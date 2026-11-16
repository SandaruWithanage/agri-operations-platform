-- Versioned catalog metadata edits only. No enrollment or permission grant is seeded.
CREATE OR REPLACE FUNCTION operations.allowed_organization(p_org uuid,p_permission text,p_source text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; grant_row record; checked_at timestamptz;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_org IS NULL OR p_permission IS NULL THEN RETURN false; END IF;
  IF NOT ((p_permission IN ('project.create','project.update') AND p_source IS NOT DISTINCT FROM 'administrator')
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
GRANT EXECUTE ON FUNCTION operations.allowed_organization(uuid,text,text) TO agri_project_runtime;

GRANT SELECT(id,organization_id,name,active,version) ON operations.project TO agri_project_function_owner;
GRANT UPDATE(name,active,version) ON operations.project TO agri_project_function_owner;
CREATE POLICY project_edit_read ON operations.project FOR SELECT TO agri_project_function_owner
  USING(operations.allowed_organization(organization_id,'project.read',NULL) AND operations.allowed_organization(organization_id,'project.update','administrator'));
CREATE POLICY project_edit ON operations.project FOR UPDATE TO agri_project_function_owner
  USING(operations.allowed_organization(organization_id,'project.read',NULL) AND operations.allowed_organization(organization_id,'project.update','administrator'))
  WITH CHECK(operations.allowed_organization(organization_id,'project.read',NULL) AND operations.allowed_organization(organization_id,'project.update','administrator'));

CREATE TABLE operations.project_change (
  id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES authn.account(id),
  project_id uuid NOT NULL,organization_id uuid NOT NULL,
  expected_version integer NOT NULL CHECK(expected_version>0 AND expected_version<2147483647),
  version integer NOT NULL CHECK(version=expected_version+1),
  payload_mac bytea NOT NULL CHECK(octet_length(payload_mac)=32),
  old_name text NOT NULL CHECK(length(btrim(old_name)) BETWEEN 1 AND 200),
  new_name text NOT NULL CHECK(length(btrim(new_name)) BETWEEN 1 AND 200),
  old_active boolean NOT NULL,new_active boolean NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,organization_id) REFERENCES operations.project(id,organization_id),
  UNIQUE(id,project_id,version)
);
REVOKE ALL ON operations.project_change FROM PUBLIC;
GRANT SELECT,INSERT ON operations.project_change TO agri_project_function_owner;
CREATE INDEX project_change_history_idx ON operations.project_change(project_id,version);
ALTER TABLE operations.audit ADD COLUMN record_version integer NOT NULL DEFAULT 1 CHECK(record_version>0);
ALTER TABLE operations.audit ADD COLUMN change_id uuid;
ALTER TABLE operations.audit DROP CONSTRAINT audit_action_check;
ALTER TABLE operations.audit ADD CONSTRAINT audit_action_version_check CHECK(
  (action='project.create' AND record_version=1 AND change_id IS NULL)
  OR (action='project.update' AND record_version>1 AND change_id IS NOT NULL)
);
ALTER TABLE operations.audit ADD FOREIGN KEY(change_id,project_id,record_version) REFERENCES operations.project_change(id,project_id,version);
GRANT CREATE ON SCHEMA operations TO agri_project_function_owner;
CREATE FUNCTION operations.change_project(p_mutation uuid,p_project uuid,p_expected integer,p_name text,p_active boolean,p_source text)
RETURNS TABLE(project_id uuid,version integer,replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; organization uuid; canonical_name text; signing_key bytea; payload bytea; prior record; current_row record; next_version integer;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_mutation IS NULL OR p_project IS NULL OR p_expected IS NULL OR p_name IS NULL OR p_active IS NULL
     OR p_source IS DISTINCT FROM 'administrator' THEN RAISE EXCEPTION 'Project change denied' USING ERRCODE='42501'; END IF;
  canonical_name:=btrim(p_name);
  IF p_expected NOT BETWEEN 1 AND 2147483646 OR length(canonical_name) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid project change' USING ERRCODE='22023'; END IF;
  SELECT p.organization_id INTO organization FROM operations.project p WHERE p.id=p_project;
  IF NOT FOUND OR operations.allowed_organization(organization,'project.read',NULL) IS DISTINCT FROM true
     OR operations.allowed_organization(organization,'project.update',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Project change denied' USING ERRCODE='42501'; END IF;
  SELECT key INTO signing_key FROM authz.context_key WHERE id=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project change denied' USING ERRCODE='42501'; END IF;
  payload:=authz_crypto.hmac(convert_to('project-change-v1:'||jsonb_build_array(p_project,organization,p_expected,canonical_name,p_active,p_source)::text,'UTF8'),signing_key,'sha256');
  -- Serialize the mutation before locking a project; equal retries cannot create two changes.
  PERFORM pg_advisory_xact_lock(hashtextextended('agri-project-change:'||p_mutation::text,0));
  SELECT c.actor_id,c.project_id,c.payload_mac,c.version INTO prior FROM operations.project_change c WHERE c.id=p_mutation;
  IF FOUND THEN
    IF prior.actor_id<>actor OR prior.project_id<>p_project OR prior.payload_mac<>payload THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE='23505'; END IF;
    -- Waiting on a mutation lock must not preserve an expired session or grant.
    IF authz.actor() IS DISTINCT FROM actor OR operations.allowed_organization(organization,'project.read',NULL) IS DISTINCT FROM true
       OR operations.allowed_organization(organization,'project.update',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Project change denied' USING ERRCODE='42501'; END IF;
    RETURN QUERY SELECT p_project,prior.version,true; RETURN;
  END IF;
  SELECT p.organization_id,p.name,p.active,p.version INTO current_row FROM operations.project p WHERE p.id=p_project FOR UPDATE;
  IF NOT FOUND OR current_row.organization_id<>organization OR authz.actor() IS DISTINCT FROM actor
     OR operations.allowed_organization(organization,'project.read',NULL) IS DISTINCT FROM true
     OR operations.allowed_organization(organization,'project.update',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Project change denied' USING ERRCODE='42501'; END IF;
  IF current_row.version<>p_expected THEN RAISE EXCEPTION 'Project version conflict' USING ERRCODE='40001'; END IF;
  IF current_row.name=canonical_name AND current_row.active=p_active THEN RAISE EXCEPTION 'No project change' USING ERRCODE='22023'; END IF;
  next_version:=current_row.version+1;
  UPDATE operations.project p SET name=canonical_name,active=p_active,version=next_version WHERE p.id=p_project AND p.version=p_expected;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project version conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO operations.project_change(id,actor_id,project_id,organization_id,expected_version,version,payload_mac,old_name,new_name,old_active,new_active)
    VALUES(p_mutation,actor,p_project,organization,p_expected,next_version,payload,current_row.name,canonical_name,current_row.active,p_active);
  INSERT INTO operations.audit(project_id,actor_id,session_id,action,record_version,change_id)
    VALUES(p_project,actor,current_setting('agri.session',true)::uuid,'project.update',next_version,p_mutation);
  RETURN QUERY SELECT p_project,next_version,false;
END $$;
ALTER FUNCTION operations.change_project(uuid,uuid,integer,text,boolean,text) OWNER TO agri_project_function_owner;
REVOKE CREATE ON SCHEMA operations FROM agri_project_function_owner;
REVOKE ALL ON FUNCTION operations.change_project(uuid,uuid,integer,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.change_project(uuid,uuid,integer,text,boolean,text) TO agri_project_runtime;

