# integrate 12: prepare a launch from any MCP client and hand off to /launch for signing

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; one gated step, named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: the user signs the launch on the page; this order never signs. Names pump.fun (commit gate). Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

The owner's `promptpad` proved a good flow: an MCP tool takes a prompt, validates a name, ticker and image, and returns a checkout link where the human signs. Our hosted MCP's pump.fun tools (`api/_mcp/tools/pumpfun.js`) are read-only, and `/launch` already accepts prefill parameters (`src/launch/launch-page.js`, around lines 192 to 200). One tool connects the two: anyone in Claude can go from "launch a coin for my agent" to a pre-filled, human-signed launch page.

## Step 0: re-derive the current state

    grep -n "searchParams\|prefill" src/launch/launch-page.js | head -20
    grep -n "name:" api/_mcp/tools/pumpfun.js | head -20
    grep -n "ssrf\|assertPublicUrl\|safeFetch" -r api/_lib --include=*.js -l | head

## Tasks

1. **`pumpfun_prepare_launch`** in `api/_mcp/tools/pumpfun.js`: inputs name, symbol, description, image URL, optional initial buy in SOL, optional agent id. Validate lengths and characters the same way the launch page does (import the shared validator; if validation lives only in the page, extract it to a shared module both use). Fetch the image through the existing SSRF guard, check type and size. Return a `/launch?...` URL with every field prefilled, plus a summary of what the human will sign.
2. Make sure `src/launch/launch-page.js` reads every field the tool emits and shows a "prepared from your assistant" banner so the human knows where the values came from.
3. **Safety annotations**: the tool is read-only from the server's view (`readOnlyHint: true`, `destructiveHint: false`), and its description says plainly that nothing is launched until the human signs.
4. **Docs**: `docs/mcp.md` tool entry with a real example, the golden tool fixture updated (`npm run audit:mcp-golden -- --update` if that is the repo's flow).

## Definition of done

- [ ] `npm run test:mcp` and `npx vitest run tests/api/pump-fun-mcp.test.js` pass with new cases (valid input, bad ticker, private-network image URL rejected, oversized image rejected).
- [ ] A `tools/call` against `localhost:3000/api/mcp` returns a URL that, opened in a browser, shows every field prefilled with the banner.
- [ ] `npm run audit:mcp-safety` passes; docs and changelog updated.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The page's validation and the server's disagree | Extract one validator module and use it in both; that is part of the task. |
| Image hosts block server fetches | Return the URL unvalidated with `image_checked: false` and let the page's own upload path handle it; say so in the summary. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/511-integrate-12-launch-from-claude.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
