-- Bounded configured choices for a future online correction editor.
GRANT CREATE ON SCHEMA farm TO agri_policy_owner;
CREATE FUNCTION farm.correction_geographies(p_farmer uuid,p_after uuid,p_limit integer)
RETURNS TABLE(current_version integer,source_geography uuid,geographies jsonb,next_cursor uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source record;
BEGIN
  IF authz.actor() IS NULL OR p_farmer IS NULL THEN RAISE EXCEPTION 'Correction choices denied' USING ERRCODE='42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid correction choices query' USING ERRCODE='22023'; END IF;
  SELECT f.version,f.geography_id INTO source FROM farm.farmer f WHERE f.id=p_farmer FOR SHARE;
  IF NOT FOUND OR authz.allowed(source.geography_id,'farmer.read',NULL) IS DISTINCT FROM true OR authz.allowed(source.geography_id,'farmer.correct',NULL) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Correction choices denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY WITH eligible AS MATERIALIZED (
    SELECT g.id,g.name FROM farm.geography g WHERE g.active AND (p_after IS NULL OR g.id>p_after)
      AND authz.allowed(g.id,'farmer.read',NULL) AND authz.allowed(g.id,'farmer.correct',NULL)
    ORDER BY g.id LIMIT p_limit+1
  ) SELECT source.version,source.geography_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',shown.id,'name',shown.name) ORDER BY shown.id) FROM (SELECT e.id,e.name FROM eligible e ORDER BY e.id LIMIT p_limit) shown),'[]'::jsonb),
    CASE WHEN EXISTS(SELECT 1 FROM eligible OFFSET p_limit) THEN (SELECT e.id FROM eligible e ORDER BY e.id OFFSET p_limit-1 LIMIT 1) ELSE NULL::uuid END;
END $$;
ALTER FUNCTION farm.correction_geographies(uuid,uuid,integer) OWNER TO agri_policy_owner;
REVOKE CREATE ON SCHEMA farm FROM agri_policy_owner;
REVOKE ALL ON FUNCTION farm.correction_geographies(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION farm.correction_geographies(uuid,uuid,integer) TO agri_farmer_runtime;
