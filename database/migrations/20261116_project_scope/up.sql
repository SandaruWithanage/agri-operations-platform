-- Restricted project AND geography authorization foundation. No enrollment records or grants are seeded.
CREATE ROLE agri_project_scope_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE TABLE authz.project_permission_grant (
  id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES authn.account(id),organization_id uuid NOT NULL,
  project_id uuid NOT NULL,permission text NOT NULL CHECK(permission IN ('enrollment.read','enrollment.create')),
  geography_id uuid,unit_id uuid,
  registration_source text CHECK(registration_source IN ('administrator','field_officer')),
  active boolean NOT NULL DEFAULT true,starts_at timestamptz NOT NULL,expires_at timestamptz,
  FOREIGN KEY(project_id,organization_id) REFERENCES operations.project(id,organization_id),
  FOREIGN KEY(geography_id,organization_id) REFERENCES farm.geography(id,organization_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES farm.organizational_unit(id,organization_id),
  CHECK(expires_at IS NULL OR starts_at<expires_at),
  CHECK((permission='enrollment.read' AND registration_source IS NULL)
     OR (permission='enrollment.create' AND registration_source IS NOT NULL))
);
CREATE TABLE authz.project_assignment (
  id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES authn.account(id),organization_id uuid NOT NULL,
  project_id uuid NOT NULL,geography_id uuid,unit_id uuid,
  active boolean NOT NULL DEFAULT true,starts_at timestamptz NOT NULL,expires_at timestamptz,
  FOREIGN KEY(project_id,organization_id) REFERENCES operations.project(id,organization_id),
  FOREIGN KEY(geography_id,organization_id) REFERENCES farm.geography(id,organization_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES farm.organizational_unit(id,organization_id),
  CHECK(geography_id IS NOT NULL OR unit_id IS NOT NULL),
  CHECK(expires_at IS NULL OR starts_at<expires_at)
);
CREATE INDEX project_grant_actor_idx ON authz.project_permission_grant(account_id,project_id,permission,id);
CREATE INDEX project_assignment_actor_idx ON authz.project_assignment(account_id,project_id,id);
REVOKE ALL ON authz.project_permission_grant,authz.project_assignment FROM PUBLIC;
GRANT USAGE ON SCHEMA authz,farm,operations TO agri_project_scope_owner;
GRANT EXECUTE ON FUNCTION authz.actor() TO agri_project_scope_owner;
GRANT SELECT,UPDATE(active) ON authz.project_permission_grant,authz.project_assignment TO agri_project_scope_owner;
GRANT SELECT(id,organization_id,unit_id,active),UPDATE(active) ON farm.geography TO agri_project_scope_owner;
-- SHARE table locks need table-level UPDATE; reachable only inside this fixed NOLOGIN helper.
GRANT SELECT,UPDATE ON farm.organizational_unit TO agri_project_scope_owner;
GRANT SELECT(id,organization_id),UPDATE(id) ON operations.project TO agri_project_scope_owner;
-- Only the NOLOGIN helper owner can resolve project identity without catalog permissions.
CREATE POLICY project_scope_identity ON operations.project FOR SELECT TO agri_project_scope_owner USING(true);
-- SELECT FOR SHARE also needs an UPDATE USING policy. No actual update is accepted.
CREATE POLICY project_scope_lock ON operations.project FOR UPDATE TO agri_project_scope_owner USING(true) WITH CHECK(false);
GRANT CREATE ON SCHEMA authz TO agri_project_scope_owner;
CREATE FUNCTION authz.allowed_project_geography(p_project uuid,p_geography uuid,p_permission text,p_source text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; current_actor uuid; project_org uuid; target record; grant_row record; assignment_row record;
  ancestors uuid[]; cycle_found boolean; checked_at timestamptz;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_project IS NULL OR p_geography IS NULL OR p_permission IS NULL THEN RETURN false; END IF;
  IF ((p_permission='enrollment.read' AND p_source IS NULL)
      OR (p_permission='enrollment.create' AND p_source IN ('administrator','field_officer'))) IS DISTINCT FROM true THEN RETURN false; END IF;
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
GRANT EXECUTE ON FUNCTION authz.allowed_project_geography(uuid,uuid,text,text) TO agri_project_runtime;
