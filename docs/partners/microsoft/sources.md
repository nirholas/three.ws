# Sources for the Microsoft co-marketing and programs pack

Every number that appears in a file under `docs/partners/microsoft/` is listed here with the query, endpoint, command or file it came from and the date it was read. Nothing in the pack is estimated. When a number cannot be re-measured, it is left out of the pack rather than guessed.

Re-measure before anything is posted or submitted: the production counts grow every day. Production SQL runs read-only against the database in `.env.local` with:

```sh
node --env-file=.env.local -e "import('./api/_lib/db.js').then(async ({ sql }) => { console.log(await sql(process.argv[1], [])); process.exit(0); })" "<query>"
```

## Headline counts (one-pager, deck, articles, programs)

Read 2026-11-12, about 16:20 UTC.

| Number | Value | Source |
|---|---|---|
| 3D models generated on three.ws (all Forge lanes) | 54,356 | `curl -s https://three.ws/api/home-stats`, field `forge_models` |
| Agents created | 4,936 | `curl -s https://three.ws/api/stats`, `stats.agents.value` (source `agent_identities`, not deleted). `/api/home-stats` field `agents` agrees |
| Live embeds on other sites | 655 | `curl -s https://three.ws/api/home-stats`, field `widgets` |
| Tools on the free MCP server | 16 | `tools/list` JSON-RPC on `https://three.ws/api/mcp-studio`: `forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`, `refine_model`, `check_job`, `look_at_model`, `get_job`, `search_catalog`, `get_catalog_item`, `get_item_source`, `search_docs`, `create_agent_persona`, `get_agent_persona`, `persona_say` |
| GitHub stars and forks | 276 stars, 78 forks | `curl -s https://api.github.com/repos/nirholas/three.ws`, `stargazers_count`, `forks_count` |
| Packages and workers in the monorepo | 114 packages, 53 workers | `ls -d packages/*/ \| wc -l`, `ls -d workers/*/ \| wc -l` |
| VS Code extension installs | 22, `threews.vscode-x402` v0.2.1 | Visual Studio Marketplace gallery API `POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery`, filterType 7, statistic `install` |
| License | Apache-2.0 | `LICENSE` in the repository root |
| Microsoft Marketplace publisher ID | `d11c4453-6e12-499d-8dfe-48fcbaa22e2f` | [docs/microsoft.md](../../microsoft.md) |

## TRELLIS on our GPUs (one-pager, tech-community-trellis-gpus.md, deck)

Read 2026-11-12.

| Number | Value | Source |
|---|---|---|
| Self-hosted TRELLIS jobs accepted since the worker went live | 35,531 | `select count(*) from forge_creations where backend='trellis_selfhost'` |
| Finished GLB files from that lane | 29,443 | `select count(*) from forge_creations where backend='trellis_selfhost' and status='done' and glb_url is not null` |
| Date the self-hosted worker went live | 2026-07-08 | `select min(created_at)::date from forge_creations where backend='trellis_selfhost'` |
| 30-day completed jobs, median wall time and median GLB size, per tier | draft 1,404 / 132 s / 1.51 MB; standard 1,956 / 234 s / 6.06 MB; high 275 / 602 s / 17.21 MB | `select tier, count(*), percentile_cont(0.5) within group (order by extract(epoch from completed_at-created_at)), percentile_cont(0.5) within group (order by size_bytes)/1048576 from forge_creations where backend='trellis_selfhost' and status='done' and glb_url is not null and completed_at is not null and created_at > now()-interval '30 days' group by tier` |
| TRELLIS.2 trial rows | 4 rows, all 2026-11-11: 2 draft done in 56 s each, 2 standard orphaned by an instance restart | `select status, tier, created_at, completed_at, error from forge_creations where backend='trellis2'` |
| TRELLIS.2 not wired into the API | no `MODEL_TRELLIS2_URL` | `gcloud run services describe three-ws-api --region us-central1 --format=json`, container env names containing `TRELLIS` returned only `MODEL_TRELLIS_URL` |
| TRELLIS.2 health | HTTP 429 "Rate exceeded" | `curl -s https://model-trellis2-lp642k3kpa-uc.a.run.app/health` |
| Tier sampler presets, face cap (150,000), alpha thresholds (245, 1%), resolution presets (512/1024/1536 with 2048/4096 px, 300,000 / 1,000,000 / 1,500,000 faces), load retry budget (four attempts), lane cooldown (90 s) | as quoted in the article | presets and face cap in `workers/model-trellis/request_policy.py`; load retries `MODEL_LOAD_ATTEMPTS` (default 4) in `workers/model-trellis/main.py`; alpha thresholds and resolution presets in `workers/model-trellis2/`; lane cooldown `LANE_COOLDOWN_SECONDS = 90` in `api/_lib/forge-lane-health.js`. Each code block in the article is copied from the file it names |
| Instance shapes (one L4 24 GB, `MAX_CONCURRENT=1`, TRELLIS max 3 instances, TRELLIS.2 8 vCPU / 32 GiB / max 2 / 900 s) | as quoted | `workers/model-trellis/cloudbuild.yaml`, `workers/model-trellis2/cloudbuild.yaml` |
| Incident dates (2026-09-02 load latch, 12 hours down; 2026-07-16 non-power-of-two texture) | as quoted | `workers/model-trellis/README.md` and the comments in `workers/model-trellis/Dockerfile` and `test_request_policy.py` |
| Checkpoint tree size (about 15 GiB), conditioner plus matte (about 1.7 GB) | as quoted | `workers/model-trellis2/README.md` and `workers/model-trellis2/main.py` (checkpoint tree), `workers/model-trellis2/pipeline_config.py` (conditioner and matte) |

## ONNX Runtime Web speech (tech-community-onnx-speech.md)

| Number | Value | Source | Read |
|---|---|---|---|
| Pinned versions | `onnxruntime-web` 1.31.1, `@ricky0123/vad-web` 0.0.31 | `package.json` | 2026-11-12 |
| Download size, Moonshine Base q8 (encoder plus merged decoder) | 63,011,933 bytes | `https://huggingface.co/api/models/onnx-community/moonshine-base-ONNX/tree/main/onnx`: `encoder_model_quantized.onnx` 20,513,063 + `decoder_model_merged_quantized.onnx` 42,498,870 | 2026-11-12 |
| Download size, Whisper Base q8 | 76,894,629 bytes | same API for `onnx-community/whisper-base`: 23,201,314 + 53,693,315 | 2026-11-12 |
| Silero frame (512 samples, 32 ms), trailing silence 352 ms (11 frames), push-to-talk silence 1,500 ms, 28 s utterance cut, wake window 760 ms plus 16 embeddings at 80 ms (2,040 ms), threshold 0.5, refractory 1,500 ms | as quoted | `src/runtime/whisper-stt.js`, `src/voice/wake-word.js` | 2026-11-11 |
| Wake-word chain per 80 ms chunk: 7.4 to 7.7 ms median, 10.5 to 11.9 ms p95 over runs of 137 chunks; Moonshine 1.88 to 2.20 s and Whisper 5.72 to 5.99 s on the 11 s JFK clip, four runs each | as quoted | `node scripts/microsoft-pack/onnx-speech-bench.mjs`, headless Chromium 158, AMD EPYC 7B12, single-threaded (no cross-origin isolation) | 2026-11-11. Not re-run 2026-11-12: the shared build host was at load average 242 on 32 cores, which would have measured contention, not ONNX Runtime. Re-run on an idle machine before posting |
| Unit tests: 15 (speech-to-text routing, window, fallback order) and 39 (voice loop) | 15, 39 | `npx vitest run tests/whisper-stt.test.js tests/home-voice.test.js` | 2026-11-12, all passing |

## Teams app on Adaptive Cards (tech-community-teams-adaptive-cards.md)

| Number | Value | Source | Read |
|---|---|---|---|
| Manifest schema, tool count, check output | v1.30, 16 tools | `npm run package:microsoft-app -- --check` printed `OK: manifest, schema v1.30, 16 tools, meeting stage tab and RSC, icons and ASCII checks pass (owner values not checked).` | 2026-11-12 |
| Payload sizes against a real agent | bound card 1,363 bytes, template 1,350 bytes, 10-result search response 18,586 bytes | `searchAgents('')` from `api/_lib/teams-bot.js` against production (10 results, first agent `740a7229-f545-4773-a2e3-610a1352dbc6`), then `Buffer.byteLength(JSON.stringify(...))` of `adaptiveCardFor(card)`, `adaptiveTemplate()` and `resultResponse(cards.map(attachmentFor))` | 2026-11-12 |
| Search caps (100 characters, 10 results), prompt length (3 to 1,000 characters), Teams submit window (5 s), `userIds` limit (60), card versions (1.5 progress card, 1.6 agent card) | as quoted | `api/_lib/teams-bot.js`, `api/_lib/teams-forge*.js`, `api/_lib/glance-adaptive.js`; the 5 s and 60 limits are from the Microsoft Teams developer documentation on message extensions and Universal Actions | 2026-11-12 |
| Tests: 97 (13 bot, 31 generation flow and cards, 21 agent card, 21 stage view, 11 package builder) | 97 | `npx vitest run tests/teams-bot.test.js tests/teams-forge.test.js tests/glance-card.test.js tests/microsoft-teams-stage.test.js tests/microsoft-app-package.test.js`, all passing | 2026-11-12 |
| Zip size | not stated | The real zip needs the owner-only `MS_APP_ID`, `MS_DEVELOPER_NAME`, `MS_KEYVAULT_URL` and `MS_TEAMS_BOT_APP_ID`, so it cannot be built and measured until those exist. The article no longer gives a byte count | 2026-11-12 |

## Reactor session (reactor-session.md)

Per-beat timings come from `node scripts/microsoft-pack/rehearse-reactor-demo.mjs`, which calls the same tools in the same order against `https://three.ws/api/mcp-studio`. The run and its date are recorded in [reactor-session.md](./reactor-session.md#measured-rehearsal).

## Programs pack (programs/)

Program names, eligibility and benefit figures are quoted from Microsoft's public pages, read 2026-11-12. Each application file names the page beside the answer it supports:

- ISV Success: [Partner Center, Build and publish with ISV Success](https://learn.microsoft.com/en-us/partner-center/membership/isv-success), [ISV Success FAQ](https://learn.microsoft.com/en-us/partner-center/membership/faq-isvsuccess), [Benefits by program and offer](https://learn.microsoft.com/en-us/partner-center/benefits/benefits-at-a-glance).
- Microsoft for Startups (Founders Hub): [Overview of the application process](https://learn.microsoft.com/en-us/startups/microsoft-for-startups/application).
- Marketplace Rewards: [Marketplace Rewards](https://www.microsoft.com/en-us/software-development-companies/offers-benefits/marketplace-rewards), [Marketplace Rewards on Microsoft Learn](https://learn.microsoft.com/en-us/azure/marketplace/marketplace-rewards).

Any three.ws number in those files is one of the rows above.
