# Production site health audit: 2026-09-15

This record captures the production audit requested on 2026-09-15, the fixes
shipped from it, and the work that still depends on an external provider or an
account balance. It deliberately contains no credentials, private keys, access
tokens, wallet secrets, or complete private endpoint values.

## Scope and method

- Ran the Cloud Run deep triage sweep over the production fleet, including
  health, revision, TLS, public pages, logs, scheduled jobs, migrations, wallet
  readiness, Forge, LLM providers, object storage, and x402 settlement.
- Drove Chromium against all 908 selected public and dynamically discovered
  HTML routes in both desktop and mobile viewports. The audit records browser
  exceptions, console errors, failed requests, HTTP failures, layout overflow,
  accessibility basics, and dead controls.
- Rechecked every initially failing route/viewport pair in isolation. This is
  necessary because a full two-viewport WebGL crawl can exhaust a shared
  renderer and turn healthy pages into false navigation or network failures.
- Performed focused live checks against the affected API endpoints and asset
  URLs. Authenticated-only flows were not considered cleared by the anonymous
  browser pass.

The initial browser report is retained outside Git under
`reports/page-audit-2026-09-15T07-23-53-110Z.{json,md}`. Reports are ignored by
design because they contain volatile production data and screenshots.

## Findings and resolution

| Area | Evidence | Resolution |
| --- | --- | --- |
| Cloud Run fleet | Health endpoint, TLS, public pages, revision readiness, schedulers, and migrations were healthy. | No fleet or schema change required. |
| R2 object storage | Production used the correct account endpoint and bucket, but authenticated storage calls rejected the deployed key pair. Several historical showcase thumbnails also resolve to missing objects. | Added the new secret as a Secret Manager version and updated only the access-key environment variable with `--update-env-vars`. Future writes use the repaired credentials. Showcase images now pass through `/api/img`, which provides gateway retry and a valid deterministic fallback for missing historical objects. |
| Auto-rig demo | `/demos/agents/auto-rig.html` threw before boot because its bare `three` imports had no import map. | Added a pinned Three.js import map for core and addons. |
| Deploy preview | The bundled avatar is Meshopt-compressed; model-viewer 4.0 could parse it before attaching its decoder and emitted a hard exception. | Upgraded the hosted model-viewer runtime to 4.3.1, whose loader waits for the bundled Meshopt decoder. |
| Voice state gallery | The browser audit treated the gallery's intentionally rendered ERROR example as a live failure banner. | Added a narrowly scoped `data-audit-intentional-error` annotation and taught the auditor to ignore only annotated example content. |
| Solana price pages | `$THREE` curve calls returned 502 during the loaded sweep. Both affected pages passed an isolated rerun. | Classified as transient RPC-lane exhaustion, not a deterministic frontend failure. Provider reliability remains monitored by deep triage. |
| Agent and metadata deep links | Seeded dynamic links included deleted/missing agent records and an unavailable Arweave metadata document. | Retained as upstream/data-lifecycle findings; the route shells render their designed not-found/degraded states. No replacement data was invented. |
| Agent Galaxy | `/api/galaxy` returned `watsonx_unavailable`. | Requires valid watsonx credentials to construct real embeddings. The API correctly refuses to fabricate a galaxy. |
| Coin Clash | `/api/clash/state` returned `cc_unconfigured`. | Requires a CoinCommunities read API key. The page already stops polling and renders a designed unavailable state. |
| Forge and LLM lanes | The deep sweep found low Forge success and unavailable LLM providers. | Provider credentials/capacity must be restored; no mock generation lane was introduced. |
| x402 settlement and sniper fleet | Settlement was not succeeding, the Solana fee payer was below its operating floor, and four sniper wallets were starved. The treasury-topup dry run produced an empty transfer plan: the master had no spendable SOL, no spare USDC, and two otherwise funded agent wallets had undecryptable secrets. | Requires an explicitly approved funding action plus recovery or rotation of the two unreadable wallet secrets. The empty plan was not applied and no funds were moved during this audit. |
| OKX bot and alerts | The OKX bot's AI credential was rejected; production Telegram push alerts were disabled. | Requires valid provider credentials and an alerts chat configuration. |

## Coverage notes

The crawler found 115 linked HTML routes absent from `data/pages.json`, plus
1,770 additional URLs excluded by dynamic-family sampling limits. Most are
content instances (agent, avatar, market, category, profile, and protocol URLs),
not separate static surfaces. The canonical route families remain the right
manifest unit; instance sampling should be expanded only where it adds a new
template or failure mode.

The loaded audit initially recorded 100 errors, 232 warnings, and 5,188
informational findings. Those totals include 57 route/viewport pairs that the
first process could not reverify before its browser recycle cap, so they are not
a release verdict. A second concurrency-one isolation pass was used for final
classification. The large majority of WebGL and navigation errors disappeared
when isolated.

## Operating and security follow-up

- Rotate every GitHub, Cloudflare, R2, npm, and other credential that was pasted
  into a chat or terminal transcript, even if it was not committed. Treat chat
  exposure as credential exposure.
- Keep R2 credentials in Secret Manager. Never add them to `.env`, shell
  history, reports, documentation, or Git.
- Restore watsonx, CoinCommunities, OKX AI, and Telegram alert credentials using
  Secret Manager references, then rerun `npm run triage:gcp -- --json --deep
  --since 6h`.
- Funding the fee payer or sniper wallets is an irreversible money-moving action
  and must be separately confirmed with the exact wallets, amounts, token, and
  network before execution.
