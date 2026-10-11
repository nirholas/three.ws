# integrate 40: funding-source, holder concentration and v1-launch signals in coin intel

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

Coin intel (`api/pump/token-stats.js`, `pages/coin-intel.html`) shows holders but not two things the owner's `atomic` toolkit computes and buyers care about: whether a coin's early wallets were seeded from one funder (`detectSeededByPump`) and how concentrated holdings are (Gini coefficient). Two v1 concepts (`v1-trench-radar`, `txv1-observatory`) add a third: whether the coin's creation transaction used transaction v1, a cheap signal of launch sophistication.

## Step 0: re-derive the current state

    sed -n 1,60p api/pump/token-stats.js
    grep -n "gini\|funder" -ri api/pump api/_lib/oracle | head

Read upstream `atomic` `analyze-holders` and `detectSeededByPump`.

## Tasks

1. Gini over the top-N holders (excluding the bonding curve and known program accounts) in `token-stats.js`.
2. Funding-source check: for the first K buyers, trace first funders (reuse order 513's signal if shipped) and report the share seeded by a single funder.
3. Record the creation transaction's version via `inspectWireTransaction` and show a "v1 launch" chip.
4. Feed Gini and seeded share into the oracle as features.
5. Docs and changelog.

## Definition of done

- [ ] Unit tests with $THREE or synthetic fixtures for each signal.
- [ ] `curl -s 'localhost:3000/api/pump/token-stats?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'` includes the new fields.
- [ ] The coin intel page shows them, browser-verified; docs and changelog.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Funder tracing is slow | Bound it, cache per mint for an hour, and return `partial: true` when the budget runs out. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/539-integrate-40-coin-intel-signals.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
