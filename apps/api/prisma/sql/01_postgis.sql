-- ===========================================================================
-- PostGIS spatial layer
--
-- Prisma models store plain lat/lng Floats so the client can read them. This
-- script mirrors those into real `geography(Point,4326)` columns kept in sync
-- by triggers, which gives us GiST indexes and native distance/containment
-- queries for the geofence and route-deviation engines.
--
-- Run after `prisma migrate deploy`:
--   psql "$DATABASE_URL" -f prisma/sql/01_postgis.sql
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Generic helper: build a geography point from lat/lng, NULL-safe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION erp_make_point(lat DOUBLE PRECISION, lng DOUBLE PRECISION)
RETURNS geography(Point, 4326)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN lat IS NULL OR lng IS NULL THEN NULL
    ELSE ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  END;
$$;

-- ---------------------------------------------------------------------------
-- location_pings — the highest-volume spatial table.
-- ---------------------------------------------------------------------------
ALTER TABLE location_pings
  ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);

CREATE OR REPLACE FUNCTION location_pings_sync_geom()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.geom := erp_make_point(NEW.latitude, NEW.longitude);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_location_pings_geom ON location_pings;
CREATE TRIGGER trg_location_pings_geom
  BEFORE INSERT OR UPDATE OF latitude, longitude ON location_pings
  FOR EACH ROW EXECUTE FUNCTION location_pings_sync_geom();

CREATE INDEX IF NOT EXISTS idx_location_pings_geom
  ON location_pings USING GIST (geom);

-- Covering index for "latest ping per vehicle", the hottest read on the
-- live map. DESC matches the ORDER BY the tracking service issues.
CREATE INDEX IF NOT EXISTS idx_location_pings_vehicle_recent
  ON location_pings ("vehicleId", "recordedAt" DESC);

-- ---------------------------------------------------------------------------
-- route_stops — used for "is the bus at the stop yet?" containment tests.
-- ---------------------------------------------------------------------------
ALTER TABLE route_stops
  ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);

CREATE OR REPLACE FUNCTION route_stops_sync_geom()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.geom := erp_make_point(NEW.latitude, NEW.longitude);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_stops_geom ON route_stops;
CREATE TRIGGER trg_route_stops_geom
  BEFORE INSERT OR UPDATE OF latitude, longitude ON route_stops
  FOR EACH ROW EXECUTE FUNCTION route_stops_sync_geom();

CREATE INDEX IF NOT EXISTS idx_route_stops_geom
  ON route_stops USING GIST (geom);

-- ---------------------------------------------------------------------------
-- geofences — circles get a centre point; polygons get a real polygon.
-- ---------------------------------------------------------------------------
ALTER TABLE geofences
  ADD COLUMN IF NOT EXISTS center_geom geography(Point, 4326),
  ADD COLUMN IF NOT EXISTS area_geom   geography(Polygon, 4326);

CREATE OR REPLACE FUNCTION geofences_sync_geom()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ring     TEXT;
  first_pt TEXT;
BEGIN
  NEW.center_geom := erp_make_point(NEW."centerLatitude", NEW."centerLongitude");

  IF NEW.shape = 'POLYGON' AND NEW.polygon IS NOT NULL THEN
    -- Build a WKT ring from the JSON array of {latitude, longitude}.
    SELECT string_agg(
             (elem->>'longitude') || ' ' || (elem->>'latitude'),
             ',' ORDER BY ord
           )
      INTO ring
      FROM jsonb_array_elements(NEW.polygon::jsonb) WITH ORDINALITY AS t(elem, ord);

    IF ring IS NOT NULL THEN
      SELECT (elem->>'longitude') || ' ' || (elem->>'latitude')
        INTO first_pt
        FROM jsonb_array_elements(NEW.polygon::jsonb) AS elem
       LIMIT 1;

      -- A valid polygon ring must be explicitly closed.
      NEW.area_geom := ST_GeogFromText(
        'SRID=4326;POLYGON((' || ring || ',' || first_pt || '))'
      );
    END IF;
  ELSE
    NEW.area_geom := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_geofences_geom ON geofences;
CREATE TRIGGER trg_geofences_geom
  BEFORE INSERT OR UPDATE ON geofences
  FOR EACH ROW EXECUTE FUNCTION geofences_sync_geom();

CREATE INDEX IF NOT EXISTS idx_geofences_center_geom ON geofences USING GIST (center_geom);
CREATE INDEX IF NOT EXISTS idx_geofences_area_geom   ON geofences USING GIST (area_geom);

-- ---------------------------------------------------------------------------
-- Containment test used by the geofence engine on every ping.
-- Handles both circle and polygon fences in one call.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION erp_point_in_geofence(
  p_geofence_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $$
DECLARE
  g       RECORD;
  the_pt  geography(Point, 4326);
BEGIN
  SELECT shape, center_geom, area_geom, "radiusMeters"
    INTO g
    FROM geofences
   WHERE id = p_geofence_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  the_pt := erp_make_point(p_lat, p_lng);
  IF the_pt IS NULL THEN
    RETURN FALSE;
  END IF;

  IF g.shape = 'POLYGON' AND g.area_geom IS NOT NULL THEN
    RETURN ST_Covers(g.area_geom, the_pt);
  END IF;

  IF g.center_geom IS NULL OR g."radiusMeters" IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN ST_DWithin(g.center_geom, the_pt, g."radiusMeters");
END;
$$;

-- ---------------------------------------------------------------------------
-- Every active geofence containing a point. One query per ping instead of N.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION erp_geofences_containing(
  p_tenant_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_student_id UUID DEFAULT NULL
) RETURNS TABLE (id UUID, name TEXT, type TEXT)
LANGUAGE sql STABLE AS $$
  SELECT g.id, g.name, g.type::TEXT
    FROM geofences g
   WHERE g."tenantId" = p_tenant_id
     AND g."isActive" = TRUE
     -- Student-scoped fences (HOME) only apply to that student.
     AND (g."studentId" IS NULL OR g."studentId" = p_student_id)
     AND (
       (g.shape = 'POLYGON' AND g.area_geom IS NOT NULL
         AND ST_Covers(g.area_geom, erp_make_point(p_lat, p_lng)))
       OR
       (g.shape = 'CIRCLE' AND g.center_geom IS NOT NULL
         AND ST_DWithin(g.center_geom, erp_make_point(p_lat, p_lng), g."radiusMeters"))
     );
$$;

-- ---------------------------------------------------------------------------
-- Retention purge (PRD 6.3). Called nightly by the jobs runner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION erp_purge_location_history(p_retention_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  removed INT;
BEGIN
  DELETE FROM location_pings
   WHERE "recordedAt" < NOW() - (p_retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
