-- Authorized reference data only. Apply transactionally after farmer ABAC.
GRANT CREATE ON SCHEMA farm TO agri_policy_owner;
CREATE FUNCTION farm.registration_geographies(p_source text)
RETURNS TABLE(id uuid, name text) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT g.id, g.name FROM farm.geography g WHERE g.active AND authz.allowed(g.id, 'farmer.create', p_source) ORDER BY g.name, g.id
$$;
ALTER FUNCTION farm.registration_geographies(text) OWNER TO agri_policy_owner;
REVOKE CREATE ON SCHEMA farm FROM agri_policy_owner;
REVOKE ALL ON FUNCTION farm.registration_geographies(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION farm.registration_geographies(text) TO agri_farmer_runtime;
