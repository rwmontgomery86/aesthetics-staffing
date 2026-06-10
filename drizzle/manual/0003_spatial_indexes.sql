-- GIST/GIN indexes — drizzle-kit cannot emit these (NotifEyes pattern:
-- drizzle/manual/0001_spatial_indexes.sql).

-- The matching prefilter's hot path: ST_Intersects(watch_zones.geom, locations.geog).
create index if not exists watch_zones_geom_gix on public.watch_zones using gist (geom);
create index if not exists locations_geog_gix on public.locations using gist (geog);

-- Zone materialization lookups (city/zip -> polygon at save time).
create index if not exists geo_zips_geog_gix on public.geo_zips using gist (geog);
create index if not exists geo_cities_geog_gix on public.geo_cities using gist (geog);

create index if not exists provider_profiles_home_location_gix
  on public.provider_profiles using gist (home_location);

-- Array-overlap prefilter terms.
create index if not exists watch_zones_opportunity_types_gin
  on public.watch_zones using gin (opportunity_types);
create index if not exists watch_zones_service_ids_gin
  on public.watch_zones using gin (service_ids);
