-- Append-only device enrollment. Keys are provisioned through a controlled operator process.
CREATE TABLE authn.device_key (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL UNIQUE,
  account_id uuid NOT NULL,
  public_jwk jsonb NOT NULL,
  enrolled_by text NOT NULL DEFAULT session_user,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  FOREIGN KEY (device_id, account_id) REFERENCES authn.device(id, account_id),
  UNIQUE (id, device_id, account_id),
  CHECK (jsonb_typeof(public_jwk) = 'object' AND public_jwk ?& ARRAY['kty','crv','x','y'] AND public_jwk - ARRAY['kty','crv','x','y'] = '{}'::jsonb AND public_jwk @> '{"kty":"EC","crv":"P-256"}'::jsonb AND jsonb_typeof(public_jwk->'x') = 'string' AND jsonb_typeof(public_jwk->'y') = 'string' AND public_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$' AND public_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE TABLE authn.device_key_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES authn.device_key(id),
  kind text NOT NULL CHECK (kind IN ('enrolled','revoked')),
  initiated_by text NOT NULL DEFAULT session_user,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE authn.device_assertion (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  device_id uuid NOT NULL,
  key_id uuid NOT NULL,
  challenge_hash bytea NOT NULL UNIQUE CHECK (octet_length(challenge_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  FOREIGN KEY (key_id, device_id, account_id) REFERENCES authn.device_key(id, device_id, account_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 seconds'),
  CHECK (used_at IS NULL OR used_at >= created_at)
);
REVOKE ALL ON authn.device_key, authn.device_key_event, authn.device_assertion FROM PUBLIC;
CREATE ROLE agri_device_verifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA authn TO agri_device_verifier;
CREATE ROLE agri_device_provisioner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA authn TO agri_device_provisioner;
GRANT SELECT (id,active) ON authn.account TO agri_device_provisioner;
GRANT SELECT (id,account_id,state,revoked_at), UPDATE (state) ON authn.device TO agri_device_provisioner;
GRANT SELECT ON authn.device_key TO agri_device_provisioner;
GRANT INSERT (id,device_id,account_id,public_jwk), UPDATE (revoked_at) ON authn.device_key TO agri_device_provisioner;
GRANT SELECT ON authn.device_key, authn.device_assertion TO agri_authn_function_owner;
GRANT INSERT ON authn.device_assertion, authn.device_key_event TO agri_authn_function_owner;
GRANT UPDATE (revoked_at) ON authn.device_key TO agri_authn_function_owner;
GRANT UPDATE (used_at) ON authn.device_assertion TO agri_authn_function_owner;
GRANT UPDATE (state, revoked_at) ON authn.device TO agri_authn_function_owner;
GRANT INSERT (device_id) ON authn.revocation_event TO agri_authn_function_owner;
GRANT CREATE ON SCHEMA authn TO agri_authn_function_owner;

CREATE FUNCTION authn.audit_device_key() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Device key history cannot be deleted' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM id FROM authn.account WHERE id=NEW.account_id AND active=true FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active account required for enrollment' USING ERRCODE='42501'; END IF;
    PERFORM id FROM authn.device WHERE id=NEW.device_id AND account_id=NEW.account_id AND state='approved' AND revoked_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Approved account-bound device required for enrollment' USING ERRCODE='42501'; END IF;
    NEW.enrolled_by := session_user; NEW.created_at := clock_timestamp();
    IF NEW.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'New key must be active' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.device_id IS DISTINCT FROM OLD.device_id OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.public_jwk IS DISTINCT FROM OLD.public_jwk OR NEW.enrolled_by IS DISTINCT FROM OLD.enrolled_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'Device keys are immutable; revoke and enroll a new device' USING ERRCODE = '42501';
  END IF;
  NEW.revoked_at := clock_timestamp();
  -- Device revocation is authoritative in use_session, SessionAccess and authz.actor.
  -- Do not lock session rows here: session -> device is the existing access-check lock order.
  UPDATE authn.device SET state = 'revoked', revoked_at = NEW.revoked_at WHERE id = NEW.device_id AND account_id = NEW.account_id;
  INSERT INTO authn.revocation_event(id,target_account_id,device_id,kind) VALUES(gen_random_uuid(),NEW.account_id,NEW.device_id,'device');
  RETURN NEW;
END $$;
CREATE FUNCTION authn.record_device_key_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO authn.device_key_event(key_id,kind) VALUES(NEW.id,CASE WHEN TG_OP = 'INSERT' THEN 'enrolled' ELSE 'revoked' END);
  RETURN NEW;
END $$;
CREATE TRIGGER device_key_guard BEFORE INSERT OR UPDATE OR DELETE ON authn.device_key FOR EACH ROW EXECUTE FUNCTION authn.audit_device_key();
CREATE TRIGGER device_key_audit AFTER INSERT OR UPDATE ON authn.device_key FOR EACH ROW EXECUTE FUNCTION authn.record_device_key_event();

CREATE FUNCTION authn.read_device_key(p_account uuid, p_device uuid)
RETURNS TABLE(key_id uuid, public_jwk jsonb) LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT k.id,k.public_jwk FROM authn.device_key k JOIN authn.device d ON d.id=k.device_id AND d.account_id=k.account_id JOIN authn.account a ON a.id=k.account_id
  WHERE k.account_id=p_account AND k.device_id=p_device AND k.revoked_at IS NULL AND d.state='approved' AND d.revoked_at IS NULL AND a.active=true
$$;
-- Called only after the trusted authentication service validates server challenge and ECDSA signature.
CREATE FUNCTION authn.record_device_assertion(p_id uuid,p_account uuid,p_device uuid,p_key uuid,p_hash bytea,p_expires timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE k authn.device_key%ROWTYPE; a_active boolean; d_state text; d_revoked timestamptz; checked_at timestamptz;
BEGIN
  IF p_id IS NULL OR p_hash IS NULL OR octet_length(p_hash) <> 32 OR p_expires IS NULL THEN RETURN false; END IF;
  SELECT * INTO k FROM authn.device_key WHERE id=p_key AND account_id=p_account AND device_id=p_device FOR SHARE;
  IF NOT FOUND OR k.revoked_at IS NOT NULL THEN RETURN false; END IF;
  SELECT active INTO a_active FROM authn.account WHERE id=p_account FOR SHARE;
  IF NOT FOUND OR a_active IS DISTINCT FROM true THEN RETURN false; END IF;
  SELECT state,revoked_at INTO d_state,d_revoked FROM authn.device WHERE id=p_device AND account_id=p_account FOR SHARE;
  IF NOT FOUND OR d_state IS DISTINCT FROM 'approved' OR d_revoked IS NOT NULL THEN RETURN false; END IF;
  checked_at := clock_timestamp();
  IF p_expires <= checked_at OR p_expires > checked_at + interval '120 seconds' THEN RETURN false; END IF;
  INSERT INTO authn.device_assertion(id,account_id,device_id,key_id,challenge_hash,created_at,expires_at)
    VALUES(p_id,p_account,p_device,p_key,p_hash,checked_at,LEAST(p_expires,checked_at+interval '30 seconds')) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END $$;

CREATE FUNCTION authn.issue_device_session(p_session uuid,p_event uuid,p_account uuid,p_device uuid,p_required boolean,p_hash bytea,p_idle integer,p_absolute integer,p_assertion uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE proof authn.device_assertion%ROWTYPE; k authn.device_key%ROWTYPE;
BEGIN
  IF p_required IS DISTINCT FROM true OR p_assertion IS NULL THEN RETURN false; END IF;
  SELECT * INTO proof FROM authn.device_assertion WHERE id=p_assertion AND account_id=p_account AND device_id=p_device FOR UPDATE;
  IF NOT FOUND OR proof.used_at IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO k FROM authn.device_key WHERE id=proof.key_id AND device_id=p_device AND account_id=p_account FOR SHARE;
  IF NOT FOUND OR k.revoked_at IS NOT NULL THEN RETURN false; END IF;
  -- Legacy function locks/checks current account and device; key revocation also revokes the device.
  IF proof.expires_at <= clock_timestamp() THEN RETURN false; END IF;
  IF NOT authn.issue_session(p_session,p_event,p_account,p_device,p_required,p_hash,p_idle,p_absolute) THEN RETURN false; END IF;
  -- Recheck after any account/device lock wait. Rolling back also rolls back session + audit.
  IF proof.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Device assertion expired' USING ERRCODE='42501'; END IF;
  UPDATE authn.device_assertion SET used_at=clock_timestamp() WHERE id=p_assertion;
  RETURN true;
END $$;

ALTER FUNCTION authn.audit_device_key() OWNER TO agri_authn_function_owner;
ALTER FUNCTION authn.record_device_key_event() OWNER TO agri_authn_function_owner;
ALTER FUNCTION authn.read_device_key(uuid,uuid) OWNER TO agri_authn_function_owner;
ALTER FUNCTION authn.record_device_assertion(uuid,uuid,uuid,uuid,bytea,timestamptz) OWNER TO agri_authn_function_owner;
ALTER FUNCTION authn.issue_device_session(uuid,uuid,uuid,uuid,boolean,bytea,integer,integer,uuid) OWNER TO agri_authn_function_owner;
REVOKE ALL ON FUNCTION authn.audit_device_key(), authn.record_device_key_event(), authn.read_device_key(uuid,uuid), authn.record_device_assertion(uuid,uuid,uuid,uuid,bytea,timestamptz), authn.issue_device_session(uuid,uuid,uuid,uuid,boolean,bytea,integer,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authn.read_device_key(uuid,uuid),authn.record_device_assertion(uuid,uuid,uuid,uuid,bytea,timestamptz) TO agri_device_verifier;
GRANT EXECUTE ON FUNCTION authn.issue_device_session(uuid,uuid,uuid,uuid,boolean,bytea,integer,integer,uuid) TO agri_session_issuer;
REVOKE EXECUTE ON FUNCTION authn.issue_session(uuid,uuid,uuid,uuid,boolean,bytea,integer,integer) FROM agri_session_issuer;
REVOKE CREATE ON SCHEMA authn FROM agri_authn_function_owner;

-- Upgrade invalidates all pre-proof sessions, with a revocation event for each.
WITH revoked AS (UPDATE authn.login_session SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL RETURNING id,account_id)
INSERT INTO authn.revocation_event(id,target_account_id,session_id,kind) SELECT gen_random_uuid(),account_id,id,'session' FROM revoked;
