# GCP credit program: prompt pack

The owner holds roughly $100k in Google Cloud credits on project `aerial-vehicle-466722-p5`
(region `us-central1`) and has pre-approved spending them on quality, reliability and UX. This
pack turned that into infrastructure. The plan and cost model live in `docs/gcp-credits.md`;
the fleet and quota position live in `docs/ops/gcp-credits-plan.md`.

## State

| # | Work order | State |
|---|---|---|
| 01 | GCP foundation | Retired, shipped (readable in git history) |
| 02 | Vertex Claude provider | Retired, shipped. Wired and **dormant, re-verified 2026-08-02**: flags are `0` on the service AND the project is unentitled (`rawPredict` 404s every Claude id in `global` and `us-east5`), so the lane could not serve even if flipped. Owner action: accept Anthropic terms in Model Garden. See [docs/ops/llm-lanes.md](../../docs/ops/llm-lanes.md). |
| 03 | Imagen activation | Retired, shipped |
| 04 | GPU worker deploys | Retired, shipped: six workers, flag-gated routing, cost docs. The rig lane shipped as `workers/rig` (`model-rig`), replacing the unirig stub. |
| 05 | [05-catalog-animation-seeding.md](../904-gcp-credits-05-catalog-animation-seeding.md) | **OPEN, avatar half and scale half landed, motion republish blocked on credentials.** Catalog is at 68,971 avatars (10,370 in the last 7 days, ~844/day). The batch runner gates at 75% for \$0.139 per accepted asset; the live cron, which does the actual growing, runs the mesh stage only and accepts 98.6%, and **no seed avatar has ever been rigged** (`SEED_CRON_VISION` / `SEED_CRON_RIG` are both off on the service: two owner env flips, see [docs/ops/gcp-credits.md](../../../docs/ops/gcp-credits.md)). Since 2026-09-09 the cron records its verdict on keepers as well as rejects, so the live accept rate is measurable from `forge_seed_jobs`. Scale-proofing is DONE and verified in a browser at a synthetic 30,070-clip catalog: `?facets=1` and `?name=` landed on `/api/animations/library` and the `/animations` first paint went from 30 requests / 11.5 MB to 2 requests / 389 KB. The motion half is still the blocker: all 133 published generated clips are in the wrong rest basis and carry a fabricated 0.2577 m/s drift, `--repair` re-derives them with no GPU (re-verified 2026-09-09: 39 of 133 survive), but **publishing needs the R2 credentials on the Cloud Run service and gcloud in this workspace cannot authenticate** (`Reauthentication failed` on both the user credential and ADC). The marketplace listing (task B8) stays unwired until that republish lands. See [docs/animation-seeding.md](../../../docs/animation-seeding.md). |
| 06 | Vanity inventory | Retired, shipped (`scripts/gcp/vanity-*`) |
| 07 | Spend observability | Retired, shipped (`scripts/gcp/burn-report.mjs`, `create-budgets.mjs`) |
| 08 | Expiry and revert runbook | Retired, shipped (`scripts/gcp/revert-to-free.sh`, `emergency-stop.sh`, `teardown.sh`) |

## Ground rules baked into every work order

- **Everything behind env flags.** Credits expire; every reroute must revert by flipping env
  vars, never by migrating code back.
- **No mocks, no placeholders, no half-wiring.** CLAUDE.md applies in full.
- **Fail-safe chains.** GCP lanes slot into existing provider chains as preferred rungs with
  automatic fallthrough. A GCP outage must never take down a feature that works today.
- **Never commit secrets.** Service-account JSON lives in the Cloud Run service env and local
  `.env` only.
- **Prefer GCP over any paid third party**, and never downgrade quality to save credits.
- Push target, when the owner asks for a push, is `git push threews main`. Never push, pull,
  fetch or merge `threeD`.

## Retire this file when the campaign is done (required)

This file is shared context rather than a single order, so it outlives the
prompts that cite it. Delete it in the commit that closes the LAST prompt of
this campaign, once nothing else in `prompts/finish/` references it:

       grep -rl 'gcp-credits-README' prompts/finish/
       git rm prompts/finish/_context/gcp-credits-README.md

While any sibling prompt of this campaign is still on disk, leave this file in
place and keep it accurate instead. The shrinking directory is the only signal
to the next agent that a campaign is closed.
