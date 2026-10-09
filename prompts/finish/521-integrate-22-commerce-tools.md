# integrate 22: named commerce tools and a spending report in the x402 MCP buyer

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; one gated step, named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: a live paid tool call is stop-and-ask; tool listing and dry runs are not. Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Our MCP buyers (`packages/x402-mcp`, `mcp-bridge`, hosted `pay_and_call`) are generic: give them a URL and they pay it. The owner's `x402-mcp-commerce` shows why named tools matter: a model picks `weather_go_no_go` or `domain_check` far more reliably than it composes a raw paid URL, and a `spending_report` tool lets the human ask what the agent spent. Once order 516 lands the keyless services, named tools make them usable.

## Step 0: re-derive the current state

    ls packages/x402-mcp/src && sed -n 1,60p packages/x402-mcp/src/index.js
    grep -n "pay_and_call" -r api/_mcpagent | head
    ls api/_mcpagent/dispatch.js

## Tasks

1. A `tools.json`-driven registry in `packages/x402-mcp`: each named tool maps to a paid endpoint, an input schema and a price ceiling. Ship entries for every service order 516 added (and only real, live endpoints).
2. `spending_report` tool: totals by merchant and day from the buyer's ledger.
3. Mirror the registry in the hosted agent dispatcher (`api/_mcpagent/dispatch.js`) so hosted and stdio agree.
4. Safety annotations: paid tools are `openWorldHint: true` and their descriptions state the price.

## Definition of done

- [ ] `node --test` in `packages/x402-mcp` lists every named tool and validates schemas without paying.
- [ ] A dry run (the package's existing no-pay or quote mode) returns the price for each tool.
- [ ] README and `docs/mcp.md` updated; changelog.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Order 516 has not shipped | Build the registry with the existing paid three.ws endpoints; the format is what matters. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/521-integrate-22-commerce-tools.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
