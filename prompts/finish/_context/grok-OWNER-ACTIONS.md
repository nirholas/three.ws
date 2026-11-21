# Grok campaigns: owner actions

Every step below needs the owner: the xAI key, a deploy, creating public repositories, submitting to marketplaces and directories, sending email, and posting. Everything an agent can do is built and verified for the 16 `grok-startups-` orders (871 to 886) and the six `x-grok-` owner orders (927 to 931, 941), and those work orders have moved to [../../archive/](../../archive/). Evidence and commit SHAs are in [grok-startups-PROGRESS.md](grok-startups-PROGRESS.md), [x-grok-PROGRESS.md](x-grok-PROGRESS.md) and the archive table in [../../archive/README.md](../../archive/README.md). Strike a row when it is done. Recorded 2026-11-21.

The campaign map with the same steps in priority order is the "Owner actions" section of [docs/partners/xai-grok-startups-plan.md](../../../docs/partners/xai-grok-startups-plan.md).

## Do these first: they unblock most rows

1. **Deploy.** `npm run deploy:gcp:full` (deploy-runbook skill). The code is on threews/main but not live. On 2026-11-21, production `/api/status/mcp`, `/voice/grok` and `/privacy` answered 404. The deploy ships orders 871, 873, 875, 876, 880, 881, 883 and 884. Its sync-crons step creates `cron--api-cron-mcp-probe` (880).
2. **The xAI key (archived order 927). On hold by owner decision 2026-11-21:** the key goes in only after the credit spend plan in [docs/grok-roadmap.md](../../../docs/grok-roadmap.md) is settled, so agents do not raise it. When the owner is ready: create a production API key at console.x.ai on the credited three.ws team, then run `npm run setup:xai-key` (stores secret `grok-api-key`, grants `three-ws@`, sets `GROK_API_KEY` with `--update-secrets`, reads it back, runs `npm run e2e:xai-mcp`). On 2026-11-21 no key existed in `.env`, `.env.local`, Secret Manager or the `three-ws-api` service.
3. **Disclose xAI in the same change as the key (agent step, after 2).** Task 3 of the archived [927 order](../../archive/927-x-grok-46-owner-grok-api-key.md): add an `xAI` row to `data/subprocessors.json` (`ai` group, evidence from the `api.x.ai` call sites), add xAI to section 10 of `public/legal/privacy.html` and Grok as a connector client in every locale (`node scripts/check-i18n-parity.mjs`), and `npx vitest run tests/trust-page.test.js` must pass. Not done earlier on purpose: the order says to disclose it the moment the key is live, not before.

## Per order

| Order | Owner steps left |
|---|---|
| 871 Cursor plugin | Deploy (step 1). Create `nirholas/three-ws-cursor-plugin` from `npm run grok:cursor-plugin-export -- --out "$OUT"`. Submit rows 1 and 2 of `docs/partners/grok-bot-listings.md` (Cursor Marketplace, cursor.directory). |
| 872 Grok Build plugin | Create the GitHub org `three-ws` and public repo `three-ws/three-ws-grok`, push the export and confirm `git ls-remote` prints the pinned SHA (179da58e, or the new SHA if the folder changed). Open the row 3 marketplace PR from listings section 3. After step 2: `grok -p "/make-3d a brass desk lamp"`. |
| 873 Grok Bot marketplace | Deploy, rerun `node scripts/grok-connector-review-check.mjs`, create the `three-ws` org handle, test the connector in Grok Bot, submit the form at x.ai/bot/marketplace/submit-a-plugin with the values in listings section 0, record it in the Submission log. |
| 874 Imagine reference-image lane | After step 2: `npm run grok:eval-ref-image` adds the xAI column to `docs/evals/grok-imagine-ref-image.md`. Set `FORGE_REF_IMAGE_PROVIDER=xai` on Cloud Run with `--update-env-vars` only if the regenerated eval says Grok wins. |
| 875 hero clips | Deploy. After step 2: make one lite clip on a model page and confirm it plays in the viewer. |
| 876 Grok Voice realtime | Deploy. After step 2: a spoken round trip on `/voice/grok`, median latency over 10 turns into `docs/voice-grok.md`. |
| 877 examples pack | After step 2: `XAI_API_KEY=... npm run grok:examples-smoke`, paste the live Grok output into each README's captured-output section. Install Grok Build and run the build-workflow walk-through once. |
| 878 credit ledger | Deploy (the migration is already applied). Set the `XAI_CREDIT_*` env vars on Cloud Run (`docs/ops/xai-credits.md`). Create an xAI management key for `npm run grok:usage -- --reconcile`. |
| 879 eval and routing | After step 2: `npm run grok:eval-llm -- --prod-env --lanes grok,grok_budget`, then set only the `LLM_ROUTE_<TASK>` flags the regenerated report recommends. |
| 880 connector probe | Deploy (creates the cron). Then check that `/api/status/mcp` answers 200 and healthz lists `mcp_probe`. |
| 881 /grok hub | Deploy. Then check that `/api/grok/stats` returns real numbers on production. |
| 882 co-marketing kit | Send email 1 from `docs/partners/xai-comarketing-kit.md`. Approve each queued draft in `data/x-content/queue.json` (930 first, then the listings, then the builds) and attach head media per the asset checklist. |
| 883 rocket engine anatomy | Deploy. After step 2: one tour step narrated by Grok. Post the cutaway (draft in the co-marketing kit). |
| 884 Share on X and Ask @grok | Deploy. |
| 885 three.js craft plugin | Create the public repo for `integrations/grok/threejs-craft`, push the export, open the xai-org/plugin-marketplace PR for `threejs-craft`. |
| 886 grok-3d-starter | Create `nirholas/grok-3d-starter` and push the tree from `npm run export:growth-satellites`. After step 2: one full chat-to-model run on the deployed starter. |
| 927 production xAI key | Steps 2 and 3 above. |
| 928 mention bot go-live | Review the reply sample, run the preflight, set `X_MENTION_BOT_LIVE`, deploy, then check the first 24 hours of replies against the guard rules row by row and confirm healthz shows the subsystem `ok`. |
| 929 connector directories | Approve submissions (1+2) to (9) in the "Owner approval" list of `docs/partners/grok-bot-listings.md`. Make each one and record its URL in the Submission log. |
| 930 launch announcement | Approve and post the `grok-bot-mention-bot` thread and article drafts in `data/x-content/queue.json` (needs 928 live for the real mention reply). Record the post URLs. |
| 931 X player card | Submit per `docs/partners/x-player-card-submission.md` using a finished `/forge/share/:id` creation. The October blocker is fixed: production `/forge/embed` sends `frame-ancestors *` (checked 2026-11-21). Confirm a shared link plays in the X timeline. |
| 941 xAI remote MCP e2e | Covered by step 2: `npm run setup:xai-key` runs `npm run e2e:xai-mcp`, which must exit 0. |
