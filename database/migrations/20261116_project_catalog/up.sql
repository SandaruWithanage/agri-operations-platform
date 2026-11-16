-- Provisional organization-wide project catalog. No enrollment, roles or projects are seeded.
CREATE SCHEMA operations;
REVOKE ALL ON SCHEMA operations FROM PUBLIC;
CREATE ROLE agri_project_function_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE agri_project_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA operations,authz,authz_crypto,farm TO agri_project_function_owner;
GRANT USAGE ON SCHEMA operations,authz TO agri_project_runtime;
GRANT EXECUTE ON FUNCTION authz.actor() TO agri_project_function_owner,agri_project_runtime;
GRANT SELECT ON authz.context_key,authz.permission_grant TO agri_project_function_owner;
GRANT UPDATE(active) ON authz.permission_grant TO agri_project_function_owner;
GRANT SELECT(id,name),UPDATE(name) ON farm.organization TO agri_project_function_owner;
GRANT CREATE ON SCHEMA operations TO agri_project_function_owner;

CREATE FUNCTION operations.allowed_organization(p_org uuid,p_permission text,p_source text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; grant_row record; checked_at timestamptz;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_org IS NULL OR p_permission IS NULL THEN RETURN false; END IF;
  IF NOT ((p_permission='project.create' AND p_source IS NOT DISTINCT FROM 'administrator')
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

CREATE TABLE operations.project (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES farm.organization(id),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL DEFAULT authz.actor() REFERENCES authn.account(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,organization_id)
);
CREATE INDEX project_organization_idx ON operations.project(organization_id,id);
ALTER TABLE operations.project ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.project FORCE ROW LEVEL SECURITY;
CREATE POLICY project_read ON operations.project FOR SELECT TO agri_project_runtime
  USING(operations.allowed_organization(organization_id,'project.read',NULL));
CREATE POLICY project_insert ON operations.project FOR INSERT TO agri_project_function_owner
  WITH CHECK(created_by=authz.actor() AND version=1 AND operations.allowed_organization(organization_id,'project.create','administrator'));
REVOKE ALL ON operations.project FROM PUBLIC;
GRANT SELECT(id,organization_id,name,active,version,created_at) ON operations.project TO agri_project_runtime;
GRANT INSERT(id,organization_id,name,active) ON operations.project TO agri_project_function_owner;

CREATE TABLE operations.project_mutation (
  id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES authn.account(id),
  project_id uuid NOT NULL REFERENCES operations.project(id) DEFERRABLE INITIALLY DEFERRED,
  payload_mac bytea NOT NULL CHECK(octet_length(payload_mac)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE operations.audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES operations.project(id),
  actor_id uuid NOT NULL REFERENCES authn.account(id),session_id uuid NOT NULL REFERENCES authn.login_session(id),
  action text NOT NULL CHECK(action='project.create'),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON operations.project_mutation,operations.audit FROM PUBLIC;
GRANT SELECT,INSERT ON operations.project_mutation TO agri_project_function_owner;
GRANT INSERT ON operations.audit TO agri_project_function_owner;
CREATE FUNCTION operations.register_project(p_mutation uuid,p_project uuid,p_org uuid,p_name text,p_active boolean,p_source text)
RETURNS TABLE(project_id uuid,replayed boolean) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; canonical_name text; signing_key bytea; payload bytea; inserted uuid; prior record;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_mutation IS NULL OR p_project IS NULL OR p_org IS NULL OR p_name IS NULL OR p_active IS NULL THEN RAISE EXCEPTION 'Project creation denied' USING ERRCODE='42501'; END IF;
  canonical_name:=btrim(p_name);
  IF length(canonical_name) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid project' USING ERRCODE='22023'; END IF;
  IF operations.allowed_organization(p_org,'project.create',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Project creation denied' USING ERRCODE='42501'; END IF;
  SELECT key INTO signing_key FROM authz.context_key WHERE id=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project creation denied' USING ERRCODE='42501'; END IF;
  payload:=authz_crypto.hmac(convert_to('project-catalog-v1:'||jsonb_build_array(p_project,p_org,canonical_name,p_active,p_source)::text,'UTF8'),signing_key,'sha256');
  INSERT INTO operations.project_mutation(id,actor_id,project_id,payload_mac) VALUES(p_mutation,actor,p_project,payload) ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN
    SELECT m.actor_id,m.project_id,m.payload_mac INTO prior FROM operations.project_mutation m WHERE m.id=p_mutation;
    IF NOT FOUND OR prior.actor_id<>actor OR prior.project_id<>p_project OR prior.payload_mac<>payload THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT p_project,true; RETURN;
  END IF;
  INSERT INTO operations.project(id,organization_id,name,active) VALUES(p_project,p_org,canonical_name,p_active);
  INSERT INTO operations.audit(project_id,actor_id,session_id,action) VALUES(p_project,actor,current_setting('agri.session',true)::uuid,'project.create');
  RETURN QUERY SELECT p_project,false;
END $$;
CREATE FUNCTION operations.creation_organizations(p_source text) RETURNS TABLE(id uuid,name text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT o.id,o.name FROM farm.organization o WHERE operations.allowed_organization(o.id,'project.create',p_source) ORDER BY o.id LIMIT 10001
$$;
CREATE FUNCTION operations.organization_name(p_org uuid) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT o.name FROM farm.organization o WHERE o.id=p_org AND operations.allowed_organization(o.id,'project.read',NULL)
$$;
ALTER FUNCTION operations.organization_name(uuid) OWNER TO agri_project_function_owner;
REVOKE ALL ON FUNCTION operations.organization_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.organization_name(uuid) TO agri_project_runtime;
ALTER FUNCTION operations.register_project(uuid,uuid,uuid,text,boolean,text) OWNER TO agri_project_function_owner;
ALTER FUNCTION operations.creation_organizations(text) OWNER TO agri_project_function_owner;
REVOKE CREATE ON SCHEMA operations FROM agri_project_function_owner;
REVOKE ALL ON FUNCTION operations.register_project(uuid,uuid,uuid,text,boolean,text),operations.creation_organizations(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.register_project(uuid,uuid,uuid,text,boolean,text),operations.creation_organizations(text) TO agri_project_runtime;
