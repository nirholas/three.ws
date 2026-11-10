# integrate: progress log

Cross-chat handoff log for the `integrate-` campaign (orders `500` to `549`). Shared facts live in
[integrate-00-CONTEXT.md](integrate-00-CONTEXT.md). Append a dated entry when an order finishes
(with commit SHAs) or stops on a gate (with the exact line that remains and who owns it). Newest
entries go at the bottom.

**Older entries:** [integrate-PROGRESS-archive-1.md](integrate-PROGRESS-archive-1.md) (2026-10-08 to 2026-10-14), [integrate-PROGRESS-archive-2.md](integrate-PROGRESS-archive-2.md) (2026-10-14 to 2026-10-15). They were moved there verbatim on 2026-11-10 to keep every file under the 50,000-character limit; search them too when you need history.

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

## 2026-10-23: order 541 (integrate 42, readme-3d in the product), done

Step 0 measured: `packages/readme-3d` had no product surface; its README forge example polled the wrong fields. Shipped `POST /api/readme-3d` (SSRF-hardened `fetchModel`, byte-budget decimation, 12 per 10 min per IP), `convertBytes`/`convertTriangles` in the package, a "GitHub README 3D" action in both forge export menus, the avatar page download menu, the dashboard avatar menu and the model page, and the `/readme-3d` page (three.js STL preview, copy, download .md). The stale curl example lived in `packages/readme-3d/README.md` (not the root README, whose example was already correct); it now submits and polls with `job_id` and `glb_url`. Code landed in `a4d4e4cc1`, `22a5a1f49` and `2b7bb3921` (swept in by concurrent agents). Evidence: 22/22 package tests, 4/4 `tests/readme-3d-api.test.js` cases (real handler over HTTP), live API on real three.ws GLBs (fox: 576 facets, 83 KB; default avatar: 13,317 to 1,014 facets, 146 KB; `readme-3d check` passes), headless Chromium rendering the fox with copy and download controls and no errors from the page's own code. `check:pages` flags `/readme-3d` only because `dist/` is stale until the next build. Remaining, owner: none beyond the normal deploy.

## 2026-10-23: order 533 (integrate 34, X post reader and /x-video), code done, two lines open

Step 0 measured: both callers read X through oEmbed (text only, no metrics or media). The shared keyless reader `api/_lib/x-syndication.js` (X syndication, then fxtwitter, then guest-token GraphQL when `X_BEARER_TOKEN` is set) now backs `handleSocialXPostImpact` in `api/pump-fun-mcp.js` and `src/social/x-post-impact.js`; `POST /api/x-video/extract` and the host-locked `GET /api/x-video/download` proxy (https `video.twimg.com` and `pbs.twimg.com` only, no credentials, ports or redirects) plus `pages/x-video.html` and `src/x-video.js` ship the free tool. Code landed in `0ad88fb38`, `22a5a1f49`, `ed75c5946` and `7718bf4fb` (all swept in by concurrent agents). Evidence: `tests/x-post-impact.test.js`, `tests/x-syndication.test.js`, `tests/api/x-video.test.js` and `tests/pumpfun-mcp-tools.test.js` 49 of 49 pass, including host refusals; `check:rules` exits 0; a local server on a spare port returned all mp4 variants (1080p, 720p, 480p and lower) for a real public video post, `no_video` for a text post, streamed a real mp4 through the proxy with 200, and answered 400 `invalid_media_url` for example.com. Open: (1) browser verification of the page and `npm run check:pages`, which needs a Vite build; the shared `node_modules` was being rewritten by a concurrent `npm install` (vite missing, then `@upstash/qstash` and `three` unresolved) for the whole session, so `dist/` is empty of every recent page. Owner: whoever next has a stable install; run `npx vite build && npm run check:pages` and open `/x-video`. The order file stays until then. The live check used a public Tripo post because the recent @trythreews posts the timeline returned contain no video.

## 2026-10-23: order 537 (integrate 38, market anomaly feed), done

Step 0 measured: no upstream tarball was needed. The detectors (modified z-score with MAD, EWMA deviation, rate of change) were written from the algorithm description in `api/_lib/market-anomaly.js` and fed from real series: CoinGecko hourly sparklines (top 100), DeFiLlama Solana TVL and Solana stablecoin supply history (built first), the stablecoin board, and Hyperliquid funding history plus open interest snapshots (no public OI history, so the cron records `market_anomaly_samples` each tick). Gas and whale processors were not built (gas is EVM-only, whale detection already exists in Oracle). Shipped in `35afe5904` (engine, sources, store, cron, migration, paid route, alert kind end to end, alerts-mcp), `22a5a1f49` and `2b7bb3921` (registry entry, fixtures and tests swept in by concurrent commits), `3f1eb493d` (ring catalog), plus the docs commit that closes this order. Migration `20261023140000_market_anomalies.sql` applied alone with `--apply --file`; 20 unrelated migrations stay pending. Evidence: 32 detector and alert tests pass on live-recorded fixtures; the cron run wrote 10 real events (stablecoin pegs) and a rerun wrote 0 (dedupe), skipping 20 open interest series as `insufficient_history` (have 2, need 29); `/api/x402/market` lists `market-anomalies` and the route answers 402. Open interest begins scoring after about 7 hours of snapshots.

## 2026-10-23: order 531 (integrate 32) MCP catalog trust grades

Every server in `public/mcp-catalog.json` now carries `trust` (0-100 score, A-F grade, per-fact breakdown) from `scripts/lib/mcp-trust.mjs`; `/mcp-tools` shows the grade with a tooltip breakdown and sorts by it; rubric in `docs/mcp.md`. Commits: `2b7bb3921` (rubric, builder, page, test and docs, swept in by a concurrent commit), `e4bdbdf34` (regenerated catalog), plus the commit that adds the changelog entry and closes this order. Evidence: `build-mcp-catalog --check` and `build-mcp-tool-history --check` pass at 704 tools on 51 servers, `tests/mcp-catalog.test.js` 10 passed, browser-verified sort and tooltips with no console errors. Network facts (npm live, registry listing, endpoint reachable) are deliberately left to the registry sentinel; the rubric scores local publish-readiness only.

## 2026-10-23: order 548 (Robinhood launch venues), code done, commit and deploy owner-gated

Step 0 measured: NOXA dead since 2026-07-13; Robinhood Chain 4663 makes about 9.6 blocks/s; a 5,000-block live probe found 1,409 mint logs, 97 tokens and 12 venue launches (Pons V2 9, others 3). Built: venue catalog (51 contract and selector pairs from the upstream launch-relay catalog, generated by `workers/robinhood-feed/scripts/build-venue-catalog.mjs`), mint-log venue discovery (`src/mints.js`), deployer reputation and dev-sold (`src/reputation.js`), `venue`/`deployer`/`dev_sold`/`flags` on the normalized launch, `api/_lib/robinhood-feed.js` merged into `/api/v1/robinhood/launches`, venue badge, deployer record and flag chips in `src/markets-robinhood.js`. Tests: 50 worker tests (real-log fixtures for 8 venues, `tests/fixtures/venue-launches.json`), 2 API mapping tests. NOXA removed from `api/_lib/robinhood.js`.

Remaining: (1) owner approves committing the diff (it names other launchpads and holds real third-party addresses in fixtures); (2) owner deploys the robinhood-feed worker and sets `ROBINHOOD_FEED_URL` on three-ws-api; (3) a full 24 h backfill needs a paid Robinhood Chain RPC (`RH_RPC_URL`), the public RPC rate-limits at 429 with a 60 s reset window, which the scan now waits out but slowly; (4) root vitest suites (`tests/api/v1-robinhood.test.js`, `robinhood-play-endpoints.test.js`, `robinhood-feed-launches.test.js`) were not run because the root `npm ci` is blocked by a lockfile out of sync with `package.json` (commit 22a5a1f49 clobbered both).

## 2026-10-23: order 534 (integrate 35, news reader lanes and trading read), code done, two checks open

Step 0 measured: for a 403 publisher page the reader returned 0 paragraphs. Built Wayback, SEC EDGAR and sibling lanes (`api/_lib/article-lanes.js`) behind the SSRF guard, the structured trading read (`parseTradingRead` in `api/news/article.js`, rendered in `src/news-article.js`), the `news_resolve` MCP tool, and the excerpt cap on every lane. Commits: `22a5a1f49` (most of the code, swept in by a concurrent commit), `33df785d3` (gzip decoding at the guard, ladder test, comment fixes), `5bcc701ec` (docs and changelog). Evidence: 7 test files, 105 tests pass. Live Wayback: `https://www.nytimes.com/2022/11/11/business/ftx-bankruptcy.html` (page 403, reader 0) resolved with `extraction: wayback` from the 2025-10-28 snapshot, excerpt capped at 173 characters. Live EDGAR: a Grayscale Bitcoin Mini Trust 8-K resolved to 11 clean paragraphs.

Remaining: (1) the live LLM trading read was not seen end to end because the provider chain returned 429 and timeouts locally; unit tests cover parsing and the response flow. (2) The reader UI (`tradingReadHtml`, `.art-trading` styles) has not been opened in a browser; run `npm run dev` and open a story at `/markets/news`. The order file stays until both are confirmed.

## 2026-10-23: order 528 (integrate 29, W3AG wallet and payment accessibility), done

Step 0: about 127 address-shortening helpers existed across src/ and dashboard-next/; all now call src/shared/address.js (shortAddress). Only two non-address truncators remain by design (dashboard-next/components/drawer.js, reputation-ui.js). Shared trap in src/shared/focus-trap.js covers the connect picker, payment modal, vault dialogs and add-funds sheet. Most of the codemod and the new modules landed in 22a5a1f49 via another agent's sweep; the closing fixes are in 1a18750d8 and c59ba09ca (committed by a concurrent sweep with accurate subjects). Evidence: tests/e2e/w3ag-wallet.spec.js 18/18, a11y-top-pages gate green including /wallet, /agent-wallet, /claim-wallet, /vaults (the one failure, / progressbar name, fixed). Full vitest has 54 failing files from redis/env and other agents' pages work, none touching these files after the connect-button test fix.

## 2026-10-23: order 540 (integrate 41, memo inscription reader), code done, live mainnet check pending

Step 0 found the reader already shipped in `876f0a4fc`: `packages/solana-memo-media-mcp/src/lib/inscriptions.js` (first/1, firsts/1, spl404 reassembly with per-part and whole SHA-256, missing-part reporting, v1 and inner-memo aware), the `read_inscription` MCP tool, `/onchain` rendering (rasters from verified bytes, SVG and HTML as inert text), docs and changelog. `npm test --prefix packages/solana-memo-media-mcp` passes 29/29, including the never-rendered-live test.

Remaining: no real multi-part inscription signature could be found (the three upstream repos' tarballs hold no mainnet signatures), so the live hash-match check is pending; vectors are built from the upstream format spec. Owner: supply one real signature, then run `/onchain` with it. Order file left in place.

## 2026-10-23: order 525 (integrate 26, Anchor IDL to agent skill), done

Step 0 measured: `packages/skill-import` and `contracts/idl/` existed, and the IDL importer, Borsh runtime, `POST /api/skills/import { idl_url | program_id, cluster }`, docs (`docs/skills.md`, package README) and changelog entry had already shipped in `b00ee311a` and `22a5a1f49`. This pass re-verified every line and closed the order. Evidence: `npx vitest run packages/skill-import` 18 of 18 pass, covering the `validateBundle` check on `skill_license.json`, Anchor-coder-identical account decoding, preview and send tools asserting no signer or secret is touched, and the risk panel. The live cluster check could not run: `EdngSwx...` (skill_license) returns a null account on both devnet and mainnet-beta, so decoding uses the recorded-fixture path; a live decode needs the program deployed (owner, see contracts/skill-license/DEPLOYMENT.md).

## 2026-10-23: order 527 (integrate 28, llms.txt and install.md), done

Step 0 found the work already shipped in `51ff59e99`: llms.txt links the curated docs as `/docs/<slug>.md`, llms-full.txt inlines doc bodies (40 KB cap, docs naming other crypto projects left out), `/install.md` is generated from the MCP directory, and `tests/llms-index.test.js` carries the conformance checks. This commit only closes the order. Evidence: `npm run build:pages` clean, `tests/llms-index.test.js` 11 passed, `/install.md` and `/docs/mcp.md` return 200 text/markdown from `server/index.mjs`, and 60 of 65 llms.txt links return 200 on Vite; the other five are server-handled (`/api/mcp` 402 by design, `/agents` and `/docs` 301, `/sitemap.xml` and `/.well-known/skill.md` need the API handlers and a built dist, not available in this sandbox).

## 2026-10-23: orders 532 and 533 (integrate 33 and 34, X guest read rung and post reader), done

Step 0 found both already shipped in `0ad88fb38` (reader, guest client, video tool, docs, changelog, STRUCTURE rows) with the oracle pieces (`api/_lib/oracle/x-account.js`, `social-feed.js`, `api/cron/oracle-social-ingest.js`, vercel.json cron) in the same tree. This pass re-verified every line and closed both orders. Evidence: `npx vitest run` on kol-leaderboard, oracle/sources, x-guest, x-post-impact, x-syndication, api/x-video and pumpfun-mcp-tools: 7 files, 87 tests pass (the download proxy host-refusal case is in tests/api/x-video.test.js). Live from `server/index.mjs`: `POST /api/x-video/extract` on a real public post returned author, metrics and media variants, a nonexistent post returned `post_unavailable`, `/api/x-video/download?url=https://evil.example/a.mp4` returned 400, and `fetchGuestProfile('trythreews')` returned 8986 followers keyless. `npm run check:claude` passes. `npm run check:pages` only reports pages missing from dist/ because this sandbox has no vite build.

Owner note: whether the keyless guest reads fit X's terms for a commercial surface is an owner call; setting `TWITTER_BEARER_TOKEN` keeps the paid API first.

## 2026-10-23: order 536 (integrate 37, $THREE post impact), partial

Step 0 found everything shipped: `scripts/x-archive-price-impact.mjs`, `api/_lib/x-content/price-impact.js`, the Posts view in `public/oracle-coin.js`, the +24h `priceReturn24h` lift in `api/_lib/x-content/outcomes.js`, docs, STRUCTURE row and changelog entry. `tests/x-archive.test.js`, `tests/x-content-outcomes.test.js` and `tests/x-post-impact.test.js` pass (81 tests). The `x:archive:price` npm script had gone missing from package.json and was restored in `618b3fd84`. `public/data/trythreews-post-impact.json` (197 posts, all three horizons measured, generated 2026-10-23) is real data.

Remaining: the three-width browser check of the Posts view and a fresh `npm run x:archive:price` run. This session's checkout had a broken `node_modules` (vite, playwright-core and lru-cache failed to resolve) and GeckoTerminal answered 429, so neither could run. Owner: whoever next has a healthy install runs the script and screenshots at 375, 768 and 1280.

## 2026-10-23: order 534 follow-up pass, still partial

Re-ran the four test files (74 pass). The live trading read still did not render: local provider chain returned kilo 429, ovh timeouts, llm7 401, and Vertex Gemini 403 (project billing dunning, owner action). The browser render check of `.art-trading` was prepared but could not run because concurrent `npm install` runs kept `node_modules` (vite, playwright) in a half-written state for the whole pass. Remaining: open a story at `/markets/news` under `npm run dev` once an LLM provider answers; owner: restore Vertex billing or supply a provider key. Order file left in place.

## 2026-10-23: orders 539 (integrate 40) and 545 (integrate 46), code done, two checks open

539: Gini, funder seeded share and v1-launch signals (`api/_lib/coin/holder-signals.js`, `api/pump/token-stats.js`, oracle features) shipped earlier via a sweep commit; this session added the trader-sheet cells in `src/launch-detail.js`. Local `/api/pump/token-stats?mint=<THREE>` returns gini 0.4952 (n=20), launch_version V0, seeding `available:false` (trade history unavailable from the capped upstream). Tests: coin-holder-signals, pump-token-stats, coin-intel, 62 pass. The dev server proxies /api to prod, so the page cells read "-" until the next deploy.
545: 3D funder graph (`src/funder-graph.js`, vendored engine in `src/vendor/swarming/`) was already wired; this session found and fixed a real layout bug (500 nodes drifted to radius 1776, off camera) with per-axis gravity, bounded charge range and a percentile-based fit, covered by `tests/funder-graph.test.js`. Browser-verified at 390 (reduced motion, 60fps idle, graph framed), 768 and 1280 with a 500-node harness, zero console errors. 60fps with 500 nodes on a real GPU is unmeasured: this box only has software GL.
Remaining (orders kept): 539 page cells need a post-deploy browser check against live /api (owner deploys); 545 needs the 500-node 60fps check on a real GPU.

## 2026-10-23: order 547 (integrate 48, Robinhood Crypto MCP tools), done

Four read-only tools (`robinhood_chain_stats`, `robinhood_token_prices`, `robinhood_recent_launches`, `robinhood_wallet_holdings`) in `api/_mcp/tools/robinhood.js`, registered in the catalog. Evidence: a live `robinhood_chain_stats` call returned block 96324688 on chain 4663, `tests/mcp-catalog.test.js` plus `tests/api/v1-robinhood.test.js` 28 passed (the launches test was updated for the NOXA removal), `audit:mcp-safety` passes. Docs section added to `docs/mcp.md`.

## 2026-10-25: order 510 (integrate 11, per-coin earnings source), done

Code shipped in 98744d430. Close-out found `20261015090000_agent_coin_earnings_timeline.sql` already `[applied]` in production (`npm run db:status`), the five new columns present on `agent_coin_earnings`, `tests/pump-creator-fees.test.js` plus `tests/agent-earnings-board.test.js` 24/24, and `launch-detail` answering 200 with `creator_fees.distributed` and `reconciliation` keys for a real earning mint (values fill when the snapshot cron next runs). OWNER-ACTIONS row 63 removed. Production still needs the normal deploy to serve the new code.

## 2026-10-25: order 534 closed
Both open checks confirmed: the live LLM path returned a full trading read (assets with exposure and direction, priced_in, horizon, counter) via the platform chain, and the reader's trading-read markup rendered with the counter-argument section (no dev server run, per standing rule). Six news test files pass (94 tests). Order file removed.

## 2026-10-25: order 536 (integrate 37), re-checked, still partial

`tests/x-archive.test.js` and `tests/x-content-outcomes.test.js` pass (75 tests). `npm run x:archive:price` again failed on a GeckoTerminal 429 before writing, so `public/data/trythreews-post-impact.json` (generated 2026-10-23) is unchanged. The three-width browser check was not run: it needs a dev server, which this session was not permitted to start. Remaining: rerun the script when GeckoTerminal recovers, then screenshot the Posts view at 375, 768 and 1280. Order file left in place.

## 2026-10-25: order 530 (registry cleanup), decisions recorded, publish and deprecate still owner-gated

Step 0: registry returns 80 entries under io.github.nirholas, 55 with a local manifest, 26 registry-only (one is listed in both counts via a renamed manifest). Decision table, all 26 re-checked against the registry's repository URLs: deprecate 2 (`claude-code-explorer-mcp`, source repo is the DMCA-notice repository; `data-workbench-mcp`, repository returns 404, source lost, so never republished); leave 24 (each points at a live repository the owner controls, with its own package or remote, so adopting them would copy third-party-project manifests into this repo and trip the other-project commit gate for no gain; the sentinel's `registry_only` finding keeps them visible). `solana-memo-media-mcp` is at 0.1.1 locally and on npm, registry still at 0.1.0. Dry run (`node scripts/publish-mcp-servers.mjs --dry-run`) prints: publish 3d-ar-studio 0.3.2 (npm and registry), publish solana-memo-media-mcp 0.1.1, deprecate both names in the registry and on npm. Remaining, owner (external writes): `node scripts/publish-mcp-servers.mjs` (publishes the two behind entries) and `node scripts/publish-mcp-servers.mjs --deprecate --apply`. Order file left in place.

## 2026-10-25: order 539 (integrate 40), re-checked, still partial

Code was already shipped (`api/_lib/coin/holder-signals.js`, `api/pump/token-stats.js`, oracle features in `api/_lib/oracle/fit.js` and `conviction.js`, Launch tx and Gini cells in `src/launch-detail.js`, changelog entry). `tests/coin-holder-signals.test.js` plus `tests/pump-token-stats.test.js` pass (24 tests). A live `readLaunchVersion` call for the $THREE mint returned `is_v1: true`. Remaining: the `curl` against `/api/pump/token-stats` and the browser check of the Launch detail stats both need a dev server, which this session was not permitted to start. Order file left in place.

## 2026-10-25: order 544 (integrate 45, chains turnover), re-checked, still partial

Code shipped in bb7445ef2 and the changelog entry is in `data/changelog.json`. `tests/defi-chains.test.js` 5/5 pass. Production `/api/defi/chains` already returns `dex_volume_24h` and `turnover` (Ethereum 0.0187). Remaining: the three-width browser check of the Turnover column (375, 768, 1280) needs a dev server, which this session was not permitted to start. Order file left in place.


## 2026-10-23: integrate 47, wallet rescue dry run

- Tip accounts: one module (`packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js`) reads the block engine's `getTipAccounts` with a pinned fallback; `jito.js` and `api/_lib/execution-engine.js` use it. Landed in 22a5a1f49 (swept into another agent's commit).
- Rescue: `scripts/rescue-wallet.mjs` and `packages/avatar-agent-mcp/src/lib/atomic-rescue.js` (dry run default, `--execute` gated). Landed in 22a5a1f49.
- Runbook `docs/ops/wallet-rescue.md`, alarm link in `api/cron/wallets-leak-scan.js`, docs index, STRUCTURE row, changelog entry: see the commit that deletes `prompts/finish/546-integrate-47-wallet-rescue-dry-run.md`.
- Dry run was executed against a local solana-test-validator wallet set (devnet faucet was rate limited), not devnet.

## 2026-10-23: integrate 33, keyless X guest read rung (not closed)

- Built: `api/_lib/x-guest/` (guest-token reader, NOTICE, README), rung 2 in `src/kol/x-profile.js`, `api/_lib/oracle/x-account.js` (coin X account age and followers into `social.xAccount`), `api/_lib/oracle/social-feed.js`, `api/cron/oracle-social-ingest.js` plus its `vercel.json` cron (every 10 min), docs, STRUCTURE row, changelog. The code landed inside other agents' sweep commits (22a5a1f49, 2b7bb3921); the cron-count fix in CLAUDE.md is the commit that touches this entry.
- Verified: vitest on x-guest, kol-leaderboard, oracle sources and sources-assemble, 41 passing (run from an isolated install, see below). Live with the bearer unset: `fetchXProfile` returned followers with source `x-guest`; the cron read a real timeline and exited 200.
- Not verified, so prompts/finish/532 stays: (1) `curl /api/kol/tracker` and (2) the cron writing `oracle_narrative` rows both need the server and a database; this checkout has no `DATABASE_URL` and `node_modules` could not boot `server/index.mjs`. Owner of the remainder: whoever has the DB env, run `node server/index.mjs` with `--env-file`, hit `/api/kol/tracker`, then the cron.
- `npm run build:pages` currently fails on another agent's changelog entry ("See whether our X posts move $THREE") which uses `tag` instead of `tags`.
- Incident: my `npm ci` raced about 35 concurrent npm processes and left the shared `node_modules` incomplete (vitest, lru-cache missing). Run `npm ci` once when no other agent is installing.

## 2026-10-23: integrate 37, $THREE post impact on the chart (not fully closed)

- Built: `api/_lib/x-content/price-impact.js` (no-lookahead pricing, no interpolation, 3600s stale cap), `scripts/x-archive-price-impact.mjs` (`npm run x:archive:price`), `beforeTimestamp` paging in `api/_lib/market/ohlcv.js`, the Posts view in `public/oracle-coin.js` and `.css` ($THREE mint only), the `priceReturn24h` lift in `api/_lib/x-content/outcomes.js` and `runner.js`, tests in `tests/x-archive.test.js` and `tests/x-content-outcomes.test.js`. The code landed in sweep commits 0ad88fb38, 22a5a1f49, 2b7bb3921; docs and changelog are in the commit that touches this entry.
- Measured (live GeckoTerminal, 197 own posts, all priced): median +1h 1.59% (baseline -0.12%), +4h 1.61% (-0.68%), +24h -1.38% (-2.41%).
- Verified: Posts view with 197 bubbles at 390, 768 and 1280 px; 32 price tests passing in an isolated vitest install.
- Not verified: `npm test` and the full `tests/x-content-outcomes.test.js` in this checkout (shared `node_modules` is incomplete, see the integrate 33 entry), so prompts/finish/536 stays. Owner of the remainder: whoever runs `npm ci` once, then `npm test` and `npm run build:pages`.

## 2026-10-23 integrate 36: news failover rung and stale skill guides

- Built: `api/_lib/news-failover.js` (hosted `cryptocurrency.cv/api/v1/news`, 3.5s timeout, one attempt, `cryptocurrency-cv-news` breaker, schema validation, `cv:` source keys, `news:failover` provenance record at tier `fallback`), wired into `getNews` in `api/_lib/news.js` only when the native merge is empty and no named source is requested; six failover cases in `tests/news-lib.test.js`. Guides rewritten against the upstream repos: `x-twitter-automation-guide` (JavaScript, Apache-2.0, real CLI/MCP/client API), `free-crypto-news-guide` (300+ sources, repo now `nirholas/cryptocurrency.cv`), `lstm-price-prediction-guide` (real repo `nirholas/lstm-bitcoin-prediction.ipynb`). `data/skills/seed.json` regenerated.
- Commits: 64caec3e8 (swept the rung, tests and FCN guide), ed75c5946 and 22a5a1f49 (swept the other guides and seed), 141998df4 (literal-host request so `audit:upstreams` attributes it), 8736a7912 (retired the work order).
- Verified: `npx vitest run tests/news-lib.test.js tests/news-sources.test.js` 56 passed; `npm run audit:upstreams` no regressions and lists `cryptocurrency.cv`; `npm run check:skills-pack` and `check:skills-seed` pass.

## 2026-11-04: order 530 (registry cleanup), re-verified, still owner-gated

Fresh `node scripts/publish-mcp-servers.mjs --dry-run` plans the same four writes as on 2026-10-25: publish 3d-ar-studio 0.3.2 (npm and registry), publish solana-memo-media-mcp 0.1.1 to the registry, deprecate claude-code-explorer-mcp and data-workbench-mcp (registry and npm). Every other server reports "already published". A dated Status paragraph now heads the order file. Remaining, owner: `node scripts/publish-mcp-servers.mjs`, then `node scripts/publish-mcp-servers.mjs --deprecate --apply`. Order file left in place.

## 2026-11-04: order 539 (integrate 40, coin intel signals), done

The two lines left open on 2026-10-25 needed a dev server, run here as a no-watch Vite on a free port (its `/api` proxies to production). `curl 'localhost:4811/api/pump/token-stats?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'` returns `holders.gini` 0.4246 (`gini_n` 20), `seeding` and `launch_version`. Headless Chromium on `/launches/<$THREE mint>` at 1280 and 375 shows "Concentration (Gini) 0.42"; a fresh platform launch shows "Launch tx V0". For $THREE, seeding and launch version are unavailable (trade history unreadable; too much history to reach the creation transaction), and the cells showed a bare dash with no reason, so their tooltips now append the server's reason (`src/launch-detail.js`). No console errors from our code; the one 502 on that page is `/api/social/sentiment-pulse`, where pump.fun answers production with 403 (handled: the panel hides). Commit: the one that removes this order file.

## 2026-11-04: order 544 (integrate 45, chains turnover), done

`curl localhost:4811/api/defi/chains` first row: Ethereum, `dex_volume_24h` 1.85e9, `turnover` 0.0404. Browser at 375, 768, 1280: the column is visible and sortable (mouse and keyboard) at 768 and 1280 and hidden at 375 by its `hide-sm` class, as the rank column is; no horizontal scroll at any width. The check found two defects, fixed test-first: Bitcoin rendered `0.000x` (now `<0.001x` via `formatTurnover` in `src/shared/coin-format.js`, pinned in `tests/coin-format.test.js`), and the header's circled-i character rendered as an empty box, now an inline SVG. `tests/defi-chains.test.js` and `tests/coin-format.test.js` 25/25 pass. Commit: the one that removes this order file.

## 2026-11-04: 536 integrate 37 ($THREE post impact) closed

Step 0: script, Posts view, +24h price lift, docs and changelog already shipped; `npm run x:archive:price` had failed on GeckoTerminal 429s, then on its 401 "only the past 180 days" refusal once paging reached history older than the window. Fixed test-first: throttled pages wait and retry (`bc39ce4f0`); paging into the history window ends the series at the pages already read (`b3855505d`); every 15m bar read is archived in `data/x-archive/analysis/trythreews-three-candles.json` and merged on each run, posts older than every available bar keep the returns the previous output measured (`carried` field, same mint and pool only), and excerpts swap the banned dash glyphs for a hyphen (`73ea81776`). Evidence: `tests/x-archive.test.js`, `tests/x-content-outcomes.test.js`, `tests/x-post-impact.test.js` 89 pass. `npm run x:archive:price` read 16,975 real bars, wrote 197 posts with all three horizons measured (+1h median 1.59% vs baseline -0.16%, +4h 1.61% vs -0.75%, +24h -1.38% vs -2.51%), series 2026-04-29 to 2026-11-04, 9 posts carried; a second run read one page from the archive and produced the same counts. Posts view on `/oracle/coin/<THREE>` checked in Chromium at 375, 768 and 1280: 197 post links, medians and baseline shown, no horizontal overflow, impact JSON 200. The page's remaining console 404s are `/api/oracle/coin` and `/api/pump/coin-intel` answering `not_found` (production gives the same answer: $THREE predates both observers), not part of this view.
