# 406. `node_modules` is stale against `package.json`: `@x402/svm` is pinned at 2.14.0 while 2.28.0 is required, failing at least 17 test files

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order." Runnable now, no gate. Written by the evolve scout lane on 2026-10-23 from a live measurement of this worktree.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them: it is a local dependency install and a handful of test files; nothing here reaches production (production's Cloud Run container is built fresh from its own build pipeline, not from this worktree's `node_modules`).
- No mocks, no fake data, no unfinished-work markers, no commented-out code, no silently loosening a test's assertions to make it pass. Every claim gets verified by re-running the real test suite, not assumed from the code.
- This is a dependency-install task, not a single code bug, so the test-first bug-fix rule does not apply verbatim; instead, the Definition of Done requires a real before/after `npm run test:core` comparison as the proof.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing. This order touches `node_modules`, which is gitignored and never staged; only `package-lock.json` (if it changes meaningfully) and any test files you touch get committed.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- This order sits inside the scope of the existing broad order `prompts/finish/401-auto-restore-green-vitest.md` (restore a fully green `npm run test:core`). It is written separately because it is a single, narrow, mechanical root cause confirmed to account for a specific named slice of that order's failures, the same way order 403 carved the `history not on node` class out of the broader `agent_index` problem. Running this order first should shrink 401's remaining scope; it does not replace 401.

## Why this matters (measured 2026-10-23, this worktree, `main` at `9b32c1ea3`)

```
$ npm run test:core
 Test Files  178 failed | 2300 passed | 10 skipped (2488)
      Tests  398 failed | 34866 passed | 429 skipped (35693)
```

Order 401 was written on 2026-10-08 against a baseline of 37 failed files / 74 failed tests. The suite has regressed roughly 5x in file-failure count since then. A single, specific, mechanical root cause is confirmed to account for at least 17 of the 178 failing files:

```
$ node -e "console.log(require('./node_modules/@x402/svm/package.json').version)"
2.14.0
$ grep -n '"@x402/svm"' package.json
673:		"@x402/svm": "^2.28.0",
```

`package.json` has required `@x402/svm@^2.28.0` since the dependency-bump commit that raised it (the version appears in the committed `package.json`), but the version physically installed in this worktree's `node_modules` is still `2.14.0`. Reading `node_modules/@x402/svm/package.json`'s `exports` map at the installed version shows only `.`, `./v1`, `./exact/client`, `./exact/server`, `./exact/facilitator`, `./exact/v1/client`, `./exact/v1/facilitator`, with **no `./upto/*` subpaths at all**. Multiple test files and library modules import an `./upto/...` subpath that exists in 2.28.0's public API but not in 2.14.0's, so every one of them throws at import time with an `exports`-resolution error (Node's `ERR_PACKAGE_PATH_NOT_EXPORTED`, surfaced as "is not exported under the conditions..."). At least these 17 files fail for exactly this reason (confirmed by grepping the test run's own output for that error signature immediately preceding each failure):

```
tests/agent-wallet-bridge-accept.test.js
tests/api/all-modules-load.test.js
tests/api/mcp-3d-challenge.test.js
tests/api/pump.test.js
tests/api/x402-discovery-parity.test.js
tests/api/x402-facilitator-log-durable.test.js
tests/api/x402-multi-asset-select.test.js
tests/api/x402-paid-endpoint-siwx.test.js
tests/api/x402-pay-feed-degraded.test.js
tests/api/x402-pay-routing.test.js
tests/api/x402-pipeline-stages.test.js
tests/api/x402-pump-agent-audit-list.test.js
tests/api/x402-security-fixes.test.js
tests/api/x402-spec.test.js
tests/x402-floor-degradation.test.js
tests/x402-settlement-pending-resource.test.js
tests/x402-upto.test.js
```

`tests/api/all-modules-load.test.js` loads every handler in `api/` to catch exactly this class of import-time break; its failure here is itself evidence that any production handler importing the missing subpath would fail the same way at cold start, which is why this is more than a test-suite nuisance. This is a classic "the lockfile/dependency bump landed in git but `node_modules` was never actually reinstalled" drift, the same class of bug the "Env-var trap" and "known traps" sections of CLAUDE.md warn about for other subsystems. The root `package-lock.json` in this worktree is also suspect: it is a 592-byte stub containing only 2 package entries and `"name": "shadow"`, nothing resembling this monorepo's real 200+-entry dependency graph, so `npm ci` against it would not help; a plain `npm install` that lets npm resolve and write a correct lockfile from `package.json` is the right tool here, not `npm ci`.

## Step 0: re-derive the current state

```bash
git log --oneline -1
node -e "console.log(require('./node_modules/@x402/svm/package.json').version)"
grep -n '"@x402/svm"' package.json
ls -la package-lock.json && node -e "const p=require('./package-lock.json'); console.log(p.name, p.version, Object.keys(p.packages||{}).length)"
npm run test:core 2>&1 | tail -10
```

If `@x402/svm`'s installed version already satisfies `^2.28.0`, another agent already fixed this; instead verify none of the 17 listed files still fail for the `is not exported under the conditions` reason, and if they are all clear, skip straight to Definition of Done and report the pre-existing fix. If the installed version or the failing-file list differs from what is recorded above, trust what you measure now.

## Tasks

1. **Install the correct dependency tree.** Run `npm install` at the repo root (not `npm ci`, since the committed lockfile is the unrelated 592-byte stub described above; `npm install` will resolve from `package.json` and rewrite the lockfile correctly). Confirm afterward: `node -e "console.log(require('./node_modules/@x402/svm/package.json').version)"` now prints a version satisfying `^2.28.0`.
2. **Check what else moved.** `npm install` may update other packages too (this worktree's `node_modules` could be behind on more than just `@x402/svm`). Run `git diff --stat package-lock.json` (or `package.json` if npm rewrites anything there, which it should not for a plain install) to see the blast radius. This is expected and fine: the goal is a `node_modules` that actually matches the committed `package.json`, not a single-package patch.
3. **Re-run the full suite.** `npm run test:core`. Compare the new failed-file/failed-test counts against today's 178/398 baseline above. Confirm specifically that all 17 files listed above now pass (or fail for a genuinely different, unrelated reason, if so note which and why, do not force them green by weakening assertions).
4. **Investigate any newly-surfaced failures.** If `npm install` upgrades a transitive dependency and that breaks something that was passing before (a real version-incompatibility, not an environment artifact), that is new information this order did not anticipate: fix it if it is small and mechanical (an API rename, a changed default), or if it is a substantial new problem, leave it and describe it precisely in the report rather than silently reverting the install (reverting would just restore today's 178-failure baseline).
5. **Decide the lockfile's fate.** If `npm install` produces a large, real `package-lock.json` (hundreds of entries) replacing the 592-byte stub, that is very likely the correct, intended lockfile this repo should have, so commit it. If something about the stub turns out to be deliberate (check `.gitignore`, check `git log -- package-lock.json` for why it was reduced to a stub, check `scripts/setup-git-hooks.mjs` and any postinstall scripts for a reason this repo intentionally avoids a full root lockfile, e.g. if each sub-package under `packages/` or a worker directory manages its own install independently), report what you found either way and make the call; do not leave `node_modules` fixed but the lockfile mismatched with it.

## Definition of done

- [ ] `node -e "console.log(require('./node_modules/@x402/svm/package.json').version)"` prints a version satisfying `^2.28.0`.
- [ ] All 17 files listed in "Why this matters" pass, or any that still fail do so for a documented, unrelated reason (quoted in the report).
- [ ] `npm run test:core`'s failed-file and failed-test counts are reported before and after, and after is materially lower than 178/398.
- [ ] No test that passed in the Step 0 baseline is now failing, unless explicitly documented in the report as a genuine, newly-surfaced version incompatibility (not silently papered over).
- [ ] A decision on `package-lock.json` is made and acted on (committed as the real lockfile, or left as-is with a documented reason), not left in an inconsistent state relative to the installed `node_modules`.
- [ ] `npm run check:rules -- --paths package-lock.json` (if changed) exits 0.
- [ ] Committed with explicit paths (`package-lock.json` if it changed; nothing under `node_modules`, which stays gitignored) and an honest message naming the version bump and the failure-count delta.
- [ ] `git status --short` shows nothing left uncommitted from this order.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `npm install` wants to touch thousands of files and takes a long time | Expected for a drifted `node_modules`; let it finish, it is a local, reversible operation (nothing is deployed or pushed). Use a background shell if it risks the foreground timeout. |
| `npm install` fails outright (network, registry auth, disk) | Check disk first (`df -h .`, confirmed 295G free as of this writing, so unlikely); if a specific package genuinely cannot resolve (private registry, yanked version), isolate it, report the exact package and error, and install everything else so the bulk of the fix still lands. |
| `npm install` surfaces a real, non-trivial breaking change in some other dependency | Do not revert the whole install to dodge it; fix the small ones, document the non-trivial one precisely (package, old vs new behavior, which test exposed it) in the report, and leave a note in `ISSUES.md` only if it is a genuinely new owner-relevant tracked issue, not a routine version bump. |
| The 17-file list has already shrunk or grown by the time you run this (other agents committing concurrently) | Trust your own fresh Step 0 measurement over the number written here; the point is the root cause and the fix, not the exact count. |
| `npm run test:core` is still red by a wide margin after this fix for unrelated reasons | Expected; order 401 covers the rest. Report your delta honestly rather than claiming full-suite green. |

## Report format

1. Before/after `npm run test:core` summary line, verbatim, both runs.
2. The `@x402/svm` version before and after.
3. Confirmation (pass/fail) for each of the 17 named files.
4. The lockfile decision and why.
5. Anything parked (a real breaking change found and not fixed, with package name and reason).
