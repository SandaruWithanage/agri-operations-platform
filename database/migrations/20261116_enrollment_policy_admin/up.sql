-- Audited, versioned administration of per-project enrollment policy (PRJ-03B).
-- Authority is a dedicated organization-level `enrollment.policy` administrator grant: catalog edit authority
-- (`project.update`) and enrollment authority never imply it. No grant is seeded; policies stay default-deny
-- until an authorized administrator creates and enables one. No client rule (DEC-04 open) is encoded here.
CREATE OR REPLACE FUNCTION operations.allowed_organization(p_org uuid,p_permission text,p_source text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; grant_row record; checked_at timestamptz;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_org IS NULL OR p_permission IS NULL THEN RETURN false; END IF;
  IF NOT ((p_permission IN ('project.create','project.update','enrollment.policy') AND p_source IS NOT DISTINCT FROM 'administrator')
       OR (p_permission='project.read' AND p_source IS NULL)) THEN RETURN false; END IF;
  PERFORM 1 FROM farm.organization o WHERE o.id=p_org FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- A narrower assigned/geography/unit/source grant must never become organization-wide access.
  FOR grant_row IN SELECT g.* FROM authz.permission_grant g
    WHERE g.account_id=actor AND g.organization_id=p_org AND g.permission=p_permission
      AND g.coverage='organization' AND g.geography_id IS NULL AND g.unit_id IS NULL
      AND g.registration_source IS NOT DISTINCT FROM p_source
    ORDER BY g.id FOR SHARE
  LOOP
    checked_at:=clock_timestamp();
    IF grant_row.active AND grant_row.starts_at<=checked_at
       AND (grant_row.expires_at IS NULL OR grant_row.expires_at>checked_at)
       AND authz.actor() IS NOT DISTINCT FROM actor THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
ALTER FUNCTION operations.allowed_organization(uuid,text,text) OWNER TO agri_project_function_owner;
REVOKE ALL ON FUNCTION operations.allowed_organization(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.allowed_organization(uuid,text,text) TO agri_project_runtime,agri_enrollment_owner;

-- Private idempotency journal / immutable history and audit; unreachable by any API login.
CREATE TABLE operations.enrollment_policy_change (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES authn.account(id),
  project_id uuid NOT NULL REFERENCES operations.project(id),
  expected_version integer NOT NULL CHECK(expected_version>=0 AND expected_version<2147483646),
  version integer NOT NULL CHECK(version=expected_version+1),
  payload_mac bytea NOT NULL CHECK(octet_length(payload_mac)=32),
  old_enabled boolean,
  old_statuses text[],
  new_enabled boolean NOT NULL,
  new_statuses text[] NOT NULL CHECK(cardinality(new_statuses)>0),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((expected_version=0)=(old_enabled IS NULL AND old_statuses IS NULL)),
  UNIQUE(id,project_id,version),
  UNIQUE(project_id,version)
);
CREATE TABLE operations.enrollment_policy_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES operations.project(id),
  actor_id uuid NOT NULL REFERENCES authn.account(id),
  session_id uuid NOT NULL REFERENCES authn.login_session(id),
  action text NOT NULL CHECK(action='enrollment.policy.set'),
  record_version integer NOT NULL CHECK(record_version>0),
  change_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(change_id,project_id,record_version) REFERENCES operations.enrollment_policy_change(id,project_id,version)
);
REVOKE ALL ON operations.enrollment_policy_change,operations.enrollment_policy_audit FROM PUBLIC;
GRANT SELECT,INSERT ON operations.enrollment_policy_change TO agri_enrollment_owner;
GRANT INSERT ON operations.enrollment_policy_audit TO agri_enrollment_owner;

-- The owner may now write the policy row, but only for a project whose organization the actor administers.
DROP POLICY enrollment_policy_lock ON operations.enrollment_policy;
REVOKE UPDATE(version) ON operations.enrollment_policy FROM agri_enrollment_owner;
GRANT INSERT(project_id,enabled,eligible_farmer_statuses,version) ON operations.enrollment_policy TO agri_enrollment_owner;
GRANT UPDATE(enabled,eligible_farmer_statuses,version) ON operations.enrollment_policy TO agri_enrollment_owner;
CREATE FUNCTION operations.enrollment_policy_admin(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT COALESCE(bool_and(operations.allowed_organization(p.organization_id,'project.read',NULL)
    AND operations.allowed_organization(p.organization_id,'enrollment.policy','administrator')),false)
  FROM operations.project p WHERE p.id=p_project
$$;
ALTER FUNCTION operations.enrollment_policy_admin(uuid) OWNER TO agri_enrollment_owner;
REVOKE ALL ON FUNCTION operations.enrollment_policy_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.enrollment_policy_admin(uuid) TO agri_project_runtime,agri_enrollment_owner;
CREATE POLICY enrollment_policy_insert ON operations.enrollment_policy FOR INSERT TO agri_enrollment_owner
  WITH CHECK(version=1 AND operations.enrollment_policy_admin(project_id));
-- Row visibility for locks (enroll_farmer takes FOR SHARE) stays open to the owner; changes need admin authority.
CREATE POLICY enrollment_policy_update ON operations.enrollment_policy FOR UPDATE TO agri_enrollment_owner
  USING(true) WITH CHECK(operations.enrollment_policy_admin(project_id));
-- Administrators read the policy through the runtime login; others see nothing.
GRANT SELECT(project_id,enabled,eligible_farmer_statuses,version) ON operations.enrollment_policy TO agri_project_runtime;
CREATE POLICY enrollment_policy_admin_read ON operations.enrollment_policy FOR SELECT TO agri_project_runtime
  USING(operations.enrollment_policy_admin(project_id));

CREATE FUNCTION operations.enrollment_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.version IS DISTINCT FROM OLD.version+1 THEN
    RAISE EXCEPTION 'Invalid enrollment policy transition' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION operations.enrollment_policy_guard() FROM PUBLIC;
CREATE TRIGGER enrollment_policy_guard BEFORE UPDATE ON operations.enrollment_policy
  FOR EACH ROW EXECUTE FUNCTION operations.enrollment_policy_guard();

GRANT CREATE ON SCHEMA operations TO agri_enrollment_owner;
CREATE FUNCTION operations.set_enrollment_policy(p_mutation uuid,p_project uuid,p_expected integer,p_enabled boolean,p_statuses text[],p_source text)
RETURNS TABLE(project_id uuid,version integer,replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; organization uuid; statuses text[]; signing_key bytea; payload bytea; prior record; current_row record; next_version integer;
        denied constant text:='Enrollment policy change denied';
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_mutation IS NULL OR p_project IS NULL OR p_expected IS NULL OR p_enabled IS NULL OR p_statuses IS NULL
     OR p_source IS DISTINCT FROM 'administrator' THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  IF p_expected NOT BETWEEN 0 AND 2147483645 OR array_position(p_statuses,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Invalid enrollment policy' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(array_agg(DISTINCT s ORDER BY s),ARRAY[]::text[]) INTO statuses FROM unnest(p_statuses) AS s;
  IF cardinality(statuses) NOT BETWEEN 1 AND 16 OR NOT (statuses <@ ARRAY['draft','pending-review','verified','inactive']::text[]) THEN
    RAISE EXCEPTION 'Invalid enrollment policy' USING ERRCODE='22023'; END IF;
  SELECT p.organization_id INTO organization FROM operations.project p WHERE p.id=p_project;
  IF NOT FOUND OR operations.allowed_organization(organization,'project.read',NULL) IS DISTINCT FROM true
     OR operations.allowed_organization(organization,'enrollment.policy',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  SELECT key INTO signing_key FROM authz.context_key WHERE id=true;
  IF NOT FOUND THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  payload:=authz_crypto.hmac(convert_to('enrollment-policy-v1:'||jsonb_build_array(p_project,p_expected,p_enabled,statuses,p_source)::text,'UTF8'),signing_key,'sha256');
  -- Serialize the mutation, then the project policy (also covers first creation), before reading the row.
  PERFORM pg_advisory_xact_lock(hashtextextended('agri-enrollment-policy-mutation:'||p_mutation::text,0));
  SELECT c.actor_id,c.project_id,c.payload_mac,c.version INTO prior FROM operations.enrollment_policy_change c WHERE c.id=p_mutation;
  IF FOUND THEN
    IF prior.actor_id<>actor OR prior.project_id<>p_project OR prior.payload_mac<>payload THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE='23505'; END IF;
    IF authz.actor() IS DISTINCT FROM actor OR operations.enrollment_policy_admin(p_project) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
    RETURN QUERY SELECT p_project,prior.version,true; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agri-enrollment-policy-project:'||p_project::text,0));
  SELECT pol.enabled,pol.eligible_farmer_statuses,pol.version INTO current_row FROM operations.enrollment_policy pol WHERE pol.project_id=p_project FOR UPDATE;
  IF authz.actor() IS DISTINCT FROM actor OR operations.enrollment_policy_admin(p_project) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  IF NOT FOUND THEN
    IF p_expected<>0 THEN RAISE EXCEPTION 'Enrollment policy version conflict' USING ERRCODE='40001'; END IF;
    next_version:=1;
    INSERT INTO operations.enrollment_policy(project_id,enabled,eligible_farmer_statuses,version) VALUES(p_project,p_enabled,statuses,1);
    INSERT INTO operations.enrollment_policy_change(id,actor_id,project_id,expected_version,version,payload_mac,new_enabled,new_statuses)
      VALUES(p_mutation,actor,p_project,0,1,payload,p_enabled,statuses);
  ELSE
    IF p_expected=0 OR current_row.version<>p_expected THEN RAISE EXCEPTION 'Enrollment policy version conflict' USING ERRCODE='40001'; END IF;
    IF current_row.enabled=p_enabled AND current_row.eligible_farmer_statuses=statuses THEN RAISE EXCEPTION 'No enrollment policy change' USING ERRCODE='22023'; END IF;
    next_version:=current_row.version+1;
    UPDATE operations.enrollment_policy pol SET enabled=p_enabled,eligible_farmer_statuses=statuses,version=next_version WHERE pol.project_id=p_project AND pol.version=p_expected;
    IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment policy version conflict' USING ERRCODE='40001'; END IF;
    INSERT INTO operations.enrollment_policy_change(id,actor_id,project_id,expected_version,version,payload_mac,old_enabled,old_statuses,new_enabled,new_statuses)
      VALUES(p_mutation,actor,p_project,p_expected,next_version,payload,current_row.enabled,current_row.eligible_farmer_statuses,p_enabled,statuses);
  END IF;
  INSERT INTO operations.enrollment_policy_audit(project_id,actor_id,session_id,action,record_version,change_id)
    VALUES(p_project,actor,current_setting('agri.session',true)::uuid,'enrollment.policy.set',next_version,p_mutation);
  RETURN QUERY SELECT p_project,next_version,false;
END $$;
ALTER FUNCTION operations.set_enrollment_policy(uuid,uuid,integer,boolean,text[],text) OWNER TO agri_enrollment_owner;
REVOKE CREATE ON SCHEMA operations FROM agri_enrollment_owner;
REVOKE ALL ON FUNCTION operations.set_enrollment_policy(uuid,uuid,integer,boolean,text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.set_enrollment_policy(uuid,uuid,integer,boolean,text[],text) TO agri_project_runtime;
