-- IAM-01 slice P1-03a (ADR 0022, PROPOSED design; read-only foundation). Creates the permission catalog, staff person,
-- role and immutable role-version tables plus bounded, scoped READ functions. There is NO mutation path, NO
-- materialization into authz grants, NO account link and NO seeded role, permission, person or grant. The existing
-- predicates (authz.allowed, authz.allowed_project_geography, operations.allowed_organization) are not modified.
-- Risk classes and every default below are provisional until the client permission matrix (DEC-02) and the
-- independent review (Gate G1) exist.
CREATE SCHEMA iam;
REVOKE ALL ON SCHEMA iam FROM PUBLIC;
CREATE ROLE agri_iam_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE agri_iam_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA iam,authz TO agri_iam_owner;
GRANT USAGE ON SCHEMA farm TO agri_iam_owner;
GRANT USAGE ON SCHEMA iam,authz TO agri_iam_runtime;
GRANT EXECUTE ON FUNCTION authz.actor() TO agri_iam_owner,agri_iam_runtime;
GRANT SELECT ON authz.permission_grant TO agri_iam_owner;
GRANT UPDATE(active) ON authz.permission_grant TO agri_iam_owner; -- row-share locks, as for the project/enrollment owners
GRANT SELECT(id) ON farm.organization TO agri_iam_owner;
GRANT CREATE ON SCHEMA iam TO agri_iam_owner;

-- Known permission names. Reference data, not authority: holding a catalog row grants nothing.
CREATE TABLE iam.permission_catalog (
  permission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK(length(code) BETWEEN 3 AND 100 AND code ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'),
  label_en text NOT NULL CHECK(length(label_en) BETWEEN 1 AND 200),
  label_si text CHECK(label_si IS NULL OR length(label_si) BETWEEN 1 AND 200),
  scope_kind text NOT NULL CHECK(scope_kind IN ('organization','unit_geography','project')),
  -- Fail closed: an unclassified permission is high risk.
  risk_class text NOT NULL DEFAULT 'high' CHECK(risk_class IN ('routine','high')),
  provisional boolean NOT NULL DEFAULT true,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Staff identity per organization, separate from authn.account, farmers and contacts. A person confers no access.
CREATE TABLE iam.person (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES farm.organization(id),
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,organization_id)
);
CREATE TABLE iam.role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES farm.organization(id),
  name_en text NOT NULL CHECK(length(name_en) BETWEEN 1 AND 200),
  name_si text CHECK(name_si IS NULL OR length(name_si) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,organization_id)
);
-- Versions are immutable: editing a role creates a new version, nothing already bound changes silently.
CREATE TABLE iam.role_version (
  role_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483645),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(role_id,version),
  FOREIGN KEY(role_id,organization_id) REFERENCES iam.role(id,organization_id)
);
CREATE TABLE iam.role_version_permission (
  role_id uuid NOT NULL,
  version integer NOT NULL,
  permission_id uuid NOT NULL REFERENCES iam.permission_catalog(permission_id),
  coverage text NOT NULL CHECK(coverage IN ('organization','assigned')),
  registration_source text CHECK(registration_source IN ('field_officer','administrator')),
  PRIMARY KEY(role_id,version,permission_id),
  FOREIGN KEY(role_id,version) REFERENCES iam.role_version(role_id,version)
);
REVOKE ALL ON ALL TABLES IN SCHEMA iam FROM PUBLIC;
GRANT SELECT ON iam.permission_catalog,iam.person,iam.role,iam.role_version,iam.role_version_permission TO agri_iam_owner;
ALTER TABLE iam.permission_catalog ENABLE ROW LEVEL SECURITY; ALTER TABLE iam.permission_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE iam.person ENABLE ROW LEVEL SECURITY; ALTER TABLE iam.person FORCE ROW LEVEL SECURITY;
ALTER TABLE iam.role ENABLE ROW LEVEL SECURITY; ALTER TABLE iam.role FORCE ROW LEVEL SECURITY;
ALTER TABLE iam.role_version ENABLE ROW LEVEL SECURITY; ALTER TABLE iam.role_version FORCE ROW LEVEL SECURITY;
ALTER TABLE iam.role_version_permission ENABLE ROW LEVEL SECURITY; ALTER TABLE iam.role_version_permission FORCE ROW LEVEL SECURITY;
-- The owner may read rows so the fixed functions can filter them; the runtime login has no table access at all.
CREATE POLICY catalog_owner_read ON iam.permission_catalog FOR SELECT TO agri_iam_owner USING(true);
CREATE POLICY person_owner_read ON iam.person FOR SELECT TO agri_iam_owner USING(true);
CREATE POLICY role_owner_read ON iam.role FOR SELECT TO agri_iam_owner USING(true);
CREATE POLICY role_version_owner_read ON iam.role_version FOR SELECT TO agri_iam_owner USING(true);
CREATE POLICY role_version_permission_owner_read ON iam.role_version_permission FOR SELECT TO agri_iam_owner USING(true);

-- Role versions and their permissions never change after creation, for anyone (this slice has no writer at all).
CREATE FUNCTION iam.reject_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Role versions are immutable' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION iam.reject_change() FROM PUBLIC;
CREATE TRIGGER role_version_immutable BEFORE UPDATE OR DELETE ON iam.role_version FOR EACH ROW EXECUTE FUNCTION iam.reject_change();
CREATE TRIGGER role_version_permission_immutable BEFORE UPDATE OR DELETE ON iam.role_version_permission FOR EACH ROW EXECUTE FUNCTION iam.reject_change();
CREATE TRIGGER role_version_no_truncate BEFORE TRUNCATE ON iam.role_version FOR EACH STATEMENT EXECUTE FUNCTION iam.reject_change();
CREATE TRIGGER role_version_permission_no_truncate BEFORE TRUNCATE ON iam.role_version_permission FOR EACH STATEMENT EXECUTE FUNCTION iam.reject_change();

-- Read authority: an ACTIVE ORGANIZATION-WIDE administrator-source `role.read` grant for the signed actor.
-- A narrower assigned/geography/unit grant never becomes organization-wide access (same rule as the project catalog).
CREATE FUNCTION iam.can_read_roles(p_org uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; grant_row record; checked_at timestamptz;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_org IS NULL THEN RETURN false; END IF;
  PERFORM 1 FROM farm.organization o WHERE o.id=p_org;
  IF NOT FOUND THEN RETURN false; END IF;
  FOR grant_row IN SELECT g.* FROM authz.permission_grant g
    WHERE g.account_id=actor AND g.organization_id=p_org AND g.permission='role.read'
      AND g.coverage='organization' AND g.geography_id IS NULL AND g.unit_id IS NULL
      AND g.registration_source IS NOT DISTINCT FROM 'administrator'
    ORDER BY g.id FOR SHARE
  LOOP
    checked_at:=clock_timestamp();
    IF grant_row.active AND grant_row.starts_at<=checked_at
       AND (grant_row.expires_at IS NULL OR grant_row.expires_at>checked_at)
       AND authz.actor() IS NOT DISTINCT FROM actor THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
ALTER FUNCTION iam.can_read_roles(uuid) OWNER TO agri_iam_owner;
REVOKE ALL ON FUNCTION iam.can_read_roles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.can_read_roles(uuid) TO agri_iam_runtime,agri_iam_owner;

-- Bounded keyset lists. Not found and not permitted are indistinguishable: both return no rows.
CREATE FUNCTION iam.list_roles(p_org uuid,p_after uuid,p_limit integer)
RETURNS TABLE(id uuid,organization_id uuid,name_en text,name_si text,active boolean,latest_version integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='22023'; END IF;
  IF NOT iam.can_read_roles(p_org) THEN RETURN; END IF;
  RETURN QUERY SELECT r.id,r.organization_id,r.name_en,r.name_si,r.active,
      (SELECT max(v.version) FROM iam.role_version v WHERE v.role_id=r.id)
    FROM iam.role r WHERE r.organization_id=p_org AND (p_after IS NULL OR r.id>p_after)
    ORDER BY r.id LIMIT p_limit;
END $$;
ALTER FUNCTION iam.list_roles(uuid,uuid,integer) OWNER TO agri_iam_owner;
REVOKE ALL ON FUNCTION iam.list_roles(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.list_roles(uuid,uuid,integer) TO agri_iam_runtime;

CREATE FUNCTION iam.get_role_version(p_org uuid,p_role uuid,p_version integer)
RETURNS TABLE(permission_id uuid,code text,coverage text,registration_source text,risk_class text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_role IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'Invalid role version' USING ERRCODE='22023'; END IF;
  IF NOT iam.can_read_roles(p_org) THEN RETURN; END IF;
  RETURN QUERY SELECT c.permission_id,c.code,vp.coverage,vp.registration_source,c.risk_class
    FROM iam.role r JOIN iam.role_version_permission vp ON vp.role_id=r.id
    JOIN iam.permission_catalog c ON c.permission_id=vp.permission_id
    WHERE r.id=p_role AND r.organization_id=p_org AND vp.version=p_version
    ORDER BY c.code;
END $$;
ALTER FUNCTION iam.get_role_version(uuid,uuid,integer) OWNER TO agri_iam_owner;
REVOKE ALL ON FUNCTION iam.get_role_version(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.get_role_version(uuid,uuid,integer) TO agri_iam_runtime;

CREATE FUNCTION iam.list_permissions(p_org uuid,p_after uuid,p_limit integer)
RETURNS TABLE(permission_id uuid,code text,label_en text,label_si text,scope_kind text,risk_class text,provisional boolean,retired boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='22023'; END IF;
  IF NOT iam.can_read_roles(p_org) THEN RETURN; END IF;
  RETURN QUERY SELECT c.permission_id,c.code,c.label_en,c.label_si,c.scope_kind,c.risk_class,c.provisional,c.retired_at IS NOT NULL
    FROM iam.permission_catalog c WHERE p_after IS NULL OR c.permission_id>p_after
    ORDER BY c.permission_id LIMIT p_limit;
END $$;
ALTER FUNCTION iam.list_permissions(uuid,uuid,integer) OWNER TO agri_iam_owner;
REVOKE ALL ON FUNCTION iam.list_permissions(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.list_permissions(uuid,uuid,integer) TO agri_iam_runtime;
