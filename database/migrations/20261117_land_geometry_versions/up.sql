-- P1-09a: versioned PROVISIONAL land polygons (owner decisions Q49-Q55 are provisional, not client-approved).
-- Reported identification points stay untouched. Polygons are operational estimates: they are never legal
-- survey, title or verified area, and nothing here can mark a polygon verified. No grant is seeded: reading and
-- recording geometry need the separate permissions `land.geometry.read` and `land.geometry.create`, each ANDed
-- with `land.read` in the land's geography. Reuses the existing land identities; no new login or owner role.

-- Composite key so a version row must sit in the same geography as its land (a wrong-geography row cannot exist).
ALTER TABLE land.identification ADD CONSTRAINT identification_id_geography_key UNIQUE(id,geography_id);
-- The function owner reads the land row only where land.read currently allows it (never wider than the caller).
GRANT SELECT(id,organization_id,geography_id) ON land.identification TO agri_land_function_owner;
CREATE POLICY land_geometry_owner_read ON land.identification FOR SELECT TO agri_land_function_owner
  USING(authz.allowed(geography_id,'land.read',NULL));

CREATE TABLE land.geometry_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  land_id uuid NOT NULL,
  geography_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0 AND version<2147483647),
  boundary public.geometry(Polygon,4326) NOT NULL,
  source text NOT NULL CHECK(source IN ('gps_walk','digitized','official_survey')),
  -- Only these two states exist in this slice. 'verified' needs a separate reviewed workflow (P1-13) and a new migration.
  status text NOT NULL CHECK(status IN ('provisional','superseded')),
  accuracy_m double precision CHECK(accuracy_m IS NULL OR (accuracy_m>=0 AND accuracy_m<1000000000)),
  vertex_count integer NOT NULL CHECK(vertex_count BETWEEN 4 AND 5000),
  calculated_area_m2 numeric(16,2) NOT NULL CHECK(calculated_area_m2>0 AND calculated_area_m2<=1000000000),
  captured_at timestamptz,
  registration_source text NOT NULL CHECK(registration_source IN ('field_officer','administrator')),
  created_by uuid NOT NULL DEFAULT authz.actor() REFERENCES authn.account(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(land_id,version),
  FOREIGN KEY(land_id,geography_id) REFERENCES land.identification(id,geography_id),
  CHECK(public.ST_IsValid(boundary) AND NOT public.ST_IsEmpty(boundary) AND public.ST_NPoints(boundary)=vertex_count),
  CHECK(public.ST_XMin(boundary)>=-180 AND public.ST_XMax(boundary)<=180 AND public.ST_YMin(boundary)>=-90 AND public.ST_YMax(boundary)<=90)
);
-- At most one current (provisional) polygon per land; earlier versions are kept as superseded history.
CREATE UNIQUE INDEX geometry_one_current_idx ON land.geometry_version(land_id) WHERE status='provisional';
CREATE INDEX geometry_boundary_idx ON land.geometry_version USING gist(boundary);
CREATE INDEX geometry_geography_idx ON land.geometry_version(geography_id,land_id,version);
ALTER TABLE land.geometry_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE land.geometry_version FORCE ROW LEVEL SECURITY;
CREATE POLICY geometry_read ON land.geometry_version FOR SELECT TO agri_land_runtime
  USING(authz.allowed(geography_id,'land.geometry.read',NULL) AND authz.allowed(geography_id,'land.read',NULL));
CREATE POLICY geometry_owner_read ON land.geometry_version FOR SELECT TO agri_land_function_owner
  USING(authz.allowed(geography_id,'land.read',NULL));
CREATE POLICY geometry_insert ON land.geometry_version FOR INSERT TO agri_land_function_owner
  WITH CHECK(created_by=authz.actor() AND status='provisional'
    AND authz.allowed(geography_id,'land.read',NULL) AND authz.allowed(geography_id,'land.geometry.create',registration_source));
CREATE POLICY geometry_supersede ON land.geometry_version FOR UPDATE TO agri_land_function_owner
  USING(status='provisional' AND authz.allowed(geography_id,'land.read',NULL)) WITH CHECK(status='superseded');
-- Defense in depth: the only possible change is provisional -> superseded; everything else is immutable.
CREATE FUNCTION land.geometry_transition_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'provisional' OR NEW.status IS DISTINCT FROM 'superseded'
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.land_id IS DISTINCT FROM OLD.land_id OR NEW.geography_id IS DISTINCT FROM OLD.geography_id
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.boundary::bytea IS DISTINCT FROM OLD.boundary::bytea
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.accuracy_m IS DISTINCT FROM OLD.accuracy_m
     OR NEW.vertex_count IS DISTINCT FROM OLD.vertex_count OR NEW.calculated_area_m2 IS DISTINCT FROM OLD.calculated_area_m2
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at OR NEW.registration_source IS DISTINCT FROM OLD.registration_source
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Invalid land geometry transition' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION land.geometry_transition_guard() FROM PUBLIC;
CREATE TRIGGER geometry_transition_guard BEFORE UPDATE ON land.geometry_version
  FOR EACH ROW EXECUTE FUNCTION land.geometry_transition_guard();

-- Private idempotency journal and audit; unreachable by any API login.
CREATE TABLE land.geometry_mutation (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES authn.account(id),
  land_id uuid NOT NULL REFERENCES land.identification(id),
  payload_mac bytea NOT NULL CHECK(octet_length(payload_mac)=32),
  result_version integer NOT NULL CHECK(result_version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,land_id)
);
CREATE TABLE land.geometry_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  land_id uuid NOT NULL,
  version integer NOT NULL,
  actor_id uuid NOT NULL REFERENCES authn.account(id),
  session_id uuid NOT NULL REFERENCES authn.login_session(id),
  action text NOT NULL CHECK(action='geometry.record'),
  mutation_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(land_id,version) REFERENCES land.geometry_version(land_id,version),
  FOREIGN KEY(mutation_id,land_id) REFERENCES land.geometry_mutation(id,land_id)
);
REVOKE ALL ON land.geometry_version,land.geometry_mutation,land.geometry_audit FROM PUBLIC;
GRANT SELECT(id,land_id,geography_id,version,boundary,source,status,accuracy_m,vertex_count,calculated_area_m2,captured_at,created_at) ON land.geometry_version TO agri_land_runtime;
GRANT SELECT ON land.geometry_version TO agri_land_function_owner;
GRANT INSERT(id,land_id,geography_id,version,boundary,source,status,accuracy_m,vertex_count,calculated_area_m2,captured_at,registration_source) ON land.geometry_version TO agri_land_function_owner;
GRANT UPDATE(status) ON land.geometry_version TO agri_land_function_owner;
GRANT SELECT,INSERT ON land.geometry_mutation TO agri_land_function_owner;
GRANT INSERT ON land.geometry_audit TO agri_land_function_owner;

GRANT CREATE ON SCHEMA land TO agri_land_function_owner;
CREATE FUNCTION land.record_geometry(p_mutation uuid,p_land uuid,p_expected integer,p_ring jsonb,p_source text,p_accuracy double precision,p_captured timestamptz,p_registration_source text)
RETURNS TABLE(out_land uuid,out_version integer,out_area numeric,out_replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; geo uuid; signing_key bytea; payload bytea; prior record; latest integer; n integer; i integer; el jsonb;
        lon double precision; lat double precision; pts public.geometry[]:=ARRAY[]::public.geometry[]; poly public.geometry;
        area numeric; next_version integer; denied constant text:='Land geometry denied'; bad constant text:='Invalid land geometry';
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_mutation IS NULL OR p_land IS NULL OR p_expected IS NULL OR p_ring IS NULL OR p_source IS NULL
     OR p_registration_source IS NULL OR p_registration_source NOT IN ('field_officer','administrator') THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  -- Authorization first (the land row is visible only with land.read), so an outsider only ever sees "denied".
  SELECT i2.geography_id INTO geo FROM land.identification i2 WHERE i2.id=p_land;
  IF NOT FOUND OR authz.allowed(geo,'land.geometry.create',p_registration_source) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  IF p_expected NOT BETWEEN 0 AND 2147483645 OR p_source NOT IN ('gps_walk','digitized','official_survey')
     OR (p_accuracy IS NOT NULL AND NOT(p_accuracy>=0 AND p_accuracy<1000000000))
     OR jsonb_typeof(p_ring) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '%',bad USING ERRCODE='22023'; END IF;
  n:=jsonb_array_length(p_ring);
  IF n NOT BETWEEN 4 AND 5000 THEN RAISE EXCEPTION '%',bad USING ERRCODE='22023'; END IF;
  BEGIN
    FOR i IN 0..n-1 LOOP
      el:=p_ring->i;
      IF jsonb_typeof(el) IS DISTINCT FROM 'array' OR jsonb_array_length(el)<>2
         OR jsonb_typeof(el->0) IS DISTINCT FROM 'number' OR jsonb_typeof(el->1) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION '%',bad USING ERRCODE='22023'; END IF;
      lon:=(el->>0)::double precision; lat:=(el->>1)::double precision;
      IF NOT(lon>=-180 AND lon<=180 AND lat>=-90 AND lat<=90) THEN RAISE EXCEPTION '%',bad USING ERRCODE='22023'; END IF;
      pts:=pts||public.ST_SetSRID(public.ST_MakePoint(lon,lat),4326);
    END LOOP;
    -- The ring must already be closed: the server never edits submitted coordinates.
    IF public.ST_X(pts[1])<>public.ST_X(pts[n]) OR public.ST_Y(pts[1])<>public.ST_Y(pts[n]) THEN RAISE EXCEPTION '%',bad USING ERRCODE='22023'; END IF;
    poly:=public.ST_ForcePolygonCCW(public.ST_SetSRID(public.ST_MakePolygon(public.ST_MakeLine(pts)),4326));
    IF poly IS NULL OR public.ST_IsEmpty(poly) OR NOT public.ST_IsValid(poly) THEN RAISE EXCEPTION '%',bad USING ERRCODE='22023'; END IF;
    area:=round(public.ST_Area(poly::public.geography)::numeric,2);
    IF NOT(area>0 AND area<=1000000000) THEN RAISE EXCEPTION '%',bad USING ERRCODE='22023'; END IF;
  EXCEPTION WHEN invalid_parameter_value OR numeric_value_out_of_range OR data_exception OR internal_error OR array_subscript_error THEN
    RAISE EXCEPTION '%',bad USING ERRCODE='22023';
  END;
  SELECT key INTO signing_key FROM authz.context_key WHERE id=true;
  IF NOT FOUND THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  payload:=authz_crypto.hmac(convert_to('land-geometry-v1:'||jsonb_build_array(p_land,p_expected,p_ring,p_source,p_accuracy,p_captured,p_registration_source)::text,'UTF8'),signing_key,'sha256');
  -- Serialize the mutation, then the land, before reading the current version.
  PERFORM pg_advisory_xact_lock(hashtextextended('agri-land-geometry-mutation:'||p_mutation::text,0));
  SELECT m.actor_id,m.land_id,m.payload_mac,m.result_version INTO prior FROM land.geometry_mutation m WHERE m.id=p_mutation;
  IF FOUND THEN
    IF prior.actor_id<>actor OR prior.land_id<>p_land OR prior.payload_mac<>payload THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE='23505'; END IF;
    -- A replay never preserves a revoked session, grant or assignment.
    IF authz.actor() IS DISTINCT FROM actor OR authz.allowed(geo,'land.geometry.create',p_registration_source) IS DISTINCT FROM true THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
    RETURN QUERY SELECT p_land,prior.result_version,v.calculated_area_m2,true FROM land.geometry_version v WHERE v.land_id=p_land AND v.version=prior.result_version;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agri-land-geometry-land:'||p_land::text,0));
  -- After every wait, authorization is evaluated again at the latest time.
  IF authz.actor() IS DISTINCT FROM actor OR authz.allowed(geo,'land.geometry.create',p_registration_source) IS DISTINCT FROM true
     OR NOT EXISTS(SELECT 1 FROM land.identification i3 WHERE i3.id=p_land AND i3.geography_id=geo) THEN RAISE EXCEPTION '%',denied USING ERRCODE='42501'; END IF;
  SELECT COALESCE(max(v.version),0) INTO latest FROM land.geometry_version v WHERE v.land_id=p_land;
  IF latest<>p_expected THEN RAISE EXCEPTION 'Land geometry version conflict' USING ERRCODE='40001'; END IF;
  next_version:=latest+1;
  UPDATE land.geometry_version v SET status='superseded' WHERE v.land_id=p_land AND v.status='provisional';
  INSERT INTO land.geometry_version(land_id,geography_id,version,boundary,source,status,accuracy_m,vertex_count,calculated_area_m2,captured_at,registration_source)
    VALUES(p_land,geo,next_version,poly,p_source,'provisional',p_accuracy,public.ST_NPoints(poly),area,p_captured,p_registration_source);
  INSERT INTO land.geometry_mutation(id,actor_id,land_id,payload_mac,result_version) VALUES(p_mutation,actor,p_land,payload,next_version);
  INSERT INTO land.geometry_audit(land_id,version,actor_id,session_id,action,mutation_id)
    VALUES(p_land,next_version,actor,current_setting('agri.session',true)::uuid,'geometry.record',p_mutation);
  RETURN QUERY SELECT p_land,next_version,area,false;
END $$;
ALTER FUNCTION land.record_geometry(uuid,uuid,integer,jsonb,text,double precision,timestamptz,text) OWNER TO agri_land_function_owner;
REVOKE CREATE ON SCHEMA land FROM agri_land_function_owner;
REVOKE ALL ON FUNCTION land.record_geometry(uuid,uuid,integer,jsonb,text,double precision,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION land.record_geometry(uuid,uuid,integer,jsonb,text,double precision,timestamptz,text) TO agri_land_runtime;
