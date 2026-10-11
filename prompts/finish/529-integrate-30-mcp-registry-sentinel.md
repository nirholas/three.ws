# integrate 30: a daily sentinel that diffs our MCP servers against the official registry and npm

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; one gated step, named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: the cron deploys with the next owner-approved deploy. Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

We publish dozens of MCP servers, but we only look at the official registry on demand (`scripts/three-ws-presence.mjs`, `prompts/store-submissions/_generated/build-registry-republish.mjs`). Measured 2026-10-08: the registry holds 77 latest names under `io.github.nirholas` while the repo has 45 local `server.json`; `solana-memo-media-mcp` is not published; `claude-code-explorer-mcp` points at a repository that is now a DMCA notice. The owner's `mcp-notify` polls and diffs the registry; its idea ports to one cron.

## Step 0: re-derive the current state

    find . -name server.json -not -path "*/node_modules/*" | wc -l
    curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.nirholas&limit=100" | head -c 600
    sed -n 1,40p api/cron/x402-directory-registrar.js
    grep -n "sendOpsAlert" api/_lib/alerts.js | head -2

## Tasks

1. `api/cron/mcp-registry-sentinel.js` modeled on `api/cron/x402-directory-registrar.js`: read every local `server.json` and hosted remote at runtime, fetch the registry's latest entries for our namespace and npm latest versions, and compute: unpublished, behind (local version newer), repository URL mismatch, registry-only names we do not track.
2. Alert through `sendOpsAlert` only on change since the last run (state in `app_settings` or the pattern neighbours use).
3. Register in `vercel.json` `crons`; run `npm run check:claude` (it checks the cron count).
4. Docs: the ops page for MCP publishing.

## Definition of done

- [ ] A vitest against a fixture registry response covers each finding type.
- [ ] Calling the route locally with cron auth lists `solana-memo-media-mcp` as unpublished (or shows it fixed).
- [ ] `npm run check:claude` passes; docs updated.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The registry API paginates by cursor | Follow `metadata.next_cursor` until empty. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/529-integrate-30-mcp-registry-sentinel.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
