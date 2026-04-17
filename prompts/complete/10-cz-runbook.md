# 10 — CZ demo runbook + fallback kit

## Why

[prompts/cz-demo/05-demo-script-and-fallbacks.md](../cz-demo/05-demo-script-and-fallbacks.md) describes a runbook that doesn't exist yet. This prompt ships **only the runbook + offline fallback kit** — documentation and shell-level tooling. No UI code. No on-chain broadcast.

When the operator demos the product, they follow this runbook. When the internet dies mid-demo, the fallback kit keeps the show running.

## What to build

### 1. The runbook

Create `docs/CZ_DEMO_RUNBOOK.md` with sections:

- **T-24h**: what to verify (all `prompts/complete/*` merged, staging URL up, wallet seeded with gas on Base Sepolia, IPFS pin healthy).
- **T-1h**: health-check script (`scripts/cz-demo/runbook.sh check`) runs, outputs pass/fail per item.
- **Demo sequence**: 9-step walk-through with exact clicks, spoken script, and expected screen state. Time each step. Total ≤ 5 minutes.
- **Fallbacks**: what to do if the chain is slow (pre-recorded tx video); if IPFS is slow (local-pin fallback); if LobeHub breaks (switch to our hosted iframe); if wallet fails (pre-connected Privy session).
- **Recovery**: how to bail gracefully — one slide, one message, no scrambling.
- **Post-demo**: what to capture (tx hashes, agentId, Q&A, gotchas). Where to file it.

### 2. Health-check script

Create `scripts/cz-demo/runbook.sh`:

```bash
#!/usr/bin/env bash
# Usage: scripts/cz-demo/runbook.sh {check|warm|stop}

check   # curls /api/health, /api/agents/cz, /cz/state.json, verifies tx on chain
warm    # hits all demo URLs to warm caches
stop    # disables public traffic (sets a feature flag or similar) — stub for now
```

Exit code 0 = all good, non-zero = at least one fail. Log output in human-readable form, no JSON noise.

### 3. Offline fallback kit

Create `public/cz/offline/index.html` — a single page that works with no network:

- Embeds `/avatars/cz.glb` (already in repo, served from origin).
- Shows a pre-rendered "claim successful" state (static screenshot as fallback `<img>`).
- Loop of 30-second pre-recorded interaction video (use an existing asset if one exists; otherwise note in reporting that a video asset is needed).

The operator can open `/cz/offline/` if the live demo fails and still look competent.

### 4. Failure rehearsal checklist

Create `docs/CZ_DEMO_FAILURE_MODES.md` — a table of every conceivable failure, the symptom, the recovery path, the time cost. Filled with at least 10 rows.

## Files you own

- Create: `docs/CZ_DEMO_RUNBOOK.md`
- Create: `docs/CZ_DEMO_FAILURE_MODES.md`
- Create: `scripts/cz-demo/runbook.sh`
- Create: `public/cz/offline/index.html`
- Create: `public/cz/offline/README.md`

## Files off-limits

- `public/cz/index.html`, `public/cz/state.json`, `public/cz/boot.js`, `src/cz-flow.js` — those are prompt 09's files. Read them if they exist, but don't edit.
- `prompts/cz-demo/*` — read-only.
- Everything else in `public/`, `src/`, `api/` — off-limits.

## Acceptance

- `bash scripts/cz-demo/runbook.sh check` runs (may exit non-zero if real env not set up; exit behavior documented).
- `docs/CZ_DEMO_RUNBOOK.md` exists, every step has expected-screen + spoken-script.
- `public/cz/offline/index.html` renders the avatar at `/cz/offline/` with zero network calls to third parties (served from origin only).
- `chmod +x` set on `runbook.sh`.

## Reporting

Runbook step count + total estimated demo time, failure modes table row count, whether pre-recorded assets (video / screenshots) exist or are TBD, known runbook gaps that need a live rehearsal to refine.
