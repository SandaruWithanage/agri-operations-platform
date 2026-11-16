-- Provisional explicit farmer/project enrollment (ADR 0019). DEC-04 is open: rules below are provisional.
-- No enrollment, grant, assignment, role or project is seeded. Runtime gets read-only access through RLS;
-- writes happen only in the two fixed functions owned by a NOLOGIN identity that is never an API login.
CREATE ROLE agri_enrollment_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

-- Withdrawal is a separate permission; existing grants are preserved (the new set is a superset).
ALTER TABLE authz.project_permission_grant DROP CONSTRAINT project_permission_grant_permission_check;
ALTER TABLE authz.project_permission_grant DROP CONSTRAINT project_permission_grant_check1;
ALTER TABLE authz.project_permission_grant ADD CONSTRAINT project_permission_grant_permission_check
  CHECK(permission IN ('enrollment.read','enrollment.create','enrollment.withdraw'));
ALTER TABLE authz.project_permission_grant ADD CONSTRAINT project_permission_grant_source_check
  CHECK((permission='enrollment.read' AND registration_source IS NULL)
     OR (permission IN ('enrollment.create','enrollment.withdraw') AND registration_source IS NOT NULL));
GRANT CREATE ON SCHEMA authz TO agri_project_scope_owner;
CREATE OR REPLACE FUNCTION authz.allowed_project_geography(p_project uuid,p_geography uuid,p_permission text,p_source text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; current_actor uuid; project_org uuid; target record; grant_row record; assignment_row record;
  ancestors uuid[]; cycle_found boolean; checked_at timestamptz;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_project IS NULL OR p_geography IS NULL OR p_permission IS NULL THEN RETURN false; END IF;
  IF ((p_permission='enrollment.read' AND p_source IS NULL)
      OR (p_permission IN ('enrollment.create','enrollment.withdraw') AND p_source IN ('administrator','field_officer'))) IS DISTINCT FROM true THEN RETURN false; END IF;
  SELECT p.organization_id INTO project_org FROM operations.project p WHERE p.id=p_project FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT g.organization_id,g.unit_id,g.active INTO target FROM farm.geography g WHERE g.id=p_geography FOR SHARE;
  IF NOT FOUND OR target.active IS DISTINCT FROM true OR target.organization_id<>project_org THEN RETURN false; END IF;
  LOCK TABLE farm.organizational_unit IN SHARE MODE;
  IF target.unit_id IS NOT NULL THEN
    WITH RECURSIVE lineage AS (
      SELECT u.id,u.parent_id,ARRAY[u.id] AS path,false AS cycle FROM farm.organizational_unit u
        WHERE u.id=target.unit_id AND u.organization_id=project_org
      UNION ALL
      SELECT parent.id,parent.parent_id,child.path||parent.id,parent.id=ANY(child.path)
        FROM farm.organizational_unit parent JOIN lineage child ON parent.id=child.parent_id
        WHERE parent.organization_id=project_org AND NOT child.cycle
    ) SELECT array_agg(id),bool_or(cycle) INTO ancestors,cycle_found FROM lineage;
    IF cycle_found IS DISTINCT FROM false THEN RETURN false; END IF;
  ELSE ancestors:=ARRAY[]::uuid[]; END IF;
  FOR grant_row IN SELECT g.* FROM authz.project_permission_grant g
    WHERE g.account_id=actor AND g.organization_id=project_org AND g.project_id=p_project
      AND g.permission=p_permission AND g.registration_source IS NOT DISTINCT FROM p_source
    ORDER BY g.id FOR SHARE
  LOOP
    checked_at:=clock_timestamp();
    IF NOT grant_row.active OR grant_row.starts_at>checked_at OR (grant_row.expires_at IS NOT NULL AND grant_row.expires_at<=checked_at)
      OR (grant_row.geography_id IS NOT NULL AND grant_row.geography_id<>p_geography)
      OR (grant_row.unit_id IS NOT NULL AND NOT grant_row.unit_id=ANY(ancestors)) THEN CONTINUE; END IF;
    FOR assignment_row IN SELECT a.* FROM authz.project_assignment a
      WHERE a.account_id=actor AND a.organization_id=project_org AND a.project_id=p_project ORDER BY a.id FOR SHARE
    LOOP
      -- Obtain all locks, then check actor and both validity windows at the latest time.
      current_actor:=authz.actor(); checked_at:=clock_timestamp();
      IF current_actor IS NOT DISTINCT FROM actor AND assignment_row.active AND assignment_row.starts_at<=checked_at
        AND (assignment_row.expires_at IS NULL OR assignment_row.expires_at>checked_at)
        AND grant_row.starts_at<=checked_at AND (grant_row.expires_at IS NULL OR grant_row.expires_at>checked_at)
        AND (assignment_row.geography_id IS NULL OR assignment_row.geography_id=p_geography)
        AND (assignment_row.unit_id IS NULL OR assignment_row.unit_id=ANY(ancestors)) THEN RETURN true; END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END $$;
ALTER FUNCTION authz.allowed_project_geography(uuid,uuid,text,text) OWNER TO agri_project_scope_owner;
REVOKE CREATE ON SCHEMA authz FROM agri_project_scope_owner;
REVOKE ALL ON FUNCTION authz.allowed_project_geography(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.allowed_project_geography(uuid,uuid,text,text) TO agri_project_runtime,agri_enrollment_owner;
GRANT EXECUTE ON FUNCTION authz.allowed(uuid,text,text) TO agri_enrollment_owner;
GRANT EXECUTE ON FUNCTION authz.actor() TO agri_enrollment_owner;

GRANT USAGE ON SCHEMA operations,authz,authz_crypto,farm TO agri_enrollment_owner;
GRANT SELECT ON authz.context_key TO agri_enrollment_owner;
-- Identity/lock access only. Functions disclose nothing before the scope predicate passes.
GRANT SELECT(id,organization_id,active),UPDATE(id) ON operations.project TO agri_enrollment_owner;
CREATE POLICY enrollment_project_identity ON operations.project FOR SELECT TO agri_enrollment_owner USING(true);
CREATE POLICY enrollment_project_lock ON operations.project FOR UPDATE TO agri_enrollment_owner USING(true) WITH CHECK(false);
GRANT SELECT(id,organization_id,active) ON farm.geography TO agri_enrollment_owner;
-- Farmers are visible to the owner only where the actor currently has farmer.read. Row locks need UPDATE.
GRANT SELECT(id,geography_id,status,version),UPDATE(id) ON farm.farmer TO agri_enrollment_owner;
CREATE POLICY farmer_enrollment_read ON farm.farmer FOR SELECT TO agri_enrollment_owner USING(authz.allowed(geography_id,'farmer.read',NULL));
CREATE POLICY farmer_enrollment_lock ON farm.farmer FOR UPDATE TO agri_enrollment_owner USING(authz.allowed(geography_id,'farmer.read',NULL)) WITH CHECK(false);

CREATE TABLE operations.enrollment (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  farmer_id uuid NOT NULL REFERENCES farm.farmer(id),
  status text NOT NULL CHECK(status IN ('enrolled','withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0 AND version<2147483647),
  enrolled_by uuid NOT NULL DEFAULT authz.actor() REFERENCES authn.account(id),
  enrolled_source text NOT NULL CHECK(enrolled_source IN ('administrator','field_officer')),
  enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  withdrawn_by uuid REFERENCES authn.account(id),
  withdrawn_source text CHECK(withdrawn_source IN ('administrator','field_officer')),
  withdrawn_at timestamptz,
  FOREIGN KEY(project_id,organization_id) REFERENCES operations.project(id,organization_id),
  CHECK((status='enrolled' AND version=1 AND withdrawn_by IS NULL AND withdrawn_source IS NULL AND withdrawn_at IS NULL)
     OR (status='withdrawn' AND version>1 AND withdrawn_by IS NOT NULL AND withdrawn_source IS NOT NULL AND withdrawn_at IS NOT NULL))
);
-- One current enrollment per farmer and project; withdrawn rows are history and never reopened.
CREATE UNIQUE INDEX enrollment_one_current_idx ON operations.enrollment(project_id,farmer_id) WHERE status='enrolled';
CREATE INDEX enrollment_project_idx ON operations.enrollment(project_id,id);
CREATE INDEX enrollment_farmer_idx ON operations.enrollment(farmer_id,id);
REVOKE ALL ON operations.enrollment FROM PUBLIC;
ALTER TABLE operations.enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.enrollment FORCE ROW LEVEL SECURITY;

GRANT CREATE ON SCHEMA operations TO agri_enrollment_owner;
-- Single authority for record visibility: project scope on the farmer's current geography AND farmer.read.
CREATE FUNCTION operations.enrollment_permitted(p_project uuid,p_farmer uuid,p_permission text,p_source text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE geography uuid;
BEGIN
  IF authz.actor() IS NULL OR p_project IS NULL OR p_farmer IS NULL OR p_permission IS NULL THEN RETURN false; END IF;
  IF p_permission NOT IN ('enrollment.read','enrollment.create','enrollment.withdraw') THEN RETURN false; END IF;
  SELECT f.geography_id INTO geography FROM farm.farmer f WHERE f.id=p_farmer;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN authz.allowed_project_geography(p_project,geography,p_permission,p_source) IS NOT DISTINCT FROM true;
END $$;
ALTER FUNCTION operations.enrollment_permitted(uuid,uuid,text,text) OWNER TO agri_enrollment_owner;
REVOKE ALL ON FUNCTION operations.enrollment_permitted(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.enrollment_permitted(uuid,uuid,text,text) TO agri_project_runtime,agri_enrollment_owner;

CREATE POLICY enrollment_read ON operations.enrollment FOR SELECT TO agri_project_runtime
  USING(operations.enrollment_permitted(project_id,farmer_id,'enrollment.read',NULL));
CREATE POLICY enrollment_owner_read ON operations.enrollment FOR SELECT TO agri_enrollment_owner
  USING(operations.enrollment_permitted(project_id,farmer_id,'enrollment.read',NULL));
CREATE POLICY enrollment_insert ON operations.enrollment FOR INSERT TO agri_enrollment_owner
  WITH CHECK(status='enrolled' AND version=1 AND enrolled_by=authz.actor()
    AND operations.enrollment_permitted(project_id,farmer_id,'enrollment.read',NULL)
    AND operations.enrollment_permitted(project_id,farmer_id,'enrollment.create',enrolled_source));
CREATE POLICY enrollment_withdraw ON operations.enrollment FOR UPDATE TO agri_enrollment_owner
  USING(operations.enrollment_permitted(project_id,farmer_id,'enrollment.read',NULL))
  WITH CHECK(status='withdrawn' AND withdrawn_by=authz.actor()
    AND operations.enrollment_permitted(project_id,farmer_id,'enrollment.read',NULL)
    AND operations.enrollment_permitted(project_id,farmer_id,'enrollment.withdraw',withdrawn_source));
-- Defense in depth: the only transition is enrolled -> withdrawn, one version at a time; nothing else may change.
CREATE FUNCTION operations.enrollment_transition_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'enrolled' THEN RAISE EXCEPTION 'Enrollment is not current' USING ERRCODE='55000'; END IF;
  IF NEW.status IS DISTINCT FROM 'withdrawn' OR NEW.version IS DISTINCT FROM OLD.version+1
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.farmer_id IS DISTINCT FROM OLD.farmer_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Invalid enrollment transition' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION operations.enrollment_transition_guard() FROM PUBLIC;
CREATE TRIGGER enrollment_transition_guard BEFORE UPDATE ON operations.enrollment
  FOR EACH ROW EXECUTE FUNCTION operations.enrollment_transition_guard();
GRANT SELECT(id,organization_id,project_id,farmer_id,status,version,enrolled_at,withdrawn_at) ON operations.enrollment TO agri_project_runtime;
GRANT SELECT ON operations.enrollment TO agri_enrollment_owner;
GRANT INSERT(id,organization_id,project_id,farmer_id,status,enrolled_source) ON operations.enrollment TO agri_enrollment_owner;
GRANT UPDATE(status,version,withdrawn_by,withdrawn_source,withdrawn_at) ON operations.enrollment TO agri_enrollment_owner;

-- Private idempotency journal and audit; unreachable by any API login.
CREATE TABLE operations.enrollment_mutation (
  id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES authn.account(id),
  kind text NOT NULL CHECK(kind IN ('enroll','withdraw')),
  enrollment_id uuid NOT NULL REFERENCES operations.enrollment(id),
  payload_mac bytea NOT NULL CHECK(octet_length(payload_mac)=32),
  result_version integer NOT NULL CHECK(result_version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,enrollment_id)
);
CREATE TABLE operations.enrollment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES operations.enrollment(id),
  project_id uuid NOT NULL REFERENCES operations.project(id),
  farmer_id uuid NOT NULL REFERENCES farm.farmer(id),
  actor_id uuid NOT NULL REFERENCES authn.account(id),
  session_id uuid NOT NULL REFERENCES authn.login_session(id),
  action text NOT NULL CHECK(action IN ('enrollment.create','enrollment.withdraw')),
  record_version integer NOT NULL CHECK(record_version>0),
  mutation_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(mutation_id,enrollment_id) REFERENCES operations.enrollment_mutation(id,enrollment_id),
  CHECK((action='enrollment.create' AND record_version=1) OR (action='enrollment.withdraw' AND record_version>1))
);
CREATE INDEX enrollment_audit_history_idx ON operations.enrollment_audit(enrollment_id,record_version);
REVOKE ALL ON operations.enrollment_mutation,operations.enrollment_audit FROM PUBLIC;
GRANT SELECT,INSERT ON operations.enrollment_mutation TO agri_enrollment_owner;
GRANT INSERT ON operations.enrollment_audit TO agri_enrollment_owner;

CREATE FUNCTION operations.enroll_farmer(p_mutation uuid,p_enrollment uuid,p_project uuid,p_farmer uuid,p_source text)
RETURNS TABLE(enrollment_id uuid,version integer,replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; organization uuid; signing_key bytea; payload bytea; prior record; farmer_row record; project_row record; denied constant text:='Enrollment denied';
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_mutation IS NULL OR p_enrollment IS NULL OR p_project IS NULL OR p_farmer IS NULL
     OR p_source IS NULL OR p_source NOT IN ('administrator','field_officer') THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  IF operations.enrollment_permitted(p_project,p_farmer,'enrollment.read',NULL) IS DISTINCT FROM true
     OR operations.enrollment_permitted(p_project,p_farmer,'enrollment.create',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  SELECT key INTO signing_key FROM authz.context_key WHERE id=true;
  IF NOT FOUND THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  payload:=authz_crypto.hmac(convert_to('project-enrollment-v1:'||jsonb_build_array('enroll',p_enrollment,p_project,p_farmer,p_source)::text,'UTF8'),signing_key,'sha256');
  -- Serialize the mutation, then the farmer/project pair, before locking rows; stable order avoids deadlocks.
  PERFORM pg_advisory_xact_lock(hashtextextended('agri-enrollment-mutation:'||p_mutation::text,0));
  SELECT m.actor_id,m.kind,m.enrollment_id,m.payload_mac,m.result_version INTO prior FROM operations.enrollment_mutation m WHERE m.id=p_mutation;
  IF FOUND THEN
    IF prior.actor_id<>actor OR prior.kind<>'enroll' OR prior.enrollment_id<>p_enrollment OR prior.payload_mac<>payload THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE='23505'; END IF;
    -- A replay never preserves an expired session, grant or assignment.
    IF authz.actor() IS DISTINCT FROM actor
       OR operations.enrollment_permitted(p_project,p_farmer,'enrollment.read',NULL) IS DISTINCT FROM true
       OR operations.enrollment_permitted(p_project,p_farmer,'enrollment.create',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
    RETURN QUERY SELECT p_enrollment,prior.result_version,true; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agri-enrollment-pair:'||p_project::text||':'||p_farmer::text,0));
  SELECT f.status INTO farmer_row FROM farm.farmer f WHERE f.id=p_farmer FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  SELECT p.organization_id,p.active INTO project_row FROM operations.project p WHERE p.id=p_project FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  organization:=project_row.organization_id;
  -- After every wait, authorization is evaluated again at the latest time.
  IF authz.actor() IS DISTINCT FROM actor
     OR operations.enrollment_permitted(p_project,p_farmer,'enrollment.read',NULL) IS DISTINCT FROM true
     OR operations.enrollment_permitted(p_project,p_farmer,'enrollment.create',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  -- Provisional eligibility (DEC-04 open): active project, non-inactive farmer. Not a client-approved rule.
  IF project_row.active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Project is not accepting enrollments' USING ERRCODE='55000'; END IF;
  IF farmer_row.status='inactive' THEN RAISE EXCEPTION 'Farmer is not eligible for enrollment' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM operations.enrollment e WHERE e.project_id=p_project AND e.farmer_id=p_farmer AND e.status='enrolled') THEN
    RAISE EXCEPTION 'Farmer is already enrolled' USING ERRCODE='23505'; END IF;
  INSERT INTO operations.enrollment(id,organization_id,project_id,farmer_id,status,enrolled_source) VALUES(p_enrollment,organization,p_project,p_farmer,'enrolled',p_source);
  INSERT INTO operations.enrollment_mutation(id,actor_id,kind,enrollment_id,payload_mac,result_version) VALUES(p_mutation,actor,'enroll',p_enrollment,payload,1);
  INSERT INTO operations.enrollment_audit(enrollment_id,project_id,farmer_id,actor_id,session_id,action,record_version,mutation_id)
    VALUES(p_enrollment,p_project,p_farmer,actor,current_setting('agri.session',true)::uuid,'enrollment.create',1,p_mutation);
  RETURN QUERY SELECT p_enrollment,1,false;
END $$;

CREATE FUNCTION operations.withdraw_enrollment(p_mutation uuid,p_enrollment uuid,p_expected integer,p_source text)
RETURNS TABLE(enrollment_id uuid,version integer,replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; signing_key bytea; payload bytea; prior record; target record; current_row record; next_version integer; farmer_status text; denied constant text:='Enrollment withdrawal denied';
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_mutation IS NULL OR p_enrollment IS NULL OR p_expected IS NULL
     OR p_source IS NULL OR p_source NOT IN ('administrator','field_officer') THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  IF p_expected NOT BETWEEN 1 AND 2147483645 THEN RAISE EXCEPTION 'Invalid enrollment withdrawal' USING ERRCODE='22023'; END IF;
  -- Row-level security hides enrollments the actor cannot currently read.
  SELECT e.project_id,e.farmer_id INTO target FROM operations.enrollment e WHERE e.id=p_enrollment;
  IF NOT FOUND
     OR operations.enrollment_permitted(target.project_id,target.farmer_id,'enrollment.read',NULL) IS DISTINCT FROM true
     OR operations.enrollment_permitted(target.project_id,target.farmer_id,'enrollment.withdraw',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  SELECT key INTO signing_key FROM authz.context_key WHERE id=true;
  IF NOT FOUND THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  payload:=authz_crypto.hmac(convert_to('project-enrollment-v1:'||jsonb_build_array('withdraw',p_enrollment,p_expected,p_source)::text,'UTF8'),signing_key,'sha256');
  PERFORM pg_advisory_xact_lock(hashtextextended('agri-enrollment-mutation:'||p_mutation::text,0));
  SELECT m.actor_id,m.kind,m.enrollment_id,m.payload_mac,m.result_version INTO prior FROM operations.enrollment_mutation m WHERE m.id=p_mutation;
  IF FOUND THEN
    IF prior.actor_id<>actor OR prior.kind<>'withdraw' OR prior.enrollment_id<>p_enrollment OR prior.payload_mac<>payload THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE='23505'; END IF;
    IF authz.actor() IS DISTINCT FROM actor
       OR operations.enrollment_permitted(target.project_id,target.farmer_id,'enrollment.read',NULL) IS DISTINCT FROM true
       OR operations.enrollment_permitted(target.project_id,target.farmer_id,'enrollment.withdraw',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
    RETURN QUERY SELECT p_enrollment,prior.result_version,true; RETURN;
  END IF;
  SELECT f.status INTO farmer_status FROM farm.farmer f WHERE f.id=target.farmer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  SELECT e.status,e.version INTO current_row FROM operations.enrollment e WHERE e.id=p_enrollment FOR UPDATE;
  IF NOT FOUND OR authz.actor() IS DISTINCT FROM actor
     OR operations.enrollment_permitted(target.project_id,target.farmer_id,'enrollment.read',NULL) IS DISTINCT FROM true
     OR operations.enrollment_permitted(target.project_id,target.farmer_id,'enrollment.withdraw',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  IF current_row.version<>p_expected THEN RAISE EXCEPTION 'Enrollment version conflict' USING ERRCODE='40001'; END IF;
  IF current_row.status<>'enrolled' THEN RAISE EXCEPTION 'Enrollment is not current' USING ERRCODE='55000'; END IF;
  next_version:=current_row.version+1;
  UPDATE operations.enrollment e SET status='withdrawn',version=next_version,withdrawn_by=actor,withdrawn_source=p_source,withdrawn_at=clock_timestamp()
    WHERE e.id=p_enrollment AND e.version=p_expected AND e.status='enrolled';
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment version conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO operations.enrollment_mutation(id,actor_id,kind,enrollment_id,payload_mac,result_version) VALUES(p_mutation,actor,'withdraw',p_enrollment,payload,next_version);
  INSERT INTO operations.enrollment_audit(enrollment_id,project_id,farmer_id,actor_id,session_id,action,record_version,mutation_id)
    VALUES(p_enrollment,target.project_id,target.farmer_id,actor,current_setting('agri.session',true)::uuid,'enrollment.withdraw',next_version,p_mutation);
  RETURN QUERY SELECT p_enrollment,next_version,false;
END $$;
ALTER FUNCTION operations.enroll_farmer(uuid,uuid,uuid,uuid,text) OWNER TO agri_enrollment_owner;
ALTER FUNCTION operations.withdraw_enrollment(uuid,uuid,integer,text) OWNER TO agri_enrollment_owner;
REVOKE CREATE ON SCHEMA operations FROM agri_enrollment_owner;
REVOKE ALL ON FUNCTION operations.enroll_farmer(uuid,uuid,uuid,uuid,text),operations.withdraw_enrollment(uuid,uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.enroll_farmer(uuid,uuid,uuid,uuid,text),operations.withdraw_enrollment(uuid,uuid,integer,text) TO agri_project_runtime;
