-- Development-only shared login attempt throttle. No raw login names or client addresses are stored.
CREATE TABLE authn.login_attempt_bucket (
  bucket_key bytea PRIMARY KEY CHECK (octet_length(bucket_key) = 32),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 0),
  blocked_until timestamptz
);
REVOKE ALL ON authn.login_attempt_bucket FROM PUBLIC;
CREATE ROLE agri_login_throttle NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA authn TO agri_login_throttle;
GRANT SELECT, INSERT, UPDATE ON authn.login_attempt_bucket TO agri_authn_function_owner;
GRANT CREATE ON SCHEMA authn TO agri_authn_function_owner;

-- Keys must be HMACs produced by the trusted auth service using distinct domains.
CREATE FUNCTION authn.consume_login_attempt(p_account_key bytea, p_client_key bytea, p_limit integer, p_window_seconds integer, p_block_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE bucket authn.login_attempt_bucket%ROWTYPE; k bytea; current_time_value timestamptz; allowed boolean := true;
BEGIN
  IF p_account_key IS NULL OR p_client_key IS NULL OR octet_length(p_account_key) <> 32 OR octet_length(p_client_key) <> 32 OR p_limit IS NULL OR p_limit < 1 OR p_limit > 20 OR p_window_seconds IS NULL OR p_window_seconds < 60 OR p_window_seconds > 3600 OR p_block_seconds IS NULL OR p_block_seconds < 60 OR p_block_seconds > 86400 THEN RETURN false; END IF;
  -- Always lock keys in deterministic order to avoid cross-bucket deadlocks.
  FOR k IN SELECT DISTINCT value FROM unnest(ARRAY[p_account_key, p_client_key]) AS value ORDER BY value LOOP
    INSERT INTO authn.login_attempt_bucket (bucket_key, window_started_at, attempts)
      VALUES (k, clock_timestamp(), 0) ON CONFLICT (bucket_key) DO NOTHING;
  END LOOP;
  PERFORM 1 FROM authn.login_attempt_bucket WHERE bucket_key IN (p_account_key, p_client_key) ORDER BY bucket_key FOR UPDATE;
  current_time_value := clock_timestamp();
  FOR bucket IN SELECT * FROM authn.login_attempt_bucket WHERE bucket_key IN (p_account_key, p_client_key) ORDER BY bucket_key LOOP
    IF bucket.blocked_until IS NOT NULL AND bucket.blocked_until > current_time_value THEN
      allowed := false;
    ELSIF bucket.window_started_at + make_interval(secs => p_window_seconds) <= current_time_value THEN
      UPDATE authn.login_attempt_bucket SET window_started_at = current_time_value, attempts = 0, blocked_until = NULL WHERE bucket_key = bucket.bucket_key;
    ELSIF bucket.attempts >= p_limit THEN
      UPDATE authn.login_attempt_bucket SET blocked_until = current_time_value + make_interval(secs => p_block_seconds) WHERE bucket_key = bucket.bucket_key;
      allowed := false;
    END IF;
  END LOOP;
  IF allowed THEN UPDATE authn.login_attempt_bucket SET attempts = attempts + 1 WHERE bucket_key IN (p_account_key, p_client_key); END IF;
  RETURN allowed;
END $$;
ALTER FUNCTION authn.consume_login_attempt(bytea, bytea, integer, integer, integer) OWNER TO agri_authn_function_owner;
REVOKE CREATE ON SCHEMA authn FROM agri_authn_function_owner;
REVOKE ALL ON FUNCTION authn.consume_login_attempt(bytea, bytea, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authn.consume_login_attempt(bytea, bytea, integer, integer, integer) TO agri_login_throttle;
