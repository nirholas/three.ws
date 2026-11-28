# three.ws Forge for Supabase

Insert a prompt into a Postgres table and get a textured 3D model (GLB) back in Supabase
Storage, with progress over Realtime. The setup guide for Supabase users is
[docs/supabase.md](../../docs/supabase.md), published at
[three.ws/docs/supabase](https://three.ws/docs/supabase).

## Layout

- `supabase/migrations/20261128000000_three_ws_models.sql`: the `three_ws_models` table, its
  row level security and column grants, the per-user cap of 3 unfinished models, the
  `three_ws_claim_models()` lease and `three_ws_next_due_seconds()` functions the sweep uses,
  the private `three-ws-models` bucket with owner-only Storage policies, and the Realtime
  publication entry.
- `supabase/migrations/20261128000100_three_ws_models_schedule.sql`: `pg_net` and `pg_cron`,
  the after-insert trigger and the per-minute cron job that call the Edge Function, using the
  project URL and shared secret stored in Vault.
- `supabase/functions/three-ws-forge/`: the Edge Function (Deno).
  - `index.ts` checks the shared secret, wires supabase-js and runs one sweep per call.
  - `sweep.ts` is the state machine: `queued → submitting → generating → storing → done`, or
    `failed`. It claims rows under a lease, so concurrent calls never work the same row.
  - `forge.ts` is the three.ws Forge client. It maps every documented answer to `done`,
    `pending`, `retry` or `fatal`, and sends the row id as the `Idempotency-Key`.
  - `deno.json` pins `@supabase/supabase-js@2`.
- `supabase/config.toml`: `verify_jwt = false` for the function, for a local `supabase start`.
- `example/index.html`: a complete client (sign-in, prompt form, live list, viewer, download).
  Open it from any static server and enter a project URL and publishable key.

`sweep.ts` and `forge.ts` use only `fetch` and web APIs, so the tests run the exact files that
deploy.

## Tests

```bash
cd integrations/supabase
npm test             # 44 tests, about a minute, no network
npm run test:live    # one real draft generation through production three.ws
```

`npm test` applies both migrations to PGlite (Postgres 18) with the roles, `auth.uid()`,
Storage tables and Realtime publication a Supabase project has, then checks:

- the RLS policies and column grants, as `authenticated` and `anon` with real JWT claims;
- the per-user cap, the claim lease and `FOR UPDATE SKIP LOCKED`, and the due-time function;
- the bucket settings and owner-only Storage policies;
- the schedule migration against recording stand-ins for `pg_net`, `pg_cron` and Vault;
- `forge.ts` against every status and error code `/api/forge` documents;
- the sweep's whole state machine, with three.ws answers injected so each failure path runs:
  cached results, submit and poll, busy lanes, rejected keys, the attempt limit, quota waits,
  non-GLB files, a crashed sweep, Storage failures and the age limit.

`npm run test:live` needs `THREE_WS_API_KEY` (a key from
[three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys)). It inserts a row as a
signed-in user, runs the real sweep against production until the row finishes, and checks the
stored file is a GLB only its owner can read.

`npm run check:integrations -- supabase` (repo root) runs `npm test` and, when Deno 2 is
installed, `deno check` on the Edge Function.

## Running it in a real project

Follow [docs/supabase.md](../../docs/supabase.md). Run a sweep by hand and read its summary:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/three-ws-forge?wait=1" \
  -H "x-three-ws-forge-secret: $FORGE_SECRET"
```

The function answers `405` to anything but POST, `500 unconfigured` (naming the missing
secrets) until `THREE_WS_API_KEY` and `THREE_WS_FORGE_SECRET` are set, and `401` without the
right secret header. Without `?wait=1` it answers `202` and finishes the sweep in the
background. Optional: `THREE_WS_BASE_URL` points it at another three.ws deployment.

## Partner listing

[SUBMITTING.md](SUBMITTING.md) has the Supabase Integration Partner application, ready to send.
