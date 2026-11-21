-- IAM-01 slice P1-03b1 (ADR 0022 sections 1 and 11, rows 6 to 8). PLUMBING ONLY: no writer, no new authority, no role
-- binding and no materialization exists yet. Two additive changes:
--  1. Every grant and assignment row records its origin ('direct' for all existing rows) and, for a future role binding,
--     the binding id. The check below keeps the pair consistent. The predicates read named columns and are unchanged.
--  2. Every INSERT, UPDATE and DELETE on the four grant/assignment tables is recorded in an append-only audit table,
--     whoever makes it (operator, migration identity or function owner). Operators with superuser access remain a
--     process control (custody, DEC-08), not something the database can prevent.
-- Audit rows hold identifiers, the permission code and the database user only: no names, contact data or secrets.
ALTER TABLE authz.permission_grant ADD COLUMN origin text NOT NULL DEFAULT 'direct' CHECK(origin IN ('direct','role_binding'));
ALTER TABLE authz.permission_grant ADD COLUMN binding_id uuid;
ALTER TABLE authz.permission_grant ADD CONSTRAINT permission_grant_origin_binding_check CHECK((origin='role_binding')=(binding_id IS NOT NULL));
ALTER TABLE authz.assignment ADD COLUMN origin text NOT NULL DEFAULT 'direct' CHECK(origin IN ('direct','role_binding'));
ALTER TABLE authz.assignment ADD COLUMN binding_id uuid;
ALTER TABLE authz.assignment ADD CONSTRAINT assignment_origin_binding_check CHECK((origin='role_binding')=(binding_id IS NOT NULL));
ALTER TABLE authz.project_permission_grant ADD COLUMN origin text NOT NULL DEFAULT 'direct' CHECK(origin IN ('direct','role_binding'));
ALTER TABLE authz.project_permission_grant ADD COLUMN binding_id uuid;
ALTER TABLE authz.project_permission_grant ADD CONSTRAINT project_permission_grant_origin_binding_check CHECK((origin='role_binding')=(binding_id IS NOT NULL));
ALTER TABLE authz.project_assignment ADD COLUMN origin text NOT NULL DEFAULT 'direct' CHECK(origin IN ('direct','role_binding'));
ALTER TABLE authz.project_assignment ADD COLUMN binding_id uuid;
ALTER TABLE authz.project_assignment ADD CONSTRAINT project_assignment_origin_binding_check CHECK((origin='role_binding')=(binding_id IS NOT NULL));

CREATE TABLE iam.grant_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL CHECK(table_name IN ('permission_grant','assignment','project_permission_grant','project_assignment')),
  operation text NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
  row_id uuid NOT NULL,
  account_id uuid,
  organization_id uuid,
  permission text,
  origin text,
  binding_id uuid,
  db_user text NOT NULL,
  transaction_id bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON iam.grant_change_audit FROM PUBLIC;
GRANT INSERT ON iam.grant_change_audit TO agri_iam_owner;
ALTER TABLE iam.grant_change_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE iam.grant_change_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY grant_audit_owner_insert ON iam.grant_change_audit FOR INSERT TO agri_iam_owner WITH CHECK(true);

-- Append-only for everyone except a future, separately reviewed retention function.
CREATE FUNCTION iam.reject_audit_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Grant audit is append-only' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION iam.reject_audit_change() FROM PUBLIC;
CREATE TRIGGER grant_audit_append_only BEFORE UPDATE OR DELETE ON iam.grant_change_audit FOR EACH ROW EXECUTE FUNCTION iam.reject_audit_change();
CREATE TRIGGER grant_audit_no_truncate BEFORE TRUNCATE ON iam.grant_change_audit FOR EACH STATEMENT EXECUTE FUNCTION iam.reject_audit_change();

CREATE FUNCTION iam.record_grant_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;
BEGIN
  r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO iam.grant_change_audit(table_name,operation,row_id,account_id,organization_id,permission,origin,binding_id,db_user,transaction_id)
  VALUES(TG_TABLE_NAME,TG_OP,(r->>'id')::uuid,(r->>'account_id')::uuid,(r->>'organization_id')::uuid,r->>'permission',r->>'origin',(r->>'binding_id')::uuid,session_user,txid_current());
  RETURN NULL;
END $$;
ALTER FUNCTION iam.record_grant_change() OWNER TO agri_iam_owner;
REVOKE ALL ON FUNCTION iam.record_grant_change() FROM PUBLIC;
CREATE TRIGGER permission_grant_audit AFTER INSERT OR UPDATE OR DELETE ON authz.permission_grant FOR EACH ROW EXECUTE FUNCTION iam.record_grant_change();
CREATE TRIGGER assignment_audit AFTER INSERT OR UPDATE OR DELETE ON authz.assignment FOR EACH ROW EXECUTE FUNCTION iam.record_grant_change();
CREATE TRIGGER project_permission_grant_audit AFTER INSERT OR UPDATE OR DELETE ON authz.project_permission_grant FOR EACH ROW EXECUTE FUNCTION iam.record_grant_change();
CREATE TRIGGER project_assignment_audit AFTER INSERT OR UPDATE OR DELETE ON authz.project_assignment FOR EACH ROW EXECUTE FUNCTION iam.record_grant_change();
