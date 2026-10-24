# 401. Restore a green `npm run test:core`: 52 failing files, 108 failing tests on `evolve`

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Rewritten by the evolve scout lane on 2026-10-24 from a fresh measurement; the file's prior content (dated 2026-10-08) described a different failure set that order 406 already closed out (its own closing note recorded the post-fix baseline as this same 52/108, then parked two of these as follow-up without filing them). Treat everything below as the current truth and ignore any memory of this order's old content.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them. Watch the coin gate on test fixtures and doc edits: if a fix needs content naming another crypto project, leave that hunk uncommitted and say so.
- No mocks of the thing under test, no fake data, no unfinished-work markers, no commented-out code, no `it.skip` / `describe.skip` / `.todo` to make a failure disappear. A test is only deleted when the code it covered was deliberately removed, and the commit message says which commit removed it.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before each commit, and commit finished work promptly, one topical commit per failure class.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Bug fixes are test-first (CLAUDE.md): where the fix is to the CODE (not a stale test pin), confirm the existing test fails for the stated reason before changing anything, fix, then confirm it passes.

## Why this matters (measured 2026-10-24, from HEAD `0674cb2ee`)

    npm run test:core
    Test Files  52 failed | 2428 passed | 11 skipped (2491)
         Tests  108 failed | 36720 passed | 229 skipped (37057)

`npm test` runs `vitest run && playwright test`, so every work order's "tests pass" line is unverifiable until this is green. One green suite unblocks honest verification for the whole queue.

**Note, 2026-10-24 (order 409, post-merge):** after merging 113 main-only commits into `evolve` (order 409), `npm run test:core` reads **47 failed files, 76 failed tests** (2473 passed files, 37308 passed tests), down from the 52/108 measured above. The drop reflects fixes that already shipped on `main` (for example its own `data/pages.json` duplicate cleanup and `tests/native-launch-curve.test.js` rewrite), not work done by this order. The class map below was written against the pre-merge 52/108 run and has not been re-verified against the new 47/76 list; treat it as a starting point, re-run `npm run test:core` fresh in step 0 before trusting any specific class's file list.

The failures are not one bug. Grouped by what they look like (verify each with `npx vitest run <file>`; this grouping is a researched starting map, not gospel):

**A. One missing DB column in a test's own hand-written fixture schema (not a real migration gap).** `tests/approvals.test.js` fails all 19 of its cases with `error: column "meta" does not exist` from pglite. Root cause confirmed by reading the file: it creates its own `agent_identities` table at line 81 as `create table agent_identities (id uuid primary key, user_id uuid, name text, deleted_at timestamptz)`, with no `meta` column. `api/_lib/approvals.js:596` (added by the burner-cap policy feature, commit `e9359c74d`) does `SELECT meta FROM agent_identities WHERE id = ...` and reads `row.meta.burner_policy`. The real `agent_identities` table has had a `meta jsonb` column since migration `20260616235900_agent_identities_meta_skills.sql`; only this test's hand-rolled DDL is behind. Fix: add `meta jsonb not null default '{}'::jsonb` to the test's `create table` statement. Also grep `tests/burner-approvals.test.js` and any other file that hand-creates `agent_identities`, since the same gap likely repeats there.

**B. A real, single-root-cause duplicate: `data/pages.json` declares the same path twice, four times over.** Confirmed by `grep -n` on the file: `/grok` at both line 639 and line 6520, `/docs/grok` at both 4582 and 4622, `/docs/grok-bot` at both 4590 and 4642, `/tutorials/grok-bot-recipes` at both 4634 and 7216. This single duplication cascades into at least four failing files: `tests/atlas.test.js` (route-existence check sees the dupes and reports them instead of the fixture route it expects), `tests/pages-routes.test.js` (asserts each path declared exactly once), `tests/sitemap-type.test.js` (core sitemap count off by exactly 4: 918 actual vs 914 expected, 918 > 914 confirms 4 extra entries), `tests/route-build-inputs.test.js`. Fix once: read both declarations of each duplicated path, keep whichever is the complete/correct one (compare metadata, likely one was added by a grok-campaign commit without noticing the entry already existed from an earlier commit), delete the other, and re-run all four files.

**C. Safety and policy guards firing correctly; fix the code or registry, never the guard.**
- `tests/real-funds-agreement-coverage.test.js`: `api/_mcpagent/named-services-tools.js` uses a custodial key but never calls `requireRealFundsAgreement`. This is a live money-path gate. Read the file; either wire the gate on its money-moving path, or add an `EXEMPT` entry with the stated reason no funds move. Treat this with the same care CLAUDE.md gives spend paths.
- `tests/audit-guards.test.js`: four gate steps run but are not registered in `data/guards.json`: `check:cli-scripts`, `test:mcp-surface`, `check:well-known-skills`, `check:postman-collection`. Register them (find the pattern from an existing guard entry).
- `tests/skill-rails.test.js`: the `a2a` rail returns 500 instead of 200 on a dry-run quote that "prices each enabled rail from one quote and moves no funds". Find the 500's real cause (likely an import or shape change in the a2a rail module) and fix the code; this is a payment-quote path, so do not loosen the assertion.
- `tests/branding.test.js`: forbidden vendor names (`Avaturn`, likely others) appear in 5+ "user-facing" locations, including `pages/video-to-motion.html:246` (a real served page: fix the copy) and several `docs/` files the guard's own definition of "user-facing" currently reaches (`docs/ops/...`, `docs/partners/outreach-plan.md`, `docs/research/...`). For the real page, fix the copy. For the docs hits, decide per file: either the guard's scope is too broad for internal ops/research notes and should exclude them (check `scripts/` for the branding scanner and see whether other `docs/` subtrees are already excluded for the same reason), or the content genuinely should not name a competitor and needs the "Competitor X" treatment this repo already uses elsewhere. Do not silently loosen the guard without reading why it currently includes those paths.

**D. Catalogs, docs, and counters that grew without their pin.** Update every place a number or list is pinned, in the same commit as whatever shipped the growth:
- `tests/mcp-tool-result.test.js`: a new tool's description does not match the test's `/\$[0-9]/` pricing-mention expectation. Find whether the tool is genuinely free (then exempt it the way other free tools are) or is missing its price line.
- `tests/cron-scheduler-sync.test.js`: `README.md` and `docs/build.md` both say "145" crons; `vercel.json` now declares 147. Update both docs to 147 (or find the generator that stamps that number and rerun it).
- `tests/notify-prefs.test.js`: category count drifted (one category added, pinned list has 11, code now has 12, or vice versa per the diff shown); update the pin.
- `tests/x-content.test.js`: one committed X queue item needs re-review because its copy or media changed after the last review stamp; re-review it and update its review timestamp.
- `tests/mcp-use-cases-doc.test.js`, `tests/grok-bot-doc.test.js` (4 cases), `tests/grok-page.test.js`, `tests/grok-skill-file.test.js` (2), `tests/grok-skill-md.test.js`: `docs/mcp.md` and `docs/grok-bot.md` have drifted from the live `/api/mcp-grok` tool/sample contract. Diff what the docs claim against what the code actually serves and bring the docs current (this is the `docs-freshness`/`changelog-and-docs` discipline, not a code change).
- `tests/dashboard-api-keys-table.test.js`, `tests/api/api-keys.test.js`, `tests/api/keys-endpoint.test.js`, `tests/api/mcp-wallet-provision.test.js`, `tests/api/oauth-authorize.test.js`, `tests/api/oauth-introspect.test.js`, `tests/oauth-endpoints.test.js` (5): likely the same family (the OAuth consent screen and connector-preset scopes changed shape; one case's exact diff is already captured: the consent page's "Read your avatars" list item text no longer matches the test's literal "See your avatars" expectation). Diagnose each: decide whether the UI copy or the test string is stale and fix accordingly.
- `tests/api/mcp-agent.test.js`, `tests/mcp-credit-plans.test.js`, `tests/mcp-spend-gate.test.js`, `tests/mcp-studio-asset-links.test.js`, `tests/x402-ring-catalog.test.js`, `tests/x402-discovery-green.test.js` (the `/api/x402/transit-delays` resource fails CDP's own schema: `/input/queryParams/route must be string`, fix the resource's declared schema), `tests/cron-forge-lane-guards.test.js`, `tests/registry-resolve-endpoint.test.js`, `tests/thumbnail-url-guard.test.js`, `tests/print-fulfillment-routing.test.js`, `tests/og-cards.test.js`, `tests/open-source-credits.test.js`, `tests/x-content-approval.test.js`, `tests/x-content-reel.test.js`, `tests/x-mention-intents.test.js`, `tests/asset-host-liveness.test.js`, `tests/directory-page-refs.test.js`, `tests/api/defi-cache-dedup.test.js`, `tests/api/developer-webhooks.test.js`, `tests/api/gpt-forge-clone.test.js`, `tests/api/launcher-claimer-cron.test.js`, `tests/api/v1-robinhood.test.js`, `tests/avatar-template-cache.test.js`, `tests/agent-guard-endpoint.test.js`, `tests/a2a-payment-hardening.test.js`: not yet triaged below the headline error. Run each with `npx vitest run <file>` and classify into A to E; most are expected to be the same B/C/D shape as the rest of this list (a catalog, schema, or policy that changed on one side without the other).

**E. Named and parked by order 406's own closing note, not yet filed anywhere else.**
- `tests/multiplayer-server-boot.test.js`: `multiplayer/package.json` pins `@colyseus/ws-transport@^0.18.4`, which peer-requires `@colyseus/core@^0.18.5`, alongside `@colyseus/core@^0.16.24` pinned directly. The mismatch landed via a Dependabot merge (`63374bac6`). Resolve the version conflict in `multiplayer/package.json` (likely bump the direct `@colyseus/core` pin to satisfy both, or pin `@colyseus/ws-transport` back to a version compatible with `^0.16.24`; check Colyseus's own compatibility table before choosing), then `npm install` inside `multiplayer/` and re-run.
- `tests/native-launch-curve.test.js` > "produces a rising multi-point curve": `buildCurveWithMarketCap` now returns a single-point curve for the native $THREE launch lane under `@meteora-ag/dynamic-bonding-curve-sdk` 2.0.0, where the previously-stale SDK produced multiple rising points. This is a real-money curve-shape change, not a test artifact: read the SDK's 2.0.0 changelog/source for `buildCurveWithMarketCap`, confirm whether a single-point curve is the SDK's new correct behavior for the given inputs (in which case fix the test's expectation and add a comment citing the SDK version) or a misuse of the new API on our side (in which case fix the call site). Do not paper over this one; it shapes a real token launch curve.

**F. Known flaky, confirmed by order 406 (re-verify, do not just skip).** `tests/pump-live-stream.test.js`, `tests/strategy-compiler-backtest.test.js` (hits the real platform LLM, no mock, per CLAUDE.md), `tests/usage-direct-insert-timeout.test.js`. These were not in the FAIL list at this measurement, so if they fail during your run, rerun once before treating as a regression.

## Step 0: re-derive the current state

    git log --oneline -1
    npm run test:core > /tmp/test-core-before.log 2>&1; echo "exit $?"
    grep -E "Test Files|Tests " /tmp/test-core-before.log
    grep -E "^ FAIL" /tmp/test-core-before.log | sed 's/ >.*//' | sort | uniq -c | sort -rn

Do not pipe `npm run test:core` through `tail` when you need the exit code; it takes about 2.5 minutes, run it in the background and poll the log file. If the counts differ from the 52/108 above, the live list is the work; the classes above are a starting map, not a checklist to force-fit. Re-run a single file with `npx vitest run <file>` to see its full error, and use `git log --oneline -5 -- <file> <the module it tests>` to find which side moved.

## Tasks

1. Work the classes in order C, A, B, E, D, F (C hides real safety and payment gaps; A and B are each one concrete root cause with an outsized blast radius; D is the long tail of pins).
2. Class C: fix the code or the registry, never loosen an assertion to make a guard stop firing.
3. Class A: add the missing `meta jsonb not null default '{}'::jsonb` column to every test fixture that hand-creates `agent_identities` without it (grep `create table agent_identities` across `tests/`).
4. Class B: resolve the `data/pages.json` quadruple duplicate once; re-run `tests/atlas.test.js`, `tests/pages-routes.test.js`, `tests/sitemap-type.test.js`, `tests/route-build-inputs.test.js` together afterward.
5. Class E: both items need a real decision (a dependency version resolution, and a domain call on a token-launch curve shape), not a quick patch. Read the cited SDK/package docs before changing either.
6. Class D: for each untriaged file, run it alone, classify it, and fix the side that is actually wrong, updating the test and the implementation together where both drifted.
7. After each class, run `npm run test:core` and record the counts.
8. Finally run the Playwright half, still masked by `npm run test:core` never getting that far: `npx playwright test` (needs a dev server per `playwright.config.*`; use a free port, never 3000). Fix what is ours; record anything environment-bound with its exact error.

## Definition of done

- [ ] `npm run test:core` exits 0 (paste the summary lines).
- [ ] `grep -rnE "\.(skip|todo)\(" $(git diff --name-only <step-0 sha> -- tests packages)` shows nothing added by this order.
- [ ] `grep -c '"path": "/grok"\|"path": "/docs/grok"\|"path": "/docs/grok-bot"\|"path": "/tutorials/grok-bot-recipes"' data/pages.json` each prints exactly 1.
- [ ] `npm run audit:mcp-catalog && npm run check:mcp-catalog && npm run audit:guards` exit 0.
- [ ] `npx playwright test` was run; its result (pass count, or each failure with its cause) is in the report.
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0.
- [ ] One commit per class (or finer), each subject naming what it fixed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| You cannot tell whether code or test is right | `git log -p` both; the newer intentional change wins, and the commit message records the call. If a behavior change looks accidental (a 500 where a quote should return 200), the code is wrong. |
| A fix would touch content naming another crypto project | Make the fix, leave that hunk uncommitted, and list it in the report; evolve preserves it as a named stash for the owner. |
| Another agent fixes some of these while you work | Rebase your understanding on `git log`; re-run the suite; do not redo their work. |
| A failure needs a built artifact (`avatar-sdk/dist`, `character-studio/build`) | Build it with the repo's own script (`npm run build:lib:full && npm run build:avatar-sdk`), never by committing the artifact. |
| Playwright needs browsers that are not installed | `npx playwright install chromium`; if the network refuses, record the exact error and finish the vitest half. |
| The suite is too slow to iterate on | Iterate per file with `npx vitest run <file>`; run the full suite only at class boundaries. |
| The native-launch-curve SDK question is genuinely ambiguous from the source alone | Write the smallest reproduction against the installed `@meteora-ag/dynamic-bonding-curve-sdk` showing the actual output for the test's exact inputs, decide from that evidence, and say which way you decided and why in the commit message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths, one topical commit per class, each subject describing that diff (e.g. `fix(approvals): add the meta column the burner-policy read needs to the test fixture`).
3. If every line passes, delete this file in the final commit (`git rm prompts/finish/401-auto-restore-green-vitest.md`) and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHAs. If a line cannot pass, leave the file, log which line remains and why.
4. Final report, in this order: the step 0 counts; per class, what was wrong (code or test) and the commit SHA; the final counts; the Playwright result; one-line judgment calls. No trailing questions.
