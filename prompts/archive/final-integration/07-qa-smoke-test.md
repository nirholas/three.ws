# 07 — End-to-End QA Smoke Test + Polish

## Context

Six sibling prompts just landed: embed bridges, idle animation, agent-home integration, discover page, LobeHub plugin, camera capture resolution. The codebase is nominally complete. The gap between "nominally complete" and "ships" is a disciplined QA pass that exercises every user-visible flow end-to-end and files or fixes the defects found.

This prompt is **the final pass**. It produces a public record of what works and what doesn't, fixes any small defects (one-line patches, copy tweaks, z-index bugs), and lists the remaining issues that deserve their own follow-up prompts.

## Goal

Exercise every critical user flow in a real browser, produce a `docs/SMOKE_TEST.md` report, and apply small fixes that keep the smoke-test 100% green. Large defects get escalated (not fixed here).

## Files you own

Create:

- `docs/SMOKE_TEST.md` — the living smoke-test document.

Edit (surgical only — the **one-line patch rule**):

- Any file in the repo for fixes ≤ 10 lines of change. Each fix must be:
    - Clearly defect-driven (not a refactor, not a "while I'm here").
    - Accompanied by a note in `SMOKE_TEST.md` citing which flow step surfaced it.
    - Kept to the minimum change that makes the flow pass.

Do NOT:

- Add features.
- Rename things.
- Touch shared-file anchors owned by sibling prompts (`EMBED_BRIDGES`, `IDLE_LOOP`, `AGENT_HOME_ORPHANS`, `DISCOVER_LINK`). If the smoke test reveals a bug inside one of those anchors, file it in `SMOKE_TEST.md` as a follow-up and do not touch the code.
- Modify contract ABIs or deployed addresses.

## Flows to exercise

Run each flow in the dev server (`npm run dev`) against a real browser. Chrome/Edge + Firefox minimum; Safari if the host has one. For each step, record PASS / FAIL / BLOCKED with a short note.

### Flow A — First-time wallet sign-in

1. Open `http://localhost:3000/` in a private window.
2. Click sign-in with wallet button.
3. Complete SIWE flow with a fresh wallet (MetaMask or WalletConnect).
4. Land on dashboard.

### Flow B — Selfie → agent

1. From dashboard, click "Create agent".
2. Grant camera permission.
3. Capture a selfie.
4. Progress UI advances through Avaturn pipeline.
5. Generated avatar appears with default name/description.
6. Save; land on `/agent/<id>`.

### Flow C — Edit + save-back

1. On any owned agent's `/agent/<id>/edit`, open the editor.
2. Change a material color.
3. Click save.
4. Reload the page. Change persists.
5. Check `/api/avatars/<id>/versions` returns ≥ 2 rows.

### Flow D — Share + embed

1. On `/agent/<id>`, click Share.
2. Copy the iframe snippet. Paste into a local scratch HTML file; open it.
3. Agent renders correctly in the iframe.
4. Open browser devtools → Network → confirm no CORS errors.

### Flow E — Embed bridge round-trip

1. Load the scratch HTML from Flow D. Open devtools → Console on the parent page.
2. Run:
    ```js
    const iframe = document.querySelector('iframe');
    iframe.contentWindow.postMessage(
    	{
    		v: 1,
    		source: 'agent-host',
    		id: crypto.randomUUID(),
    		kind: 'request',
    		op: 'ping',
    	},
    	'*',
    );
    ```
3. Expect a `pong` event in the console (install a temporary `window.addEventListener('message', …)` to see it).
4. Try `op: 'speak', payload: { text: 'Hello world' }` — avatar should visibly speak.

### Flow F — Idle loop

1. On `/agent/<id>`, watch the avatar for 10 seconds without interacting.
2. Observe: blinks occur, subtle head drift, no jank.
3. Open the Performance tab; record 5 seconds. Average frame time < 16.7ms.

### Flow G — Discover page

1. Sign in with a wallet that owns on-chain agents (or a test wallet pre-seeded on Base Sepolia).
2. Visit `/discover`.
3. Discovered agents render as cards.
4. Click Import on one.
5. Card transitions to "Already in library".
6. Click through → `/agent/<new-id>` renders.

### Flow H — Deploy on-chain

1. As the agent owner, open `/agent/<id>`.
2. Deploy chip visible.
3. Click Deploy.
4. Wallet prompts for tx signature on the correct chain.
5. After tx mines, chip transitions to on-chain success state without page reload.
6. `api/agents/by-address/<wallet>` returns the new agent.

### Flow I — LobeHub plugin dev harness

1. `cd lobehub-plugin && npm install && npm run build`.
2. Open `lobehub-plugin/dev/index.html` via `python3 -m http.server 5555`.
3. Inject a fake assistant message.
4. Avatar in the iframe visibly speaks.

### Flow J — Dashboard sidebar pages

1. From `/dashboard/`, navigate to: Avatars, Agents, Sessions, Wallets, Actions, Reputation.
2. Every sidebar page loads without console errors.
3. Each page fetches and displays real data (or a correct empty state).

### Flow K — Logout + session revocation

1. From `/dashboard/sessions.html`, click "Sign out all devices".
2. Refresh; land on sign-in.
3. `/api/auth/me` returns 401.

### Flow L — Mobile layout smoke

1. Chrome devtools → device toolbar → iPhone SE (360×667).
2. Visit homepage, `/agent/<id>`, `/discover`, `/dashboard/`.
3. No horizontal scroll, no overlapping elements, all CTAs tappable.

## `docs/SMOKE_TEST.md` structure

```markdown
# three.ws — Smoke Test Report

**Run date:** YYYY-MM-DD
**Commit:** <git sha>
**Browsers:** <list>
**Dev server:** npm run dev (port 3000)

## Summary

| Flow               | Result            | Notes |
| ------------------ | ----------------- | ----- |
| A. Wallet sign-in  | PASS/FAIL/BLOCKED | …     |
| B. Selfie → agent  | …                 | …     |
| … (every flow A–L) |

## Defects fixed in this pass

- [ ] <short description> — file:line — 1-line summary of fix.

## Defects NOT fixed (follow-up prompts recommended)

- [ ] <short description> — file:line — why escalated (out of scope, > 10 LOC, touches sibling anchor, etc.).

## Environment notes

<Anything about test wallets, seeded chain state, or setup that the next runner needs.>
```

Keep the doc evergreen — future QA passes append to the same file rather than rewriting.

## One-line-patch rule

A fix qualifies as in-scope if ALL of:

- ≤ 10 lines changed in one file.
- No new files added (except `SMOKE_TEST.md` itself).
- No anchor-owned block touched.
- Clearly defect-driven (copy typo, z-index, missing `aria-label`, broken link, stale import).

Everything bigger is escalated in the `Defects NOT fixed` list for a future prompt.

## Deliverables checklist

- [ ] `docs/SMOKE_TEST.md` created with every flow's result.
- [ ] Every fixed defect listed and diff-linked in the "fixed" section.
- [ ] Every escalated defect listed in the "not fixed" section with rationale.
- [ ] Prettier pass on touched files.
- [ ] `npm run build` succeeds.
- [ ] `npm run verify` (the project's canonical check) succeeds.

## Acceptance

- Smoke test covers all 12 flows (A–L).
- `docs/SMOKE_TEST.md` is in the committed tree.
- Repo at HEAD passes `npm run verify` with zero warnings.

## Report + archive

Post the full smoke-test summary table (flow pass/fail) inline in your final message. Then:

```bash
git mv prompts/final-integration/07-qa-smoke-test.md prompts/archive/final-integration/07-qa-smoke-test.md
```

Commit: `chore(qa): end-to-end smoke test + surgical fixes`.

## After this prompt completes

If any flow is FAIL or BLOCKED and escalated to "not fixed", write a tiny follow-up prompt in `prompts/final-integration/` named `08-followup-<short-slug>.md` describing the defect and the smallest-possible fix. That restarts the loop at 95%+ completion with a concrete punch list.
