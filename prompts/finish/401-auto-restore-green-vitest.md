# 401. Restore a green `npm run test:core`: 37 failing files, 74 failing tests on `main`

**Evolve status (2026-10-08, from the order 024 retry):** the suite is green on the evolve working tree. `E2E_PORT=3107 npm test` exits 0: vitest 2194 files / 31,910 tests, 0 failed (from 34 files / 72 tests), and Playwright 262 passed, 5 skipped. The fixes landed one commit per class: D/E `821771220`, A `025a9474c` and `2cc2908d7` (`pay_quote`, because pay_and_call could never run), B `4da09d565`, C `f8af368cb` `3c21bc70e` `0cf94cb6b` `6c546e91b` `219ad4534`. Playwright: `cc84796d6` `fcbf15d47` `3ae6db5ff` `a6113184d` `958b10969` `83e77b691`; webkit system deps were installed with `sudo npx playwright install-deps webkit`. The audits pass: `audit:mcp-catalog`, `check:mcp-catalog`, `audit:guards` (85 OK). No skips were added, and there are no `/workspaces` paths left. One line is still open: at HEAD, `tests/mcp-schema.test.js` fails 3 tests until the coin-gated regenerated `public/mcp-catalog.json` is committed (OWNER-ACTIONS row 26). After that, verify `npm run test:core` at HEAD and retire this order.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Written by the evolve scout lane on 2026-10-08 from the measurements below.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them. Watch the coin gate on test fixtures and doc edits: if a fix needs content naming another crypto project, leave that hunk uncommitted and say so.
- No mocks of the thing under test, no fake data, no unfinished-work markers, no commented-out code, no `it.skip` / `describe.skip` / `.todo` to make a failure disappear. A test is only deleted when the code it covered was deliberately removed, and the commit message says which commit removed it.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before each commit, and commit finished work promptly, one topical commit per failure class.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters (measured 2026-10-08, 17:27 UTC, `main` at `1c0fc8432`)

`npm run test:core` (`vitest run`) ends:

    Test Files  37 failed | 2153 passed | 9 skipped (2199)
         Tests  74 failed | 31731 passed | 197 skipped (32002)

`npm test` runs `vitest run && playwright test`, so the Playwright stage has not run for anyone. Every work order's definition of done says "`npm test` passes" and every agent currently has to baseline the red and argue "no new failures", which is how real regressions hide. Order 400 and every later order inherit this. One green suite unblocks the honest verification line of the whole queue.

The failures are not one bug. First error per file, grouped by what they look like (verify each; the grouping is a hypothesis):

**A. Stale test doubles: the handler gained an import the test's `vi.mock` factory does not export, so the route 500s inside the test.**
- `tests/agent-guard-endpoint.test.js` (9): `No "clientIp" export is defined on the "../api/_lib/rate-limit.js" mock`
- `tests/api/onboarding-actions.test.js`, `tests/api/marketplace-agents-csrf.test.js`: `No "hasSessionCookie" export is defined on the "../../api/_lib/auth.js" mock` (expected 200, got 500)
- `tests/api/security-csrf-gates.test.js`: `Cannot convert undefined to a BigInt` at `api/_lib/token/config.js:24`
- `tests/api/x402-pay-routing.test.js`: `no dev keypair` from its `node:fs` mock
- `tests/agent-wallet-withdraw.test.js` (4): idempotent replay answers 409, expected 200
- `tests/api/leaderboard-rollup-cron.test.js`: `{ checked: 0 }`, expected 2
- `tests/api/mcp-memory.test.js` (2): `forget is turned off for this connection`, expected an ownership error
- `tests/api/forge-nim.test.js`: public https `baseUrl` override no longer accepted (likely the DNS-resolving SSRF check; commit `6bd6b4ef5` fixed the same class for BYOK fixtures)

**B. Catalogs grew and the pinned expectations did not.** `tests/api/mcp-agent.test.js` (8), `tests/api/mcp-agent-catalog.test.js`, `tests/api/mcp-agent-challenge.test.js`, `tests/api/mcp-bazaar.test.js`, `tests/api/mcp-bazaar-challenge.test.js`, `tests/agora-mcp-tools.test.js`, `tests/mcp-schema.test.js` (3: `agora_quote_register` and one more listed tool carry no input schema), `packages/home-mcp/tests/registration.test.js` (2), `tests/pump-alert-eval.test.js` (alert kinds grew). For each, decide whether the new tool or kind is intended (find its commit) and then update the pin, the challenge metadata, the published catalog and its golden files together. A tool listed without an input schema is a product defect, not a stale pin.

**C. Safety and policy guards that are firing correctly.** Fix the code or registry, never the guard.
- `tests/real-funds-agreement-coverage.test.js` (5): four handlers use a custodial key but never call `requireRealFundsAgreement` (`api/_mcp/resources.js`, `api/agents/_id/credits.js`, `api/cli/[action].js`, `api/inference/[action].js`), and the fifth case reports a stale exemption. This is a money-path gate; read each file and either gate its money path or add an `EXEMPT` entry with the reason no funds move, and drop the stale exemption.
- `tests/mcp-remote-annotations.test.js` (3): `agent_card_create` advertises `destructiveHint: true` against the pinned set.
- `tests/audit-guards.test.js` (2): `scripts/check-xai-models.mjs looks like a guard but is not in data/guards.json`.
- `tests/guard-wiring.test.js`: `docs/ops/guard-wiring.md` lacks rows for `check:community-skills` and two more guards.
- `tests/branding.test.js` (3): a forbidden vendor brand appears in 10 user-facing locations (first: `docs/aws-builder-center-universal-retargeting.md:66`).
- `tests/pages-routes.test.js`: `data/pages.json` declares one `/docs/...` path twice (the test prints it); `tests/atlas.test.js` and `tests/sitemap-type.test.js` (814 vs 815) likely fall with the same duplicate.
- `tests/route-build-inputs.test.js`: two routed static pages are not emitted by the build.
- `tests/server-404-routes.test.js`: a real tutorial no longer resolves to its article.
- `tests/x-content.test.js`: one item in the committed X queue fails validation.

**D. Machine-specific or time-bound tests.**
- `tests/zz-probe.test.js` imports `/workspaces/three.ws/src/game/combat-system.js`, an absolute path from one codespace. It was committed in `fa4a242e8` as a probe; either delete it (if another test already covers `CombatSystem`) or make it resolve relative to `import.meta.url`.
- `tests/src/usdz-pipeline.test.js` opens `/workspaces/three.ws/public/avatars/cz.glb`: same fix.
- `tests/check-event-window.test.js`: "the configured event that ships has not already ended" (event end 2026-09-26 against today). Decide what the guard should say once an event is over (see `npm run check:event` in `gate`) and make the test date-independent with an injected clock.
- `tests/vanity-grinder-batch.test.js`: off-GCE shard resolution returns `name-hash`, expected `unavailable`.
- `tests/prepare-deploy-worktree.test.js`: plan mode exits 1 where 0 is expected; check whether it fails only because this machine already has a deploy worktree.
- `tests/avatar-sdk-api.test.js`: `Failed to resolve import "../dist/index.mjs"`. The build chain creates it (`build:lib:full` then `build:avatar-sdk`); the test must either build or skip with a stated precondition the way other dist-dependent tests do (find their pattern).

**E. Real-looking logic failures.** `tests/eidon-imu-clip.test.js` (6: calibration angle is `NaN`), `tests/src/animation-canonical-support.test.js` (5: `root.updateMatrixWorld is not a function` in `src/animation-retarget.js:346`). Find whether the code or the fixture regressed; both sit on the universal-animation path CLAUDE.md calls load-bearing.

## Step 0: re-derive the current state

    git log --oneline -1
    npm run test:core > /tmp/test-core-before.log 2>&1; echo "exit $?"
    grep -E "Test Files|Tests " /tmp/test-core-before.log
    grep -E "^ FAIL" /tmp/test-core-before.log | sed 's/ >.*//' | sort | uniq -c | sort -rn

Do not pipe `npm run test:core` through `tail` when you need the exit code. If the counts differ from the table above, the live list is the work; the grouping above is a starting map. Re-run a single file with `npx vitest run <file>` to see its full error, and use `git log --oneline -5 -- <file> <the module it tests>` to find which side moved.

## Tasks

1. Work the classes in order A, C, E, B, D (A and C hide real 500s and safety gaps; B and D are pins and environment). For every file decide which side is wrong, the code or the test, and say so in the commit message.
2. Class A: extend each `vi.mock` factory with the missing exports using `importOriginal` where the real module is safe to load, so the next added import does not break it again.
3. Class C: fix the code or the registry. `tests/real-funds-agreement-coverage.test.js` gets particular care: a custodial key on a money path without `requireRealFundsAgreement` is a live gap, so gate it and add a handler test proving the gate, unless the file truly moves no funds.
4. Class B: update every place a catalog is pinned in the same commit (tests, challenge metadata strings, golden files under `tests/` or `data/`, and `npm run audit:mcp-catalog` / `npm run check:mcp-catalog` inputs). Run those two audits after.
5. Class D: no absolute machine paths in any test (`grep -rn "/workspaces/three.ws" tests/ packages/*/tests` must be empty afterwards); no test that depends on today's date.
6. Class E: root-cause and fix; add the regression case that would have caught it.
7. After each class, run `npm run test:core` and record the counts.
8. Finally run the Playwright half that has been masked: `npx playwright test` (needs a dev server per `playwright.config.*`; use a free port, never 3000). Fix what is ours; record anything environment-bound with its exact error.

## Definition of done

- [ ] `npm run test:core` exits 0 (paste the summary lines).
- [ ] `grep -rnE "\.(skip|todo)\(" $(git diff --name-only <step-0 sha> -- tests packages) ` shows nothing added by this order.
- [ ] `grep -rn "/workspaces/three.ws" tests/ packages/*/tests` prints nothing.
- [ ] `npm run audit:mcp-catalog && npm run check:mcp-catalog && npm run audit:guards` exit 0.
- [ ] `npx playwright test` was run; its result (pass count, or each failure with its cause) is in the report.
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0.
- [ ] One commit per class (or finer), each subject naming what it fixed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| You cannot tell whether code or test is right | `git log -p` both; the newer intentional change wins, and the commit message records the call. If a behavior change looks accidental (a 409 where a replay should return 200), the code is wrong. |
| A fix would touch content naming another crypto project | Make the fix, leave that hunk uncommitted, and list it in the report; evolve preserves it as a named stash for the owner. |
| Another agent fixes some of these while you work | Rebase your understanding on `git log`; re-run the suite; do not redo their work. |
| A failure needs a built artifact (`avatar-sdk/dist`, `character-studio/build`) | Build it with the repo's own script (`npm run build:lib:full && npm run build:avatar-sdk`), never by committing the artifact. |
| Playwright needs browsers that are not installed | `npx playwright install chromium`; if the network refuses, record the exact error and finish the vitest half. |
| The suite is too slow to iterate on | Iterate per file with `npx vitest run <file>`; run the full suite only at class boundaries. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths, one topical commit per class, each subject describing that diff (e.g. `test(mcp): pin the grown agent-wallet catalog and give agora_quote_register an input schema`).
3. If every line passes, delete this file in the final commit (`git rm prompts/finish/401-auto-restore-green-vitest.md`) and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHAs. If a line cannot pass, leave the file, log which line remains and why.
4. Final report, in this order: the step 0 counts; per class, what was wrong (code or test) and the commit SHA; the final counts; the Playwright result; one-line judgment calls. No trailing questions.
