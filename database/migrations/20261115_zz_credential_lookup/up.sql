-- Development-only credential lookup. Invoke only from a trusted, rate-limited auth service.
CREATE ROLE agri_credential_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA authn TO agri_credential_reader;
GRANT SELECT (login_name, password_hash) ON authn.account TO agri_authn_function_owner;
GRANT CREATE ON SCHEMA authn TO agri_authn_function_owner;
CREATE FUNCTION authn.find_credential(p_login_name text)
RETURNS TABLE(account_id uuid, password_hash text, active boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.id, a.password_hash, a.active FROM authn.account a
  WHERE a.login_name = p_login_name AND length(p_login_name) BETWEEN 1 AND 200
$$;
ALTER FUNCTION authn.find_credential(text) OWNER TO agri_authn_function_owner;
REVOKE CREATE ON SCHEMA authn FROM agri_authn_function_owner;
REVOKE ALL ON FUNCTION authn.find_credential(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authn.find_credential(text) TO agri_credential_reader;
