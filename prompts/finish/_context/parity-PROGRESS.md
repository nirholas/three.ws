# parity: progress log

Cross-session handoff for the `parity-` orders ([parity-00-CONTEXT.md](parity-00-CONTEXT.md)). Append one dated entry per session: which order, what shipped (commit SHAs), what was measured, and anything the next session must know. Never edit an earlier entry.

## 2026-09-29: teardown and Tier 1

- Teardown written: `docs/research/competitor-teardown-2026-09.md` (`1cfce0cd1`).
- Tier 1 shipped locally, not pushed: `/connect` and `/docs/cli` (`1ee0a06c3`), official notice and curated `llms.txt` (`781090002`), `/skill.md` (`d8080afd2`), `three-ws create` / `launch` (`ec8dae368`), API reference error table and checklist (`a9380b9b2`).
- Found: the `three-ws` npm package was never published, so `npx three-ws setup` (named in every MCP 401 and in `/.well-known/mcp.json`) fails for everyone. Order 919.
- Corrected in the context file: the teardown called the $THREE burn policy contradictory. It is not. The platform never burns $THREE; the burn in `launcher-claimer.js` is each agent's own coin.
- Orders 015 to 022 and 919 to 925 written 2026-09-30.

## 2026-09-30: order 021, where every $100 goes (/three-token)

- Shipped: `05faebd92` (live wallets API `GET /api/three-token/wallets`, `src/three-token-fee-flow.js`, light theme for the page, tests) and the close-out commit that carries this entry (segment-label and stamp polish, light-theme state-kit tokens, API reference "$THREE Fee Flow API", thesis section 6 pointer, changelog).
- Measured in production: `treasury: null`, `rewards_wallet: null` on `/api/token/config`; neither `THREE_TREASURY_WALLET` nor `THREE_REWARDS_WALLET` exists on the Cloud Run service. 6 `POST /api/token/quote` answered 503 in the 7 days to 2026-09-30 and none succeeded (Cloud Run request log). The textPayload search for `treasury_unavailable` finds nothing because the quote handler returns that typed 503 without logging it; count refusals from the request log instead.
- Remaining owner action (not a line of the order): publish the two wallet addresses with `gcloud run services update three-ws-api --region us-central1 --update-env-vars THREE_TREASURY_WALLET=...,THREE_REWARDS_WALLET=...`. The page shows "not yet published" until then and fills itself in afterwards with no code change.

## 2026-09-30: order 016, /analytics (platform totals and growth)

- Shipped: `0af815c5b` (data layer `api/_lib/platform-analytics.js` + `GET /api/platform/analytics`), `7a739e177` (page module), `d0212823a` (page, route, build input, tests), `f04f022ce` (footer and nav links), `85318b030` (`data/pages.json` entry, `llms.txt` "Economy and $THREE" group, regenerated feeds), `f60d919b8` (STRUCTURE.md row), `a4187c39f` (changelog), `796803608` (link-audit fix in `src/syndicates.js`, a `#` stub that failed `npm run audit:links`), and the close-out commit that carries this entry (creator fees from order 015's snapshot, API reference update). The API reference section and the `/docs/start-here` link were swept into `1806064d3` by a concurrent agent.
- Measured on production data 2026-09-30 (30d window): 4,165 agents (+724), 920 with a wallet (+176), 90 mainnet coins (+3), 39,488 finished 3D models (+19,646), 244.3M LLM tokens (+109.1M), 191,488 x402 settlements (+60,572) moving $11,760.36 in USDC (+$9,141.69), 0 paid marketplace sales, $0 agent-to-agent hire volume, 5.515 SOL lifetime creator fees across 48 counted creator wallets. Every source answered in under 5 s, so no rollup table was needed; the response is cached 5 minutes.
- Note for readers of these numbers: the x402 settlement count includes the platform's self-cycled ring (`/api/x402-ring`), and the method string says so.

## 2026-09-30: order 020, /stories and verified Spotlight results

- Shipped: migration `api/_lib/migrations/20260930171500_agent_showcase_story_consent.sql` (applied alone with `apply-migrations.mjs --file`; landed in `716131b4f`), metrics + consent + moderation backend (`1ef826a16`), PGlite handler tests `tests/spotlight-stories.test.js` (`d866ed2a0`), STRUCTURE row (swept into `625cbb8a6`), and the close-out commit that carries this entry (`/stories` page, Verified results block and owner toggle on `/spotlight/:id`, submit-form consent checkbox, docs, route, nav, changelog).
- Measured: 15 live `agent_showcase` entries (14 curated, 1 community), 0 with story consent, so `/stories` ships on its empty state by design. `agent_revenue_events` and `agent_hires` are empty in the database today, so service income reads $0 everywhere; coins come from 90 mainnet `pump_agent_mints` rows.
- Creator fees: order 015's read model (`api/_lib/agent-earnings.js`) was present and is loaded lazily, so creator fees are live on entries (e.g. an entry with two coins shows 0.0324 SOL). If that module is ever absent the metric degrades to "Not measured yet", never zero.
- Judgment call: a story needs a RESULT (coin, creator fees above zero, or service income above zero); conversations and actions alone do not qualify.
- Not browser-exercised: the owner-only "Feature as a success story" button, because no QA account owns a Spotlight entry and creating one would write a public production entry. The consent API behind it is covered by the handler tests.
