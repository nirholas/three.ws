# Database retention — keeping the Neon branch under its storage cap

The platform runs on a Neon Postgres branch with a hard **project-size cap**
(512 MB on the free tier). When a branch reaches that cap Postgres raises
SQLSTATE **53100** — `could not extend file because project size limit … exceeded`
— and every **write** path starts failing (reads still work). In production this
surfaced as a storm of 500s on `/api/cron/smart-money-rollup` plus caught write
failures across `coin-intel-observe`, `launcher-tick`, `flush-usage-events`, and
usage metering.

This doc is the playbook: what fills the branch, what keeps it bounded, and when
to upgrade.

## What fills the branch

Two families grow without bound:

1. **The coin-intel firehose.** `pump_coin_intel` ingests **~15–20k new mints a
   day** (≈30 MB/day), and its mint-keyed satellites grow in lockstep —
   `pump_coin_wallets`, `coin_smart_money`, `smart_money_scored`,
   `pump_coin_outcomes`, `oracle_conviction`, `oracle_conviction_history`. All
   told the family adds **~60 MB/day**. The smart-money judge
   (`api/cron/smart-money-rollup.js`) has to outrun this window: it walks unjudged
   coins oldest-first at 400 per run (raised from 80 on 2026-08-16, when a 309k
   backlog was ageing toward the cliff), because a coin pruned before it is judged
   never folds its buyers into `wallet_reputation` at all.
2. **`avatar_regen_jobs`.** Each reconstruct job's `params` carries the multi-MB
   base64 **source** images. The live path drops them once a job leaves
   reconstruction, but terminal jobs that took another route kept them — 346 rows
   were holding 43 MB.

At ~60 MB/day the firehose alone cannot fit a 14-day window inside 512 MB. That
is a plan-capacity fact, not a bug: **a longer guaranteed history window requires
a larger Neon plan.**

3. **The append-only history tables (the 2026-11 incident).** By 2026-11-03 the
   branch was 16,814 MB against a 16,384 MB mark, and the write-heavy crons
   (`launcher-tick`, `coin-intel-observe`, `smart-money-rollup`,
   `recompute-reputation`, `intel-learn`) logged `skipped - db at storage cap` on
   every tick. None of the biggest growers were in any retention list, so the
   skip message's "retention will reclaim space" was false. Measured that day:

   | Table | Size | Rows | Live window | Kept, never pruned |
   | --- | --- | --- | --- | --- |
   | `agent_onchain_events` | 3,570 MB | 5.2M | 30 days on `occurred_at` | nothing (the chain is the source of truth) |
   | `agent_sniper_price_ticks` | new (2026-11-04) | 0 | 14 days on `ts` | nothing (one tick a second per open position and moon bag) |
   | `oracle_training_set` | 2,456 MB | 1.9M | 45 days on `first_seen_at` | `outcome = 'unknown'` rows (still waiting for a label) |
   | `x402_self_facilitator_log` | 1,512 MB | 3.2M | 60 days on `ts` | nothing; pruned days roll into `x402_self_facilitator_rollup` |
   | `firewall_decisions` | 1,350 MB | 645k | 45 days on `created_at` | nothing |
   | `usage_events` | 934 MB | 2.9M | 60 days on `created_at` | `kind = 'metered'` rows (invoices bill any past month) |
   | `sniper_llm_verdicts` | 521 MB | 1.1M | 30 days on `created_at` | nothing |
   | `ops_alerts` | 507 MB | 776k | 30 days on `last_seen` | unacknowledged alerts that recurred (`count > 1`) |

   Every window, the readers audited for it and their longest lookback live
   beside the spec in `api/_lib/db-archive-tables.js`; the test
   `tests/db-retention-archive.test.js` fails if a table over 500 MB drops out of
   that list or loses its keyset index. `club_tips` (596 MB, 1.2M rows) is
   deliberately **not** archived: the all-time dancer leaderboard reads it with no
   time filter and every row with `paid_at IS NULL` is money still owed, so it
   needs a rollup of its own before any prune. The update-churn tables
   (`wallet_reputation`, `smart_wallet_folded`, ~170k dead tuples each) are not
   pruned at all; they are compaction candidates so their bloat is returned.

## Archive layout (cold storage)

Old rows are never deleted until they are in cold storage and verified there.

- **Bucket:** `gs://three-ws-db-archive` (project `aerial-vehicle-466722-p5`,
  `us-central1`, uniform bucket-level access, public access prevention inherited).
  Objects move to Coldline after 365 days. The runtime service account
  `three-ws@` holds `roles/storage.objectCreator` only: it can create objects and
  can neither read, list, overwrite nor delete them. Uploads use
  `ifGenerationMatch=0`, so nothing in the bucket is ever overwritten.
- **Objects per part** (20,000 rows by default), under
  `<table>/<YYYY-MM-DD of the part's oldest row>/<runId>-<seq>-<sha8>`:
  - `.ndjson.gz`: one `to_jsonb(row)` per line, produced by Postgres so bigint and
    numeric values keep full precision.
  - `.manifest.json`: table, cutoff, row count, min and max keyset key, sha256 and
    md5 of the part, written after GCS confirmed the part's md5 server-side.
  - `.deleted.json`: written after the delete, with the deleted row count. A part
    with a manifest and no `.deleted.json` was archived but not pruned (an
    archive-only run, or a delete that never started).
- **Order of operations** (`archiveSlice` in `api/_lib/db-archive.js`): read a
  keyset page, upload the part, check the returned size and md5, write the
  manifest, and only then delete exactly those primary keys, re-applying the
  table's cutoff and `where` predicate so a row that changed after it was archived
  (an alert acknowledged late) stays. Any failure before the delete returns
  `skipped` and deletes nothing.
- **Keyset indexes.** Each archived table has an index leading with its archive
  timestamp column (`*_archive_keyset` migrations from 2026-11-03). Without one,
  every 2,500-row page was a full scan of a multi-GB table.

### Firehose archive

`pump_coin_intel` and its mint-keyed satellites (`pump_coin_wallets`,
`coin_smart_money`, `smart_money_scored`, `pump_coin_outcomes`,
`oracle_conviction`, `oracle_conviction_history`) are archived by mint batch
rather than by keyset (`api/_lib/firehose-archive.js`). Until 2026-11-05 the cron
deleted these rows with no copy, so everything observed before 2026-10-31 is
gone; from this change on nothing is lost.

- **Per batch** of up to 1,000 mints, oldest `first_seen_at` first: every row of
  every table for those mints is read with its `ctid`, each table becomes one
  part + manifest under `<table>/<YYYY-MM-DD>/<runId>-b<seq>-<sha8>` (same object
  layout and manifest shape as above, `key_columns: ["first_seen_at"]`), and only
  after **all** parts of the batch have verified does it delete exactly the
  archived rows by `ctid`. A row updated after it was read has a new `ctid`, so it
  stays and is archived on the next tick.
- **Satellites first, master last, guarded.** `pump_coin_outcomes` cascades from
  `pump_coin_intel`, so the master delete skips any mint that still has a
  satellite row (written between read and delete). Nothing leaves through the
  cascade without being archived.
- **Orphans** (satellite rows whose master is gone) are archived under
  `<table>/<today>/<runId>-orphans-<sha8>` before the sweep deletes them.
- **Failure:** an upload or checksum failure deletes nothing for the batch, stops
  the pass, and raises the `db:firehose-archive-skipped` ops alert. The firehose
  then grows until the bucket is reachable; that is the deliberate trade against
  losing history. `DB_ARCHIVE_ENABLED=0` does not bypass this: with no archive
  there is no firehose delete.
- **Budget:** the firehose gets the first 35 s of the tick and the orphan sweep
  runs until 45 s; at ~17k mints a day and a tick every 15 minutes a tick needs a
  batch or two.
- **Verify / restore:** `node scripts/db-archive-table.mjs pump_coin_intel --verify`
  and `... --restore --from 2026-11-01 --to 2026-11-08 [--apply]` work on every
  firehose table. Restore satellites after the master (the `pump_coin_outcomes`
  FK needs its master row).

### Who archives

- **The cron** (`/api/cron/db-retention`, every 15 minutes) archives and prunes
  the steady-state slice: up to 50,000 rows per table per tick inside an 85 s
  budget, about 4.8M rows per table per day of capacity. `DB_ARCHIVE_ENABLED=0`
  turns the step off; a bucket or auth outage makes it report `skipped` per table
  and delete nothing.
- **The script** handles the first bulk pass, verification and restores:

```sh
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"
node scripts/db-archive-table.mjs firewall_decisions            # archive only, read-only against the DB
node scripts/db-archive-table.mjs firewall_decisions --prune    # archive, verify, delete
node scripts/db-archive-table.mjs --all --verify                # re-hash every part, recount every line
```

`--verify` prints `{table, parts, archivedRows, deletedRows, problems}` per table
and exits non-zero on any sha256 or line-count mismatch. `archivedRows` can exceed
`deletedRows` by the rows of an archive-only part (for example the 1,000-row
`sniper_llm_verdicts` trial part from 2026-11-03, whose rows were archived again by
the prune run).

### Restore a month

```sh
# dry run: lists every part overlapping the range and the rows it would restore
node scripts/db-archive-table.mjs usage_events --restore --from 2026-08-01 --to 2026-09-01
# apply: INSERT ... SELECT * FROM jsonb_populate_recordset(...) ON CONFLICT DO NOTHING
node scripts/db-archive-table.mjs usage_events --restore --from 2026-08-01 --to 2026-09-01 --apply
```

Restoring is idempotent (rows already present are skipped). Restored rows are
older than the live window, so the next cron tick archives and prunes them again
unless you raise that table's `days` first, or set `DB_ARCHIVE_ENABLED=0` while
you work with them.

### The settle-book rollup

`/api/x402-ring?period=all` and `api/_lib/platform-analytics.js` publish lifetime
totals over `x402_self_facilitator_log`. Its delete statement fills
`x402_self_facilitator_rollup` (per UTC day, network, action, ok, mint and reject
class: count, amount, fee) in the same statement as the delete, so a row leaves
the log and enters the rollup atomically, and both readers add the rollup to the
live log. `tests/x402-ring-lifetime-rollup.test.js` proves lifetime totals are
identical before and after a prune. The readers and the pruning cron ship in the
same image, so totals never dip during a deploy; do not prune this table by hand
against a production revision older than the rollup readers.

## The two mechanisms

### 1. Graceful degradation (always on)

`isDbCapacityError()` (`api/_lib/db.js`) classifies SQLSTATE 53100. Once
classified, write paths degrade instead of 500-storming:

- **API writes** return a bounded **503 + `Retry-After: 30`** (`wrap` /
  `serverError` in `api/_lib/http.js`), with a single deduped `db:capacity` ops
  alert — no per-request Sentry flood.
- **Crons** skip the tick and return `200 { ok: false, reason: "db_full" }`
  (`wrapCron`), so a full branch never produces a 5xx alert storm.

### 2. `/api/cron/db-retention` (scheduled every 15 min)

Bounded + idempotent. Each tick:

- **Firehose retention** (archive, then delete). Every mint older than the window
  is written to cold storage with all its satellite rows before anything is
  deleted, so the full launch history behind `/radar`, `/coin-intel` and the
  Oracle coin pages is kept even though the live tables only hold the window. See
  "Firehose archive" below. The delete itself is still a `DELETE`, which settles
  `xmax` in place and therefore works **even at the cap**, where an `UPDATE` would
  itself fail with 53100. `wallet_reputation` (the durable, wallet-keyed output)
  and `pumpfun_graduations` (win/loss ground truth) are **never** touched.
- **Ledger windows with their own clocks.** The x402 audit ledger keeps a longer
  window (`X402_AUDIT_RETENTION_DAYS`, tightening to
  `X402_AUDIT_MIN_RETENTION_DAYS` under pressure), and `x402_spent_payments`, the
  replay guard behind `api/_lib/x402/spent-payments.js`, keeps a **fixed** window
  (`X402_SPENT_RETENTION_DAYS`) that the valve never shortens: a shorter window is
  a shorter replay-protection window, and the rows are too small to be why the
  branch is under pressure. `x402_self_facilitator_log` (the settle book) is
  archived and pruned with a rollup, see "The settle-book rollup" above.
- **Archive-then-prune** of the history tables in the inventory above, see
  "Archive layout".
- **MCP client sessions.** `mcp_client_sessions`, the raw join table behind the
  [MCP clients board](mcp-clients.md), loses every session idle for 30 days. The
  window is fixed and the valve never touches it; `mcp_client_daily`, the
  aggregate the board reads, is kept.
- **Avatar job hygiene** — deletes terminal jobs past 30 days and strips base64
  source images from terminal jobs past a day.
- **VACUUM** (plain) of the pruned tables so freed pages become reusable by
  future inserts.
- **Compaction under pressure.** Plain `VACUUM` never shrinks the relation
  *files*, so on Neon `pg_database_size` stays high after a prune and the
  storage-pressure gate (`isStoragePressured` / `requireWriteCapacity`) can
  latch permanently: the July 2026 recurrence had **770 MB** of dead file space
  across the pruned tables while every write-heavy cron sat skipped. When a
  tick starts over the high-water mark, the cron now measures reclaimable space
  per managed table (`pgstattuple_approx`, extension auto-installed) and
  `VACUUM FULL`s the worst offenders, smallest file first (each rewrite needs
  headroom about equal to the table's live size), bounded per tick, and only
  ever on tables this cron itself manages. The rewrites returned
  `pump_coin_intel` 576→194 MB and `oracle_conviction` 386→137 MB in ~2 s each
  during the 2026-07-22 recovery.

**The self-healing valve.** The retention window self-tunes: normally
`PUMP_INTEL_RETENTION_DAYS`, but whenever the branch is at/above
`DB_RETENTION_HIGH_WATER_MB` it tightens to `PUMP_INTEL_MIN_RETENTION_DAYS`, so
the hard cap is **never actually reached**. It relaxes again once GC returns the
freed space and the branch drops back under the mark. When the valve engages it
fires one deduped `db:retention-pressure` alert.

## Tunables

| Env | Default | Meaning |
| --- | --- | --- |
| `PUMP_INTEL_RETENTION_DAYS` | `14` | Normal firehose window (days). Clamped `[2, 365]`. Raise after a Neon plan upgrade. |
| `PUMP_INTEL_MIN_RETENTION_DAYS` | `3` | Floor the valve tightens to under pressure. Clamped `[1, retention]`. |
| `DB_RETENTION_HIGH_WATER_MB` | `470` | Engage the valve at/above this size. Clamped `[128, 100000]`. Production runs `20992` (see the sizing note below). |
| `DB_ARCHIVE_ENABLED` | `1` | Set `0` to stop the cron's archive-then-prune step (nothing is archived or deleted; the tables grow). |
| `DB_COMPACT_ENABLED` | `1` | Set `0` to disable the `VACUUM FULL` compaction step entirely. |
| `DB_COMPACT_MIN_FREE_MB` | `25` | Only rewrite a table holding at least this much reclaimable space (and at least 30% of its file). |
| `DB_COMPACT_MAX_TABLES` | `3` | Most tables one tick may rewrite. |
| `X402_AUDIT_RETENTION_DAYS` | `365` | x402 audit ledger window (`x402_autonomous_log` and the audit log). Clamped `[7, 3650]`. `x402_audit_log` rows are archived to object storage (gzip JSONL, read back and verified) before they are deleted; with storage unconfigured nothing is deleted. |
| `X402_AUDIT_MIN_RETENTION_DAYS` | `30` | Floor the valve tightens the audit window to. Clamped `[1, audit retention]`. |
| `X402_SPENT_RETENTION_DAYS` | `90` | Fixed window for `x402_spent_payments` replay proofs. Clamped `[30, 3650]` so a typo cannot shrink the guard to hours; never tightened by the valve. |

### Sizing the high-water mark (read before changing it)

The mark must sit **above the live data footprint and below the real branch
cap**. Both halves matter, and getting either wrong is a production incident:

- **Too low** and the branch sits permanently over the mark. Every cron built
  with `requireWriteCapacity` preflight-skips forever, the valve pins retention
  at its floor, and the platform quietly stops ingesting while looking healthy.
  This is the failure mode that mattered on 2026-07-28: the mark was set equal
  to the assumed 3072 MB cap while the live footprint was ~2.7 GB, so at 18:42
  a single tick over the line skipped 56 crons in one minute — including
  `economy-rebalance`, the cron that refills the x402 fee wallet. The fee wallet
  starved and every settle returned `fee_wallet_below_floor` for the next four
  hours. `economy-rebalance` is no longer gated for exactly this reason.
- **Too high** and the valve never engages before the branch hits its real cap,
  where writes fail with SQLSTATE 53100 and only `DELETE` still works.

Confirm the real cap before sizing, rather than assuming the tier you signed up
on:

```sh
psql "$DATABASE_URL" -c 'SHOW neon.max_cluster_size'
psql "$DATABASE_URL" -c 'SELECT pg_size_pretty(pg_database_size(current_database()))'
```

As of 2026-07-29 that reads `16TB` against a ~2.5 GB footprint, so the mark is
`8192` on the Cloud Run service: months of headroom at the firehose's ~60 MB/day
while still leaving the valve as a genuine runaway backstop.

```sh
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 --update-env-vars DB_RETENTION_HIGH_WATER_MB=16384
```

**Raised to `16384` on 2026-10-09.** The footprint crossed 8192 MB on 2026-09-09 and
reached 11,606 MB a month later (about 114 MB a day), with `neon.max_cluster_size`
still `16TB`. For that whole month `launcher-tick`, `coin-intel-observe`,
`smart-money-rollup`, `recompute-reputation` and `intel-learn` preflight-skipped on
every tick, which is the "too low" failure above: the `db retention pressure valve
engaged` ops alert fired about 2,200 times a day, nobody acted on it, and nothing was
ingested. The growth is not the pump.fun firehose the valve sheds: the largest tables
are outside the retention set (`oracle_training_set` 1.8 GB, `x402_self_facilitator_log`
1.4 GB, `firewall_decisions` 1.2 GB, `usage_events` 0.7 GB, `club_tips` 0.6 GB,
`ops_alerts` 0.5 GB). At the current rate 16384 is about six weeks of headroom, so
re-measure before it runs out and decide retention for those tables rather than
raising the mark again.

**Raised to `20992` on 2026-11-03** (16,814 MB measured plus 4,096 MB, revisions
`three-ws-api-00518`/`00519`) as relief only, so the skipped crons ran again and
`VACUUM FULL` had headroom. The durable fix landed the same day: the seven history
tables above are archived to cold storage and pruned ("Archive layout"), which
brings the footprint well under 70 percent of this mark. Do not raise it again to
answer growth; add the growing table to `api/_lib/db-archive-tables.js`.

### The `database_storage` health subsystem

`/api/healthz` reports `database_storage` (`api/_lib/ops/database-storage-health.js`)
with the size, percent of the mark, the three largest tables and the last
retention run: `ok` under 75 percent of `DB_RETENTION_HIGH_WATER_MB`, `degraded`
from 75 to 100 percent, `down` above the mark (the write-heavy crons are skipping).
`/api/cron/uptime-check` escalates a degraded or down subsystem into an ops alert
on first sight and re-pages hourly, so the cap now pages before it bites instead
of after a month of silent skips.

## Upgrade trigger

The valve keeps the branch **healthy** on the free tier, but at the cost of a
**shorter effective history window** (roughly `PUMP_INTEL_MIN_RETENTION_DAYS`)
whenever storage is tight. If `db:retention-pressure` alerts are frequent and you
want a longer guaranteed window (e.g. the full 14-day judge horizon), **upgrade
the Neon plan** for more storage, then raise `DB_RETENTION_HIGH_WATER_MB` and
`PUMP_INTEL_RETENTION_DAYS` to match.

## Manual reclaim (one-off, at the cap)

`DELETE` frees space without extending a file, so it works at the cap; `UPDATE`
does not. To reclaim immediately, delete the oldest rows in batches, then
`VACUUM` (or `VACUUM FULL <table>` only when that table's **live** data is small
enough that the rewrite fits the remaining headroom). Measure with:

```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public'
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 20;
```

## MCP client sessions

Raw `mcp_client_sessions` rows are deleted 30 days after their last call. The daily aggregates (`mcp_client_daily`, `mcp_client_tool_daily`) are kept. See [mcp-clients.md](mcp-clients.md).

## See also

- `api/cron/db-retention.js` — the cron
- `api/_lib/db.js` — `isDbCapacityError` / `isDbUnavailableError`
- [docs/ops/redis.md](redis.md) — the Upstash cache/limiter quota playbook
