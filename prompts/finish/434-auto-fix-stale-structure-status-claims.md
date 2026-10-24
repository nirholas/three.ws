# 434. Correct stale "not yet applied / not yet deployed" status claims in STRUCTURE.md

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a documentation-accuracy fix, not a bug fix in running code, so the test-first rule does not apply. The "test" is the re-measurement command given for each row below: run it, compare its real output to the row's current claim, and only edit the row if the measurement disagrees with the claim.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-24)

STRUCTURE.md is the canonical map every master prompt and work order is told to read first (`prompts/masters/09-the-frontier.md` Step 0 literally runs `cat STRUCTURE.md | grep "| Live"` before generating any idea). A false "not built yet" or "not live yet" claim in it costs a future agent a full investigation to discover the feature already shipped, or worse, causes it to re-plan or re-build something that already exists. This run burned real effort re-deriving the true status of two rows before finding they were stale; this order exists so the next agent does not pay that cost again.

Two rows are confirmed stale right now, found by re-measuring every row in STRUCTURE.md containing the phrase "not yet":

    grep -n "not yet" STRUCTURE.md

- **Row 281** (Destination whitelist): claims "Built; migration not yet applied to production." Measured false: `npm run db:status` (reads `DATABASE_URL` from `.env.local`, the real Neon production database) shows `[applied] 20261010160000_destination_whitelist.sql`. The feature has no feature-flag gate (`grep -n "process.env\." api/_lib/destination-whitelist.js api/wallet-whitelist/index.js api/cron/whitelist-activate.js` shows only an unrelated `APP_ORIGIN` default), its cron is registered (`grep -n "whitelist-activate" vercel.json` matches line ~7170), and the live endpoint responds correctly authenticated-gated: `curl -s https://three.ws/api/wallet-whitelist` returns `{"error":"unauthorized","error_description":"sign in required"}` (HTTP 401), proving it is wired into production routing right now, not inert.
- **Row 282** (Owner-funded agent budgets): claims "Built; migration not yet applied to production; recurring behind `ALLOWANCE_RECURRING_ENABLED`." The migration clause is false the same way: `npm run db:status` shows `[applied] 20261023170000_agent_onchain_allowances.sql`. The `ALLOWANCE_RECURRING_ENABLED` flag clause may still be accurate (that is a real, separate feature flag, not a migration-applied claim); verify it still exists before deciding whether to keep that half of the sentence.

A third row is truncated, not stale, found by reading past the matched line:

- **Row 619** (`@three-ws/agent`): the cell ends mid-sentence: "...the `three-ws-agent` CLI and TUI entry points it declares are not yet |" (the table cell closes with no predicate after "not yet"). Measured 2026-10-24: `npm view three-ws-agent version` returns `404 Not Found`, and `packages/agent-cli/package.json`'s name is `@three-ws/agent` at version `0.1.1` with no `"private"` field forcing it off the registry, so "not yet published" is the most likely intended completion, but re-verify at execution time (`npm view @three-ws/agent version` too, in case the scoped name is the one that matters) rather than trusting this guess blindly.

## Task

1. Re-run `grep -n "not yet" STRUCTURE.md` fresh (the line numbers above may have shifted if another agent edited the file since this order was written; match on the quoted phrases, not the line numbers).
2. For **every** row the grep returns (as of this writing: 189, 281, 282, 301, 324, 394, 408, 409, 431, 619), re-measure its claim with the command below, and edit only the rows whose measurement disagrees with the current text. Leave accurate rows untouched; do not rewrite prose that is already correct just because this order touched the file.
   - Row 189 (On-demand caster pool): `gcloud run services list --project aerial-vehicle-466722-p5 --format="value(metadata.name)" | grep -i "screen\|caster"`. Confirmed still accurate as of 2026-10-24 (no match, service genuinely not deployed); re-verify, do not assume.
   - Row 281 (Destination whitelist): `npm run db:status | grep destination_whitelist` plus the endpoint/cron checks in "Why this matters" above. Fix the migration clause to reflect it is applied; keep the rest of the sentence (cooldown/step-up/enforcement description) as-is since that is a feature description, not a deploy-status claim.
   - Row 282 (Owner-funded agent budgets): `npm run db:status | grep agent_onchain_allowances`, plus `grep -n "ALLOWANCE_RECURRING_ENABLED" api/_lib/onchain-allowance.js api/_lib/onchain-allowance-store.js` to confirm the flag clause is still accurate on its own. Fix the migration clause; keep the flag clause if the grep still finds it gating something real.
   - Row 301 (Native launchpad): `gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format="value(spec.template.spec.containers[0].env)" | tr ',' '\n' | grep -i NATIVE_LAUNCH_CONFIG_KEY`. Confirmed still accurate as of 2026-10-24 (no match, mainnet config genuinely not pinned); re-verify, do not assume.
   - Row 324 (Pending x402 settlement): the matched "not yet" is inside ordinary descriptive prose ("broadcast but not yet confirmed"), not a deploy-status claim. Confirm this on re-read and leave the row untouched; do not edit it.
   - Row 394 (Desktop companion app): claims "packaged with electron-builder (`npm run dist`), not yet published." Check `apps/desktop/package.json` for a `"private"` field or publish config, and check whether a release artifact exists anywhere a user could already download it (e.g. a GitHub Releases page referenced in `apps/desktop/README.md`, or a download link wired into any page under `pages/`). If still unpublished, leave as-is.
   - Row 408 (VS Code 3D extension): claims "v0.2.0, not yet on the Marketplace." Check `packages/vscode-3d/package.json`'s `version` against the claimed `v0.2.0` (version drift is itself worth fixing even if "not yet on the Marketplace" is still true), and if a `vsce` publish token or CI step exists, note it but do not publish (publishing is this order's forbidden territory per gate 2, "publishing" to an external channel).
   - Row 409 (VS Code x402 extension): same pattern as row 408, check `packages/vscode-x402/package.json`'s version against the claimed `v0.2.0`.
   - Row 431 (X mention-reply bot): the "not yet live-replying" clause is a real, explicitly-scoped-elsewhere feature description (the row itself says the enforcement side is "tracked in the x-grok campaign"), not a stale claim. Confirm this on re-read and leave the row untouched.
   - Row 619 (`@three-ws/agent`): complete the truncated sentence. Re-run `npm view three-ws-agent version` and `npm view @three-ws/agent version` fresh; if both still 404, complete the cell with something like "...are not yet published to npm." (adjust wording to fit the existing sentence style in that row and the rest of STRUCTURE.md, i.e. no em-dash, matches the terse descriptive register used throughout the file). If either now resolves to a real published version, write what actually shipped instead.
3. For every row actually edited, keep the edit surgical: change only the status cell (and row 619's truncated sentence), not the feature description prose, the file-path links, or unrelated rows.
4. Run `npm run check:rules -- --paths STRUCTURE.md` and fix anything it flags.
5. Read the full diff (`git diff STRUCTURE.md`) and confirm every changed line is one of the measured corrections above, nothing else slipped in.

## Done when

- `grep -n "not yet" STRUCTURE.md` has been re-run and every match re-measured against real production state (database, Cloud Run services, npm registry, env vars) as of the run date.
- Rows 281 and 282's migration-applied claims are corrected to match `npm run db:status`'s real output (both migrations confirmed applied as of 2026-10-24; re-confirm at execution time in case either was rolled back since).
- Row 619's truncated sentence is completed with a real, re-measured claim (not a guess carried over unverified from this order's text).
- Every other row's claim is re-verified; rows that are still accurate are left untouched (no speculative rewrites).
- `npm run check:rules -- --paths STRUCTURE.md` passes.
- `git diff STRUCTURE.md` reviewed; every changed line traces to a specific measurement in the report.
- The fix is committed on `evolve` with an explicit path (`STRUCTURE.md`) and a commit message naming which rows were corrected and why.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA, which rows changed, and the measurement that justified each change.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| A row's claim is ambiguous about what exactly counts as "deployed" (e.g. a worker that is built but whose Cloud Build trigger has never run) | The measurement commands given above are the ground truth this order asks for; ambiguity in the row's wording is itself something to tighten while editing | Make the corrected sentence state the measured fact plainly (e.g. "no Cloud Run service named X exists as of <date>") rather than leaving the same vague wording that caused the ambiguity |
| Publishing or deploying would be the "real" fix and feels more valuable than editing a doc | Publishing, deploying and submitting Cloud Builds are all gate-2 owner actions; this order's job stops at making the documentation honest about current state, not changing that state | Do not deploy, publish, or submit a Cloud Build as part of this order. If a row's underlying feature genuinely deserves to ship next, note that as a one-line observation in the report, do not act on it here |
| A row's status has changed again since this order was written (e.g. another agent deployed the caster pool worker between now and execution) | That is expected drift; the whole point of re-measuring instead of trusting this order's own claims is to catch exactly that | Trust your own fresh measurement over this order's "confirmed accurate as of 2026-10-24" notes; update whichever rows your measurement disagrees with |
| `npm run db:status` fails to connect (missing or expired `DATABASE_URL` in `.env.local`) | This is a credential issue with a known resolution path, not a reason to skip the migration rows | Follow the credential row in the `self-unblock-playbook` skill; if truly unresolvable in-session, correct every other row, leave rows 281/282 unedited, and say exactly that in the report rather than guessing at their status |

## Report format

State: the full list of rows checked, each with its measurement command's real output, which rows were edited versus left untouched and why, the diff, the `check:rules` result, and the commit SHA.
