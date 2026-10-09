# integrate 48: read-only Robinhood Chain tools in the hosted MCP

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; one gated step, named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: the diff names Robinhood Chain projects (commit gate). Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

We ship a Robinhood Chain surface (`/markets/robinhood`, `api/v1/robinhood/*` over `api/_lib/robinhood.js`) and the owner built `robinhood-chain-mcp`, but the hosted MCP in `api/_mcp/tools/` has no Robinhood tools at all. Agents connected to three.ws can read Solana and pump.fun, not the chain the owner invested a whole campaign in. Solana tools already exist, so this is purely additive and read-only.

## Step 0: re-derive the current state

    ls api/_mcp/tools/ && grep -n "robinhood" api/_mcp/catalog.js
    ls api/v1/robinhood/
    grep -n "export async function" api/_lib/robinhood.js | head -20

## Tasks

1. `api/_mcp/tools/robinhood.js`: chain stats, token prices, recent launches, wallet holdings, all backed by `api/_lib/robinhood.js` (no new RPC client), all `readOnlyHint: true`.
2. Register in `api/_mcp/catalog.js`; update the golden fixture and safety audit.
3. Docs: `docs/mcp.md`.

## Definition of done

- [ ] `tools/list` shows them; `tools/call` returns a live 4663 block number and live prices in dev.
- [ ] `npx vitest run tests/mcp-catalog.test.js tests/api/v1-robinhood.test.js` passes; `npm run audit:mcp-safety` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The chain RPC is slow | Use the failover list already in `api/_lib/robinhood.js`. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/547-integrate-48-robinhood-mcp-tools.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
