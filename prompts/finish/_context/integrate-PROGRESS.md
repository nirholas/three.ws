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

## 2026-10-14: order 501-integrate-02 closed (evolve)

`scripts/mirror-drift-report.mjs` (`npm run mirrors:drift`) does the three-way comparison the
order asked for: for each of the 105 mirrors in `data/standalone-mirrors.json` it finds the last
`Sync from three.ws@<sha>` commit via the GitHub commits API, archives the monorepo directory at
that sha into the scratchpad, and diffs it against the mirror's current HEAD tarball and the
monorepo's current tree, writing `tasks/mirror-drift-<date>.json`. It fell back to the README
timestamp heuristic and said so once the GitHub token's rate limit reset mid-run (61 calls, 98/105
resolved this run; a repo with no sync-marker commit at all gets `status: "no-sync-base"` per the
order's own never-blocked table). The first run (before anything below was ported) flagged exactly
what the order named: `avatar-agent-mcp`'s package.json diff showed `@nirholas/pump-sdk` at
`^1.36.0` on GitHub against `^1.30.0` here, and the aggregate reported 6 mirrors still carrying the
legacy "all rights reserved" footer (the order's own "93" figure was stale; 6 is the current,
re-measured count).

Two of the order's five named GitHub-only changes were real and got ported, each its own commit,
each with a test that failed on the pre-fix code for the right reason before it passed:
- `fix(threews-avatar-mcp): clamp name/camera-orbit args before they reach modelViewerHtml`
  (`2a5caaec9`). `isSafeModelUrl` already bounded the model URL; `name` and `cameraOrbit` had no
  such bound before reaching the generated `<model-viewer>` HTML. New `clampArg` closes that gap;
  `test/threews.test.mjs` proves an over-long argument is clamped (13/13 green).
- `fix(walk-sdk): give ?avatar= precedence over the stored choice on deep links` (`6be91ed66`).
  `?walk=play&avatar=<id>` and the drop-in resume path read the saved avatar preference straight
  out of storage and never looked at the query string. New `deepLinkAvatarId` in
  `walk-sdk/src/companion.js` gives the query param precedence and persists it;
  `test/companion.test.mjs` covers precedence, persistence, and both fallback paths (48/48 green).
  `walk-sdk/src/picker.js` was also checked and is byte-identical to its mirror; nothing else in
  that package needed a port.

Three of the order's named changes turned out to be stale or inaccurate on closer reading (the
order itself is nine days old against mirrors that keep moving):
- `readme-3d`'s claimed "docs site and `.gltf` fix" is just the auto-generated GitHub Pages build
  output and scaffold (`AGENTS.md`, `CITATION.cff`, `llms.txt`, etc.) that every synced mirror
  carries; after stripping the generated marker blocks, `src/` and the README are identical to the
  monorepo. No port made; the rerun shows `github-only` is metadata only (`README.md`,
  `package.json`).
- `x402-fetch` and `x402-server`'s claimed README rewrites ("326 and 698 lines against 103 and
  410") are also stale: after stripping generated blocks, both READMEs differ from GitHub only in
  whitespace. No port made; both rerun to metadata-only `github-only`.
- `x402-modal` and `x402-payment-modal`'s GitHub READMEs are real rewrites (676 and more lines),
  but per task 4's own condition ("where it is accurate against the current code") they fail
  verification: both claim "vendor-neutral defaults" (`brand: null`, `builderCode: null`), but
  both packages' actual `DEFAULTS` ship three.ws branding (`brand: { label: 'Powered by three.ws'
  ... }`, `builderCode: { wallet: '3d_agent', ... }`). The GitHub README also drops the `discover()`
  API and the Development section that the current local README documents correctly. Per the
  order's own never-blocked row ("the monorepo wins unless the GitHub change is a security or
  correctness fix"), neither was backported. Both mirrors have no sync-marker commit (`heuristic`
  method, `legacyLicenseFooter: true`), so their `github-only` list stays large after the rerun;
  that is the expected no-sync-base/heuristic shape for an independently-edited mirror, not an
  unported fix.

One gated port, staged but not committed: `packages/avatar-agent-mcp/package.json`'s
`@nirholas/pump-sdk` bump from `^1.30.0` to `^1.36.0` (and the matching root `package-lock.json`
update from `npm install`) names another project's SDK, so it falls under the commit gate. The
order's own claim of a "2.x move with holder-reward launches" did not hold up: the real current
GitHub range is `^1.36.0` (still 1.x), and no holder-reward code exists in the mirror (checked,
no match for `holder.reward`/`holder_reward`/`holderReward`). The edit is verified (`npm install`,
`npm ls @nirholas/pump-sdk` → `1.36.0`, `npm test` → 26/26 green) and left staged, uncommitted,
in this worktree. Logged as row 60 in
[production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md).

Verified live: the rerun after porting shows `github-only` reduced to metadata (`README.md`,
`package.json`, and `glama.json` where present) for `readme-3d`, `x402-fetch`, `x402-server`, and
`threews-avatar-mcp` (whose `here-only` now lists the 5 files of this session's own fix, expected
since GitHub hasn't been re-synced); `avatar-agent-mcp`'s `package.json` diff narrows to the
unrelated, out-of-scope `@grpc/grpc-js`/`@modelcontextprotocol/sdk` drift once `@nirholas/pump-sdk`
itself is applied locally. `npm test` is green for every touched package: `walk-sdk` 48/48,
`threews-avatar-mcp` 13/13, `avatar-agent-mcp` 26/26. `npm run check:rules` (no `--paths`, full
repo) reports zero hard-rule violations across every changed file. `npm run build:pages` and
`npm run audit:docs` ran clean against the new `data/changelog.json` entries (the 24 audit
findings reported are pre-existing and unrelated to this diff).

Commits: `82fb502a2` (mirror-drift-report script + npm script + first report),
`2a5caaec9` (threews-avatar-mcp arg-clamp fix + test),
`6be91ed66` (walk-sdk `?avatar=` deep-link fix + test),
`fa3b6a34a` (changelog entries + generated build files),
plus this closing commit (PROGRESS log, order-file deletion, owner-action row).
