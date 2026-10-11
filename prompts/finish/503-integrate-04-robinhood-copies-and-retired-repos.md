# integrate 04: settle the robinhood copies' direction and stage pointer READMEs for superseded repos

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; one gated step, named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: archiving or pushing to any GitHub repo is the owner's (gate 2), and this diff names Robinhood Chain projects (commit gate). Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Two kinds of drift confuse every reader of the owner's GitHub.

First, `robinhood/README.md` says the standalone `robinhood-chain-*` repos are the source of truth and the copies under `robinhood/` are "older snapshots". The copies have drifted badly (README differences of 12 to 684 lines; `hood-pay`, `hood-connect` and `erc8056` gained webhooks, wagmi/React and receipt-verification sections upstream), yet `workers/robinhood-feed/package.json` imports `file:../../robinhood/robinhood-chain-sdk`. Production code depends on a stale snapshot of a repo whose real source lives elsewhere. Two pairs are also duplicates of each other upstream (`robinhood-chain-alert-bot` and `robinhood-chain-alerts` are both titled `hood-alerts`; `robinhood-chain-traders` and `robinhood-chain-trading-bot` are both `hood-traders`). `contracts/paired-launchpad/README.md` claims "three.ws reads the address from PAIRED_LAUNCHPAD", but no code reads it.

Second, several repos are superseded by monorepo surfaces and still present themselves as live: `three-ui` says "Source of truth is github.com/nirholas/three-ui" and documents a Vercel deploy; `crypto-market-data`, `crypto-market-data-ts` and `crypto-data-aggregator` are superseded by `/markets`; `memescope-monday` and `memescope-monday-directory` duplicate each other and their site is down.

## Step 0: re-derive the current state

    cat robinhood/README.md | head -30
    ls robinhood/
    grep -rn "robinhood/" --include=package.json workers services packages api | head
    grep -rn "PAIRED_LAUNCHPAD" api src workers | head
    for p in robinhood/*/package.json; do node -e 'const p=require("./'$p'");console.log(p.name,p.version)'; done
    # then for each name: npm view <name> version

## Tasks

1. **Decide per copy, by measurement:** for each `robinhood/<x>`, compare its `package.json` version with npm and with the upstream HEAD tarball. If production code imports it (today: `robinhood-chain-sdk` via `workers/robinhood-feed`), replace the `file:` dependency with the published npm version pinned `^x.y.0`, and run the worker's tests. If nothing imports it, delete the copy and leave the link in `robinhood/README.md`. Record each decision in `data/standalone-mirrors.json` (order 500) with `direction: "in"` for anything kept.
2. **Fix the false `PAIRED_LAUNCHPAD` claim** in `contracts/paired-launchpad/README.md` so it says what the code actually does.
3. **Stage pointer READMEs** under `dist/retired-repos/<repo>/README.md` for `three-ui`, `crypto-market-data`, `crypto-market-data-ts`, `crypto-data-aggregator`, `memescope-monday-directory` (the duplicate), and one of each duplicate Robinhood pair: a short README naming where the capability lives now (a monorepo path or a three.ws page that returns 200), the date, and that the repo is archived. Print the owner's push and `gh repo archive` commands; run neither.
4. Update `robinhood/README.md` to describe the new arrangement truthfully.

## Definition of done

- [ ] `grep -rn '"file:../../robinhood' workers services packages` prints nothing, or each remaining hit is justified in `robinhood/README.md`.
- [ ] `npm test` passes in `workers/robinhood-feed` (or that worker's own test command).
- [ ] Every page or path a staged pointer README links returns 200 (`curl -s -o /dev/null -w '%{http_code}'`).
- [ ] `contracts/paired-launchpad/README.md` no longer claims code that does not exist.
- [ ] The owner message lists every push and archive command, one per line.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The npm version of a Robinhood package is older than the copy | Keep the copy, mark it `direction: "in"`, and note the newer local changes; do not publish. |
| Deleting a copy loses unique local commits | Check `git log -- robinhood/<x>` first; if anything there is not upstream, keep the copy and list it. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/503-integrate-04-robinhood-copies-and-retired-repos.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
