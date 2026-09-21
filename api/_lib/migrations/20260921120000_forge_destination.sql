-- Forge funnel instrumentation: what a generation is FOR, and when it finished.
--
-- forge_creations already records the verdict on a model (outcome, rating,
-- downloaded), but not the two facts the funnel report needs to turn that
-- verdict into a product decision:
--
--   destination   What the maker is building for: game, web, avatar, simulation,
--                 print, ar, or play (just exploring). Asked once in the Forge
--                 composer and attached to every generation from that browser,
--                 or sent as `destination` by an API caller. Without it the
--                 acceptance rate is one number for the whole product, and
--                 nobody can say which use case the pipeline actually serves.
--                 Null means "never asked or never answered", which is every row
--                 before this migration; readers report it as its own bucket
--                 and never fold it into a real answer.
--
--   completed_at  When the row reached a terminal status (done or failed).
--                 updated_at cannot stand in for it: a later feedback write, a
--                 vote, or the web-delivery backfill all move updated_at, so
--                 updated_at - created_at overstates generation time by days.
--                 Generation seconds per accepted asset is the physical quantity
--                 cost scales with on the self-hosted GPU lanes. Null on rows
--                 that finished before this migration; the report counts only
--                 rows that carry it and says how many it judged.
--
--   internal      True when the platform generated the row itself: the catalog
--                 seeder and the weekly quality benchmark both submit through the
--                 real /api/forge path (authenticated by the x-forge-seed header)
--                 so they exercise what users exercise. No human ever accepts
--                 those rows, so left in the funnel they read as thousands of
--                 abandoned generations. Historical seeder rows are still
--                 excluded through forge_seed_jobs.creation_id; historical
--                 benchmark rows cannot be told apart and stay in the pre-
--                 migration numbers, which is one reason the report leads with
--                 a window that starts after this migration when one is given.
alter table forge_creations
	add column if not exists destination  text,
	add column if not exists completed_at timestamptz,
	add column if not exists internal     boolean not null default false;

-- The funnel report groups finished rows by destination over a rolling window.
-- Partial on the answered rows so the index stays small while most history is null.
create index if not exists forge_creations_destination_idx
	on forge_creations (destination, created_at desc)
	where destination is not null;
