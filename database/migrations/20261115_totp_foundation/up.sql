-- Development-only MFA storage and replay protection. Requires the two preceding authn migrations.
-- This does not validate a TOTP code or issue an authenticated session by itself.
CREATE TABLE authn.mfa_factor (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES authn.account(id),
  key_id text NOT NULL CHECK (length(key_id) BETWEEN 1 AND 100),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 20 AND 128),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  enrolled_at timestamptz,
  disabled_at timestamptz,
  last_used_counter bigint NOT NULL DEFAULT -1 CHECK (last_used_counter >= -1)
);
CREATE UNIQUE INDEX mfa_one_active_per_account ON authn.mfa_factor (account_id) WHERE disabled_at IS NULL;
REVOKE ALL ON authn.mfa_factor FROM PUBLIC;
CREATE ROLE agri_mfa_verifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA authn TO agri_mfa_verifier;
GRANT SELECT ON authn.mfa_factor TO agri_authn_function_owner;
GRANT UPDATE (last_used_counter) ON authn.mfa_factor TO agri_authn_function_owner;
GRANT CREATE ON SCHEMA authn TO agri_authn_function_owner;

-- Callers must first verify a password and must never expose this function directly to browsers.
CREATE FUNCTION authn.read_mfa_factor(p_account_id uuid)
RETURNS TABLE(factor_id uuid, key_id text, nonce bytea, ciphertext bytea, auth_tag bytea, last_used_counter bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT f.id, f.key_id, f.nonce, f.ciphertext, f.auth_tag, f.last_used_counter
  FROM authn.mfa_factor f JOIN authn.account a ON a.id = f.account_id
  WHERE f.account_id = p_account_id AND a.active AND f.enrolled_at IS NOT NULL AND f.disabled_at IS NULL
$$;

-- This only enforces monotonicity and a narrow time window. The caller must verify the OTP before invoking it.
CREATE FUNCTION authn.consume_mfa_counter(p_account_id uuid, p_factor_id uuid, p_counter bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE f authn.mfa_factor%ROWTYPE; account_active boolean; current_counter bigint;
BEGIN
  IF p_account_id IS NULL OR p_factor_id IS NULL OR p_counter IS NULL OR p_counter < 0 THEN RETURN false; END IF;
  SELECT * INTO f FROM authn.mfa_factor WHERE id = p_factor_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND OR f.enrolled_at IS NULL OR f.disabled_at IS NOT NULL THEN RETURN false; END IF;
  SELECT active INTO account_active FROM authn.account WHERE id = p_account_id FOR SHARE;
  IF NOT FOUND OR account_active IS DISTINCT FROM true THEN RETURN false; END IF;
  current_counter := floor(extract(epoch FROM clock_timestamp()) / 30)::bigint;
  IF p_counter <= f.last_used_counter OR p_counter < current_counter - 1 OR p_counter > current_counter + 1 THEN RETURN false; END IF;
  UPDATE authn.mfa_factor SET last_used_counter = p_counter WHERE id = f.id;
  RETURN true;
END $$;

ALTER FUNCTION authn.read_mfa_factor(uuid) OWNER TO agri_authn_function_owner;
ALTER FUNCTION authn.consume_mfa_counter(uuid, uuid, bigint) OWNER TO agri_authn_function_owner;
REVOKE CREATE ON SCHEMA authn FROM agri_authn_function_owner;
REVOKE ALL ON FUNCTION authn.read_mfa_factor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION authn.consume_mfa_counter(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authn.read_mfa_factor(uuid) TO agri_mfa_verifier;
GRANT EXECUTE ON FUNCTION authn.consume_mfa_counter(uuid, uuid, bigint) TO agri_mfa_verifier;
