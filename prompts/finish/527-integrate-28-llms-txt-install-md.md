# integrate 28: make llms.txt spec-correct, put real doc bodies in llms-full.txt, and serve install.md

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; one gated step, named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: full doc bodies can carry other-coin text (for example the BNB docs); filter those docs out or treat the diff under the commit gate. Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Measured 2026-10-08: `public/llms.txt` has a single `.md` link even though production serves `/docs/<slug>.md` as `text/markdown`; `llms-full.txt` holds page descriptions, not doc bodies; `https://three.ws/install.md` is a 404. The owner's `extract-llms-docs` parses, validates and generates llms.txt and install.md, and `AuditKit`'s AI-readiness pillar checks the same things. Agents that read three.ws through these files currently get a thin view of the platform.

## Step 0: re-derive the current state

    grep -c "\.md)" public/llms.txt
    head -c 1200 public/llms-full.txt
    curl -s -o /dev/null -w '%{http_code}\n' https://three.ws/install.md
    grep -n "buildLlmsTxt\|buildLlmsFull" scripts/build-page-index.mjs
    npx vitest run tests/llms-index.test.js

## Tasks

1. `buildLlmsTxt` links every curated doc as `/docs/<slug>.md` under H2 sections, with the spec's H1 and blockquote.
2. `buildLlmsFull` inlines the curated docs' full markdown, excluding docs that name other crypto projects unless approved.
3. Generate `/install.md` from the CLI and MCP connect data (one place for "how do I install three.ws in my agent").
4. A conformance test: H1, blockquote, H2 link lists, every link resolves to a route the server serves.

## Definition of done

- [ ] `npm run build:pages` regenerates all three files; the vitest passes.
- [ ] Every link in `public/llms.txt` returns 200 against `npm run dev`.
- [ ] `curl -s localhost:3000/install.md` returns the document.
- [ ] Changelog entry (docs tag).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `llms-full.txt` grows past a sensible size | Cap per doc and link the rest; document the cap in the file header. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/527-integrate-28-llms-txt-install-md.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
