# integrate 11: reconciled per-coin creator earnings from the coin timeline

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; one gated step, named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: the diff names pump.fun endpoints (commit gate). Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Order 015 (parity 01) builds per-agent creator earnings from pump.fun fee totals. The owner's `pumpfun-creator-rewards` repo has a stronger source for the per-coin number: it sums the `distribution` events in `swap-api.pump.fun/v1/coins/<mint>/timeline`, pages `fee-sharing/account/<wallet>/shares`, and reconciles the two so the displayed figure carries its own audit. `api/_lib/pump-creator-fees.js` only has per-wallet totals and nothing here calls either endpoint. This order makes the per-coin figure reconciled and gives the snapshot from 015 a second, independent source.

## Step 0: re-derive the current state

    ls prompts/finish/015-parity-01-creator-earnings.md 2>/dev/null && echo "015 still open"
    ls api/_lib/creator-earnings-snapshot.js api/_lib/agent-earnings.js
    grep -n "timeline\|fee-sharing" api/_lib/pump-creator-fees.js api/pump/launch-detail.js | head
    curl -s "https://swap-api.pump.fun/v1/coins/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump/timeline" | head -c 500

If 015 is still open, run it first; this order extends its snapshot rather than building a parallel one.

## Tasks

1. Port `fetchCoinEarnings`, `fetchAllShares` and the reconciliation from upstream `lib/pump.js` into `api/_lib/pump-creator-fees.js`, behind the existing circuit breaker used by `launch-detail.js` (do not add a second client).
2. Feed the per-coin snapshot (from 015, in `api/_lib/creator-earnings-snapshot.js`) from the timeline sum, and store the reconciliation delta and its source.
3. Show "this coin paid X SOL" with the reconciliation note on `/launches/<mint>` (`src/launch-detail.js`) and in the agent earnings card.
4. Docs: the `method` string in the earnings API names both sources.

## Definition of done

- [ ] `tests/pump-creator-fees.test.js` gains cases for timeline summing, share paging and reconciliation against recorded $THREE responses.
- [ ] `curl -s 'localhost:3000/api/pump/launch-detail?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'` shows the per-coin figure with its reconciliation.
- [ ] UI verified at three widths, zero console errors; docs and changelog updated.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The timeline endpoint is down | The breaker serves the last snapshot with `refreshed_at`; never invent a number. |
| The two sources disagree by more than 1% | Show both and the delta; that disagreement is the feature, not a bug. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/510-integrate-11-per-coin-earnings-source.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
