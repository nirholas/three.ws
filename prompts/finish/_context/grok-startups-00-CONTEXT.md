# grok-startups campaign: shared context

Not a work order. Never run this file. Every `prompts/finish/8NN-grok-startups-*.md` order (871 to 886) names it in its first lines; read it before step 0. CLAUDE.md overrides everything here.

The campaign builds on three.ws's admission to xAI's **Grok for Startups** program (admitted 2026-11-20). The opportunity map and the reasoning behind every order is [docs/partners/xai-grok-startups-plan.md](../../../docs/partners/xai-grok-startups-plan.md). Read its "Rules that bind every route" section before writing any copy.

**The 15 orders are independent by design: all of them can run at the same time in separate chats.** No order waits on another, and none may assume another has landed. If a sibling's work is already on disk, reuse it when it fits, but never require it. The older `x-grok-` campaign (context: [x-grok-00-CONTEXT.md](x-grok-00-CONTEXT.md)) owns the Grok Bot connector surface, the @-mention bot and these gated orders, archived on 2026-11-21 with only owner steps left ([grok-OWNER-ACTIONS.md](grok-OWNER-ACTIONS.md)). **Never redo them; reference them:**

| Order | Owns |
|---|---|
| [927](../../archive/927-x-grok-46-owner-grok-api-key.md) | The production xAI key. `npm run setup:xai-key` ([scripts/install-xai-key.mjs](../../../scripts/install-xai-key.mjs)) stores it as secret `grok-api-key` and mounts it as `GROK_API_KEY` on `three-ws-api` |
| [928](../../archive/928-x-grok-47-go-live-mention-bot.md) | Turning the @-mention bot live (`X_MENTION_BOT_LIVE`) |
| [929](../../archive/929-x-grok-48-connector-directory-listings.md) | The 13 third-party connector directories in [docs/partners/grok-bot-listings.md](../../../docs/partners/grok-bot-listings.md), including the prepared Cursor Marketplace, cursor.directory and `xai-org/plugin-marketplace` submissions |
| [930](../../archive/930-x-grok-49-launch-announcement.md) | The Grok Bot and mention-bot launch posts in [data/x-content/queue.json](../../../data/x-content/queue.json) |
| [931](../../archive/931-x-grok-50-player-card-approval.md) | X player card approval |
| [941](../../archive/941-x-grok-17-xai-remote-mcp-e2e.md) | The live `npm run e2e:xai-mcp` proof against production |

## Facts every order needs (re-derive the ones you use in step 0)

| Fact | Value / where |
|---|---|
| Membership record | Tracker row `xai-grok-for-startups` in [data/partner-programs.json](../../../data/partner-programs.json), status `member`. Credits: one balance across the Grok API, Grok, Grok Build and Grok Bot; 20% on approval, 80% after onboarding; expire 6 months after issue. **Never write the credit amount or the team ID anywhere in the repo, a post or a log.** |
| xAI is now SpaceXSI | SpaceX acquired xAI (2026-02-02); the unit was renamed SpaceXAI (July 2026) and SpaceXSI (October 2026). xAI's own pages say "SpaceXSI API". Domains and docs stay `x.ai`, `docs.x.ai`, `console.x.ai`, API base `https://api.x.ai/v1`. SpaceX also announced the acquisition of Cursor (Anysphere) in June 2026. |
| xAI API key | `GROK_API_KEY` (falls back to `XAI_API_KEY`), read through [api/_lib/env.js](../../../api/_lib/env.js). **As of 2026-11-20 no key exists in production or on this machine** until order 927 lands. Check: `gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json \| grep -c GROK_API_KEY` and `grep -c "^GROK_API_KEY\|^XAI_API_KEY" .env .env.local 2>/dev/null` |
| Model ids | One place: `GROK_MODELS` in [api/_lib/chat-models.js](../../../api/_lib/chat-models.js) (`tests/grok-model-literals.test.js` fails the build on a Grok id typed anywhere else). `npm run check:xai-models` diffs it against the live catalog. Image, video and voice ids follow the same rule: add them to that file, never inline them. |
| xAI capabilities (from third-party reporting and docs.x.ai, re-verify) | Grok 4.7 flagship (2026-09-21). Grok Imagine Image 2.0 (serves the image slugs since 2026-11-02). Grok Imagine Video 1.5 GA: `grok-imagine-video-1.5` and `grok-imagine-video-1.5-lite`, reference-to-video with up to 14 reference images, `/v1/videos/edits`, `/v1/videos/extensions`. Grok Voice 3.0 speech-to-speech; `grok-voice-latest` points to it. Responses API with remote MCP (`server_url`, `server_label`) and built-in `x_search`. Docs root: `https://docs.x.ai/developers/`. x.ai pages answer 403 to curl; `docs.x.ai` pages are usually fetchable as `.md`. |
| Existing Grok code | Provider chain [api/_lib/llm.js](../../../api/_lib/llm.js); X search rung [api/_lib/x-search.js](../../../api/_lib/x-search.js); per-agent Grok key [api/_lib/agent-grok-key.js](../../../api/_lib/agent-grok-key.js); remote MCP e2e [scripts/xai-mcp-e2e.mjs](../../../scripts/xai-mcp-e2e.mjs); model check [scripts/check-xai-models.mjs](../../../scripts/check-xai-models.mjs) |
| Grok-facing MCP surfaces | `https://three.ws/api/mcp-grok` ([api/mcp-grok.js](../../../api/mcp-grok.js)), `https://three.ws/api/mcp-studio` (free studio; making or rigging a model needs a free account via OAuth `?auth=oauth` or an API key). All listed in [public/.well-known/mcp.json](../../../public/.well-known/mcp.json), documented in [docs/mcp.md](../../../docs/mcp.md), [docs/grok.md](../../../docs/grok.md), [docs/grok-bot.md](../../../docs/grok-bot.md) |
| Plugins | Cursor: [integrations/cursor/three-ws](../../../integrations/cursor/three-ws) (`.cursor-plugin/plugin.json`, `mcp.json`, `skills/`, `assets/`). Grok Build: [integrations/grok/three-ws](../../../integrations/grok/three-ws) (`.grok-plugin/`, `.mcp.json`, `commands/`, `skills/`). Example: [examples/grok-remote-mcp](../../../examples/grok-remote-mcp) |
| Owned pages | `/grok` ([pages/grok.html](../../../pages/grok.html)), the Grok skill file `/grok-skill.md` ([public/grok-skill.md](../../../public/grok-skill.md)), `/anatomy` ([pages/anatomy.html](../../../pages/anatomy.html)), `/partners` and `/partners/benefits#xai` |
| Rendering | `GET /api/render/glb?glbUrl=<url>` renders any GLB to a PNG ([api/render/glb.js](../../../api/render/glb.js)); the source for every still, reference image and card |
| Usage telemetry | [api/_lib/usage.js](../../../api/_lib/usage.js) buffers into `usage_events` ([migration](../../../api/_lib/migrations/20260605120000_usage_events.sql)); `client_id` is a free-text attribution label |
| Health | [api/healthz.js](../../../api/healthz.js) assembles `subsystems`; `api/_lib/*-health.js` is the pattern (for example [x-mention-health.js](../../../api/_lib/x-mention-health.js)) |
| X content pipeline | [data/x-content/queue.json](../../../data/x-content/queue.json) plus the reviewed pipeline in [docs/x-content-pipeline.md](../../../docs/x-content-pipeline.md) (long-form: [docs/x-article-author-brief.md](../../../docs/x-article-author-brief.md)). Drafts only; posting is an owner step |
| Production | Google Cloud Run `three-ws-api`, `us-central1`, project `aerial-vehicle-466722-p5`. Stays on GCP |

## Saying it correctly (binding on every UI string, doc, listing, email and post)

- Approved claim: **"three.ws is a member of xAI's Grok for Startups program."** It is a startup credit program, not a partnership, an investment or an endorsement. Never write "xAI partner", "backed by xAI", "official Grok plugin" or "endorsed by SpaceX". Use "for Grok", "works with Grok", "built on the Grok API".
- **xAI-facing material is token-free.** Plugins, marketplace listings, connector descriptions, the startups email, the case study, the rocket cutaway and every example never mention $THREE, a coin, a price, trading or a wallet balance. No connector or plugin this campaign ships exposes a wallet, spend, transfer, trade, launch or x402-payment tool.
- Marks are nominative only. No xAI, Grok, SpaceX, Starship, Cursor or X logo inside a three.ws asset unless a published brand kit allows that use; fetch and cite the kit if you use one.
- Never publish the credit amount, the team ID, or any xAI staff email address. Public X handles of people who made public announcements may be referenced in drafts.

## Rules for running every order at once in one worktree

1. **Dev server port.** Never take port 3000. Run `npm run dev -- --port <3200 + NN> --strictPort` where `NN` is your order's last two digits (order 876 uses 3276).
2. **Shared hot files** (`data/changelog.json`, `data/pages.json`, `STRUCTURE.md`, `vercel.json`, `vite.config.js`, `api/_lib/env.js`, `api/_lib/chat-models.js`, `package.json`, `pages/grok.html`, `docs/grok.md`, `docs/partners/grok-bot-listings.md`, `public/.well-known/mcp.json`): edit them LAST, re-read the file immediately before each edit, make small anchored `Edit` calls (never rewrite the whole file), and commit right after. If an edit fails because the file moved, re-read and redo it.
3. **Stage explicit paths only.** Never `git add -A` or `git add .`. Commit with `git commit --only <paths>` or the private-index recipe, and run `git diff --staged` first; if a sibling's hunk is in your file, unstage it with `git restore --staged -p`.
4. **Migrations.** Fresh UTC timestamp per migration. Run `npm run db:status` before `npm run db:migrate` (it applies immediately, no dry run). Read the `self-unblock-playbook` skill's database row first. For a live check that must not touch production data, use [scripts/lib/isolated-db.mjs](../../../scripts/lib/isolated-db.mjs).
5. **Tests.** Run your own suite (`npx vitest run tests/<yours>.test.js`) on every change and `npm test` once before close-out. A red you did not cause gets one line in the report, not a detour.
6. **Generated files.** After appending to `data/changelog.json`, run `npm run build:pages` and stage what it regenerates.
7. **package.json scripts.** Add one only if you need it, prefixed `grok:` (for example `grok:usage`), via a small anchored edit.
8. **Model and endpoint ids.** New xAI ids go into `api/_lib/chat-models.js` next to `GROK_MODELS` (hot file, rule 2) and are read from there.
9. **New files more than one order may create.** `scripts/export-plugin-repo.mjs` (orders 871, 872, 885) and `api/_lib/xai-pricing.js` (orders 878, 879) can be created by whichever order gets there first. Immediately before creating one, check both the disk and `git log -1 -- <path>`. If it exists in either place (committed, or uncommitted from a sibling still working), extend it with anchored edits and keep its existing CLI flags and exports backward compatible; never overwrite it. If it does not exist, create the smallest complete version your order needs, with its test, and commit those two paths on their own at once, before building on them, so the first commit wins and siblings find it.

## When there is no xAI key (held on purpose by the owner)

The owner is deliberately holding the production key back until the credit spend plan in `docs/grok-roadmap.md` is settled (decision of 2026-11-21, recorded in CLAUDE.md). Do not remind the owner about it, and do not list it in your owner message.

The missing key is never a reason to stop or to build less. Build the whole feature, wire it behind `GROK_API_KEY`, and prove it three ways: (1) unit tests with recorded real response shapes copied from `docs.x.ai` (a documented example is a real shape; an invented one is not), (2) a live call that reaches xAI and gets its documented 401 or 400 (proves endpoint, auth header and body shape), (3) the feature's no-key path visibly degrades to the existing lane with an honest message, never a fake result. Write the exact command that proves it live into the feature's doc.

## Owner gates (batch into ONE message at the end of your session)

`git push`, production deploys (`npm run deploy:gcp:full`), creating GitHub repositories or organizations, marketplace or directory submissions, emails to xAI, posts on X, and anything touching the xAI console are owner steps. Build and verify everything up to the step, write the exact command, click path or paste-ready text into the repo, and list it in your final owner message. Never contact xAI, X, Cursor or any third party yourself.

## Paid services

GCP is pre-approved. xAI API usage is funded by the startups credits and xAI is an already-integrated provider, so calling it is not onboarding a new paid API. Do not add any other new paid service. Live xAI calls made while building stay small (single requests, lite models, shortest durations) until order 878's ledger exists.

## Progress log

Append a dated entry to [grok-startups-PROGRESS.md](grok-startups-PROGRESS.md) when you finish: order number, commit SHAs, what is live, the measured number, what waits on the owner. Re-read the log right before appending (siblings write to it too) and append with a small anchored edit at the end.
