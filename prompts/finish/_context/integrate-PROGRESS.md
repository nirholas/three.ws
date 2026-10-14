# integrate: progress log

Cross-chat handoff log for the `integrate-` campaign (orders `500` to `549`). Shared facts live in
[integrate-00-CONTEXT.md](integrate-00-CONTEXT.md). Append a dated entry when an order finishes
(with commit SHAs) or stops on a gate (with the exact line that remains and who owns it). Newest
entries go at the bottom.

## 2026-10-08: campaign written

Surveyed all 389 repositories under `github.com/nirholas` (354 owned, 35 forks) against this
monorepo in six clusters and wrote 50 work orders. No order has run yet. Order 500 and 501 should
run before anyone pushes a mirror; 505 before 506 and 507 (shared decoder); 524 before 525; 529
before 530 and 531; 015 (parity) before 510.

## 2026-10-14: order 500-integrate-01 closed (evolve)

`data/standalone-mirrors.json` is now the single source of truth for which monorepo directory
maps to which public GitHub repo, direction, and exporter; it lists all eleven renamed MCP
mirrors under their real GitHub names, `walk-sdk` (published as `3d-avatar-companion`),
`x402-modal-sdk`/`x402-payment-modal` (no mirror yet, `repo: null`), `agent-payments-sdk`, the
three growth satellites, `awesome-3d-agents`, the three skill-repo targets sharing the
`.agents/skills` source path, and the 17 `robinhood/*` reference copies under `direction: "in"`.
`scripts/sync-standalone-repos.mjs` was rewritten to read that manifest and stage a one-commit
snapshot per mirror under `dist/standalone-mirrors/<repo>/`, fix any stale pre-Apache-2.0
license footer, and print the push command, with zero `gh` calls and zero `git push` calls
anywhere in the file. `export-growth-satellites.mjs`, `build-awesome.mjs` and
`build-standalone-skill-repos.mjs` now read repo names from the same manifest instead of each
keeping its own list. `npm run sync:repos` no longer carries `--execute`; `sync:repos:check`
replaces the old `sync:repos:dry` and compares staged trees against each mirror's live codeload
tarball, reporting drift without writing. `docs/contributing.md`, `packages/README.md` and
`STRUCTURE.md` describe the new flow.

Verified live: staged 96 mirrors with zero errors and zero duplicates for the eleven renamed
repos; `tty-avatar`'s staged commit message matched `Sync from three.ws@<sha>` exactly, and its
staged tree differed from `packages/tty-avatar` only in `.git` and `package.json`'s `repository`
field; zero staged README carried an "all rights reserved" footer; `sync:repos:check` exited
non-zero and listed every repo as drifted (expected, since nothing has been pushed yet);
`audit:docs` reported the same 24 pre-existing findings before and after this diff (verified by
stashing this change and re-running); the full `npx vitest run` showed 44 pre-existing failing
files unrelated to this diff, confirmed by stashing this change and re-running three of the
failing files, which failed identically without it.

One judgment call: the previous script also ran the rich enrichment pipeline
(`enrichMirror`/`boostMirror` from `scripts/lib/standalone-kit.mjs`, adding AGENTS.md, llms.txt,
an OG card and a docs site to every staged mirror). The order's task list only asked for a
snapshot, a `package.json` repository rewrite, and a license-footer fix, and its own
definition-of-done line requires the staged `tty-avatar` tree to differ from the source
*only* in `.git` and `package.json`'s `repository` field, which the richer pipeline would
violate. The new script does not call it; `enrichMirror`/`enrichPackageJson`/`boostMirror`
are unused by any entry point now but left in place as tested library code.

Pushing every staged mirror is the owner's call (gate 2); logged as row 59 in
[production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md).

Commits: `a9c8abfae` (manifest, script rewrite, docs, changelog), plus this closing commit
(PROGRESS log, order-file deletion, owner-action row).
