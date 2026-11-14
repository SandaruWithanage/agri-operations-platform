-- Development foundation: provision using an audited privileged migration role.
-- No login roles, passwords, or API endpoints are created here.
CREATE ROLE agri_authn_function_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE agri_session_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA authn TO agri_authn_function_owner, agri_session_executor;
GRANT CREATE ON SCHEMA authn TO agri_authn_function_owner;
GRANT SELECT ON authn.login_session TO agri_authn_function_owner;
GRANT UPDATE (idle_expires_at, revoked_at) ON authn.login_session TO agri_authn_function_owner;
GRANT SELECT (id, active) ON authn.account TO agri_authn_function_owner;
GRANT UPDATE (active) ON authn.account TO agri_authn_function_owner;
GRANT SELECT (id, account_id, state, revoked_at) ON authn.device TO agri_authn_function_owner;
GRANT UPDATE (state) ON authn.device TO agri_authn_function_owner;
GRANT INSERT (id, actor_account_id, target_account_id, session_id, kind) ON authn.revocation_event TO agri_authn_function_owner;

-- The cookie digest is the credential. The actor/account is derived from the locked row.
CREATE FUNCTION authn.use_session(p_secret_hash bytea, p_idle_seconds integer)
RETURNS TABLE(session_id uuid, account_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  current_time_value timestamptz;
  s authn.login_session%ROWTYPE;
  a_active boolean;
  d_state text;
  d_revoked timestamptz;
BEGIN
  IF p_secret_hash IS NULL OR octet_length(p_secret_hash) <> 32 OR p_idle_seconds IS NULL OR p_idle_seconds < 1 OR p_idle_seconds > 86400 THEN RETURN; END IF;
  SELECT * INTO s FROM authn.login_session WHERE cookie_secret_hash = p_secret_hash FOR UPDATE;
  IF NOT FOUND OR s.revoked_at IS NOT NULL THEN RETURN; END IF;
  SELECT active INTO a_active FROM authn.account WHERE id = s.account_id FOR SHARE;
  IF NOT FOUND OR a_active IS DISTINCT FROM true THEN RETURN; END IF;
  IF s.device_required AND s.device_id IS NULL THEN RETURN; END IF;
  IF s.device_id IS NOT NULL THEN
    SELECT state, revoked_at INTO d_state, d_revoked FROM authn.device WHERE id = s.device_id AND authn.device.account_id = s.account_id FOR SHARE;
    IF NOT FOUND OR d_state IS DISTINCT FROM 'approved' OR d_revoked IS NOT NULL THEN RETURN; END IF;
  END IF;
  current_time_value := clock_timestamp();
  IF s.idle_expires_at <= current_time_value OR s.absolute_expires_at <= current_time_value THEN RETURN; END IF;
  UPDATE authn.login_session SET idle_expires_at = LEAST(current_time_value + make_interval(secs => p_idle_seconds), s.absolute_expires_at) WHERE id = s.id;
  RETURN QUERY SELECT s.id, s.account_id;
END $$;

-- Logout and its audit event are one atomic database statement.
CREATE FUNCTION authn.logout_session(p_secret_hash bytea, p_event_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s authn.login_session%ROWTYPE;
BEGIN
  IF p_secret_hash IS NULL OR octet_length(p_secret_hash) <> 32 OR p_event_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO s FROM authn.login_session WHERE cookie_secret_hash = p_secret_hash FOR UPDATE;
  IF NOT FOUND OR s.revoked_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE authn.login_session SET revoked_at = GREATEST(clock_timestamp(), s.created_at) WHERE id = s.id;
  INSERT INTO authn.revocation_event (id, actor_account_id, target_account_id, session_id, kind)
    VALUES (p_event_id, s.account_id, s.account_id, s.id, 'session');
  RETURN true;
END $$;

ALTER FUNCTION authn.use_session(bytea, integer) OWNER TO agri_authn_function_owner;
ALTER FUNCTION authn.logout_session(bytea, uuid) OWNER TO agri_authn_function_owner;
REVOKE CREATE ON SCHEMA authn FROM agri_authn_function_owner;
REVOKE ALL ON FUNCTION authn.use_session(bytea, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION authn.logout_session(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authn.use_session(bytea, integer) TO agri_session_executor;
GRANT EXECUTE ON FUNCTION authn.logout_session(bytea, uuid) TO agri_session_executor;
