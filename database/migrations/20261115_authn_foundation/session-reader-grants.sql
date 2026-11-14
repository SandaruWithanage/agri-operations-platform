-- Run as an appropriately privileged provisioning identity after up.sql.
-- The group role has no login. Grant membership only to a dedicated session-reader
-- connection, never to general API connections. No credentials are created here.
CREATE ROLE agri_session_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA authn TO agri_session_reader;
GRANT SELECT (id, active) ON authn.account TO agri_session_reader;
GRANT SELECT (id, account_id, state, revoked_at) ON authn.device TO agri_session_reader;
GRANT SELECT (id, account_id, device_id, device_required, idle_expires_at, absolute_expires_at, revoked_at) ON authn.login_session TO agri_session_reader;
