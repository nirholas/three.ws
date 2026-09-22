# Forge funnel board

`GET /api/ops/forge-funnel` answers the question the generation health sensor
cannot: of the models Forge finishes, how many does anyone keep? The sensor
(`api/_lib/ops/forge-health-sensor.js`, surfaced on `/api/healthz`) reports
whether a mesh came back. That is a pipeline fact. This board is the product
fact after it: accepted or downloaded output, whether new makers come back for a
second model, what each model was for, which engine earns its attempts, and what
paying agents spend per kept model.

Forge has recorded the verdict on every generation (`outcome`, `rating`,
`downloaded`) since its first migration. Until this board nothing read those
columns, so the acceptance data was collected and never looked at.

Three ways to read it, all backed by `api/_lib/forge-funnel.js` so the
definitions cannot drift:

- **[/forge-funnel](../../pages/forge-funnel.html)**, the internal page.
- `GET /api/ops/forge-funnel?days=30`, the JSON behind it.
- `npm run forge:funnel`, the same report in a terminal with no server running.

```bash
npm run forge:funnel                 # last 30 days
npm run forge:funnel -- --days 7
npm run forge:funnel -- --json

curl -s -H "x-ops-secret: $OPS_SECRET" "https://three.ws/api/ops/forge-funnel?days=30" | jq '.output.useful_output_rate'
```

The CLI reads `DATABASE_URL` from `.env.local`, then `.env`, then the shell, the
same order as `npm run forge:errors`. It runs SELECTs and nothing else.

## Auth

Same gate as `/api/ops/health` and the [payment-outcome board](payment-outcomes.md):
an admin session, or `x-ops-secret` matching `OPS_SECRET` (never `CRON_SECRET`;
see `api/_lib/ops-auth.js`). Unset secret means open in dev and denied in
production. It is owner-only on purpose: it carries per-engine performance and
revenue. Per-IP ceiling is the shared `authedReadIp` bucket.

## The response envelope

```json
{
	"ok": true,
	"degraded": [],
	"window_days": 30,
	"min_sample": 20,
	"generated_at": "2026-09-21T22:33:20.917Z",
	"output": {},
	"new_actors": {},
	"retention": {},
	"destinations": {},
	"lanes": [],
	"revenue": {}
}
```

`days` is a whole number from 1 to 365, default 30. The panels are read
independently and in parallel. One that throws is named in `degraded`, its
section reads as empty, and the status is `207 Multi-Status`, the convention the
other ops boards use. `ok` says whether the board rendered, never whether the
funnel is good. If a panel reports a missing column, migration
`20260921120000_forge_destination.sql` is not applied: `npm run db:status`.

Every rate is an object, not a bare number:

```json
{ "value": 0.2183, "n": 310, "of": 1420, "low_sample": false }
```

`value` is null when `of` is zero, because an empty base is not a zero rate.
`low_sample` is true when `of` is under `min_sample`. The rate is still shown.
Do not act on it.

## Definitions

| Term | Meaning |
| --- | --- |
| Useful | A finished row the maker accepted or downloaded. Either is a deliberate act on the result. A rating alone is not. |
| Maker | `coalesce(user_id, client_key)`: the account when signed in, otherwise the anonymous browser key. |
| Keyless request | A row with no account and no `x-forge-client` header. All of them hash to the literal key `anon`, which would read as one extremely loyal maker, so they count in volume and are left out of every per-maker number. `output.unattributed_requests` says how many. |
| New maker | A maker whose first-ever Forge creation falls inside the window. |
| Internal | Rows the platform generated itself (catalog seeder, weekly quality benchmark). Excluded everywhere: by `forge_creations.internal` from this migration on, and by `forge_seed_jobs.creation_id` for older seeder rows. Older benchmark rows cannot be told apart and remain in pre-migration numbers. |
| Failed over | An attempt re-dispatched to another engine (`superseded_by` set). Request-level panels skip it, because the successor row carries the request to its real outcome. The engine table keeps it, because a lost attempt is what that table measures. |

## The panels

**`output`**: volume (`requests`, `done`, `failed`, `in_flight`),
`generation_success_rate`, and `useful_output_rate` (useful over done).
`feedback_coverage` is the share of finished rows carrying any verdict, rating
or download. Read it first. It bounds everything else: a useful-output rate over
rows nobody judged undercounts, and a router cannot learn from rows with no
label.

**`new_actors`**: `first_asset_success_rate` is new makers who reached a model
they kept, over all new makers. `second_asset_rate` is based on new makers who
got one finished model, not on everyone, so a bad first-generation failure rate
does not masquerade as low repeat interest.

**`retention`**: `d7` and `d30` are makers who created again at least that many
days after their first creation, over makers first seen long enough ago to have
had the chance. The cohort always looks back `cohort_lookback_days` and ignores
`days`, so narrowing the window does not starve it.

**`destinations`**: one row per destination in composer order, any stored id
this build does not recognise, then `Not answered` last. A known destination
with no rows still appears, so the table reads "nobody chose Print" and not as a
gap. `answer_rate` is answered finished rows over all finished rows.

**`lanes`**: per engine. `attempts_per_useful` is the cost driver: terminal
attempts spent per kept model. `generation_seconds_per_useful` is total
generation seconds over kept models, which is what GPU cost scales with on the
self-hosted engines. Seconds come from `completed_at - created_at`, so only rows
finished after the migration are timed; `timed_attempts` says how many that is.
There is deliberately no dollar figure. Cost per generation is not recorded, and
an always-on GPU bills idle time that a per-row estimate would hide.

**`revenue`**: x402 only, because it is the one payment rail whose price is
recorded on the row (`x402_price_atomic`). `usdc_per_useful_asset` divides that
by every kept model in the window. `agent_weekly_retention` is distinct payer
wallets from the prior week that paid again this week. $THREE and credit payments
are not on the row and are not in this panel.

## Where destination comes from

`forge_creations.destination` is one of `game`, `web`, `avatar`, `simulation`,
`print`, `ar`, `play`. The list lives once in
`src/shared/forge-destinations.js`, which the composer, the request validator
and this report all import.

- In [/forge](../../pages/forge.html) and `/forge-studio`, a "Making this for"
  chip row appears under a finished model. One tap is remembered in that browser,
  sent as `destination` on every later `POST /api/forge`, and written onto the
  model on screen through `POST /api/forge-feedback`.
- API callers send the same field. An unrecognised value is ignored, never an
  error.

```bash
curl -sS -X POST https://three.ws/api/forge \
  -H 'content-type: application/json' \
  -d '{"prompt":"a low-poly wooden barrel","destination":"game"}'
```

Rows from before the migration are null and land in `Not answered`. They are
never folded into a real answer.

## Related

- [forge-error-triage.md](forge-error-triage.md): what fails, ranked by class and engine.
- [../forge-pipeline.md](../forge-pipeline.md): the pipeline, the `forge_creations` columns, and routing.
- [payment-outcomes.md](payment-outcomes.md): the sibling board for the payment rail.
