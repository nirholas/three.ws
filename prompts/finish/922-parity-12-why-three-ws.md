# parity 12: a "Why three.ws" page built on live numbers

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Band 900: a comparison that names other platforms needs the owner's yes before it is committed. Build the whole page without names first; the named comparison is the one gated step.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/parity-00-CONTEXT.md](_context/parity-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. Where this order hits one, it says so, and you batch every such ask into ONE message after everything else is done.
- Never name Competitor X in anything you commit. If a reference is unavoidable, write "Competitor X".
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Status

The unnamed `/why-three-ws` page shipped in `62fe9136b` (live metrics from `/api/platform/analytics`, category comparison, loop SVG, tests in `tests/why-three-ws.test.js`, nav, pages.json, STRUCTURE row, changelog from the pages.json row). What remains is one owner-gated step.

## Remaining: the named comparison (owner gate)

1. Ask the owner for a yes on the platform names to compare against. For each proposed platform give the metric, its value, the public source URL and the date read. Every figure must come from a public source fetched that day (DefiLlama, the platform's own docs); a figure with no public source is left out.
2. On a yes, add the table to `pages/why-three-ws.html` in a follow-up commit (names need the owner's approval before commit), then delete this file and log the SHA in [_context/parity-PROGRESS.md](_context/parity-PROGRESS.md).

Until then the category comparison on the page is the complete, correct state.
