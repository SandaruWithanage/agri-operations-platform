-- Provisional minimal farmer authorization. Apply in a single transaction in a disposable DB.
-- The context signing key must be provisioned separately. No production credentials are included.
CREATE SCHEMA authz;
CREATE SCHEMA farm;
CREATE SCHEMA authz_crypto;
REVOKE ALL ON SCHEMA authz, farm, authz_crypto FROM PUBLIC;
CREATE EXTENSION pgcrypto WITH SCHEMA authz_crypto;
CREATE ROLE agri_policy_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE agri_farmer_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE TABLE authz.context_key (id boolean PRIMARY KEY DEFAULT true CHECK (id), key bytea NOT NULL CHECK (octet_length(key) >= 32));
CREATE TABLE farm.organization (id uuid PRIMARY KEY, name text NOT NULL CHECK (length(btrim(name)) > 0));
CREATE TABLE farm.organizational_unit (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES farm.organization(id), parent_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) > 0), UNIQUE(id, organization_id),
  FOREIGN KEY (parent_id, organization_id) REFERENCES farm.organizational_unit(id, organization_id),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE TABLE farm.geography (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES farm.organization(id), unit_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) > 0), active boolean NOT NULL DEFAULT true,
  UNIQUE(id, organization_id), FOREIGN KEY(unit_id, organization_id) REFERENCES farm.organizational_unit(id, organization_id)
);
CREATE TABLE authz.permission_grant (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES authn.account(id), organization_id uuid NOT NULL REFERENCES farm.organization(id),
  permission text NOT NULL, coverage text NOT NULL CHECK (coverage IN ('organization', 'assigned')),
  geography_id uuid, unit_id uuid, registration_source text CHECK (registration_source IN ('field_officer', 'administrator')),
  active boolean NOT NULL DEFAULT true, starts_at timestamptz NOT NULL, expires_at timestamptz,
  FOREIGN KEY(geography_id, organization_id) REFERENCES farm.geography(id, organization_id),
  FOREIGN KEY(unit_id, organization_id) REFERENCES farm.organizational_unit(id, organization_id),
  CHECK (expires_at IS NULL OR starts_at < expires_at)
);
CREATE TABLE authz.assignment (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES authn.account(id), organization_id uuid NOT NULL REFERENCES farm.organization(id),
  geography_id uuid, unit_id uuid, active boolean NOT NULL DEFAULT true, starts_at timestamptz NOT NULL, expires_at timestamptz,
  FOREIGN KEY(geography_id, organization_id) REFERENCES farm.geography(id, organization_id),
  FOREIGN KEY(unit_id, organization_id) REFERENCES farm.organizational_unit(id, organization_id),
  CHECK (geography_id IS NOT NULL OR unit_id IS NOT NULL), CHECK (expires_at IS NULL OR starts_at < expires_at)
);

REVOKE ALL ON ALL TABLES IN SCHEMA authz, farm FROM PUBLIC;
GRANT USAGE ON SCHEMA authz, farm, authz_crypto, authn TO agri_policy_owner;
GRANT USAGE ON SCHEMA authz, farm TO agri_farmer_runtime;
GRANT SELECT ON authz.context_key, authz.permission_grant, authz.assignment, farm.geography, farm.organizational_unit TO agri_policy_owner;
-- PostgreSQL requires UPDATE permission for row locks; the NOLOGIN owner can only be reached through fixed functions.
GRANT UPDATE (active) ON authz.permission_grant, authz.assignment, farm.geography TO agri_policy_owner;
GRANT UPDATE ON farm.organizational_unit TO agri_policy_owner;
GRANT SELECT (id, account_id, device_id, device_required, idle_expires_at, absolute_expires_at, revoked_at), UPDATE (idle_expires_at) ON authn.login_session TO agri_policy_owner;
GRANT SELECT (id, active), UPDATE (active) ON authn.account TO agri_policy_owner;
GRANT SELECT (id, account_id, state, revoked_at), UPDATE (state) ON authn.device TO agri_policy_owner;
GRANT CREATE ON SCHEMA authz TO agri_policy_owner;

-- Caller-controlled settings are accepted only with an HMAC bound to actor, session and transaction ID.
CREATE FUNCTION authz.actor() RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor_text text; session_text text; signature_text text; supplied bytea; expected bytea; key_value bytea; actor_id uuid; session_id uuid;
  session_row record; a_active boolean; d_state text; d_revoked timestamptz; difference integer := 0; i integer; checked_at timestamptz;
BEGIN
  actor_text := current_setting('agri.actor', true); session_text := current_setting('agri.session', true); signature_text := current_setting('agri.signature', true);
  IF actor_text IS NULL OR session_text IS NULL OR signature_text IS NULL OR signature_text !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  BEGIN actor_id := actor_text::uuid; session_id := session_text::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END;
  IF actor_text <> actor_id::text OR session_text <> session_id::text THEN RETURN NULL; END IF;
  SELECT key INTO key_value FROM authz.context_key WHERE id = true;
  IF NOT FOUND THEN RETURN NULL; END IF;
  supplied := decode(signature_text, 'hex');
  expected := authz_crypto.hmac(convert_to(actor_text || ':' || session_text || ':' || txid_current()::text, 'UTF8'), key_value, 'sha256');
  FOR i IN 0..31 LOOP difference := difference | (get_byte(supplied, i) # get_byte(expected, i)); END LOOP;
  IF difference <> 0 THEN RETURN NULL; END IF;
  SELECT ls.account_id, ls.device_id, ls.device_required, ls.idle_expires_at, ls.absolute_expires_at, ls.revoked_at INTO session_row FROM authn.login_session ls WHERE ls.id = session_id FOR SHARE;
  IF NOT FOUND OR session_row.account_id <> actor_id OR session_row.revoked_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT active INTO a_active FROM authn.account WHERE id = actor_id FOR SHARE;
  IF NOT FOUND OR a_active IS DISTINCT FROM true THEN RETURN NULL; END IF;
  IF session_row.device_required AND session_row.device_id IS NULL THEN RETURN NULL; END IF;
  IF session_row.device_id IS NOT NULL THEN
    SELECT state, revoked_at INTO d_state, d_revoked FROM authn.device WHERE id = session_row.device_id AND account_id = actor_id FOR SHARE;
    IF NOT FOUND OR d_state IS DISTINCT FROM 'approved' OR d_revoked IS NOT NULL THEN RETURN NULL; END IF;
  END IF;
  checked_at := clock_timestamp();
  IF session_row.idle_expires_at <= checked_at OR session_row.absolute_expires_at <= checked_at THEN RETURN NULL; END IF;
  RETURN actor_id;
END $$;

CREATE FUNCTION authz.allowed(p_geography uuid, p_permission text, p_source text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor_id uuid; target record; grant_row record; assignment_row record; ancestors uuid[]; cycle_found boolean; now_value timestamptz;
BEGIN
  actor_id := authz.actor(); IF actor_id IS NULL THEN RETURN false; END IF;
  SELECT id, organization_id, unit_id, active INTO target FROM farm.geography WHERE id = p_geography FOR SHARE;
  IF NOT FOUND OR target.active IS DISTINCT FROM true THEN RETURN false; END IF;
  -- Serialize hierarchy changes while evaluating ancestry; optimize only with equivalent locking tests.
  LOCK TABLE farm.organizational_unit IN SHARE MODE;
  IF target.unit_id IS NOT NULL THEN
    WITH RECURSIVE lineage AS (
      SELECT u.id, u.parent_id, ARRAY[u.id] AS path, false AS cycle FROM farm.organizational_unit u WHERE u.id = target.unit_id AND u.organization_id = target.organization_id
      UNION ALL
      SELECT parent.id, parent.parent_id, child.path || parent.id, parent.id = ANY(child.path)
      FROM farm.organizational_unit parent JOIN lineage child ON parent.id = child.parent_id
      WHERE parent.organization_id = target.organization_id AND NOT child.cycle
    ) SELECT array_agg(id), bool_or(cycle) INTO ancestors, cycle_found FROM lineage;
    IF cycle_found IS DISTINCT FROM false THEN RETURN false; END IF;
  ELSE ancestors := ARRAY[]::uuid[]; END IF;
  FOR grant_row IN SELECT * FROM authz.permission_grant WHERE account_id = actor_id AND organization_id = target.organization_id AND permission = p_permission FOR SHARE LOOP
    now_value := clock_timestamp();
    IF NOT grant_row.active OR grant_row.starts_at > now_value OR (grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= now_value) OR (grant_row.geography_id IS NOT NULL AND grant_row.geography_id <> p_geography) OR (grant_row.unit_id IS NOT NULL AND NOT grant_row.unit_id = ANY(ancestors)) OR (p_source IS NOT NULL AND grant_row.registration_source IS DISTINCT FROM p_source) THEN CONTINUE; END IF;
    IF grant_row.coverage = 'organization' THEN RETURN authz.actor() = actor_id AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp()); END IF;
    FOR assignment_row IN SELECT * FROM authz.assignment WHERE account_id = actor_id AND organization_id = target.organization_id FOR SHARE LOOP
      now_value := clock_timestamp();
      IF assignment_row.active AND assignment_row.starts_at <= now_value AND (assignment_row.expires_at IS NULL OR assignment_row.expires_at > now_value) AND (assignment_row.geography_id IS NULL OR assignment_row.geography_id = p_geography) AND (assignment_row.unit_id IS NULL OR assignment_row.unit_id = ANY(ancestors)) THEN RETURN authz.actor() = actor_id AND (grant_row.expires_at IS NULL OR grant_row.expires_at > clock_timestamp()) AND (assignment_row.expires_at IS NULL OR assignment_row.expires_at > clock_timestamp()); END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END $$;
ALTER FUNCTION authz.actor() OWNER TO agri_policy_owner;
ALTER FUNCTION authz.allowed(uuid, text, text) OWNER TO agri_policy_owner;
REVOKE CREATE ON SCHEMA authz FROM agri_policy_owner;
REVOKE ALL ON FUNCTION authz.actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.allowed(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.actor() TO agri_farmer_runtime;
GRANT EXECUTE ON FUNCTION authz.allowed(uuid, text, text) TO agri_farmer_runtime;

CREATE TABLE farm.farmer (
  id uuid PRIMARY KEY,
  geography_id uuid NOT NULL REFERENCES farm.geography(id),
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 200),
  privacy_notice_provided boolean NOT NULL CHECK (privacy_notice_provided),
  registration_source text NOT NULL CHECK (registration_source IN ('field_officer', 'administrator')),
  status text NOT NULL DEFAULT 'pending-review' CHECK (status IN ('draft', 'pending-review', 'verified', 'inactive')),
  created_by uuid NOT NULL DEFAULT authz.actor() REFERENCES authn.account(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE farm.farmer ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm.farmer FORCE ROW LEVEL SECURITY;
CREATE POLICY farmer_read ON farm.farmer FOR SELECT TO agri_farmer_runtime USING (authz.allowed(geography_id, 'farmer.read', NULL));
CREATE POLICY farmer_create ON farm.farmer FOR INSERT TO agri_farmer_runtime WITH CHECK (created_by = authz.actor() AND status = 'pending-review' AND authz.allowed(geography_id, 'farmer.create', registration_source));
GRANT SELECT (id, geography_id, full_name, privacy_notice_provided, registration_source, status, created_by, created_at) ON farm.farmer TO agri_farmer_runtime;
GRANT INSERT (id, geography_id, full_name, privacy_notice_provided, registration_source) ON farm.farmer TO agri_farmer_runtime;

CREATE TABLE farm.farmer_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), farmer_id uuid NOT NULL REFERENCES farm.farmer(id),
  actor_id uuid NOT NULL REFERENCES authn.account(id), action text NOT NULL CHECK (action = 'registration'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON farm.farmer_audit FROM PUBLIC;
GRANT INSERT ON farm.farmer_audit TO agri_policy_owner;
GRANT CREATE ON SCHEMA farm TO agri_policy_owner;
CREATE FUNCTION farm.audit_registration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO farm.farmer_audit (farmer_id, actor_id, action) VALUES (NEW.id, NEW.created_by, 'registration');
  RETURN NEW;
END $$;
ALTER FUNCTION farm.audit_registration() OWNER TO agri_policy_owner;
REVOKE CREATE ON SCHEMA farm FROM agri_policy_owner;
REVOKE ALL ON FUNCTION farm.audit_registration() FROM PUBLIC;
CREATE TRIGGER farmer_registration_audit AFTER INSERT ON farm.farmer FOR EACH ROW EXECUTE FUNCTION farm.audit_registration();

-- Mutations are visible only to the fixed SECURITY DEFINER function, never directly to runtime.
-- Definer-only visibility for duplicate checks is restricted to geographies where the actor can create.
GRANT SELECT (geography_id, full_name) ON farm.farmer TO agri_policy_owner;
CREATE POLICY farmer_duplicate_probe ON farm.farmer FOR SELECT TO agri_policy_owner USING (authz.allowed(geography_id, 'farmer.create', 'field_officer') OR authz.allowed(geography_id, 'farmer.create', 'administrator'));
CREATE TABLE farm.registration_mutation (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES authn.account(id),
  farmer_id uuid NOT NULL REFERENCES farm.farmer(id) DEFERRABLE INITIALLY DEFERRED,
  payload_mac bytea NOT NULL CHECK (octet_length(payload_mac) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE farm.registration_risk (
  mutation_id uuid NOT NULL REFERENCES farm.registration_mutation(id),
  reason text NOT NULL CHECK (reason = 'name_and_geography'),
  PRIMARY KEY (mutation_id, reason)
);
REVOKE ALL ON farm.registration_risk FROM PUBLIC;
GRANT INSERT ON farm.registration_risk TO agri_policy_owner;
REVOKE ALL ON farm.registration_mutation FROM PUBLIC;
GRANT SELECT, INSERT ON farm.registration_mutation TO agri_policy_owner;
GRANT INSERT (id, geography_id, full_name, privacy_notice_provided, registration_source) ON farm.farmer TO agri_policy_owner;
CREATE POLICY farmer_create_definer ON farm.farmer FOR INSERT TO agri_policy_owner WITH CHECK (created_by = authz.actor() AND status = 'pending-review' AND authz.allowed(geography_id, 'farmer.create', registration_source));
REVOKE INSERT (id, geography_id, full_name, privacy_notice_provided, registration_source) ON farm.farmer FROM agri_farmer_runtime;
GRANT CREATE ON SCHEMA farm TO agri_policy_owner;
CREATE FUNCTION farm.register_farmer(p_mutation_id uuid, p_farmer_id uuid, p_geography_id uuid, p_full_name text, p_notice boolean, p_source text)
RETURNS TABLE(farmer_id uuid, replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor_id uuid; key_value bytea; payload bytea; existing record; inserted uuid; canonical_name text;
BEGIN
  actor_id := authz.actor();
  IF actor_id IS NULL OR p_mutation_id IS NULL OR p_farmer_id IS NULL OR p_geography_id IS NULL OR p_full_name IS NULL OR p_notice IS DISTINCT FROM true OR p_source IS NULL THEN RAISE EXCEPTION 'Registration denied' USING ERRCODE = '42501'; END IF;
  canonical_name := btrim(p_full_name);
  IF length(canonical_name) NOT BETWEEN 1 AND 200 OR p_source NOT IN ('field_officer','administrator') THEN RAISE EXCEPTION 'Invalid registration' USING ERRCODE = '22023'; END IF;
  IF authz.allowed(p_geography_id, 'farmer.create', p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Registration denied' USING ERRCODE = '42501'; END IF;
  SELECT key INTO key_value FROM authz.context_key WHERE id = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration denied' USING ERRCODE = '42501'; END IF;
  payload := authz_crypto.hmac(convert_to('farmer-registration-v1:' || jsonb_build_object('farmer',p_farmer_id,'geography',p_geography_id,'name',canonical_name,'notice',p_notice,'source',p_source)::text, 'UTF8'), key_value, 'sha256');
  INSERT INTO farm.registration_mutation (id, actor_id, farmer_id, payload_mac) VALUES (p_mutation_id, actor_id, p_farmer_id, payload) ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN
    SELECT m.actor_id, m.farmer_id, m.payload_mac INTO existing FROM farm.registration_mutation m WHERE m.id = p_mutation_id;
    IF NOT FOUND OR existing.actor_id <> actor_id OR existing.farmer_id <> p_farmer_id OR existing.payload_mac <> payload THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE = '23505'; END IF;
    RETURN QUERY SELECT p_farmer_id, true;
    RETURN;
  END IF;
  -- Serialize new registrations within a geography for the provisional exact-name risk check.
  PERFORM pg_advisory_xact_lock(hashtextextended('agri-farmer:' || p_geography_id::text, 0));
  INSERT INTO farm.registration_risk (mutation_id, reason)
    SELECT p_mutation_id, 'name_and_geography' WHERE EXISTS (
      SELECT 1 FROM farm.farmer f WHERE f.geography_id = p_geography_id AND lower(btrim(f.full_name)) = lower(canonical_name)
    );
  INSERT INTO farm.farmer (id, geography_id, full_name, privacy_notice_provided, registration_source) VALUES (p_farmer_id, p_geography_id, canonical_name, p_notice, p_source);
  RETURN QUERY SELECT p_farmer_id, false;
END $$;
ALTER FUNCTION farm.register_farmer(uuid, uuid, uuid, text, boolean, text) OWNER TO agri_policy_owner;
REVOKE CREATE ON SCHEMA farm FROM agri_policy_owner;
REVOKE ALL ON FUNCTION farm.register_farmer(uuid, uuid, uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION farm.register_farmer(uuid, uuid, uuid, text, boolean, text) TO agri_farmer_runtime;
