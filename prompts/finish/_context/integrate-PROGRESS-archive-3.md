# integrate-PROGRESS, archive 3 (2026-10-15 to 2026-10-23)

Older entries moved verbatim out of [integrate-PROGRESS.md](integrate-PROGRESS.md) on 2026-11-13 so every file stays under the 50,000-character limit. Read-only record: append new entries to [integrate-PROGRESS.md](integrate-PROGRESS.md), never here.

## 2026-10-15: order 524-integrate-25 closed (evolve)

Turned any public OpenAPI/Swagger spec URL or GitHub repo into a draft, importable
three.ws skill bundle end to end.

Step 0 measured: `specs/SKILL_SPEC.md` confirmed the four-file bundle shape (manifest.json,
SKILL.md, tools.json, handlers.js); `community-skills/tools/validate.mjs` validates a
different directory shape (a flat registry-manifest layout, not an individual bundle), so
Task 3's "validate with community-skills/tools/validate.mjs" was satisfied by a new
purpose-built `packages/skill-import/src/validate.js` instead (judgment call, logged at the
time); `packages/tool-sdk/src/mcp-adapter.js` confirmed the `ctx.fetch`/`ctx.secrets` handler
contract generated handlers must target; `api/skills/` had no existing import route.

Task 1: new `packages/skill-import` package. `openapi.js` parses OpenAPI 3.x and converts
Swagger 2.0 via `swagger2openapi`; `operations.js` dereferences `$ref`s into a normalized
operation list; `generate-tools.js`/`generate-handlers.js`/`generate-manifest.js`/
`generate-skillmd.js` turn that into a full bundle, with handlers calling `ctx.fetch` and
filling auth from `ctx.secrets` at call time (never hardcoded). Two bugs found and fixed
while wiring this live against the public Petstore API: a real API mislabeling a plain-text
body as `application/json` crashed the handler (now always reads text first, parses JSON
only on success); `server/index.mjs` strips a trailing ".js" from API paths before routing,
so the generated bundle's own `handlers.js` 404'd through the dynamic catch-all until the
route accepted both "handlers.js" and the bare "handlers" it actually receives.

Task 2: a repo with only a README produces a declarative bundle (`declarative.js`): SKILL.md
only, no tools.json, no handlers.js.

Task 3: `POST/GET /api/skills/import` (`api/skills/import.js`) generates and lists drafts
through the SSRF guard (`fetchSafePublicUrlPinned`), validates with the new `validate.js`,
and saves via `api/_lib/openapi-skill-imports.js` with `enabled` hardcoded false. Beyond the
literal task list: built the previously-missing `GET/PATCH/DELETE /api/skills/import/:id`
route, since without it a draft's `enabled` flag could never change and the feature would
have been a dead end once generated (judgment call, justified by "no half-finished
implementations"). Also built the bundle host `api/skills/import/[id]/[...file].js` serving
manifest.json/SKILL.md/tools.json/handlers.js anonymously by id. New migration
`20261015130000_openapi_skill_imports.sql`, new rate limit `openapiSkillImportUser` (20/10m).
Fixed a real, pre-existing vercel.json routing collision (`/api/skills/([^/]+)` was
swallowing `/api/skills/import` before the literal route could match) and confirmed via the
server's route-compile anchoring (`^...$`) that the new two-segment `:id` route needs no
further vercel.json change.

Task 4: CLI. `three-ws skills import <url>` (full URL or bare `owner/repo`) posts to
`/api/skills/import`; `isImportUrl()` disambiguates a URL/`owner/repo` from a community
slug (slugs never contain `/`). New `three-ws skills drafts` lists the caller's drafts with
enabled state.

Task 5: UI. New "From an API" tab on the existing `/skills/import` page (reused its
tab/`sc-*` CSS shell rather than a new page, since both features are "import a skill from
somewhere external"): submit a URL, see the generated tool list in a result card labelled
disabled, manage drafts (enable/disable/delete, manifest.json link) from a persistent list,
signed-out gate state. Verified live in a real headless Chromium session against the dev
server (a real session cookie minted via `createSession`, not a mock): generated a skill
from the public Petstore OpenAPI spec end to end (19 tools), enabled it, deleted it, checked
the signed-out gate render; zero console errors, zero failed network requests at every step.

Task 6: new docs/skills.md section "Importing a skill from an OpenAPI spec or a GitHub repo"
with a real curl example against the Petstore spec; `data/changelog.json` entry;
`STRUCTURE.md` row for `packages/skill-import` and its routes; `npm run build:pages` run.

Definition of done, verified:
- `packages/skill-import/tests/skill-import.test.js`: a vitest serves the synthetic
  `sample-openapi.json` fixture from a real local `node:http` server, asserts the generated
  bundle passes `validate.js`, and loads its handlers (4/4 pass).
- `tests/openapi-skill-import.test.js`: 7 tests against the real API handlers (import, the
  new `:id` route, and the bundle host) with a real local HTTP server standing in for the
  upstream spec (only the SSRF guard's network check is swapped for a passthrough, since
  loopback is exactly what it exists to refuse in production); covers auth/scope rejection,
  full real generation end to end asserting `enabled: false` on both the response and the
  raw stored row, owner-scoped enable/disable/delete, and bundle file serving including the
  `.js`-extension-stripping edge case.
- "Imported skills are never enabled automatically": asserted directly in the test above
  (`db.rows[0].enabled === false` immediately after creation) and confirmed live: the
  generated draft from the real Petstore spec came back `enabled: false` and stayed that way
  until the dedicated PATCH.
- "Importing a real public OpenAPI spec end to end in dev produces a draft skill whose tool
  call works": verified live twice, once via curl/node against the real Petstore demo
  (`logoutUser` call succeeded against the live API after the content-type fix) and once via
  the full browser UI flow above.
- Package README (pre-existing from this order's own earlier work), `STRUCTURE.md` row,
  docs section, changelog entry: all present, `npm run build:pages` run.
- `npm run check:rules -- --paths <every touched file>`: clean (fixed five em-dash
  violations first, one of them in this order's own new docs prose, the rest already in the
  prior session's generated code comments).
- Full regression pass, no failures: `packages/skill-import/tests` + `tests/
  openapi-skill-import.test.js` (11/11), `packages/three-ws-cli` full suite (82/82), `tests/
  api-rate-limit-wiring.test.js` + `tests/api/rate-limit-buckets.test.js` (24/24, covers the
  touched `api/_lib/rate-limit.js`).

No owner-gated action: no push, no deploy, no on-chain write, no crypto project other than
$THREE in the diff. One judgment call beyond the task list already logged above (the missing
enable/delete route); the `validate.mjs` substitution and the `agents:write`/`agents:read`
scope reuse on a non-agent-scoped resource were carried over from the prior session's work
and are logged there.

Commits: `d7bcabdcc` (package + API routes + migration + rate limit + vercel.json fix +
tests), `df5e2d380` (CLI), `e55c84a15` (UI tab), `7c28d186c` (docs, STRUCTURE.md, changelog),
this closing commit (PROGRESS log, order-file removal).

## 2026-10-23: order 530 (registry cleanup), partial, owner-gated

Prepared: `scripts/publish-mcp-servers.mjs --deprecate` (dry run unless `--apply`; `--dry-run` also prints the plan), a DEPRECATIONS list (claude-code-explorer-mcp, data-workbench-mcp), solana-memo-media-mcp bumped to 0.1.1 to match npm (registry still has 0.1.0), ecosystem doc count replaced by its source of truth. Remaining and owned by the owner: run the registry publish and deprecate commands (external writes). Order file left in place.

## 2026-10-23: order 529 (MCP registry sentinel), done

`api/cron/mcp-registry-sentinel.js` plus `api/_lib/mcp-registry-sentinel.js`, daily cron in `vercel.json`, 12 vitest cases, ops doc `docs/mcp-registry-sentinel.md`. Code landed in `218f00660` (swept into a concurrent agent's commit); this closing commit adds the doc, PROGRESS entry and order-file removal. Deploys with the next owner-approved deploy.

## 2026-10-23: order 542 (3D-AR-Studio source into the monorepo), code done, publish and push owner-gated

Step 0 measured: in-app studio 5,072 lines (`src/ar-studio.js` + `src/ar/*`), npm `3d-ar-studio` at 0.3.1, upstream repo already at 0.3.2. Upstream's shared modules were functionally identical to `src/ar/*` (comment style aside) except the share-URL helpers (upstream take the hosting page URL, not an origin) and the room client (upstream adds a connect timeout and lazy optional `colyseus.js`). Imported at `packages/ar-studio` (0.3.2, 75 package tests); `src/ar-studio.js`, `src/irl.js`, `src/ar/webxr.js` and the `tests/ar-*` suites now import the package modules; the seven duplicated `src/ar/*` files were deleted; `src/ar/studio-net.js` is a thin subclass that only resolves the Colyseus host. `tests/ar-studio-package-parity.test.js` guards the server/package wire schema. Mirror entry added to `data/standalone-mirrors.json`; STRUCTURE.md, `docs/ar-studio.md`, changelog updated. Commits: `111fc15c7` (swept in by a concurrent agent), `22a5a1f49`, `0ac2f37ac`, plus this closing commit. Remaining, owner: `npm publish` of 3d-ar-studio 0.3.2 from `packages/ar-studio` and `npm run sync:repos -- --only 3D-AR-Studio` (stage, review, push). Order file removed (code complete; the two remaining steps are the gate-2 commands reported in the final message).

## 2026-10-23: order 543 (Flappin UFO back at /play/ufo), done

Step 0 measured: the retired page was a static notice with no game; the owner's `flappin-ufo` ran on DOM physics that a server cannot verify. Built a shared deterministic 60 Hz sim (`src/play/ufo/sim.js`) used by the browser, the ghost and the server verifier; levels 1 to 30 proven clearable by a bot. Code landed in `22a5a1f49` (swept in by another agent's commit): `api/play/ufo-runs.js`, the `ufo_runs` migration, `game.js`, the page, the `ufo_score` metric on the unified leaderboard and a `/rankings` tab. Follow-up commit adds the test fixes, `docs/play-ufo.md`, STRUCTURE row, pages.json entries and changelog entry. Evidence: 16/16 vitest cases (real handler on PGlite: POST, GET, ghost, tamper, 422, 409), headless Chromium at about 60fps on desktop and Pixel 7 emulation with no console errors. Remaining, owner-gated: migration `20261023150000_ufo_runs.sql` applies with the next approved deploy (`npm run db:status` first); until then the production endpoint returns an error and the page shows its retry state.

## 2026-10-23: order 538 (oracle wallet prior from the database), done

Step 0 measured: the committed prior snapshot dated 2026-06-16 (273 wallets: 128 smart money, 145 KOL), read by `known-wallets.js` through a synchronous JSON load; `gmgn-seed` already upserts `wallet_reputation` daily and was still serving 200 via its kol-quest fallback. `known-wallets.js` now loads the prior from `wallet_reputation` (mainnet, `coins_traded < 5`, labels smart_money/kol/sniper) into an in-process map with a 10 minute TTL (30 seconds after a failed read, last good rows kept), single-flight; `knownWallet()` stays synchronous and callers (`sources.js`, `store.js`, `trades.js`, `pump-fun-mcp.js`) `await loadKnownWallets()` first. An empty table serves an empty prior and logs once. The snapshot file was deleted. `gmgn-seed` now files KOLs as `kol` (score 74) instead of `neutral`, otherwise the 145 KOLs would have dropped out of the prior. Evidence: a live cron run into a PGlite copy of the table fetched 273 wallets and upserted 273 (128 smart_money, 145 neutral before the label fix), the oracle read back 128 as prior; `tests/oracle` 21 files and 282 tests pass in an isolated install; new `tests/oracle/gmgn-seed-prior.test.js` covers cron to prior. Code landed in `22a5a1f49` (swept in by a concurrent agent), the cron label fix and closing files in this commit. Left in place on purpose: the copy-trading directory snapshot and its builder script, which carry names, handles, BSC rows and 30 day PnL that `wallet_reputation` does not hold, and which a different endpoint reads. Production note: existing KOL rows are relabeled `kol` on the next gmgn-seed run after deploy.

## 2026-10-23: order 522 (integrate 23, outbound receipts), done

Step 0: everything but the schema was already committed. Resolver `api/_lib/x402/solana-settlement.js`, cache layer `api/_lib/x402/outbound-receipts.js`, endpoint `api/x402/outbound-receipts.js` landed in `420a88d88`; the Outbound tab on `/receipts` (`pages/receipts.html`, `src/receipts-outbound.js`) in `9e1ff2270`. Closing step: applied only `20261015110000_x402_outbound_resolved.sql` to production with `node scripts/apply-migrations.mjs --apply --file 20261015110000_x402_outbound_resolved.sql` (additive, idempotent; the other pending migrations were left alone). `npm run db:status` lists it applied. Vitest: `tests/solana-settlement.test.js` plus `tests/x402-outbound-receipts.test.js` 22 pass, `tests/x402-outbound-receipts-endpoint.test.js` 6 pass. Row 66 in `production-100-OWNER-ACTIONS.md` is resolved by this apply.
