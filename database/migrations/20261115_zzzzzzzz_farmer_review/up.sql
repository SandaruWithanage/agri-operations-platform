-- Provisional online staff review/correction. No role names or automatic ownership.
CREATE INDEX farmer_name_geography_idx ON farm.farmer(geography_id,lower(btrim(full_name)));
ALTER TABLE farm.farmer ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
GRANT SELECT (version) ON farm.farmer TO agri_farmer_runtime;
GRANT SELECT (id, status, version), UPDATE (full_name, geography_id, status, version) ON farm.farmer TO agri_policy_owner;
CREATE POLICY farmer_change_owner_read ON farm.farmer FOR SELECT TO agri_policy_owner USING (
  authz.allowed(geography_id,'farmer.read',NULL) AND
  (authz.allowed(geography_id,'farmer.correct',NULL) OR authz.allowed(geography_id,'farmer.verify',NULL))
);
CREATE POLICY farmer_change_owner_update ON farm.farmer FOR UPDATE TO agri_policy_owner USING (
  authz.allowed(geography_id,'farmer.read',NULL) AND
  (authz.allowed(geography_id,'farmer.correct',NULL) OR authz.allowed(geography_id,'farmer.verify',NULL))
) WITH CHECK (
  authz.allowed(geography_id,'farmer.read',NULL) AND
  (authz.allowed(geography_id,'farmer.correct',NULL) OR authz.allowed(geography_id,'farmer.verify',NULL))
);
CREATE TABLE farm.farmer_change (
  id uuid PRIMARY KEY,
  farmer_id uuid NOT NULL REFERENCES farm.farmer(id),
  actor_id uuid NOT NULL REFERENCES authn.account(id),
  session_id uuid NOT NULL REFERENCES authn.login_session(id),
  action text NOT NULL CHECK (action IN ('correction','verification')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  payload_mac bytea NOT NULL CHECK (octet_length(payload_mac)=32),
  previous_version integer NOT NULL CHECK (previous_version>0),
  result_version integer NOT NULL CHECK (result_version=previous_version+1),
  previous_name text NOT NULL, result_name text NOT NULL,
  previous_geography uuid NOT NULL REFERENCES farm.geography(id),
  result_geography uuid NOT NULL REFERENCES farm.geography(id),
  previous_status text NOT NULL, result_status text NOT NULL,
  duplicate_risk boolean NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON farm.farmer_change FROM PUBLIC;
GRANT SELECT, INSERT ON farm.farmer_change TO agri_policy_owner;
ALTER TABLE farm.farmer_audit DROP CONSTRAINT farmer_audit_action_check;
ALTER TABLE farm.farmer_audit ADD CONSTRAINT farmer_audit_action_check CHECK (action IN ('registration','correction','verification'));
ALTER TABLE farm.farmer_audit ADD COLUMN change_id uuid UNIQUE REFERENCES farm.farmer_change(id);
GRANT CREATE ON SCHEMA farm TO agri_policy_owner;
CREATE FUNCTION farm.change_farmer(p_mutation uuid,p_farmer uuid,p_version integer,p_action text,p_name text,p_geography uuid,p_reason text)
RETURNS TABLE(farmer_id uuid,version integer,replayed boolean,duplicate_risk boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor uuid; sid uuid; row_before record; prior record; signing_key bytea; mac bytea; permission_name text;
  target_name text; target_geography uuid; target_status text; risk boolean; inserted uuid;
BEGIN
  actor := authz.actor();
  IF actor IS NULL OR p_mutation IS NULL OR p_farmer IS NULL THEN RAISE EXCEPTION 'Change denied' USING ERRCODE='42501'; END IF;
  IF p_version IS NULL OR p_version<1 OR p_version>=2147483647 OR p_action IS NULL OR p_action NOT IN ('correction','verification') OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 500 THEN RAISE EXCEPTION 'Invalid change' USING ERRCODE='22023'; END IF;
  IF (p_action='verification' AND (p_name IS NOT NULL OR p_geography IS NOT NULL)) OR
     (p_action='correction' AND (p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR p_geography IS NULL)) THEN RAISE EXCEPTION 'Invalid change' USING ERRCODE='22023'; END IF;
  permission_name := CASE WHEN p_action='correction' THEN 'farmer.correct' ELSE 'farmer.verify' END;
  SELECT f.id,f.full_name,f.geography_id,f.status,f.version INTO row_before FROM farm.farmer f WHERE f.id=p_farmer FOR UPDATE;
  IF NOT FOUND OR authz.allowed(row_before.geography_id,'farmer.read',NULL) IS DISTINCT FROM true OR authz.allowed(row_before.geography_id,permission_name,NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Change denied' USING ERRCODE='42501'; END IF;
  target_name := CASE WHEN p_action='correction' THEN btrim(p_name) ELSE row_before.full_name END;
  target_geography := CASE WHEN p_action='correction' THEN p_geography ELSE row_before.geography_id END;
  IF authz.allowed(target_geography,'farmer.read',NULL) IS DISTINCT FROM true OR authz.allowed(target_geography,permission_name,NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Change denied' USING ERRCODE='42501'; END IF;
  SELECT key INTO signing_key FROM authz.context_key WHERE id=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Change denied' USING ERRCODE='42501'; END IF;
  mac := authz_crypto.hmac(convert_to('farmer-change-v1:' || jsonb_build_array(actor,p_farmer,p_version,p_action,CASE WHEN p_action='correction' THEN btrim(p_name) ELSE NULL END,p_geography,btrim(p_reason))::text,'UTF8'),signing_key,'sha256');
  SELECT * INTO prior FROM farm.farmer_change c WHERE c.id=p_mutation;
  IF FOUND THEN
    IF prior.actor_id<>actor OR prior.farmer_id<>p_farmer OR prior.payload_mac<>mac OR authz.allowed(prior.previous_geography,permission_name,NULL) IS DISTINCT FROM true OR authz.allowed(prior.previous_geography,'farmer.read',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT p_farmer,prior.result_version,true,prior.duplicate_risk; RETURN;
  END IF;
  IF row_before.version<>p_version THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  IF p_action='verification' AND row_before.status<>'pending-review' THEN RAISE EXCEPTION 'Review state conflict' USING ERRCODE='40001'; END IF;
  IF p_action='correction' AND target_name=row_before.full_name AND target_geography=row_before.geography_id THEN RAISE EXCEPTION 'No correction supplied' USING ERRCODE='22023'; END IF;
  target_status := CASE WHEN p_action='verification' THEN 'verified' WHEN row_before.status='verified' THEN 'pending-review' ELSE row_before.status END;
  risk := false;
  IF p_action='correction' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('agri-farmer:' || target_geography::text,0));
    SELECT EXISTS(SELECT 1 FROM farm.farmer f WHERE f.id<>p_farmer AND f.geography_id=target_geography AND lower(btrim(f.full_name))=lower(target_name)) INTO risk;
  END IF;
  sid := current_setting('agri.session',true)::uuid;
  INSERT INTO farm.farmer_change(id,farmer_id,actor_id,session_id,action,reason,payload_mac,previous_version,result_version,previous_name,result_name,previous_geography,result_geography,previous_status,result_status,duplicate_risk)
    VALUES(p_mutation,p_farmer,actor,sid,p_action,btrim(p_reason),mac,p_version,p_version+1,row_before.full_name,target_name,row_before.geography_id,target_geography,row_before.status,target_status,risk)
    ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE='23505'; END IF;
  UPDATE farm.farmer f SET full_name=target_name,geography_id=target_geography,status=target_status,version=p_version+1 WHERE f.id=p_farmer AND f.version=p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO farm.farmer_audit(farmer_id,actor_id,action,change_id) VALUES(p_farmer,actor,p_action,p_mutation);
  RETURN QUERY SELECT p_farmer,p_version+1,false,risk;
END $$;
ALTER FUNCTION farm.change_farmer(uuid,uuid,integer,text,text,uuid,text) OWNER TO agri_policy_owner;
REVOKE CREATE ON SCHEMA farm FROM agri_policy_owner;
REVOKE ALL ON FUNCTION farm.change_farmer(uuid,uuid,integer,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION farm.change_farmer(uuid,uuid,integer,text,text,uuid,text) TO agri_farmer_runtime;
