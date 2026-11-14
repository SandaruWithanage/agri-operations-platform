-- Development foundation. Execute transactionally after the preceding authn migrations.
CREATE TABLE authn.session_issuance_event (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES authn.account(id),
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, account_id) REFERENCES authn.login_session(id, account_id)
);
REVOKE ALL ON authn.session_issuance_event FROM PUBLIC;
CREATE ROLE agri_session_issuer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA authn TO agri_session_issuer;
GRANT INSERT (id, account_id, device_id, device_required, cookie_secret_hash, created_at, idle_expires_at, absolute_expires_at) ON authn.login_session TO agri_authn_function_owner;
GRANT INSERT (id, account_id, session_id) ON authn.session_issuance_event TO agri_authn_function_owner;
GRANT CREATE ON SCHEMA authn TO agri_authn_function_owner;

-- Only the trusted authentication service, after verifying credentials and required MFA, may call this.
CREATE FUNCTION authn.issue_session(p_session_id uuid, p_event_id uuid, p_account_id uuid, p_device_id uuid, p_device_required boolean, p_secret_hash bytea, p_idle_seconds integer, p_absolute_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE a_active boolean; d_state text; d_revoked timestamptz; current_time_value timestamptz;
BEGIN
  IF p_session_id IS NULL OR p_event_id IS NULL OR p_account_id IS NULL OR p_device_required IS NULL OR p_secret_hash IS NULL OR octet_length(p_secret_hash) <> 32 OR p_idle_seconds IS NULL OR p_absolute_seconds IS NULL OR p_idle_seconds < 1 OR p_absolute_seconds < p_idle_seconds OR p_absolute_seconds > 2592000 OR (p_device_required AND p_device_id IS NULL) THEN RETURN false; END IF;
  SELECT active INTO a_active FROM authn.account WHERE id = p_account_id FOR SHARE;
  IF NOT FOUND OR a_active IS DISTINCT FROM true THEN RETURN false; END IF;
  IF p_device_id IS NOT NULL THEN
    SELECT state, revoked_at INTO d_state, d_revoked FROM authn.device WHERE id = p_device_id AND account_id = p_account_id FOR SHARE;
    IF NOT FOUND OR d_state IS DISTINCT FROM 'approved' OR d_revoked IS NOT NULL THEN RETURN false; END IF;
  END IF;
  current_time_value := clock_timestamp();
  INSERT INTO authn.login_session (id, account_id, device_id, device_required, cookie_secret_hash, created_at, idle_expires_at, absolute_expires_at)
    VALUES (p_session_id, p_account_id, p_device_id, p_device_required, p_secret_hash, current_time_value, current_time_value + make_interval(secs => p_idle_seconds), current_time_value + make_interval(secs => p_absolute_seconds));
  INSERT INTO authn.session_issuance_event (id, account_id, session_id) VALUES (p_event_id, p_account_id, p_session_id);
  RETURN true;
END $$;
ALTER FUNCTION authn.issue_session(uuid, uuid, uuid, uuid, boolean, bytea, integer, integer) OWNER TO agri_authn_function_owner;
REVOKE CREATE ON SCHEMA authn FROM agri_authn_function_owner;
REVOKE ALL ON FUNCTION authn.issue_session(uuid, uuid, uuid, uuid, boolean, bytea, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authn.issue_session(uuid, uuid, uuid, uuid, boolean, bytea, integer, integer) TO agri_session_issuer;
