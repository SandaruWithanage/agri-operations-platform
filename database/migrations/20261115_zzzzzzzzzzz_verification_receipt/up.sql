-- Account-bound recovery of the latest visible staff verification result.
-- No additional journal access or business grants for runtime logins.
CREATE INDEX farmer_own_verification_idx ON farm.farmer_change(farmer_id,actor_id,occurred_at DESC,id DESC) WHERE action='verification';
GRANT CREATE ON SCHEMA farm TO agri_policy_owner;
CREATE FUNCTION farm.latest_own_verification(p_farmer uuid)
RETURNS TABLE(mutation_id uuid,result_version integer,occurred_at text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; geography uuid;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_farmer IS NULL THEN RAISE EXCEPTION 'Verification receipt denied' USING ERRCODE='42501'; END IF;
  SELECT f.geography_id INTO geography FROM farm.farmer f WHERE f.id=p_farmer FOR SHARE;
  IF NOT FOUND OR authz.allowed(geography,'farmer.read',NULL) IS DISTINCT FROM true OR authz.allowed(geography,'farmer.verify',NULL) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Verification receipt denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT c.id,c.result_version,to_char(c.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    FROM farm.farmer_change c WHERE c.farmer_id=p_farmer AND c.actor_id=actor AND c.action='verification'
      AND authz.allowed(c.previous_geography,'farmer.read',NULL) AND authz.allowed(c.previous_geography,'farmer.verify',NULL)
      AND authz.allowed(c.result_geography,'farmer.read',NULL) AND authz.allowed(c.result_geography,'farmer.verify',NULL)
    ORDER BY c.occurred_at DESC,c.id DESC LIMIT 1;
END $$;
ALTER FUNCTION farm.latest_own_verification(uuid) OWNER TO agri_policy_owner;
REVOKE CREATE ON SCHEMA farm FROM agri_policy_owner;
REVOKE ALL ON FUNCTION farm.latest_own_verification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION farm.latest_own_verification(uuid) TO agri_farmer_runtime;
