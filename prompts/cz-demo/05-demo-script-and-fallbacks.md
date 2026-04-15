# Task 05 — Live demo runbook + fallbacks

## Why this exists

The CZ demo is a live event. Everything can fail — RPC flaps, the venue wifi, MetaMask popup blockers, a frozen GLB load, an iframe origin check misconfigured at the last minute. This task produces the runbook that keeps the demo on rails, and a kill-switch set of fallbacks that look like the real thing even when nothing live works.

## What to build

### 1. `docs/cz-demo-runbook.md`

Sections:

**Pre-flight checklist (T-24h)**
- [ ] `scripts/cz-demo/register-onchain.mjs` has been run; `agentId` in `.state.json`.
- [ ] Basescan confirms `AgentRegistered` event exists for that agentId.
- [ ] `/cz` loads on the staging URL; avatar renders; camera orbits.
- [ ] `GET /api/cz/identity` returns the expected JSON.
- [ ] CZ's wallet address has > 0.01 testnet ETH on Base Sepolia. Fund from faucet if not.
- [ ] LobeHub fork build with the patch from task 04 is deployed and reachable.
- [ ] Service-worker cache populated (see fallback 3 below).
- [ ] IPFS gateway timing check — `cat ipfs://{cid}` in < 3s from the demo venue.
- [ ] Backup RPC endpoint saved in env: primary Base Sepolia public RPC, secondary Alchemy / Infura.
- [ ] `window.VIEWER.agent_protocol.history` shows clean boot (no errors) on `/cz`.

**Pre-flight checklist (T-1h)**
- [ ] Fresh browser profile, MetaMask imported from CZ's seed (or hardware wallet plugged in).
- [ ] DNS cached for the demo origin (`nslookup` twice).
- [ ] Phone on hotspot ready if venue wifi dies.
- [ ] `/cz` preloaded in browser; `/lobehub` preloaded in browser.
- [ ] One dry-run through the full flow with a throwaway wallet. Reset state.

**Demo sequence (talk track + clicks)**

1. Open `/cz` — pause on the tagline.
2. "This is an onchain agent. Let me show you its passport." — click the address chip, Basescan opens.
3. Back to `/cz`. "CZ, can you claim this?" — hand over.
4. CZ clicks Claim, signs in MetaMask. Confetti.
5. "Now watch — same agent, in LobeHub." — open LobeHub tab. Agent is in sidebar.
6. CZ types: "Hello". Avatar waves + smiles. Empathy Layer visible.
7. Close.

**Failure modes + response**

| Symptom | Likely cause | Response |
|---|---|---|
| Avatar never renders | GLB 404 or CORS | Fallback 1 |
| Claim tx pending > 45s | RPC congestion | Continue talking; fallback 2 if > 2 min |
| MetaMask doesn't pop | Popup blocker | Click wallet icon directly |
| LobeHub iframe blank | `postMessage` origin mismatch | Fallback 3 |
| IPFS gateway fetch slow | ipfs.io rate limit | Switch to `dweb.link` via URL fragment |

### 2. Fallback 1 — "demo mode" static build

Create `public/cz/demo.html` — a **self-contained** page with zero network calls after initial load:
- GLB bundled as a blob URL (read at build-time from `public/avatars/cz.glb`).
- No `/api/agents/me`, no `/api/cz/identity` — all identity data baked into the HTML.
- Fake claim flow: clicking "Claim" plays the confetti + flips the UI after a 1.5s delay; no MetaMask call.
- Used only if the live flow breaks on stage. Visually identical to `/cz`.

### 3. Fallback 2 — pre-mined claim tx

Have a sacrificial pre-mined claim transaction ready — the agent is pre-claimed by CZ's wallet already, and the "Claim" button is a theatrical no-op that plays the confetti and the UI flip. Only switch to this mode if the live tx is failing; disclose honestly if asked.

**Implementation:** a URL param `/cz?rehearsal=1` that turns `window.claimAgent()` into the theatrical version. Inspect the URL param in `public/cz/claim.js` from task 03; if `rehearsal=1`, skip the real tx.

### 4. Fallback 3 — service-worker warm cache

`public/cz/sw.js` — pre-caches:
- `/avatars/cz.glb`
- `/animations/*.glb`
- `/dist-lib/agent-3d.js`
- `/api/cz/identity` (if GET, stale-while-revalidate)

Register on `/cz` page load. Serve from cache when offline. Document that 5s of zero-internet during the demo is safe once cached.

### 5. Operator one-liner

`scripts/cz-demo/preflight.sh`:
```bash
#!/usr/bin/env bash
set -e
curl -sf https://3d.irish/cz > /dev/null && echo "✓ /cz reachable"
curl -sf https://3d.irish/api/cz/identity | jq .agentId
curl -sf https://basescan.io/api?module=... # fetch registration event
echo "Preflight complete"
```

## Files you own

- Create: `docs/cz-demo-runbook.md`, `public/cz/demo.html`, `public/cz/sw.js`, `scripts/cz-demo/preflight.sh`
- Edit: `public/cz/claim.js` (rehearsal-mode branch — *only* this branch; do not restructure), `public/cz/index.html` (one `<script>` line to register the SW)

## Files off-limits

- `public/agent/*` — not for this task
- Anything under `api/*` — should already be shipped by earlier tasks

## Acceptance test

1. Run `scripts/cz-demo/preflight.sh` — all green.
2. Disconnect wifi after loading `/cz`. Reload. Page still renders from SW cache.
3. Open `/cz?rehearsal=1`. Click claim — confetti + UI flip, no tx dispatched. Confirm via Network tab.
4. Open `public/cz/demo.html` with DevTools Network throttled to offline from the first request. Renders fully.
5. Dry-run the demo sequence from the runbook with a stopwatch. Total time under 3 minutes.

## Reporting

Report: runbook page count, SW cache manifest (files cached), dry-run time, exact failure modes tested, which fallback actually shipped (and whether it was needed).
