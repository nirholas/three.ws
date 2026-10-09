# integrate 43: bring 3D-AR-Studio's source into the monorepo so the npm package and the in-app studio stop drifting

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; one gated step, named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: publishing the package and pushing the mirror are the owner's (gate 2). Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

npm ships `3d-ar-studio@0.3.1` and `3d-ar-studio-mcp`, but their source lives only in the standalone `3D-AR-Studio` repo, while the in-app studio lives in `src/ar-studio.js` and `src/ar/*` (about 5,000 lines) behind `/ar/studio`. Two copies of the same product drift independently, and fixes land in one or the other.

## Step 0: re-derive the current state

    wc -l src/ar-studio.js src/ar/*.js | tail -1
    npm view 3d-ar-studio version
    grep -n "ar-studio\|ar/studio" STRUCTURE.md docs/ar-studio.md | head

Fetch `3D-AR-Studio` and diff its core modules against `src/ar/`.

## Tasks

1. Import the standalone source into `packages/ar-studio` (README, license, tests), reconciling with `src/ar/*`: one implementation, the better version of each module.
2. Switch `pages/ar-studio.html` to import the package's core modules.
3. Add the package to `data/standalone-mirrors.json` (order 500) mapping to `3D-AR-Studio`.
4. `STRUCTURE.md` row and `docs/ar-studio.md` updated.

## Definition of done

- [ ] `npm test` passes; `npm pack --dry-run` in the package succeeds.
- [ ] `/ar/studio` browser-verified on desktop and a mobile viewport, zero console errors.
- [ ] Publish and push commands in the owner message.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The two implementations conflict in behaviour | Keep the in-app behaviour users already have unless the standalone one fixes a bug; list each choice. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/542-integrate-43-ar-studio-source.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
