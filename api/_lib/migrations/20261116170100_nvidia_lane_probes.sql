-- Migration: live NVIDIA lane probes and per-job serving-worker attribution.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261116170100_nvidia_lane_probes.sql
-- Idempotent and additive (one new table, one nullable column, no backfill).
--
--   nvidia_lane_probes   one row per probe the /api/cron/nvidia-lane-probes cron
--                        sends to an NVIDIA lane (hosted NIM, NVCF gRPC, or a
--                        self-hosted GPU worker): status, measured latency, the
--                        model id that answered, and, for self-hosted workers,
--                        the GPU the worker reported on /health plus the Cloud
--                        Run host and region it runs in. /api/nvidia/stats reads
--                        it for the live lane grid on /nvidia.
--
--   forge_creations.worker_host
--                        the Cloud Run host of the self-hosted worker that served
--                        a completed creation, written by api/_lib/forge-store.js
--                        at materialize time. Joined to the probe rows' host to
--                        split job latency by GPU type. Null means the job ran
--                        before this column existed or on a hosted lane; rows are
--                        never backfilled, so null is "not recorded", not a guess.

create table if not exists nvidia_lane_probes (
	id           bigserial   primary key,
	lane         text        not null,
	-- ok | degraded | down | unconfigured
	status       text        not null,
	http_status  integer,
	latency_ms   integer,
	model        text,
	-- Short operator-facing reason; never a key, prompt or internal URL.
	detail       text,
	gpu_name     text,
	worker_host  text,
	region       text,
	probed_at    timestamptz not null default now()
);

create index if not exists nvidia_lane_probes_lane_time_idx on nvidia_lane_probes (lane, probed_at desc);

alter table forge_creations add column if not exists worker_host text;
