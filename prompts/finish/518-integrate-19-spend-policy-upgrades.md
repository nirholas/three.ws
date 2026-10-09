# integrate 19: approval thresholds, host denylists, per-rail caps and signed verdicts in the spend policy

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order is not expected to hit one. Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Our spend enforcement is strong where it matters (atomic in SQL and Redis: `api/_lib/pay/policy.js`, `api/_lib/pay/spend-governor.js`, `api/_lib/agent-trade-guards.js`, `x402-spending-cap.js`), but the owner's `x402-agent-wallet` has four ideas we lack: an approval threshold (above X, a human must approve), a merchant denylist, per-rail daily caps (Solana and Base budgets separate), and HMAC-signed verdicts tied to a `policyDigest` so any decision can be audited against the exact policy that made it. Its file-backed ledger is weaker than ours; the ideas port, the storage does not.

## Step 0: re-derive the current state

    sed -n 1,80p api/_lib/pay/policy.js
    sed -n 1,60p api/_lib/pay/spend-governor.js
    sed -n 1,60p api/pay/simulate.js
    npx vitest run tests/payment-session-governor.test.js tests/solana-trade-guards.test.js

## Tasks

1. Extend the policy schema with `approval_threshold_usd`, `blocked_hosts`, and `per_rail_daily_usd` (keyed by CAIP-2 network). Migration if the policy is stored in a table.
2. Enforce them in `spend-governor.js` atomically with the existing budget checks. An above-threshold call returns a distinct `requires_approval` verdict (order 519 builds the approval flow on it).
3. **Signed verdicts**: every verdict carries `policy_digest` (SHA-256 of the canonical policy) and an HMAC over `{verdict, digest, request hash, timestamp}` with a server key from env. Store it with the execution.
4. Keep `evaluateCall` and `replay` in `api/pay/simulate.js` in parity, so a simulated verdict and an enforced one cannot disagree; add a test that runs both over the same cases.
5. Policy editor UI on the payments page gains the new fields with validation.

## Definition of done

- [ ] Extended governor and guard tests pass, including a parity test between simulate and enforce.
- [ ] A verdict's HMAC verifies against its stored digest in a test; tampering with the policy breaks it.
- [ ] The UI fields browser-verified; docs and changelog updated.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No HMAC key exists in env | Add `PAY_VERDICT_HMAC_KEY` wired end to end, generate a dev value in `.env.local`, and list the production var in the report. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/518-integrate-19-spend-policy-upgrades.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
