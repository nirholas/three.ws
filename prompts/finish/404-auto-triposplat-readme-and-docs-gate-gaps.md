# 404. Close the three fresh `check:claude` / `audit:docs` gaps blocking a clean `npm run gate`

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order." Runnable now, no gate. Written by the evolve scout lane on 2026-10-23 from a fresh measurement; independent of [402](402-auto-restore-green-gate.md), which was written 2026-10-08 against an older commit and whose named gaps (`workers/agent-gateway`, `services/autopilot`, several MCP/motion-token/freshness findings) are not what is failing today. This order closes only what is red right now in `check:claude` and `audit:docs`; 402 still owns everything else in the `gate` chain.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them.
- No mocks, no fake data, no unfinished-work markers, no commented-out code. Never make a guard pass by weakening it, deleting its check, or loosening a threshold; the one script edit this order makes (task 3) adds a narrower recognition rule, it does not remove or skip a check.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters (measured 2026-10-23, `main` at `84a86a5bf`)

`npm run gate` is a `&&` chain; `check:claude` runs second and `audit:docs` runs a few steps later, so either one failing hides everything after it from every agent who trusts a green gate to mean the tree is clean. Both are red right now, for reasons introduced since order 402 was written:

**`npm run check:claude`** (1 finding):
```
[check-claude] CLAUDE.md claims 100% README coverage but 1 dir(s) have none: workers/model-triposplat.
```
`workers/model-triposplat` was added in commit `3bd57493d` ("feat(forge): add TripoSplat gaussian-splat generation endpoint, GPU worker and provider") earlier today. It ships `main.py`, `Dockerfile`, `cloudbuild.yaml`, `requirements.txt`, `splat_prep.py`, `test_splat_prep.py`, `worker_security.py` and `stage-assets.sh`, exactly like its sibling GPU workers, but no `README.md`. It is also missing from `STRUCTURE.md`'s self-hosted-GPU-fleet row (line ~205), which lists every sibling (`model-trellis2`, `model-pixal3d`, `model-hunyuan3d`, `model-triposg`, `model-triposr`, etc.) by name.

**`npm run audit:docs`** (5 findings, `npm run audit:docs` exits 0 today because the script is advisory by default, but `npm run gate` still surfaces its output and the findings are real):
1. Three dead-link findings, all the same pattern:
   ```
   hubs/awesome-agent-identity/README.md:23  ../../issues/new?template=add-project.md
   hubs/awesome-agent-protocols/README.md:11  ../../issues/new?template=add-project.md
   hubs/awesome-solana-agents/README.md:7     ../../issues/new?template=add-project.md
   ```
   These are **false positives, not broken content**. `hubs/README.md` states the design explicitly: "Each folder is self-contained... and is built to be lifted into its own GitHub repo." Each hub already carries its own `.github/ISSUE_TEMPLATE/add-project.md` (confirmed: `hubs/awesome-agent-identity/.github/ISSUE_TEMPLATE/add-project.md` exists on disk). The link `../../issues/new?template=add-project.md` is the standard GitHub convention for linking to a repo's own issue-creation route from a README at that repo's root (GitHub resolves it against the page URL, which includes `/blob/<branch>/`, not against the filesystem). `scripts/audit-docs.mjs` checks these as filesystem-relative paths, which is the wrong model for a hub's own GitHub-facing links. The script already has precedent for this exact class of problem: `vendor/` and `third_party/` are skipped with the documented reasoning "its relative links resolve against the upstream repo layout... auditing it reports the vendor's own docs as our drift" (`scripts/audit-docs.mjs` lines 61-75). Hubs need the mirror-image version of that reasoning: their GitHub-route links resolve against a *future downstream* repo layout, not this one.
2. One missing-README finding, the same `workers/model-triposplat` gap as above (the two checks overlap here).
3. One missing-from-`data/pages.json` finding: `docs/mcp-registry-sentinel.md  served at /docs/mcp-registry-sentinel but absent from data/pages.json, so no crawler can find it.`

## Step 0: re-derive the current state

```bash
git log --oneline -1
npm run -s check:claude
npm run -s audit:docs
ls workers/model-triposplat/
grep -n "model-triposplat" STRUCTURE.md
grep -n "mcp-registry-sentinel" data/pages.json scripts/audit-docs.mjs
```

If any of these three gaps is already closed (a concurrent agent may have fixed it), skip that task and move to the next. If `check:claude` or `audit:docs` report a DIFFERENT finding than listed above, trust the live output; it is this order's real target.

## Tasks

1. **Write `workers/model-triposplat/README.md`.** Use `workers/model-triposg/README.md` and `workers/model-trellis2/README.md` as the structural template (what it does and why, the API contract, auth, environment variables, how it is reached from the product, what it returns). Source the facts from `workers/model-triposplat/main.py`'s own module docstring and code, not guesswork:
   - What: TripoSplat (VAST-AI-Research, MIT code and weights), one image to a 3D Gaussian splat. Geometry-free: produces `.ply` plus a compact `.splat`, rendered by the Splat Viewer (`src/splat-viewer.js`, Spark), not a mesh viewer.
   - Reached via: the Forge "Image to splat" lane behind `api/forge-splat.js` (`POST /api/forge-splat`, `GET /api/forge-splat?job=<id>`), routed through `api/_providers/gcp.js` when `MODEL_TRIPOSPLAT_URL` is set.
   - Endpoints: `POST /infer` (`{ images: [data-uri|https url], num_gaussians?: int, job_id?: str }` → `202 { task_id, status: "queued" }`), `GET /tasks/:id`, `GET /health`, `GET /` (unauthenticated warmth probe). `/infer` and `/tasks/:id` require `Authorization: Bearer $API_KEY`.
   - Env vars: `API_KEY`, `GCS_BUCKET`, `WEIGHTS_DIR` (default `/weights/triposplat`), `TRIPOSPLAT_REPO` (default `/opt/triposplat`), `MAX_CONCURRENT` (default 1), `MODEL_LOAD_ATTEMPTS`, `MODEL_LOAD_RETRY_BASE_S`.
   - Weights: `gs://three-ws-model-weights/triposplat`, staged by `stage-assets.sh`.
   - Security: SSRF guard on remote image URLs via `worker_security.py` (same pattern as every sibling worker); this worker also vendors it, so `npm run check:vendored` must stay green after you touch nothing in that file.
   - Deploy status: check honestly before writing it down. Run `gcloud run services describe model-triposplat --region us-central1 --project aerial-vehicle-466722-p5 --format='value(status.url)' 2>&1` (or the equivalent your `gcloud` auth allows); if it answers a URL, say "deployed"; if `gcloud` is unauthenticated or the service does not exist, say "built and tested, deploy owner-gated" exactly like the sibling entries in `STRUCTURE.md` do when they are in the same state. Do not claim a deploy state you have not checked.
2. **Add the `STRUCTURE.md` fleet row entry.** In the "Self-hosted 3D GPU fleet" row (around line 205), add `workers/model-triposplat/` to the bracketed list of fleet members, in the same style as its neighbors (one clause naming the model, its license, the Forge lane name, and its deploy status from task 1).
3. **Fix the hub-link false positive in `scripts/audit-docs.mjs`.** Add a narrow recognition rule for GitHub-web-route relative links inside `hubs/*/README.md` (the pattern is `(\.\.\/)*issues\/(new|...)` reached from a hub's own README; verify against all three flagged files plus any other hub README using the same convention, e.g. grep `hubs/*/README.md` for `issues/new` and `pulls/new`-style links first so the fix covers every instance, not just the three already flagged). Model the fix and its code comment on the existing `vendor`/`third_party` exclusion block (lines 61-75): explain that a hub is authored to become its own repo root, so its GitHub-route links resolve against a future downstream layout that does not exist in this filesystem. Scope the exclusion as tightly as the vendor one is scoped (by path prefix and by the specific link shape), so it cannot hide a genuine broken filesystem link inside a hub's other Markdown (e.g. its `CONTRIBUTING.md` or `data/schema.json` references must still be checked).
4. **Decide `docs/mcp-registry-sentinel.md`'s publish state.** Read the full doc and judge its audience the way order 402 task 4 judged `docs/grok.md` and the `ibm-community-*` posts: it documents a daily Cloud Scheduler cron that diffs our shipped MCP servers against the official registry and npm, callable manually with a `CRON_SECRET` bearer token. That reads as an operator runbook, not reader-facing product documentation (compare to `docs/ops/agent-index.md`, which stays unlisted for the same reason; `docs/agent-index.md`, a different, reader-facing doc about the product feature, is listed). If you judge it internal, add it to `UNPUBLISHED_DOCS` in `scripts/audit-docs.mjs` with a one-line reason in the style of the existing entries (e.g. `['mcp-registry-sentinel', 'internal: operator runbook for the MCP registry-diff cron, not a reader-facing product doc']`). If you judge it reader-facing instead, add the entry to `data/pages.json` following the exact schema of the neighboring `/docs/agent-index` entry (`path`, `title`, `description`, `added`: today's date). Either is a valid outcome; just make the decision and leave the check green.

## Definition of done

- [ ] `npm run check:claude` exits with no drift finding.
- [ ] `npm run audit:docs` reports zero findings (or only findings this order did not cause and did not claim to fix, which should not exist given the Step 0 measurement).
- [ ] `workers/model-triposplat/README.md` exists and documents the real, verified endpoint contract and deploy state.
- [ ] `STRUCTURE.md` lists `workers/model-triposplat/` in the GPU fleet row.
- [ ] `grep -n "issues/new" hubs/*/README.md` still shows the same three (or more, if others existed) links unchanged in the hub content, and `npm run audit:docs` no longer flags them.
- [ ] `docs/mcp-registry-sentinel.md` is either in `data/pages.json` or in `UNPUBLISHED_DOCS` with a dated reason; not neither.
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0.
- [ ] `git status --short` shows nothing left uncommitted from this order.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `gcloud` cannot authenticate to check the triposplat deploy state | Write "built and tested, deploy owner-gated" (the honest default state for an undeployed-but-complete worker), do not block the README on it. |
| Another hub README uses a different GitHub-route link shape (e.g. `pulls/new`, `compare`) you did not anticipate | Widen the recognition rule to cover it; the goal is zero false positives across every hub, not just the three named here. |
| `docs/mcp-registry-sentinel.md`'s audience is genuinely ambiguous | Default to `UNPUBLISHED_DOCS` (the safer, reversible choice: a doc can always be published later by moving one line) and say so in the report. |

## Report format

1. The three fixes, each with its file path and a one-line description of what changed.
2. Before/after output of `npm run check:claude` and `npm run audit:docs`.
3. The deploy-state check you ran for `model-triposplat` and what it returned.
4. The publish-state decision for `docs/mcp-registry-sentinel.md` and the one-line reason.
