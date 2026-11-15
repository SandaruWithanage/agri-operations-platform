-- Minimal reported land identification. No title, boundary, ownership or farmer linkage is inferred.
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
CREATE SCHEMA land;
REVOKE ALL ON SCHEMA land FROM PUBLIC;
CREATE ROLE agri_land_function_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE agri_land_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA land,authz,farm,authz_crypto,public TO agri_land_function_owner;
GRANT USAGE ON SCHEMA land,authz,public TO agri_land_runtime;
GRANT EXECUTE ON FUNCTION authz.actor(),authz.allowed(uuid,text,text) TO agri_land_function_owner,agri_land_runtime;
GRANT SELECT ON authz.context_key TO agri_land_function_owner;
GRANT SELECT(id,organization_id,name,active) ON farm.geography TO agri_land_function_owner;
CREATE TABLE land.identification (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES farm.organization(id),
  geography_id uuid NOT NULL,
  label text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 200),
  point public.geometry(Point,4326),
  accuracy_m double precision CHECK (accuracy_m IS NULL OR (point IS NOT NULL AND accuracy_m>=0 AND accuracy_m<1000000000)),
  reported_area_hectares numeric(12,4) CHECK (reported_area_hectares IS NULL OR (reported_area_hectares>=0 AND reported_area_hectares<100000000)),
  registration_source text NOT NULL CHECK (registration_source IN ('field_officer','administrator')),
  created_by uuid NOT NULL DEFAULT authz.actor() REFERENCES authn.account(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  FOREIGN KEY(geography_id,organization_id) REFERENCES farm.geography(id,organization_id),
  CHECK (point IS NULL OR (NOT public.ST_IsEmpty(point) AND public.ST_X(point)>=-180 AND public.ST_X(point)<=180 AND public.ST_Y(point)>=-90 AND public.ST_Y(point)<=90))
);
CREATE INDEX identification_geography_idx ON land.identification(geography_id,id);
CREATE INDEX identification_point_idx ON land.identification USING gist(point) WHERE point IS NOT NULL;
ALTER TABLE land.identification ENABLE ROW LEVEL SECURITY;
ALTER TABLE land.identification FORCE ROW LEVEL SECURITY;
CREATE POLICY land_read ON land.identification FOR SELECT TO agri_land_runtime USING(authz.allowed(geography_id,'land.read',NULL));
CREATE POLICY land_insert ON land.identification FOR INSERT TO agri_land_function_owner WITH CHECK(created_by=authz.actor() AND authz.allowed(geography_id,'land.create',registration_source));
GRANT SELECT(id,geography_id,label,point,accuracy_m,reported_area_hectares,created_at,version) ON land.identification TO agri_land_runtime;
GRANT INSERT(id,organization_id,geography_id,label,point,accuracy_m,reported_area_hectares,registration_source) ON land.identification TO agri_land_function_owner;
CREATE TABLE land.registration_mutation (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES authn.account(id),
  land_id uuid NOT NULL REFERENCES land.identification(id) DEFERRABLE INITIALLY DEFERRED,
  payload_mac bytea NOT NULL CHECK(octet_length(payload_mac)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE land.audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),land_id uuid NOT NULL REFERENCES land.identification(id),
  actor_id uuid NOT NULL REFERENCES authn.account(id),session_id uuid NOT NULL REFERENCES authn.login_session(id),
  action text NOT NULL CHECK(action='registration'),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON land.identification,land.registration_mutation,land.audit FROM PUBLIC;
GRANT SELECT,INSERT ON land.registration_mutation TO agri_land_function_owner;
GRANT INSERT ON land.audit TO agri_land_function_owner;
GRANT CREATE ON SCHEMA land TO agri_land_function_owner;
CREATE FUNCTION land.register_identification(p_mutation uuid,p_land uuid,p_geo uuid,p_label text,p_lon double precision,p_lat double precision,p_accuracy double precision,p_area numeric,p_source text)
RETURNS TABLE(land_id uuid,replayed boolean) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; organization uuid; signing_key bytea; payload bytea; prior record; inserted uuid; canonical_label text;
BEGIN
  actor:=authz.actor();
  IF actor IS NULL OR p_mutation IS NULL OR p_land IS NULL OR p_geo IS NULL OR p_source IS NULL THEN RAISE EXCEPTION 'Land registration denied' USING ERRCODE='42501'; END IF;
  canonical_label:=CASE WHEN p_label IS NULL THEN NULL ELSE btrim(p_label) END;
  IF p_source NOT IN ('field_officer','administrator') OR (canonical_label IS NOT NULL AND length(canonical_label) NOT BETWEEN 1 AND 200)
     OR ((p_lon IS NULL)<>(p_lat IS NULL)) OR (p_lon IS NOT NULL AND NOT(p_lon>=-180 AND p_lon<=180 AND p_lat>=-90 AND p_lat<=90))
     OR (p_accuracy IS NOT NULL AND (p_lon IS NULL OR NOT(p_accuracy>=0 AND p_accuracy<1000000000)))
     OR (p_area IS NOT NULL AND (NOT(p_area>=0 AND p_area<100000000) OR p_area<>round(p_area,4))) THEN RAISE EXCEPTION 'Invalid land identification' USING ERRCODE='22023'; END IF;
  IF authz.allowed(p_geo,'land.create',p_source) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Land registration denied' USING ERRCODE='42501'; END IF;
  SELECT g.organization_id INTO organization FROM farm.geography g WHERE g.id=p_geo AND g.active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Land registration denied' USING ERRCODE='42501'; END IF;
  SELECT key INTO signing_key FROM authz.context_key WHERE id=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Land registration denied' USING ERRCODE='42501'; END IF;
  payload:=authz_crypto.hmac(convert_to('land-identification-v1:' || jsonb_build_array(p_land,p_geo,canonical_label,p_lon,p_lat,p_accuracy,p_area,p_source)::text,'UTF8'),signing_key,'sha256');
  INSERT INTO land.registration_mutation(id,actor_id,land_id,payload_mac) VALUES(p_mutation,actor,p_land,payload) ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN
    SELECT m.actor_id,m.land_id,m.payload_mac INTO prior FROM land.registration_mutation m WHERE m.id=p_mutation;
    IF NOT FOUND OR prior.actor_id<>actor OR prior.land_id<>p_land OR prior.payload_mac<>payload THEN RAISE EXCEPTION 'Mutation conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT p_land,true; RETURN;
  END IF;
  INSERT INTO land.identification(id,organization_id,geography_id,label,point,accuracy_m,reported_area_hectares,registration_source)
    VALUES(p_land,organization,p_geo,canonical_label,CASE WHEN p_lon IS NULL THEN NULL ELSE public.ST_SetSRID(public.ST_MakePoint(p_lon,p_lat),4326) END,p_accuracy,p_area,p_source);
  INSERT INTO land.audit(land_id,actor_id,session_id,action) VALUES(p_land,actor,current_setting('agri.session',true)::uuid,'registration');
  RETURN QUERY SELECT p_land,false;
END $$;
CREATE FUNCTION land.geography_name(p_geo uuid) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT g.name FROM farm.geography g WHERE g.id=p_geo AND authz.allowed(g.id,'land.read',NULL)
$$;
CREATE FUNCTION land.registration_geographies(p_source text) RETURNS TABLE(id uuid,name text) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT g.id,g.name FROM farm.geography g WHERE g.active AND authz.allowed(g.id,'land.create',p_source) ORDER BY g.name,g.id
$$;
ALTER FUNCTION land.register_identification(uuid,uuid,uuid,text,double precision,double precision,double precision,numeric,text) OWNER TO agri_land_function_owner;
ALTER FUNCTION land.geography_name(uuid) OWNER TO agri_land_function_owner;
ALTER FUNCTION land.registration_geographies(text) OWNER TO agri_land_function_owner;
REVOKE CREATE ON SCHEMA land FROM agri_land_function_owner;
REVOKE ALL ON FUNCTION land.register_identification(uuid,uuid,uuid,text,double precision,double precision,double precision,numeric,text),land.geography_name(uuid),land.registration_geographies(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION land.register_identification(uuid,uuid,uuid,text,double precision,double precision,double precision,numeric,text),land.geography_name(uuid),land.registration_geographies(text) TO agri_land_runtime;
