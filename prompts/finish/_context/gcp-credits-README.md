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
| 05 | Catalog and animation seeding (retired; full text in git history before `25c6683cf`) | **Done except one owner-gated step, updated 2026-09-18.** Avatar half and scale-proofing landed earlier (catalog at 68,971 on 2026-09-09; `/animations` first paint 2 requests / 389 KB at a synthetic 30,070 clips). **Motion half done:** 843 new takes on `model-text2motion` (lane-asserted, zero paid calls), **70.7% accepted** through the full motion gate, **469 generated clips published** (three takes per prompt at most, 175 of 180 prompts; the prompt library grew from 137 to 180), library now 3,343 clips, for \$0.73 to \$1.27 of GPU (\$0.002 to \$0.003 per accepted clip). Rendering clips on the default rig exposed two defects the gate could not see, both fixed and every clip re-derived before publishing: the lane's rest shape (arms hanging, head forward of the neck) had been treated as a T-pose, so every generated clip including the 39 already live played with the head thrown back (basis `canonical-rest-v2`), and single-frame foot flicks; walks now keep the root travel their feet imply. **Task B8 done:** all 469 are listed in `/api/marketplace/animations` under the platform account at 0.01 USDC and sell through `/api/x402/animation-download` (live 402 verified), GLBs under unguessable keys. The weekly free subset of 12 and the upright conversion on `/api/forge-motion` are committed and go live with the next `three-ws-api` deploy. **Remaining, owner:** `SEED_CRON_VISION` stays off because its judge is Gemini on Vertex only and Vertex is denied by the project billing hold; clear the hold, then flip it. See [docs/animation-seeding.md](../../../docs/animation-seeding.md) and [docs/ops/gcp-credits.md](../../../docs/ops/gcp-credits.md). |
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
- Push target, when the owner asks for a push, is `git push threews main`.

## Retire this file when the campaign is done (required)

This file is shared context rather than a single order, so it outlives the
prompts that cite it. Delete it in the commit that closes the LAST prompt of
this campaign, once nothing else in `prompts/finish/` references it:

       grep -rl 'gcp-credits-README' prompts/finish/
       git rm prompts/finish/_context/gcp-credits-README.md

While any sibling prompt of this campaign is still on disk, leave this file in
place and keep it accurate instead. The shrinking directory is the only signal
to the next agent that a campaign is closed.
