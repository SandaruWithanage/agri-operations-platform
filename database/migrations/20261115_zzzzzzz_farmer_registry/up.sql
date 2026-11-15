-- Scoped reference labels for visible registry records. No broader geography/table grants.
GRANT CREATE ON SCHEMA farm TO agri_policy_owner;
CREATE FUNCTION farm.farmer_geography_name(p_geography uuid)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT g.name FROM farm.geography g
  WHERE g.id = p_geography AND authz.allowed(g.id, 'farmer.read', NULL)
$$;
ALTER FUNCTION farm.farmer_geography_name(uuid) OWNER TO agri_policy_owner;
REVOKE CREATE ON SCHEMA farm FROM agri_policy_owner;
REVOKE ALL ON FUNCTION farm.farmer_geography_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION farm.farmer_geography_name(uuid) TO agri_farmer_runtime;
