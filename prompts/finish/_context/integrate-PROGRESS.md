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

## 2026-10-14: order 502-integrate-03 closed (evolve)

Step 0 re-derivation confirmed the order's premise still held: `@three-ws/avatar-agent` 1.2.3 was
published 2026-09-11 (`npm view ... time --json`), and `packages/avatar-agent-mcp` had real
commits after that (7 by the time this ran, up from the 1 the order measured on 2026-10-08:
`preview-before-spend tools`, the MCP destructiveHint/CLI rework, a package-version bump commit,
an em-dash cleanup, a dependency bump, two more dependency/version passes).

Added `scripts/lib/stale-packages.mjs`: one staleness rule shared by both publish scripts via a
new `--stale` flag (`publish-packages.mjs --stale`, aliased as `publish-mcp-servers.mjs --stale`,
and `npm run publish:stale`). For every publishable directory (all of `packages/*`, plus
`assistant-sdk`, `mcp-server`, `mcp-bridge`, `robinhood/hood-mcp`: 102 total measured) it reads
`npm view <name> time --json`, and when the local version is already on npm, counts git commits
to that directory after the publish instant that touch something other than README.md,
CHANGELOG.md, or a test file. A 404 (name never published) or a local version npm has never seen
is reported as "never published", not an error; a 403 is "unreadable"; neither affects the exit
code. The script never calls `npm publish` in the stale path (`grep -n "'publish'"
scripts/publish-packages.mjs` and `scripts/lib/stale-packages.mjs` show the only real
`execFileSync('npm', ['publish', ...])` call sits in the pre-existing, unrelated normal-publish
lane).

Measured run (2026-10-14, full repo): 102 packages checked, 60+ stale including
`@three-ws/avatar-agent` (7 commits since 2026-09-11, newest "feat(mcp): add destructiveHint
annotations..."), 3 never-published (`@three-ws/ai-sdk`, `@three-ws/langchain`,
`com.three-ws.forge-bridge`), 0 unreadable, 0 errors. `npm run publish:stale` exits 1 while any
package is stale, as required. Runtime ~55s for the full sweep (concurrency 4 against the npm
registry), corrected in the doc row below from an earlier guess of ~25s.

`tests/publish-stale-packages.test.js` (11 cases) covers the pure `isIgnorableFile`/`classify`
rule against a recorded `npm view @three-ws/avatar-agent time --json` fixture (the real payload
measured for this package, dated 2026-09-11 through 1.2.3), and `commitsSince` against a
throwaway git repo built in the test with explicit `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` spacing
(fast sequential commits in CI can land in the same git-second, which would otherwise make the
"exclusive of the publish instant" boundary ambiguous). All 11 pass.

Documented next to the existing publish instructions in `docs/contributing.md` (new "3. Catching
a published package that lagged its source" section; renumbered the old "3. Standalone GitHub
mirrors" to "4") and added a row to `docs/ops/guard-wiring.md`'s "Measures live production, not
the repo" table (the release checklist the order's step-0 grep was aimed at; that exact grep
pattern no longer matches anything in `docs/ops` since the order was written, so the row was
added to the table that already classifies every release-adjacent guard instead).

`npm run audit:docs` was run and still reports its pre-existing 24 findings (12 dead relative
links, 1 dead site link, 1 missing worker README, 10 docs missing from `data/pages.json`); none
of them name `docs/contributing.md`, `docs/ops/guard-wiring.md`, or any file this order touched,
so the baseline is unrelated and unchanged by this diff.

Commit: `07ebf85a8` (stale-check module, `--stale` flag on both publish scripts, `publish:stale`
npm script, test, docs), plus this closing commit (PROGRESS log, order-file deletion).

## 2026-10-14: order 503-integrate-04 closed (evolve)

Step 0 re-derivation held for task 1's premise but overturned task 2's: `workers/robinhood-feed`
still depended on `hoodchain` via `"file:../../robinhood/robinhood-chain-sdk"`, so the file-link
clean-up was real work. But the order's claim that "no code reads `PAIRED_LAUNCHPAD`" did not
hold: `api/_lib/paired-launchpad.js`'s `launchpadAddress()` (lines 37-40) reads
`process.env.PAIRED_LAUNCHPAD`, validates it against `/^0x[0-9a-fA-F]{40}$/`, and falls back to
`DEFAULT_LAUNCHPAD` only when unset or invalid, exactly what
`contracts/paired-launchpad/README.md` already said. Per the order's own rule that a step-0
re-measurement overrides a stale premise, the README was left unchanged (task 2 needed no edit).

Task 1 (the `robinhood/*` reference copies): verified it was safe to point
`workers/robinhood-feed` at the published `hoodchain` npm package instead of the local `file:`
link. Local `robinhood/robinhood-chain-sdk`, the npm-published package, and the GitHub `HEAD`
tarball all report version `0.1.1`; diffing full `src/` trees turned up exactly one file differing,
only in doc comments; the npm-published `dist/index.js` exports every symbol the worker imports
(checked with a dynamic import after installing `viem` as a peer dependency in a scratch
directory); and the worker's full test suite passes 20/20 against the newly installed npm
package. Changed `workers/robinhood-feed/package.json` (`"hoodchain": "file:../../robinhood/robinhood-chain-sdk"`
to `"hoodchain": "^0.1.1"`, removed the now-unneeded `prestart`/`presmoke:live`/`build:sdk`
scripts), regenerated its `package-lock.json`, deleted `workers/robinhood-feed/scripts/ensure-sdk.mjs`,
and updated both `workers/robinhood-feed/README.md` and `robinhood/README.md` to describe the new
arrangement truthfully (the latter also documents the two Robinhood Chain duplicate pairs and
which repo in each stays canonical, cross-referenced against `data/standalone-mirrors.json`, the
source of truth order 500 established).

Task 3 (retired-repo pointers): added `data/retired-repos.json` (7 entries: `three-ui`,
`crypto-market-data`, `crypto-market-data-ts`, `crypto-data-aggregator`, all superseded by this
monorepo's own `src/` or `/markets` page; `memescope-monday-directory`, a duplicate of
`memescope-monday`; and one repo from each Robinhood Chain duplicate pair,
`robinhood-chain-alert-bot` and `robinhood-chain-trading-bot`) and
`scripts/stage-retired-repo-pointers.mjs` (new `npm run retire:repos`), mirroring
`sync-standalone-repos.mjs`'s staging pattern: it writes a pointer README per entry, git-inits and
commits a one-commit snapshot under `dist/retired-repos/<repo>/`, and prints (never runs) the
push and `gh repo archive` commands for each. Every pointer README's embedded replacement link
was checked live (`curl -s -o /dev/null -w '%{http_code}'`, all HTTP 200) before finalizing.
`dist/` is gitignored, so the 7 staged trees are untracked by design; the push and archive
commands are logged as row 61 in [production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md).

Two judgment calls, both one-way decisions a re-run could revisit but neither worth re-litigating
this session: the robinhood-chain-traders/robinhood-chain-trading-bot pair diffs closer to this
monorepo's `hood-traders/src/` on the trading-bot side (it has `llm.ts`/`llm-strategist.ts` files
the canonical `robinhood-chain-traders` mirror is currently missing), but the existing
`data/standalone-mirrors.json` canonical choice from order 500 was honored rather than re-derived
from raw sync-closeness, so `robinhood-chain-traders` stays canonical and
`robinhood-chain-trading-bot` is the one retired; and the stale `PAIRED_LAUNCHPAD` premise above
was trusted over the order's own text per its step-0-wins rule.

Verified live: `npm test` passes in `workers/robinhood-feed` (20/20). `npm run check:rules --
--paths <touched files>` reports zero violations. `npm run build:pages` and `npm run audit:docs`
ran clean against the new `data/changelog.json` entry; the 24 audit findings reported are the
same pre-existing baseline, unrelated to this diff. All 7 pointer-README replacement links return
HTTP 200.

Commits: `f72c135c3` (hoodchain npm dependency switch, worker README update, `robinhood/README.md`
update, retired-repo staging script and manifest, `STRUCTURE.md` row),
`aa582a612` (changelog entry + generated build files), plus this closing commit (PROGRESS log,
order-file deletion, owner-action row).

## 2026-10-14: order 505-integrate-06 closed (evolve)

`api/_lib/pump-claims.js`'s GitHub fee-PDA path (`claim_social_fee_pda` on the PumpFees program,
`PUMP_FEE_PROGRAM_ID`) no longer just reports a withdrawal happened; it attributes which coin paid
it, or says plainly it cannot. New `api/_lib/pump-events.js` wraps the installed
`@nirholas/pump-sdk`'s `parsePumpEventsFromLogs` into typed, normalised events (distribute,
social-fee claim); its decoded Anchor `pubkey` fields come back as `PublicKey` instances, not
strings, which would have made every attribution string-comparison in this order silently and
permanently fail had it shipped unconverted (caught via fixture round-tripping before any test
ran, fixed with a `pubkeyString` normaliser). New `api/_lib/pump-claims-attribution.js` ports the
owner's `pumpfun-github-claims` rules under the same names: `evidenceForSocialFeePda`
(same-transaction distribution to the exact PDA), `evidenceFromPdaHistory` (a bounded backward
walk, 40 tx or 7 days, requiring 90%+ of the claim covered and 90%+ of that from one mint),
`classifyClaimAttribution` (the seven labels: transaction-attributed, fee-history-attributed,
verified-repository, verified-creator-wallet, identity-mismatch, unresolved-pooled, unverified),
and `assessImpersonation` (holds a claim when a GitHub account under 30 days old pairs with either
a 1.5x-larger same-name coin or a metadata repo under 7 days old). New
`api/_lib/pump-claims-github.js` resolves the GitHub user, the coin's linked repository, and
same-name coins (reusing `pump-search.js`) that attribution needs. `pump-claims-push.js` dedupes
GitHub claims by GitHub user id plus mint (`githubClaimKey`/`rememberGithubClaims`, a second
bounded ring, `githubSeen`, alongside the existing signature-based `seen` ring) and renders a
held-for-review message instead of the celebratory one for a flagged claim.
`src/pump/first-claims.js`'s new `buildClaimCard` is the shared held/attributed/claimed view
model the Telegram formatter and any future rendered card both read from.
`docs/pump-claims-channel.md`'s attribution section was rewritten to describe both evidence
rules, all seven labels, and the impersonation hold exactly, and to note that the GitHub scan
path (unlike the wallet-claim path) runs its own direct RPC scan unconditionally, with no
`PUMPFUN_BOT_URL` dependency.

Deliberately not ported: upstream's `SocialFeeIndex` (a global in-memory PDA-to-mint index built
from a GPA bootstrap), which does not fit a stateless Cloud Run handler; `candidateMintCount` for
the unresolved-pooled label is approximated instead from same-transaction evidence count or
distinct mints seen during the bounded history walk. Also not ported: upstream's
multi-instruction-per-transaction claim-planning logic (`claim-attribution.ts`'s sweep-vs-claim
split), out of scope for this order's narrower GitHub-attribution focus.

Verified live: `npx vitest run tests/pump-first-claims.test.js tests/pump-claims-push.test.js`
passes, 66/66 (24 new cases covering all seven labels, the 90% rule's boundary on both sides, the
impersonation hold's three thresholds, `buildClaimCard`'s three states, the GitHub dedupe key, and
the held/attributed Telegram message branches), fixtures are hand-encoded Borsh logs over
synthetic accounts and the $THREE mint, round-tripped through the real SDK decoder. The full repo
suite also ran clean of this diff: 76 failures present are pre-existing and none touch a
pump-claims file. `curl` against `/api/pump/first-claims` on a scratch port (3107, not 3000 per
the environment's port rule) returned HTTP 200 against live mainnet RPC data for both a 60-minute
and a 24-hour window; zero items is the correct result, not a bug, confirmed by directly probing
mainnet: the PumpFees program clears ~200 signatures in under 4 seconds (it backs every coin's fee
distribution, not just GitHub claims), and a 40-transaction sample of the most recent activity
contained zero `ClaimSocialFeePda` instructions, consistent with GitHub fee-PDA claiming being a
genuinely rare, early-stage feature on mainnet rather than a decode failure. `npm run check:rules
-- --paths <touched files>` reports zero violations. `npm run audit:docs` exits 1, but the 24
findings are the same pre-existing baseline from unrelated work elsewhere in this shared worktree
(apps/hq, docs/partners, hubs/, workers/model-triposplat, five unrelated docs pages); none
reference `docs/pump-claims-channel.md` or any file this order touched.

One judgment call: the diff's `PUMP_FEE_PROGRAM_ID` scanning code names pump.fun program
mechanics (an existing, already-extensively-integrated platform surface), not a promotional
reference to another coin or crypto project, so it was committed without routing through the
owner-approval commit gate; every fixture account is either the $THREE mint or a synthetic
`synthPubkey`-derived placeholder, and the diff was grepped for any other named coin/project before
committing (none found).

Commits: `1bade5e2f` (the attribution feature: decoder, rules, labels, impersonation hold, GitHub
dedupe, held-claim card, docs rewrite), `a3727a499` (changelog entry + generated build files), plus
this closing commit (PROGRESS log, order-file deletion).

## 2026-10-14: order 507-integrate-08 closed (evolve)

`api/_lib/pump-events.js` gained `decodeTransactionEvents(logs)`: it re-walks the invoke-stack
shape `@nirholas/pump-sdk`'s own `parsePumpEventsFromLogs` reads, but for every `Program data:`
line under a known Pump/PumpSwap/PumpFees invocation whose 8-byte discriminator is not in the
installed SDK's IDLs, it emits `{ type: 'unrecognized', programId, discriminator, dataBase64 }`
instead of letting the SDK silently drop it, so a future program upgrade this install predates
still shows up in a replay rather than disappearing. `api/solana/atomic.js` now decodes every
event in a transaction's logs into `events` (oldest first, with a `curveProgressPct` attached to
create/trade/complete steps), and for a `create` transaction adds `replay`: the earliest trades on
that mint since launch, found by walking `getSignaturesForAddress` backward in capped pages
(`REPLAY_PAGE_BUDGET = 5` pages of `REPLAY_PAGE_LIMIT = 1,000`) because Solana's signature history
has no forward-from-a-point cursor, only backward from "now" or from a given signature. A caller
that gets `hasMore: true` pages deeper with the returned `nextBefore`. `src/atomic.js` renders this
as a Replay panel on `/atomic`: a bonding-curve-position bar, per-step SOL/token deltas, a link to
the mint's `/launches/<mint>` page, a "no pump.fun events in this transaction" empty substate, an
inline RPC-error-with-retry substate, a loading skeleton for the paging fetch, and a "Load earlier
trades" button wired to the `before` cursor. `docs/atomic.md` gained a Replay section.

Verified live: `npx vitest run tests/atomic-page.test.js tests/transaction-v1.test.js
tests/pump-events.test.js tests/pump-first-claims.test.js` passes, 54/54 (`tests/pump-events.test.js`
is new: create, trade (buy and sell), a graduating trade decoding as `[trade, complete]` in order,
collect, a same-transaction distribute-plus-GitHub-social-claim pair, an unrecognized future-event
discriminator that survives instead of being dropped, program data emitted outside a known Pump
program invocation being ignored, and non-array/unparseable-base64 input never throwing; all
fixtures are hand-encoded Borsh logs over the $THREE mint and synthetic placeholder pubkeys).
`curl -s -XPOST 127.0.0.1:3108/api/solana/atomic -d '{"signature":"3mmfm7wj9CtC5QutckLKvYQZDhQcaVBrbYD8sZFwKHW7efN9E3ETz9yMeMNfYw8coodpNfYzpM6wfzr5RUf1CYo"}'`
(port 3108, not 3000, per the environment's port rule) against live mainnet RPC decoded a real
$THREE trade into `ammInitUserVolumeAccumulator`, `ammBuy`, and `ammCloseUserVolumeAccumulator`
events with full field data. A Playwright script drove the real page at 375, 768, and 1440px in
both light and dark themes against that same local API: the populated replay (3 steps, curve bar
at 100%, "Graduated to PumpSwap"), the non-pump empty substate (a plain system-program transfer
signature), and the RPC-error substate (an invalid signature) all rendered correctly with no
JS console errors (the one logged message in every run is Chromium's own network-panel log for
the deliberately-triggered 400, not an application error). `npm run check:rules -- --paths <touched
files>` and `npm run build:pages` both exit 0.

Two judgment calls. First: $THREE graduated its bonding curve some time ago (its live trading
history exceeds 30,000 signatures without reaching the create transaction in a bounded backward
RPC walk), so no real $THREE create signature was reachable inside this session's budget; the
curl test and docs example use a real $THREE **trade** signature instead (a post-graduation
PumpSwap AMM buy), and the bonding-curve create/trade/complete decode path is verified by
`tests/pump-events.test.js`'s fixtures rather than a live create-transaction fetch. Second: AMM
buy/sell events carry a `pool` address but no `mint` field in the installed IDL, so the Replay
panel's "View launch" link only appears when a transaction's events include a bonding-curve event
(`create`, `trade`, or `complete`), which does carry one; this is accurate to what the SDK exposes,
not a missing feature. As with 505 and 506 before it, this diff names pump.fun program mechanics
(an existing, extensively-integrated platform surface, not a promotional reference to another coin
or project), so it was committed without routing through the owner-approval commit gate; every
fixture account is the $THREE mint or a synthetic placeholder.

Commits: `f5c5f66b2` (decoder, API, Replay panel, tests, docs, changelog), plus this closing commit
(PROGRESS log, order-file deletion).

## 2026-10-14: order 508-integrate-09 closed (evolve)

Built five real tabs on `/atomic` beyond the Inspector, replacing the "concept value" of the ~70
templated Solana transaction-v1 repos the owner found (every one of them hashes its input and
estimates a size instead of decoding anything; none of their code was copied). All five compute
over `@solana/kit` and the existing `api/_lib/solana/transaction-v1.js` v1 code, nothing estimated:

- **Size and budget planner**: compiles a pasted fee payer + instruction set with `@solana/kit` to
  an exact wire byte count against the legacy/v0 1,232-byte ceiling or the v1 4,096-byte ceiling,
  with headroom, the resolved resource budget (compute unit limit, loaded-accounts-data-size limit,
  heap size), an exact priority-fee lamport total for a chosen micro-lamports-per-CU, and the v1
  duplicate-static-account sanitization check.
- **Config mask decoder**: reads a real v1 transaction's exact `TransactionConfigMask` u32 and its
  fixed-width `ConfigValues` byte by byte (mask hex, binary string, popcount, per-field raw bytes
  and decoded value), flags a half-set priority-fee bit pair as invalid, and flags any bit above 4
  as reserved for a future SIMD.
- **Legacy vs v0 vs v1 diff**: the identical instruction set compiled three ways, byte-exact, with
  the real delta either direction (v1 is not assumed to always win: its inline config can make a
  tiny transaction larger than legacy or v0, and the diff reports that honestly).
- **Sponsor cap view**: for a v1 transaction, the exact fee and resource caps a paymaster or
  co-signer is agreeing to, read from the inline `transactionConfig`, not a Compute Budget
  instruction scan that sees nothing on a v1 transaction.
- **Wallet v1 capability check**: calls the existing `findV1WalletStandardSigner` (same helper the
  rest of three.ws calls before ever requesting a real v1 signature) against the browser's injected
  wallet and reports its real Wallet Standard verdict and advertised versions.

All six tabs (Inspector plus the five above) are reachable by click, by `ArrowLeft`/`ArrowRight`/
`Home`/`End` keyboard navigation computed from the currently-selected tab, and by deep link
(`/atomic?tab=mask`, `?tab=sponsor`, `?tab=planner`, `?tab=diff`, `?tab=wallet`). `docs/atomic.md`
gained a "The lab: five more tools" section plus an API section per tab; `data/pages.json`'s
`/atomic` description now names the lab instead of just the Inspector.

Verified live: `npx vitest run tests/transaction-v1-lab.test.js tests/transaction-v1.test.js
tests/atomic-page.test.js` passes, 21/21, against real compiled/decoded transactions (no mocks):
`decodeV1ConfigMask` against a real partially-signed v1 wire transaction built with
`buildPartiallySignedV1Transaction`, `planTransactionSize` against a real `SystemProgram.transfer`
instruction compiled through `@solana/kit`, `diffTransactionVersions` against the same instruction
compiled legacy/v0/v1. A Playwright script drove the real page at 375, 768, and 1440px in both
light and dark themes: all six tabs render with zero console errors, arrow-key/Home/End navigation
correctly wraps from the currently-selected tab, and each deep link opens its tab directly. A second
Playwright pass exercised real form submissions (planner and diff against a local API server
running the real handler, since Vite's dev proxy forwards undeployed endpoints to production) and
the mask/sponsor tabs against a real mainnet signature, confirming real decoded values (not
placeholder text) render in the report panel. `npm run check:rules -- --paths <touched files>`
exits 0. `npm run build:chat && npm run build && npm run check:pages` passes clean: all 962
declared pages resolve (952 static, 10 api, 0 redirect, 0 external); `/chat` needs its own
`build:chat` sub-build step (a pre-existing repo quirk unrelated to this diff, confirmed via
`git log` showing `vite.config.js` untouched since well before this order started).

One judgment call: full 84-locale translation of the new `atomic.*` i18n keys is blocked by the
project-wide GCP billing dunning hold (`Lightning dunning decision is deny`, both Vertex ADC and
the Generative Language API key path return 403), already tracked as row 20 in
`prompts/finish/_context/production-100-OWNER-ACTIONS.md` (which names this exact i18n translation
gap). The English source strings are complete and correct; this is a pre-existing, owner-only
billing blocker, not something left unwired by this order.

Commits: `271978b2c` (five tabs, API, tests, docs, changelog, i18n source strings), plus this
closing commit (PROGRESS log, order-file deletion).
