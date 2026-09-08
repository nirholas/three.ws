-- Rolling store of geolocated force, posture and sanctions events for /globe.
--
-- GDELT publishes one 15-minute export file and keeps no queryable history: its
-- GEO 2.0 API has 404'd for every query for long enough that it cannot be built
-- on. So the globe's time control (24h / 7d / 30d) is only honest if we keep the
-- window ourselves. /api/cron/globe-ingest reads each new file as it lands and
-- writes the classified events here; /api/globe/intel reads the window back.
--
-- Only the three CAMEO families the globe renders are stored (conflicts, force
-- posture, sanctions), roughly a tenth of each file, so a 30-day window is tens
-- of thousands of rows rather than millions.
--
-- The primary key is GDELT's own GlobalEventID, which makes re-ingesting an
-- overlapping file a no-op and lets the cron re-read a window it already covered
-- without duplicating anything.
create table if not exists globe_events (
	id           bigint primary key,
	layer        text        not null check (layer in ('conflicts', 'military', 'sanctions')),
	occurred_at  timestamptz not null,
	lat          double precision not null,
	lon          double precision not null,
	place        text        not null default '',
	country      text,
	cameo_code   text        not null,
	root_code    text        not null default '',
	quad_class   smallint,
	goldstein    real,
	mentions     integer     not null default 1,
	avg_tone     real,
	actor1       text,
	actor2       text,
	source_url   text,
	source_stamp text        not null,
	ingested_at  timestamptz not null default now()
);

-- Every read is "this layer, over this window, heaviest first", and the retention
-- sweep is "everything older than this".
create index if not exists globe_events_layer_time_idx on globe_events (layer, occurred_at desc);
create index if not exists globe_events_time_idx on globe_events (occurred_at desc);

-- The cron asks "which files have I already read?" before deciding what to fetch.
create index if not exists globe_events_stamp_idx on globe_events (source_stamp desc);
