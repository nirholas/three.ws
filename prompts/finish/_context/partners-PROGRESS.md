# partners: progress log

Append a dated entry per closed order, with commit SHAs. Newest at the bottom.

**Older entries:** [partners-PROGRESS-archive-1.md](partners-PROGRESS-archive-1.md) (2026-10-09 to 2026-10-13). They were moved there verbatim on 2026-11-10 to keep every file under the 50,000-character limit; search them too when you need history.

## 2026-10-13: order 091 built and verified end to end; Shopify Partner app registration remains, order file stays open

Order 091 asked for a Shopify app that turns a product photo into 3D product media on the
storefront. Built directly against Shopify's documented OAuth/session-token/GraphQL/Billing
contracts (no `@shopify/shopify-api` or `shopify-app-remix`), matching how Discord and Google
are integrated elsewhere in this codebase, and placed the code under `api/shopify/`,
`api/_lib/shopify/`, `src/shopify-app/` and `pages/shopify-app.html` rather than the order's
literal `integrations/shopify/`, matching the Discord Activity's actual shape. Both are one-
line judgment calls, stated in the order file's own Evolve status paragraph.

- **The app (task 1).** OAuth install (`api/shopify/install.js`) and callback
  (`api/shopify/callback.js`) with real query-string HMAC verification
  (`api/_lib/shopify/hmac.js`) and offline-token exchange; the embedded admin UI
  (`pages/shopify-app.html`, `src/shopify-app/app.js`) authenticates every call with an App
  Bridge session token (`api/_lib/shopify/session-token.js`, `api/_lib/shopify/auth-request.js`)
  rather than a cookie, and lists the shop's products with their current 3D-media status
  (`api/shopify/products.js`, `api/_lib/shopify/media.js`'s `listProducts`).
- **The flow (task 2).** Generate (`api/shopify/media/create.js`) starts a Forge job through
  three.ws's own `/api/forge` pipeline (`api/_mcp-studio/forge-client.js`, no new generation
  logic); status polling (`api/shopify/media/status.js`) surfaces real per-item state; attach
  (`api/shopify/media/attach.js`) stages the GLB upload and calls `productCreateMedia` with
  `mediaContentType: MODEL_3D` (`api/_lib/shopify/media.js`'s `stageAndUploadGlb`/
  `attachModel3d`), so Shopify derives the USDZ for iOS AR Quick Look from the one upload.
  Bulk mode in the admin UI runs three jobs at a time with a live per-card status badge.
- **Billing (task 3).** Usage-based subscription through the Billing API, test mode until the
  app has Public distribution (`api/_lib/shopify/billing.js`, `api/shopify/billing/*.js`);
  the admin UI opens Shopify's confirmation page with `window.open(url, '_top')` to escape the
  embedded iframe, the one UI judgment call on this order. Cannot be proven against a real
  development store from this workspace (see below).
- **Compliance (task 4).** The three mandatory privacy webhooks (`customers/data_request`,
  `customers/redact`, `shop/redact`) plus `app/uninstalled`, all HMAC-verified
  (`api/_lib/shopify/webhook-verify.js`) and delivery-deduplicated against a
  `(topic, delivery_id)` ledger so a Shopify retry never double-processes; scopes kept to
  `read_products,write_products`, nothing wider.
- **Submission package (task 5).** `marketing/growth/submissions/shopify-app.md`: exact
  Partner Dashboard settings (App URL, redirect, scopes, embedding), the App Store listing
  copy (name, tagline, description, category, pricing), and the owner order 939 steps.
- **Docs (task 6).** `docs/shopify-app.md` (How it works, Auth flow, Billing, Privacy
  webhooks, Owner setup), `STRUCTURE.md` row, `data/changelog.json` entry dated 2026-10-13,
  `data/pages.json` entries for `/docs/shopify-app` and a non-indexable `/apps/shopify`
  (it only functions inside Shopify's admin iframe).
- **`npm test`**: 44 failed files / 2353 passed (80 failed tests, 35359 passed, 244 skipped).
  None of the five new Shopify test files are in the failing set
  (`npx vitest run tests/shopify-{hmac,session-token,store,graphql,webhooks}.test.js`: 5
  files, 42/42 passing). Spot-checked the one failure closest to this order's own edits
  (`tests/pages-routes.test.js`'s "declares each path exactly once"): the reported duplicates
  are `/docs/grok`, `/docs/grok-bot`, `/grok`, `/tutorials/grok-bot-recipes`, none of them
  Shopify paths, and `grep` confirms `/apps/shopify` and `/docs/shopify-app` each appear
  exactly once in `data/pages.json`. The rest of the failing set is OAuth/MCP-wallet/grok/
  x-content infrastructure this order never touched, consistent with the pre-existing,
  environment-dependent baseline orders 087-090 each independently measured in this same
  shared worktree.
- **`npm run audit:docs`**: 21 findings, the same pre-existing set documented on orders
  089/090; none reference `docs/shopify-app.md`, `/apps/shopify`, or `/docs/shopify-app`.
- **`npm run check:rules`** against every touched path across both commits: `OK: no hard-rule
  violations in the added lines`.

One step is owner-gated (CLAUDE.md gate 2: no agent may contact a third party or create
accounts) and cannot be done inside this session: register a Shopify Partner app, set its
Cloud Run env vars, apply the pending migration, and verify the photo-to-3D flow on a real
development store (storefront screenshot, a completed test-mode Billing charge, and real
webhook test deliveries) before submitting it to the App Store. Logged as row 54 in
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). The order file
stays in place (not deleted) until that registration and live verification land. Commits:
`7b52431a9` (feature, docs, changelog, tests), `b7b55dbf3` (owner-actions row and the order
file's Evolve status paragraph).

## 2026-10-13: order 092 re-verified (VRoid Hub import), stays open on an owner action

Re-ran this session's close-out checklist against the feature landed in `05fdde784`
(OAuth2 connect/callback/status/disconnect with PKCE, the real `CharacterModelLicenseSerializer`
evaluator, the `/import/vroid` picker, and the import pipeline into the existing VRM
load/canonicalize path). Every Definition of done line that does not require the owner's
action was verified fresh, not assumed:

- **Coming-soon state, no error**: `node scripts/read-service-env.mjs '^VROID' --names`
  still returns zero matches on `three-ws-api`; `api/vroid/models.js` checks
  `vroidConfigured()` and answers `200` with the designed coming-soon payload rather than an
  error, and `pages/import-vroid.html` renders "VRoid Hub import is coming soon" for that
  response.
- **License gating unit test**: `npx vitest run tests/vroid-license.test.js`, 9/9 passing;
  the evaluator defaults closed so an action the creator didn't permit is never offered.
- **`npm test`**: 43 failed files / 2355 passed (79 failed tests, 35373 passed, 244 skipped).
  None of the failing files or tests mention vroid; the full failing set is pre-existing
  OAuth/idempotency/ops-mcp infrastructure this order never touched (same category of
  baseline noise logged on orders 089-091 in this shared worktree).
- **`npm run audit:docs`**: 21 findings, the same pre-existing set as orders 089-091; none
  reference `docs/vroid-hub-import.md`, `/import/vroid`, or `/docs/vroid-hub-import`.
- **Docs/page/structure/changelog**: `data/pages.json` carries `/import/vroid` and
  `/docs/vroid-hub-import`; `STRUCTURE.md` has the VRoid Hub import row; `CHANGELOG.md` and
  `data/changelog.json` carry the 2026-10-13 entry; `marketing/growth/submissions/vroid-hub-app.md`
  has the app registration answers for owner order 939.
- **`npm run check:rules`** against the files this re-verification pass touched: `OK: no
  hard-rule violations`.

The remaining step is owner-gated and cannot be done inside this session: register the
VRoid Hub application at `hub.vroid.com/oauth/applications` (confirmed live, pixiv-account
sign-in required), set `VROID_HUB_CLIENT_ID`/`VROID_HUB_CLIENT_SECRET` on Cloud Run with
`--update-env-vars`, run the pending `20261015070000_vroid_hub_source.sql` migration, and
verify a real import on a live VRoid Hub account (idle/walk playing, creator credit
rendered, a disallowed action actually blocked). Logged as row 55 in
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). The order file
stays in place (not deleted) until that registration, env update, migration, and live
verification land. Commits: `05fdde784` (feature, docs, changelog, tests, owner-actions row),
this entry's commit (re-verification log only, no code changes).

## 2026-10-13: order 093 built and verified end to end; npm publish and three registry/issue submissions remain, order file stays open

Order 093 asked for the agent-framework tool packages and registry entries the prospects list
depends on. Step 0 found `packages/ai-sdk/` and `packages/langchain/` already shipped in an
earlier segment of this same session (`e388d1458`), the ten published Agent Skills already
em-dash-clean (`a9925cd4a`), and the skills index already live (`0871315f4`); this session's
work closed the remaining gaps: a Google ADK sample, the Postman collection, and the docs/
STRUCTURE.md wiring those needed.

- **AI SDK and LangChain packages (tasks 1, 2)**: re-verified rather than re-built. Both
  packages' `npm test` (Node's own `node --test`) run live against production: ai-sdk 5/5
  passing (render, agentChat, forge, rig, animate, including a real x402 `PaymentRequired`
  challenge on the paid animate tool); langchain the same 5 tools under their `three_ws_*`
  names, 5/5 passing. `npm pack --dry-run` is clean for both (5 files each, LICENSE +
  README + package.json + src/client.js + src/index.js). `packages/langchain/INTEGRATION_ISSUE.md`
  already carries the LangChain integration-issue text.
- **Google ADK (task 3)**: `examples/google-adk/` (package.json, index.mjs, README.md) connects
  an ADK agent to `https://three.ws/api/mcp-studio` via `MCPToolset`. `node index.mjs --check`
  discovers the live 15-tool catalog and runs a real `rig_mesh` call against production
  (returned a real viewer/GLB/embed/IRL/AR/run-receipt link set), proving the wiring without a
  Gemini credential; a full `LlmAgent` conversation runs when `GOOGLE_API_KEY` or Vertex
  credentials are present (neither exists in this sandbox, so that path is gated, not faked).
  `docs/google-adk.md` follows the `docs/grok.md` template and is linked from `docs/mcp.md`'s
  per-server guides and `data/pages.json` (which regenerated the changelog and page-index
  derived files via `npm run build:pages`).
- **Skills index (task 4)**: `/.well-known/skills/index.json` (20 entries) already shipped in
  `0871315f4`; re-validated this session by loading and counting it.
- **OpenRouter attribution (task 5)**: re-verified rather than re-built. All 19 files under
  `api/` that call `openrouter.ai/api` import the shared `openrouter-attribution` helper, zero
  exceptions.
- **Postman collection (task 6)**: new. `scripts/build-postman-collection.mjs` converts
  `public/.well-known/openapi.yaml` through `openapi-to-postmanv2` and checks in
  `public/.well-known/postman-collection.json`. The converter injects random ids and fabricated
  example values on every run regardless of `schemaFaker`; a `clean()` pass strips the ids,
  drops the fabricated response examples (no fake data, per CLAUDE.md), and canonicalizes
  free-form request-body placeholders. Verified deterministic across three independent
  regenerations (byte-identical) and loads cleanly through the official `postman-collection`
  SDK (`new Collection(data)`, 3 top-level items). Converting the spec surfaced nine
  pre-existing em-dashes in `public/.well-known/openapi.yaml` itself (a hard-rule violation
  this change now touches); fixed in the same commit. `build:postman-collection` /
  `check:postman-collection` are wired into `npm run gate`.
- **Registry entries (task 7)**: the six files for Hermes, Kilo, OpenHands, OpenCode, Dify and
  cursor.directory already existed in `marketing/growth/submissions/agent-registries/` from an
  earlier segment of this session; confirmed present, one per registry.
- **`npm pack --dry-run` (task 8)**: clean for both packages (re-verified above).
- **Docs (task 9)**: `docs/google-adk.md` (new), `docs/mcp.md` and `docs/api-reference.md`
  updated, `STRUCTURE.md` rows for the Google ADK example, the Postman collection, and (a gap
  from the earlier `e388d1458` commit) the `@three-ws/ai-sdk`/`@three-ws/langchain` npm
  workspace entries, `data/pages.json` entry for `/docs/google-adk`, changelog regenerated via
  `npm run build:pages`.
- **`npm test`**: 44 failed files / 2354 passed (80 failed tests, 35372 passed, 244 skipped),
  the same pre-existing, environment-dependent baseline (OAuth, MCP wallet, idempotency-key,
  ops-mcp-clients) orders 089-092 each independently measured in this shared worktree; none of
  the failing files reference ai-sdk, langchain, google-adk, or the Postman collection.
- **`npm run audit:docs`**: 21 findings, the same pre-existing baseline; none reference the new
  doc page, example, or collection.
- **`npm run check:rules`** against every touched path across both commits: `OK: no hard-rule
  violations in the added lines`.

Two steps are owner-gated (CLAUDE.md gate 2: publish, and contact a third party) and cannot be
done inside this session: `npm publish --access public` for `@three-ws/ai-sdk` and
`@three-ws/langchain`, opening the LangChain integration issue
(`packages/langchain/INTEGRATION_ISSUE.md`), and submitting the six registry entries per each
file's own "Owner steps" section. Logged as row 56 in
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). The order file
stays in place (not deleted) until those publishes and submissions land. Commits: `746c27934`
(Google ADK example and docs), `5b7ebbf19` (Postman collection, openapi.yaml em-dash fix),
this entry's commit (owner-actions row and the order file's Evolve status paragraph).

## 2026-10-13: order 094 built and verified end to end; WordPress.org/Framer/Webflow account signups remain, order file stays open

Order 094 asked for WordPress, Framer and Webflow embeds of `<agent-3d>`. Step 0 found the
WordPress plugin, the shared release-pin build step, and the pin-drift check already shipped in
an earlier segment of this session (`a80ce225d`); this session's work built the Framer and
Webflow embeds, wired all three to the same pin, and closed out the documentation task.

- **WordPress (task 1)**: already done (`a80ce225d`). Re-verified by re-running
  `scripts/wordpress-plugin-check.sh` against a fresh Docker WordPress 7.1.3: "Checks complete.
  No errors found."
- **Framer (task 2)**: new. `integrations/framer/`: `Agent3DView.tsx` (no `"framer"` import, so
  it can be typechecked and rendered outside Framer's canvas) wrapped by `Agent3D.tsx`'s
  `addPropertyControls()` over On-chain URI, Agent ID, Chain ID, Model URL, Background, Framing,
  Poster and Autoplay. No Framer account exists in this sandbox, so verification runs through a
  real-React Playwright harness instead: the package's own `vite.config.mjs` (the repo root's
  config sets a non-React JSX factory for static-site generation) serves `harness/index.html`,
  and `tests/e2e/agent-3d-framer-component.spec.js` asserts a real WebGL canvas renders inside
  `<agent-3d>`'s shadow DOM against the actual pinned production CDN release and a real avatar
  GLB (1 passed, 4.4s), no mocks.
- **Webflow (task 3)**: new. `integrations/webflow/`: the same split pattern, independently
  copied (`Agent3DView.tsx` wrapped by `Agent3D.webflow.tsx`'s `declareComponent()`/
  `@webflow/data-types` props). Verified two real ways: the real, unmodified
  `@webflow/webflow-cli`'s `devlink bundle --no-input` ("Code Library bundled successfully!")
  and the same real-React Playwright harness pattern
  (`tests/e2e/agent-3d-webflow-component.spec.js`, 1 passed, 4.3s).
- **One release pin (task 4)**: all three packages' `pinned-release.{php,ts}` are generated by
  the existing `scripts/build-site-builder-embeds.mjs` from `data/agent-3d-releases.json`;
  `npm run check:site-builder-embeds` confirms all three match `agent-3d 1.5.2`.
- **Docs (task 5)**: `docs/wordpress-embed.md` (new, with the real Plugin Check output),
  `docs/embedding.md`'s Webflow and Framer subsections rewritten to describe the real
  components (replacing outdated generic iframe/custom-code advice) plus a new WordPress
  subsection, a `STRUCTURE.md` row, `data/pages.json` entry for `/docs/wordpress-embed`, a
  `data/changelog.json` entry (regenerated via `npm run build:pages`), READMEs in both new
  package directories, and `marketing/growth/submissions/site-builders.md` for owner order 938
  (WordPress.org, Framer Marketplace, Webflow Apps, with listing copy for each).
- **`npm test`**: 44 failed files / 2354 passed (80 failed tests, 35372 passed, 244 skipped),
  the same pre-existing, environment-dependent baseline orders 089-093 each independently
  measured in this shared worktree; none of the failing files reference framer, webflow,
  wordpress, or any file this order touched (confirmed via `git log -1` on the three failing
  test files, last touched by an unrelated merge commit).
- **`npm run audit:docs`**: 21 findings, the same pre-existing baseline; the 9 findings this
  session's own `marketing/growth/submissions/site-builders.md` first introduced (wrong relative
  link depth) were fixed before this measurement, so the count is unchanged from the baseline.
- **`npm run check:rules`** against every touched path across all three commits: `OK: no
  hard-rule violations in the added lines`.

Three steps are owner-gated (CLAUDE.md gate 2: a third-party account only the owner can create,
for each platform) and cannot be done inside this session: creating a WordPress.org account and
submitting the plugin for review; creating a Framer account and submitting the Marketplace
listing; creating a Webflow account, running `webflow devlink import`, and submitting the Apps
marketplace listing. Logged as row 57 in
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). The order file
stays in place (not deleted) until those account signups and submissions land. Commits:
`9c36dd51f` (Framer code component), `a722c6017` (Webflow Code Component), `bc5369b04` (docs,
STRUCTURE.md, changelog, pages index, submission text), this entry's commit (owner-actions row
and the order file's Evolve status paragraph).

## 2026-10-13: order 095 built and verified end to end; standalone-repo creation and two pull requests remain, order file stays open

Order 095 asked for the Home Assistant integration to be made ready for the HACS default store.
Step 0 found a working integration with wrong manifest metadata (a 404ing documentation link, a
too-low `hacs.json` minimum HA version) and no brand icon, and no standalone repository yet.

- **Local validation (task 1)**: ran the real `ghcr.io/home-assistant/hassfest` Docker image
  against a built export tree: `Integrations: 1, Invalid integrations: 0`. HACS's own
  `hacs/action` is architecturally incapable of validating a repository that does not exist yet
  (confirmed by reading `hacs.async_register_repository` in its real source), so its individual
  local-file validators (`hacsjson.py`, `integration_manifest.py`, `brands.py`, `information.py`,
  with the real `voluptuous` schema objects pulled from `hacs/integration`) were run directly
  against the exported tree instead: all pass. The GitHub-settings-dependent checks
  (`description`, `topics`, `issues`, `archived`, `license`) stay deferred to that repository's
  own future CI.
- **Manifest and metadata (task 2)**: `manifest.json`'s `documentation` fixed from a 404 to the
  live `/docs/home-relay`, `version` bumped to `1.0.1`. `hacs.json`'s `homeassistant` corrected
  from `2024.6.0` to `2024.12.0`: `relay_client.py` uses `aiohttp.ClientWSTimeout`, absent before
  aiohttp 3.11, first bundled in HA 2024.12.0 (verified against HA's real
  `package_constraints.txt` across releases 2024.6.0 through 2025.1.0). `codeowners` and
  `issue_tracker` were already correct. No config-flow translations needed beyond what already
  ships; the flow's existing `strings.json`/`translations/en.json` cover every field.
- **Brand icon (task 3)**: real 256x256/512x512 PNGs (light and dark) rendered via `sharp` from
  the existing `public/pwa-icon.svg` cube mark, shipped at
  `custom_components/three_ws/brand/{icon,icon@2x,dark_icon,dark_icon@2x}.png` (HA 2026.3.0's
  local brand images feature, which also satisfies HACS's own `brands.py` check). The
  `home-assistant/brands` PR text (for the same four files, copied unchanged) is in the
  submission doc.
- **Standalone-repo export (task 4)**: new `scripts/export-hacs-repo.mjs` builds the integration,
  README, `info.md`, LICENSE, `hacs.json`, and `.github/workflows/{hassfest,hacs}.yml` into
  `dist/hacs-export/`. This monorepo runs no GitHub Actions of its own, so those two workflow
  files exist only inside the exported tree.
- **Submission text (task 5)**: `marketing/growth/submissions/home-assistant.md`, for owner order
  938: the `hacs/default` PR (exact alphabetical insertion point in the `integration` file,
  between `nimroddolev/chime_tts` and `nishithdev/wled-taskmap`) and the `home-assistant/brands`
  PR, both with title/description text, plus the full verification packet.
- **Docs (task 6)**: `home-assistant-integration/README.md` gained the minimum-HA-version line
  and a fix to a real pre-existing inaccuracy found during end-to-end testing (the connectivity
  sensor's entity ID is device-name-prefixed, not the fixed name the README claimed).
  `docs/home-relay.md` now notes the integration is ready for the HACS default store once the
  standalone repository is live. `data/changelog.json` entry added, `npm run build:pages` run.
- **Real end-to-end install (Definition of Done line 2)**: no cloud-backed Neon database or
  published standalone repository exists in this workspace, so this ran a real
  `ghcr.io/home-assistant/home-assistant:stable` container (HA 2026.9.4), onboarded via its own
  REST API, paired through the integration's real `config_flow.py` against a real
  `services/home-relay` server (`createRelay`) and a real `mintInstallToken`-signed install
  token, justified by the integration's own documented self-hosted `platform_url` option. Result:
  `{"type": "create_entry", "result": {"state": "loaded"}}`, the integration dialled in on its
  own, opened a session, and answered a real `get_states` call with 18 real entities. After the
  relay was restarted, the integration's own backoff reconnected it without intervention, and
  `binary_sensor.evolve_test_home_three_ws_connection` read `state: "on"` with no `last_error`.
- **`npm test`**: 43 failed files / 2355 passed (79 failed tests, 35373 passed, 244 skipped),
  one file and one test better than the documented pre-existing baseline (44/2354, 80/35372);
  none of the failures reference home-assistant, hacs, or export-hacs-repo.
- **`npm run audit:docs`**: 21 findings, unchanged from the documented baseline.
- **`npm run check:rules`** against every touched path across all commits: `OK: no hard-rule
  violations in the added lines`.

Two steps are owner-gated (CLAUDE.md gate 2: a step needing a new third-party repository and
pull requests from a personal GitHub account) and cannot be done inside this session: creating
`github.com/nirholas/three-ws-home-assistant` from the exported tree, cutting its `v1.0.1`
release, and opening the `hacs/default` and `home-assistant/brands` pull requests. Logged as row
58 in [_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). The order
file stays in place (not deleted) until that repository and both pull requests land. Commits:
`90590dee5` (manifest/hacs.json fixes, brand icons, README/docs fixes, changelog),
`0c6ac3614` (export script, submission packet), this entry's commit (owner-actions row and the
order file's Evolve status paragraph).

## 2026-11-03: order 091 re-checked (Shopify product media), still open on the owner action

Re-measured the owner-gated step rather than assuming it: `node scripts/read-service-env.mjs
'^SHOPIFY' --names` still reports no matching variable on `three-ws-api`, so no Shopify Partner
app is registered and the live Definition of done lines (storefront screenshot, test-mode
Billing charge, real webhook test deliveries) remain unverifiable. The code side is intact:
`npx vitest run tests/shopify-*.test.js` passes 5 files, 43/43. No code changed. Row 54 in
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md) is still the
remaining step; the order file stays in place.

## 2026-11-03: order 092 re-checked (VRoid Hub import), still open on the owner action

Re-measured rather than assumed: `node scripts/read-service-env.mjs '^VROID' --names` reports
no matching variable on `three-ws-api`, so no VRoid Hub application credentials exist yet. The
migration `20261015070000_vroid_hub_source.sql` is already `[applied]` in production
(`npm run db:status` against the Cloud Run `DATABASE_URL` secret), so it drops off the owner's
list. Live probes: `hub.vroid.com/oauth/authorize` answers a documented `invalid_request`;
production `/import/vroid` answers 200 and `/api/vroid/models` and `/api/auth/vroid/connect`
answer the designed 501 `not_configured`. `npx vitest run tests/vroid-*.test.js` passes 5
files, 53/53. No code changed. Row 55 in
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md) and
`marketing/growth/submissions/vroid-hub-app.md` now list only the app registration, the two
env vars and the live verification; the order file stays in place.

## 2026-11-03: order 095-partners-12 (Home Assistant HACS) re-check

- **Step 0**: `gh repo view nirholas/three-ws-home-assistant` still returns "Could not resolve to a
  Repository", so the standalone repository has not been created. `hacs.json` (min HA `2024.12.0`)
  and `manifest.json` (`1.0.1`) are unchanged, and so are the four local brand PNGs.
- **Re-verified**: `node scripts/export-hacs-repo.mjs` rebuilt `dist/hacs-export/`. The current
  `ghcr.io/home-assistant/hassfest:latest` image (digest `sha256:d4a30239f4af...`) run against it:
  `Integrations: 1, Invalid integrations: 0`.
- **Drift fixed in the submission packet**: (1) the `hacs/default` `integration` file has grown to
  4,563 entries, so the insertion point is now between `NirBY/ha-mashov` and `Nischay-Pro/ha-zebra`
  (checked by inserting the entry and confirming the list still equals its case-insensitive sort,
  which is what the PR's `lint sorted` check enforces). (2) The `home-assistant/brands` README now
  labels `custom_integrations/` legacy and says custom integrations "ship their images in a `brand`
  folder of their own nowadays, instead of adding them to this repository". The HACS brands check
  reads the local `brand/icon.png` first, so the brands PR has been removed from the owner steps.
  Owner-actions row 58 now covers one repository, one release and one PR.
- **Remaining (owner, order 938)**: create the repository from `dist/hacs-export/`, set its
  description, topics and issues, confirm both workflows pass, cut `v1.0.1`, then open the
  `hacs/default` PR. The order file stays open until that lands.

## 2026-11-03: order 088 re-checked; only the Discord app registration and live verification remain

- `node scripts/read-service-env.mjs '^DISCORD' --names`: `FAILED: no variable on three-ws-api matches /^DISCORD/`. No Discord application is registered yet.
- `npm view @discord/embedded-app-sdk version`: `2.5.0`, which still satisfies the `^2.5.0` pin in `package.json`. Nothing to upgrade.
- `npx vitest run tests/discord-activity-store.test.js tests/discord-activity-auth.test.js`: 2 files, 14 tests passed.
- Live `POST https://discord.com/api/oauth2/token` with a placeholder client: `{"error": "invalid_client"}` HTTP 400, the documented error path the token endpoint already surfaces.
- Production migration dry run (`node scripts/apply-migrations.mjs`, no `--apply`): `20261015050000_discord_activity_rooms.sql` is `[applied]`, so step (d) of owner-actions row 52 is done and has been struck from that row.

Remaining, owner-owned: register the Discord application, set `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/`DISCORD_PUBLIC_KEY` with `--update-env-vars`, verify with two accounts in a test server, and submit the Discovery listing (row 52). The order file stays in place.

## 2026-11-03: order 085-partners-02 re-check (upstream drift fixed, upload still owed)

- **Step 0**: `GET https://three.ws/api/animations/library?facets=1` still answers `total: 0`, so
  owner-action row 50 has not been run. Licenses re-read today: Mesh2Motion `LICENSE-CC0.MD` ("All
  3d models, blend files, rigs, animations ... CC0 1.0 Universal") and the UAL2 [Standard] zip's
  `License.txt` ("CC0 1.0 Universal (CC0 1.0) Public Domain Dedication"), both unchanged.
- **Drift found**: the gitignored staging dir had been cleared, and rebuilding it failed twice.
  (1) Mesh2Motion merged a data restructure on 2026-10-31 (`ec0669b9a`) that split the three
  bundled human GLBs into per-clip files, so the branch URLs returned 404. (2) The zip extractor
  substring-matched `UAL2_Standard.glb` against absolute paths whose extract dir carries that same
  name, so it copied the animation-less `Female Mannequin/Mannequin_F.glb` and 42 Quaternius clips
  failed with "no clip in source".
- **Fixed in `1af29c7c4`** (test-first, `tests/cc0-animation-library-sources.test.js`, 4/4): pack and
  license URLs pinned to `faed1501297a341bc1461487be612ad27ebc1775` (the restructure's first
  parent, so the clip names in `scripts/cc0-library.config.json` stay valid; only `license_url`
  changed in the config), and `scripts/lib/zip-member.mjs` matches on the archive-relative path.
- **Re-verified**: full rebuild 219/219 clips, 0 failures; staged manifest 87 + 74 + 16 Mesh2Motion
  and 42 Quaternius, all `CC0 1.0 Universal`, 0 entries missing `source`/`license`, 0 mentioning
  Mixamo. Endpoint, animation and retarget suites 134/134.
- **Remaining (owner, row 50)**: `node scripts/cc0-animation-library.mjs` with production R2
  credentials (the full pipeline, since `--upload` alone needs the staging dir). The Adobe letter
  stays owner order 938. The order file stays open.

## 2026-11-03: order 094 (partners 11, site-builder embeds) re-check

- `npm run check:site-builder-embeds`: `3 pinned-release file(s) match agent-3d 1.5.2`.
- `scripts/wordpress-plugin-check.sh` (WordPress 7.1.4, Plugin Check 2.1.0): `Success: Checks complete. No errors found.`
- Found a doc/script gap: `docs/wordpress-embed.md` claimed the script also verified that the block and shortcode render on a live page, but it never did. The script now publishes a block page and a shortcode page and fails unless both serve a real `<agent-3d>` with the pinned loader (`https://three.ws/agent-3d/1.5.2/agent-3d.js`, its ledger SRI hash). Both passed. With `WP_KEEP=1`, real Chromium opened both pages: `agent-3d` defined, a live 645x480 WebGL canvas, no console errors. A concurrent sweep committed the script change in `9c6dcdb78`; the doc refresh lands in this entry's commit.
- `npx playwright test tests/e2e/agent-3d-framer-component.spec.js tests/e2e/agent-3d-webflow-component.spec.js`: 2 passed.
- `npm run audit:docs`: clean. The full `npm test` run was stopped by a 25-minute session timeout. Its partial failures are in unrelated wallet, MCP and deploy suites, and the tests that reference the plugin pass (25/25).
- Remaining: owner row 57 (WordPress.org, Framer and Webflow account signups and submissions). The order file stays open.

## 2026-11-03: order 093 (partners 10, agent tool packages) re-check

- **Step 0**: `@three-ws/ai-sdk` and `@three-ws/langchain` still 404 on npm (never published). Peer ranges still cover current upstream (`ai` 7.0.162, `@langchain/core` 1.3.4). LangChain's `CONTRIBUTING.md` today: "We no longer accept new integrations to this repository", publish a standalone npm package, then "Let us know by opening an issue or discussion". `packages/langchain/INTEGRATION_ISSUE.md` already follows that order. It also asks for a separate repository; ours links the monorepo subdirectory, which the owner can accept or split before filing.
- **Live re-verification**: `packages/ai-sdk` `npm test` 5/5 and `packages/langchain` 5/5 against production; `npm pack --dry-run` clean for both (9.4 kB and 9.6 kB, 5 files each). `examples/google-adk` `node index.mjs --check` returned a real GLB (`https://three.ws/cdn/forge/anon/e22c6a30-0c93-4dcd-b00b-293e97218acb.glb`, run receipt `rr_R6t4ru3V1Pg2GfJ6xkUK5L`). `check:postman-collection` up to date; the skills index lists 20 skills. `npm run audit:docs` clean.
- **Drift found and fixed in `2b46da6b0`** (test-first, `tests/openrouter-attribution.test.js`): seven OpenRouter call sites did not send the canonical attribution from `api/_lib/openrouter-attribution.js`. The agent-sniper judge and risk officer sent a title with no `HTTP-Referer`, the OKX bot's OpenRouter gateway lane sent nothing (now passed to the spawned CLI through `ANTHROPIC_CUSTOM_HEADERS`, OpenRouter only), and the assistant widget, chat app, i18n and vision-probe scripts sent nothing or a drifted title. The new test scans `api`, `workers`, `src`, `chat/src` and `scripts` so a new call site cannot ship unattributed. `apps/hq` and `robinhood/hood-traders` keep their own app identities on purpose.
- **Remaining (owner, row 56)**: the two npm publishes, the LangChain listing issue, and the six registry submissions. The order file stays open.

## 2026-11-03: order 087 re-verified; one client defect found and fixed, owner steps still remain

- **Packages**: `ruff check .` and `ruff format --check .` pass for both `livekit-plugins-threews` (8 files) and `pipecat-threews` (9 files); `pytest tests` 2/2 and 4/4; `pdoc` builds both modules (exit 0). Run in a fresh venv with `livekit-agents` and `pipecat-ai[livekit]` 1.15.0 current from PyPI.
- **E2E**: both specs pass against a local `livekit/livekit-server` 1.13.11 started with `--keys "devkey: devsecret"` (the plain `--dev` default secret is `secret`, which the specs reject with a 401; the documented command in `docs/voice-framework-integrations.md` is correct) and an `espeak-ng` 1.51 extracted from the Ubuntu package. The LiveKit spec needed its one retry each run because the box was at load average 300 to 700 from concurrent agents; the Pipecat spec passed first try.
- **Defect fixed in `2a9e358c5`** (test-first, `tests/livekit-voice.test.js`, 3 tests failing before and passing after): `LiveKitVoice.connect()` let a `NotFoundError`/`NotAllowedError` from `setMicrophoneEnabled()` reject after the room was already joined, so every visitor without a microphone, or who declined the prompt, got "LiveKit connect failed" while the avatar was in fact lip-syncing. It now joins in listen-only mode and exposes `micEnabled`/`micError`. LiveKit E2E rerun after the fix: passes, with no connect-failed warning.
- **Remaining (owner, row 51)**: PyPI publishes of both packages, the `livekit/agents` plugin PR plus the LiveKit Startups application, and the `pipecat-ai/pipecat` docs PR. The order file stays open.

## 2026-11-04: order 091 closed by the owner (Shopify product media)

The owner directed the order file be deleted. Everything buildable in code shipped in
`7b52431a9`; the live store checks (storefront screenshot, test-mode Billing charge, webhook
test deliveries) still need a registered Shopify Partner app. Those steps are tracked in row 54
of [_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md), which now
holds the only copy of the remaining work. `plan-COVERAGE.md` rows that pointed at the order
file now point at that row.

## 2026-11-04: order 094 closed

Owner instruction: delete the order now that the agent-side work is done. Commits: `a80ce225d` (WordPress plugin), `a722c6017` (Webflow component), `860ee4b73` (React 18/19 support), `9c6dcdb78` (live render check in the plugin-check script), `cc731d38d` (re-check docs). The only steps left are owner action row 57 in [production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md): the WordPress.org, Framer and Webflow signups and submissions, with step-by-step instructions in `marketing/growth/submissions/site-builders.md`.

## 2026-11-04: order 092 closed (VRoid Hub import)

Order file deleted at the owner's instruction. Everything buildable is shipped
(`05fdde784`, `6bb7c0d6a`, `b6330e2ff`; migration applied in production, re-measure `65b5ed019`).
The remaining owner steps (register the hub.vroid.com application, set
`VROID_HUB_CLIENT_ID`/`VROID_HUB_CLIENT_SECRET` with `--update-env-vars`, live verification)
are tracked only in row 55 of [_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md)
and Step 4 of `marketing/growth/submissions/vroid-hub-app.md`.

## 2026-11-04: order 093 closed

- Owner directed the order file deleted. Every agent-buildable line was verified on 2026-11-03 (entry above, fixes in `2b46da6b0`). The three remaining owner steps (npm publish of both packages, the LangChain listing issue, the six registry submissions) are owned by order 938 and owner-actions row 56, whose links now point at order 938.

## 2026-11-04: order 088 closed by the owner (Discord Activity)

The owner directed the order file be deleted. Everything buildable in code shipped (see the
2026-10-13 entry above; re-checked 2026-11-03 in `80b1656e3`: 14/14 tests, live `invalid_client`
from Discord's token endpoint, the `discord_activity_rooms` migration applied in production).
The Discord application registration, `DISCORD_*` env vars, the two-account check in a real
Discord client, and the Discovery submission are tracked in row 52 of
[_context/production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md), which now holds
the only copy of the remaining work. `plan-COVERAGE.md` now points at that row.

## 2026-11-04: order 095-partners-12 (Home Assistant HACS) closed

Closed and deleted at the owner's instruction. All agent work was verified in the 2026-10-13 and
2026-11-03 entries above. What remains is owner-only (order 938, owner-actions row 58): create
`nirholas/three-ws-home-assistant` from `node scripts/export-hacs-repo.mjs`, cut `v1.0.1`, and open
the `hacs/default` PR using the text in `marketing/growth/submissions/home-assistant.md`. Links to the
deleted order now point at row 58 and order 938, and RUN-ORDER's partners row lists only the
orders still on disk.

## 2026-11-04: order 085-partners-02 retired (CC0 library live in production)

- **Upload (owner-action row 50)**: run on the owner's instruction "complete everything" with the
  production S3 credentials read from the `three-ws-api` Cloud Run service via
  `node scripts/read-service-env.mjs`. `node scripts/cc0-animation-library.mjs` rebuilt 219/219
  clips and uploaded them to `animations/library/manifest.json` in bucket `chatty-storage`.
- **Public endpoint**: `GET https://three.ws/api/animations/library?limit=500` answers `total: 219`,
  219 clips, every one `CC0 1.0 Universal` with `source` and `license`, 0 mentioning Mixamo;
  `?facets=1` reports real per-category counts (idle 16, locomotion 39, weapons 40, ...).
- **Mirror path**: `node scripts/mirror-animation-library.mjs --no-thumbs` mirrored 219 clips; the
  mirrored manifest is all CC0 and no mirrored file mentions Mixamo.
- **Product surfaces**: `/animations` in headless Chromium fetches the library (200) and renders the
  per-clip credit (a search for "angry" shows the `m2m-addon-angry` card credited "Mesh2Motion
  human-addon-animations"), no console errors. The embed viewer (`?animation=`) and the pose studio
  (`/pose?anim=`) resolve non-curated names through `GET /api/animations/library?name=`; that exact
  request returns the CC0 def for `m2m-addon-angry` and its clip JSON loads (200, 156 tracks).
  Driving those two pages to playback in this sandbox's software WebGL stalled on the avatar load
  before the lookup, so the playback step was proven at the request level, not on screen. No product
  source deep-links an `mx-*` name; the curated in-product clips keep their Mixamo credit under the
  2026-10-13 decision (in-product playback, not redistributed as a raw library).
- **Remaining**: sending the Adobe letter
  (`marketing/growth/submissions/adobe-mixamo-permission.md`) stays owner order 938; it no longer
  blocks anything. The order file is deleted in this commit.

## 2026-11-04: Home Assistant HACS, external steps run at the owner's "complete everything"

- Created public `github.com/nirholas/three-ws-home-assistant` from the export (description,
  homepage, Issues, six topics, Apache-2.0 detected), released `v1.0.1`, then `v1.0.2` after adding
  manifest `categories: ["ai_voice.voice_assistants"]` to clear the HACS validator's only warning.
- The real `ghcr.io/hacs/action:main` container against the live repository: `All (10) checks
  passed`, no warnings. Hassfest on the 1.0.2 export: `Invalid integrations: 0`.
- Forked `hacs/default` to `nirholas/default` and pushed branch `add-three-ws-home-assistant` with
  the one-line, sort-verified entry.
- The PR is held: the repository's own Hassfest and HACS workflow runs were refused with "The job
  was not started because your account is locked due to a billing issue", and the `hacs/default`
  template requires links to green runs. New `scripts/hacs-default-submit.mjs` reports that blocker,
  re-runs the workflows (`--rerun`), and opens the PR with real links (`--open`) once they pass.
  The export now skips `__pycache__` (test-first, `tests/export-hacs-repo.test.js`).
- Remaining (owner): clear the billing lock in the browser, then the two commands. Row 58.

## 2026-11-14: Sketchfab AI-tag backfill (order 940), nothing to backfill

- **Already built** in `309a22c28`: `scripts/sketchfab-retag.mjs` (dry run by default, `--apply`
  sends a tags-only `PATCH /v3/models/{uid}` with the existing tags plus `createdwithai`, honours
  `429 Retry-After`), `tests/sketchfab-retag.test.js` (5/5 pass) and the backfill note in
  `docs/sketchfab.md`.
- **Measured**: the `sketchfab_uploads` ledger in production has 0 rows (the cron claims a row
  before any network call, so every upload attempt would leave one). None of the 535 `three-ws-api`
  revisions from 2026-07-07 to 2026-11-13 has carried `SKETCHFAB_API_TOKEN`. The showcase has never
  uploaded, so there is no pre-2026-10-09 catalog, and every future upload carries the tag from
  `919e54e82`.
- **Live dry run**: `node scripts/sketchfab-retag.mjs --user threews` printed
  `0 models listed, 0 already tagged, 0 to change.` The same run against an unrelated public
  account listed 16 models over pagination and planned 16 tags-only patches, which proves the
  listing and plan against the real API. `GET /v3/me/models` without a token answers 401, and
  `--apply` without a token exits 2 before touching anything.
- Fixed the stale prospects finding (row on the `createdwithai` tag). The order file is deleted in
  this commit. Owner action only if the official account was ever populated by hand outside the
  cron: set the token and run `node scripts/sketchfab-retag.mjs`.

## 2026-11-14: order 936 (Tripo reply and house key) second pass; owner steps remain

- **Step 0**: the reply has not been sent; no `TRIPO*` variable on `three-ws-api`; order 084 is
  closed. `npm run forge:tripo`: 0 paid-lane jobs in the last 30 days (3 all time, last
  2026-10-05). TripoSG: 490 finished, 95 failed in the last 30 days; 263 jobs in October and 500
  in November through the 14th, none of them seeder rows.
- **New since 2026-10-23**: TripoSplat runs self-hosted in production (2026-11-03), so Tripo now
  has four surfaces in three.ws. Tripo launched Agentic Canvas (2026-11-02) and is at Formnext
  2026-11-17 to 20. Both Tripo API hosts (`.com`, which the provider uses, and the documented `.ai`)
  answer the same v3 401 envelope, so nothing in the provider needs to move. Tripo suites: 8 files, 68
  tests, all passing.
- **Changed**: the Tripo brief gets a 2026-11-14 refresh section, October platform numbers, a
  corrected TripoSplat row and splat note, and a rewritten reply (apology for the five-week delay,
  v3 and webhooks described as shipped, September plus October totals: 20,158 maker requests, 25,446
  MCP tool calls). The launch-post facts table and copy are updated to match. Tracker row 100
  `next_action`, owner and target date are refreshed.
- **Remaining (owner)**: send the reply, hold the call, approve and set `TRIPO_API_KEY`. After the
  key lands, an agent runs the production house-lane job, the daily `npm run forge:tripo` pilot
  report and the launch post. The order file stays until then.
