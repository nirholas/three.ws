begin;

-- Flappin UFO runs (api/play/ufo-runs.js). Every row is a run the server
-- re-simulated from its recorded input edges (src/play/ufo/sim.js), so score,
-- level and ticks are server-computed, never client-claimed. recording is the
-- replay itself: the ghost of the top run is rebuilt from it.
-- recording_hash dedupes a replayed submission of the same run.
create table if not exists ufo_runs (
    id             uuid         primary key default gen_random_uuid(),
    user_id        uuid         references users(id) on delete set null,
    name           text         not null,
    score          integer      not null check (score >= 0),
    level          integer      not null check (level >= 1),
    ticks          integer      not null check (ticks > 0),
    recording      jsonb        not null,
    recording_hash text         not null unique,
    created_at     timestamptz  not null default now()
);

create index if not exists ufo_runs_score_idx on ufo_runs (score desc, created_at asc);
create index if not exists ufo_runs_user_idx on ufo_runs (user_id, score desc) where user_id is not null;

commit;
