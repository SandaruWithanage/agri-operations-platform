-- History remains separate from ordinary farmer read and change permissions.
CREATE INDEX farmer_audit_timeline_idx ON farm.farmer_audit(farmer_id,occurred_at DESC,id DESC);
GRANT SELECT ON farm.farmer_audit TO agri_policy_owner;
CREATE POLICY farmer_audit_owner_read ON farm.farmer FOR SELECT TO agri_policy_owner USING (
  authz.allowed(geography_id,'farmer.read',NULL) AND authz.allowed(geography_id,'farmer.audit.read',NULL)
);
-- PostgreSQL applies UPDATE visibility to SELECT FOR SHARE. Permit audit row
-- locking while WITH CHECK(false) prevents this policy from authorizing writes.
CREATE POLICY farmer_audit_owner_lock ON farm.farmer FOR UPDATE TO agri_policy_owner USING (
  authz.allowed(geography_id,'farmer.read',NULL) AND authz.allowed(geography_id,'farmer.audit.read',NULL)
) WITH CHECK (false);
GRANT CREATE ON SCHEMA farm TO agri_policy_owner;
CREATE FUNCTION farm.farmer_history(p_farmer uuid,p_before timestamptz,p_before_id uuid,p_limit integer)
RETURNS TABLE(event_id uuid,action text,occurred_at text,actor_id uuid,change jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_geography uuid;
BEGIN
  IF p_farmer IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 OR ((p_before IS NULL)<>(p_before_id IS NULL)) THEN RAISE EXCEPTION 'Invalid history query' USING ERRCODE='22023'; END IF;
  SELECT f.geography_id INTO current_geography FROM farm.farmer f WHERE f.id=p_farmer FOR SHARE;
  IF NOT FOUND OR authz.allowed(current_geography,'farmer.read',NULL) IS DISTINCT FROM true OR authz.allowed(current_geography,'farmer.audit.read',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'History denied' USING ERRCODE='42501'; END IF;
  RETURN QUERY
    SELECT a.id,a.action,to_char(a.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),a.actor_id,
      CASE WHEN a.change_id IS NULL THEN NULL::jsonb ELSE jsonb_build_object(
        'reason',c.reason,'previousVersion',c.previous_version,'resultVersion',c.result_version,'duplicateRisk',c.duplicate_risk,
        'previous',jsonb_build_object('fullName',c.previous_name,'geographyId',c.previous_geography,'geographyName',(SELECT g.name FROM farm.geography g WHERE g.id=c.previous_geography),'status',c.previous_status),
        'result',jsonb_build_object('fullName',c.result_name,'geographyId',c.result_geography,'geographyName',(SELECT g.name FROM farm.geography g WHERE g.id=c.result_geography),'status',c.result_status)
      ) END
    FROM farm.farmer_audit a LEFT JOIN farm.farmer_change c ON c.id=a.change_id
    WHERE a.farmer_id=p_farmer
      AND ((a.action='registration' AND a.change_id IS NULL) OR
        (c.id IS NOT NULL AND c.farmer_id=a.farmer_id AND c.actor_id=a.actor_id AND c.action=a.action
         AND authz.allowed(c.previous_geography,'farmer.read',NULL) AND authz.allowed(c.previous_geography,'farmer.audit.read',NULL)
         AND authz.allowed(c.result_geography,'farmer.read',NULL) AND authz.allowed(c.result_geography,'farmer.audit.read',NULL)))
      AND (p_before IS NULL OR (a.occurred_at,a.id)<(p_before,p_before_id))
    ORDER BY a.occurred_at DESC,a.id DESC LIMIT p_limit;
END $$;
ALTER FUNCTION farm.farmer_history(uuid,timestamptz,uuid,integer) OWNER TO agri_policy_owner;
REVOKE CREATE ON SCHEMA farm FROM agri_policy_owner;
REVOKE ALL ON FUNCTION farm.farmer_history(uuid,timestamptz,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION farm.farmer_history(uuid,timestamptz,uuid,integer) TO agri_farmer_runtime;
