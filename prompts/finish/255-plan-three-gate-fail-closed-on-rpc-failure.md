# The $THREE balance gate fails closed when the RPC is down instead of waving everyone through

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/255-plan-three-gate-fail-closed-on-rpc-failure.md`.

**Priority:** P0, live defect, security, or broken money rail (score 85 of 100 inside the tier). **Area:** three-token. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`checkThreeBalance` in `api/_lib/three-gate.js` returns `eligible: true` whenever the Solana RPC call throws ("RPC failure -> fail open"). Two production paths trust it: the paid-skill executor in `api/agents/x402/[action].js` (an agent owner who sets `meta.three_gate.enabled` expects only holders to run the skill) and the public `GET /api/pump/check-three-balance`. Any caller with a zero balance therefore passes the gate whenever the RPC lanes are unhealthy, and `/api/healthz` reported `rpc_lanes: degraded, all paid lanes exhausted` on 2026-11-03. The skill executor also wraps the call in a bare `catch { /* fail open */ }`. This is an access-control bypass on a live path, so it is P0. The newer tier-pass path (`api/_lib/three-tier.js`) already fails closed to Member; this older path is the documented bypass (three-thesis risk 11).

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/three-gate.js` lines 48-51: `catch { return { wallet, balance: 0, min: minNum, eligible: true }; }`. The file header says "Never throws - returns eligible:true on infra failure so the gate fails open."
- `api/agents/x402/[action].js` around line 220-240: gate call wrapped in `try { ... } catch { /* fail open so callers aren't blocked by infra */ }`.
- `api/pump/check-three-balance.js` returns the helper result verbatim, so an outage answers `eligible: true` with `balance: 0`.
- Only existing test: `tests/three-gate.test.js`, which covers the browser `<three-gate>` element, not this server helper. No server-side test of `checkThreeBalance` exists.
- Cached results (Redis, 30 s TTL) are written only after a successful read, which is correct and must stay that way.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "fail open\|eligible: true" api/_lib/three-gate.js 'api/agents/x402/[action].js' api/pump/check-three-balance.js
grep -rn "checkThreeBalance" api src scripts tests --include=*.js --include=*.mjs
ls tests | grep -i 'three-gate\|check-three-balance'
curl -s "https://three.ws/api/pump/check-three-balance?wallet=11111111111111111111111111111111&min=1"
```

If the helper already distinguishes "RPC unavailable" from "not eligible" and the skill path no longer swallows the error, skip to the verification tasks.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. Create `tests/api/three-gate-server.test.js` (beside the other `tests/api/*.test.js`). Mock only the network boundary: `vi.mock('../../api/_lib/agent-pumpfun.js')` so `solanaConnection().getParsedTokenAccountsByOwner` rejects, and `vi.mock('../../api/_lib/redis.js')` to return null. Assert the CURRENT behavior is wrong: a wallet with an RPC failure gets `eligible: true`. Run it and confirm the failing assertion is the one for "RPC failure must not be eligible", not a setup error.
2. Change `checkThreeBalance` to return a third state on infra failure: `{ wallet, balance: null, min, eligible: false, unavailable: true, reason: 'rpc_unavailable' }`. Never cache an unavailable result. Update the header comment to describe fail-closed behavior.
3. Because `solanaConnection('mainnet')` is a single lane, retry once on the next healthy lane before declaring unavailable (use the existing failover helper in `api/_lib/agent-pumpfun.js` or the RPC lane rotation in `api/_lib/rpc*.js`; do not invent a second rotation).
4. `api/pump/check-three-balance.js`: when `unavailable` is true answer `503` with `error: 'rpc_unavailable'`, `Retry-After: 5`, and a body that does NOT include `eligible`. Keep the 200 shape unchanged for real reads.
5. `api/agents/x402/[action].js`: remove the bare catch. On `unavailable` or a thrown error, answer `503 three_gate_unavailable` with `retry: true`, and make sure the paid intent is NOT consumed (the surrounding code already leaves it unconsumed on gate failure; add a test that proves it). A real `eligible: false` still answers the existing `402 insufficient_three_balance`.
6. Extend the new test file: RPC ok + balance below min -> not eligible and cached; RPC ok + balance above min -> eligible; RPC rejects twice -> `unavailable`, not cached, endpoint 503; skill executor path with a gated agent and failing RPC -> 503 and intent still `paid`.
7. Update `docs/hold-to-access.md` (the sections that describe the older gate) and the "fail-open path exists" risk row in `docs/three-thesis.md` section 14 so they state the path now fails closed. Add a `data/changelog.json` entry (type fix) and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/api/three-gate-server.test.js` passes, and the RPC-failure case failed before the fix for the stated reason.
- [ ] `grep -n "fail open" api/_lib/three-gate.js 'api/agents/x402/[action].js'` prints nothing.
- [ ] A gated-agent skill call with the RPC mocked down returns 503 `three_gate_unavailable` and leaves the intent unconsumed (asserted in the test).
- [ ] `curl` of `/api/pump/check-three-balance` for a real holder wallet still returns `eligible: true` with a numeric balance (checked against production after deploy, or against `npm run dev`).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Fail-closed will block real holders during an outage | That is the intent for a paid gate. The 503 carries `retry: true`; tell the owner in one report line. Do not add a new fail-open fallback. |
| Cannot reach mainnet RPC from the sandbox | The tests mock the connection; for the live check use `curl` against `https://three.ws` read-only. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/255-plan-three-gate-fail-closed-on-rpc-failure.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `255-plan-three-gate-fail-closed-on-rpc-failure.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/hold-to-access.md` (section "Activation roadmap")

~~~~markdown
## Activation roadmap

Goal: **drive $THREE demand** by activating registered-but-dormant perks. A perk is only
worth gating when its backend genuinely exists - wiring a gate onto a missing feature
would be a fake perk, exactly what `enforced` guards against.

Priority order by demand value × backend readiness:

1. **`worlds.private` (Silver)** - strongest *standing-hold* lever: a persistent private
   space you keep only while you hold Silver. Backend closest to ready. **Spec below.**
2. **`names.first_dibs` (Genesis)** - window-gate the `*.threews.sol` auction so Genesis
   holders get a head start. SNS backend exists ([`api/sns.js`](../api/sns.js)).
3. **`drops.early` (Gold)** - time-gate the existing drop endpoints
   ([`api/irl/drops.js`](../api/irl/drops.js), [`api/vanity/drops.js`](../api/vanity/drops.js))
   so Gold holders enter the window early.
4. **`mcp.priority`, `worlds.branded`** - deferred: no backend (shared MCP queue / custom
   environments) exists to gate. Build the feature first, then the gate.

Each activation is the same shape: add the gate call, flip `enforced: true`, add a gate
test mirroring `tests/forge-high-gate.test.js`, add a changelog entry. Nothing else
changes - the access endpoint and `/three` pick it up automatically.

---
~~~~

