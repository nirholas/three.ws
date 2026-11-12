# Restore the 85-language picker by closing the missing keys, draining the lint backlog and republishing the locale manifest

**Status (2026-11-12):** Not complete, owner-gated on GCP billing. Re-measured: en.json has 25634 leaf keys; 84 locale files, six are complete (es, fr, ja, ko, zh-CN, de or similar, per commit 789091c16) and the manifest now lists 7 locales, but the other ~78 are up to 1114 keys behind. A direct Vertex generateContent probe returned `403: There are issues with your billing account, please resolve / pay your outstanding balance for project: projects/93741856042`; no GOOGLE_API_KEY or GEMINI_API_KEY exists in .env, so no translation backend works. Owner: pay the outstanding balance on the GCP billing account (or add a GOOGLE_API_KEY to .env), then run `GOOGLE_CLOUD_PROJECT=aerial-vehicle-466722-p5 npm run i18n:translate` in shards from Step 0 (tasks 2-8 remain).

**Update (2026-11-04, later): node_modules now works (dry-run runs). Re-measured: 748 keys behind in 80+ locales (en.json is still growing under other sessions), es 132. Vertex probe with GOOGLE_CLOUD_PROJECT=aerial-vehicle-466722-p5 returned `vertex 403: credentials are not valid even after re-minting` (the gcloud token is revoked by the reauth policy), and no GOOGLE_API_KEY, GEMINI_API_KEY or other provider key exists in .env. Owner: one `gcloud auth login` (or a GOOGLE_API_KEY in .env), then `GOOGLE_CLOUD_PROJECT=aerial-vehicle-466722-p5 npm run i18n:translate` in shards from Step 0.**

**Status (2026-11-04):** Not complete. Step 0 re-measured: en.json has 25187 leaf keys; 84 of 85 locale files are 640-666 keys behind (es 50, af/am/ar/as 611-619), so the manifest still lists only `en`. Task 1 (threshold-aware `buildManifest` and `tests/i18n-manifest-publish.test.js`) already shipped in 91282baf6. Remaining: tasks 2-8 (translate ~56k keys, repair, lint to 0, parity check, manifest, browser check, docs and changelog). Blocked this session because the shared `node_modules` is broken (`scripts/i18n-translate.mjs` fails with `Cannot find package 'dotenv'`), so no translate, lint or vitest could run; Vertex billing (OWNER-ACTIONS row 20) must also be probed once deps exist, with fallback to `--provider=gemini`. Owner: the next session with a healthy `node_modules` (run Step 0 onward); no owner decision needed.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/262-plan-i18n-restore-language-picker-manifest.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 78 of 100 inside the tier). **Area:** i18n. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`public/locales/manifest.json` (served at https://three.ws/locales/manifest.json) lists only English since commit `04e298db6` (2026-10-12), because `writeManifest()` in `scripts/i18n-translate.mjs` holds back any locale with missing keys (the dry-run says "1 locale(s) listed, 84 held back until complete"). Flattened, `en.json` has 25147 leaf keys (25139 by an earlier count) while the other locale files have about 24524, so roughly 623 newer keys are untranslated almost everywhere (es is behind by 379), and the language switcher shows nothing to switch to in production while the changelog advertises 69 and 85 languages. Separately, `node scripts/i18n-translate.mjs --lint` has been reported failing with 52,331 problems across the locale files (missing keys, markup and placeholder mismatches, untranslated copy), so users in those languages see English fallbacks or raw keys on partly translated pages, and the repo gate cannot be turned on while the lint is red, so every new page can add drift unnoticed. This is a shipped feature that is effectively off.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `public/locales/` holds 87 files (86 locales plus `manifest.json`); the source is `public/locales/en.json` (the script header and some docs say `locales/en.json`, but no such top-level directory exists). The manifest lists only `en`.
- Counting counts matters. `en.json` has 710 top-level sections, which is what a naive `Object.keys` count shows, but 25147 flattened leaf keys. A naive top-level comparison shows es/fr/ja/de with 0 empty values, 0 values identical to English and only 2 to 4 absent sections, which looks like the dry-run's 623 is a lint artefact. The flattened comparison (re-run 2026-11-03) shows fr/ja/de at 24524 leaf keys (623 missing) and es at 24768 (379 missing, plus 158 empty values per an earlier measurement). So the 623 are real missing leaf keys, not a lint false positive. Step 0 re-derives this so the executor does not repeat the confusion.
- `writeManifest()` at about line 1001 of `scripts/i18n-translate.mjs` withholds a locale when `missingKeys(source, locale).length > 0`; `untranslatedCount` lives in `scripts/lib/i18n-shared.mjs`.
- Provider default is Vertex (pre-approved GCP spend, `--concurrency=8`, `--split-token=3600`); alternatives are gemini, openai, anthropic and the `threews` proxy. Vertex was blocked by a billing hold (OWNER-ACTIONS row 20, `Lightning dunning decision is deny`) and OpenAI billing is inactive (docs/ops/ISSUES.md items 1 and 4); re-check, and pick a working backend at run time. A past incident: a revoked ADC wrote English passthrough into `ar.json`; the script now fails closed.
- Scripts: `i18n:translate`, `i18n:extract`, `i18n:lint`, `i18n:repair`, `i18n:prune`, `i18n:backfill`; queue helper `scripts/i18n-generate-queue.sh`.
- Tests exist: `tests/i18n-missing-key.test.js`, `i18n-backfill`, `i18n-idempotent-writes`, `i18n-markup`, `i18n-annotate`, `i18n-localized-pages`.
- `public/locales/localized-pages.json` may be modified in the working tree by another agent; do not clobber it.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
curl -s https://three.ws/locales/manifest.json | head -c 400
node -e "
const fs=require('fs');
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?flat(v,p+k+'.'):[[p+k,v]]);
const en=new Map(flat(JSON.parse(fs.readFileSync('public/locales/en.json'))));
console.log('en leaf keys',en.size,'top-level',Object.keys(JSON.parse(fs.readFileSync('public/locales/en.json'))).length);
for(const f of fs.readdirSync('public/locales').filter(f=>f.endsWith('.json')&&f!=='en.json'&&f!=='manifest.json'&&f!=='localized-pages.json')){const l=new Map(flat(JSON.parse(fs.readFileSync('public/locales/'+f))));const m=[...en.keys()].filter(k=>!l.has(k)||l.get(k)==='').length;if(m)console.log(f,m)}" | head -100
timeout 300 node scripts/i18n-translate.mjs --dry-run 2>&1 | tail -5
node scripts/i18n-translate.mjs --lint 2>&1 | tail -3
node scripts/i18n-translate.mjs --lint 2>&1 | grep -oE "^. \[[a-zA-Z_-]+\]" | sort | uniq -c | sort -rn | head -30
node scripts/i18n-translate.mjs --help 2>&1 | head -30
sed -n 960,1040p scripts/i18n-translate.mjs
gcloud auth print-access-token >/dev/null && echo gcp-auth-ok
```

Write the reconciliation (naive top-level count versus flattened leaf count versus dry-run 623 versus lint problem count) into the report. If the lint count differs from 52,331, use the measured one.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first: add `tests/i18n-manifest-publish.test.js` that builds a manifest from fixture locale dirs and asserts (a) complete locales are listed, (b) a locale with missing keys is held back, (c) a locale at or above a configurable threshold (default 100 percent) is listed. Confirm any threshold case you add fails on the current behavior.
2. Break the lint problems down by locale and key family; separate "missing key" from "markup mismatch", "placeholder mismatch" and "untranslated copy". Fix any lint rule false positives in the script first, test-first in `tests/i18n-missing-key.test.js` (for example locales the product deliberately does not ship, or keys that are intentionally English-only brand names); record the allowlist, with a reason per entry, in a data file, not inline.
3. Run `npm run i18n:extract` so `en.json` is the source of truth. Probe backends in turn with one real key (vertex first, then gemini, `threews`, anthropic; use `--provider=gemini` with `GOOGLE_API_KEY` from the service env if Vertex is billing-blocked) and run `npm run i18n:translate` in resumable shards (`--locales=es,fr,...`, `--concurrency=8`, lower on 429, backoff) to fill the missing keys and empty values. Never hand-write or machine-fake translations and never accept English passthrough. Keep proper nouns (three.ws, $THREE, product names) and placeholders intact per the lint rules.
4. Run `npm run i18n:repair` and `npm run i18n:lint` until `--lint` exits 0 with no problems; also run `--prune`. Never commit a locale whose lint fails. Commit locale JSON in topical batches, not one sweep.
5. Ensure the pipeline cannot silently regress: add a `check:i18n-parity` script (or extend `i18n:lint`) that fails when any shipped locale is more than N keys behind `en.json`. Add it to the gate list in `package.json` or `npm run check:rules`/the pre-push hook only if it runs in under 60 seconds; otherwise expose it as `npm run check:i18n` and note it in `docs/i18n.md`.
6. Regenerate `public/locales/manifest.json` and verify every previously advertised locale is present and no locale is held back. Spot check that RTL languages (ar, he, fa, ur) set `dir` correctly in the picker.
7. Verify in a real browser: open `/`, `/irl`, `/pricing` and `/workbench`, open the language switcher, confirm all locales listed, pick `es`, `ja`, `ar` (and use `?lang=`), confirm text and direction change, no raw `section.key` strings, no layout overflow, no console errors, and that a key added later falls back to English instead of showing the key.
8. Run `node --test tests/i18n-*.test.js`. Update `docs/i18n.md` (counts, parity check, repair workflow, backend probe order), add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] The Step 0 leaf-key snippet prints nothing (no locale behind `en.json`).
- [ ] `node scripts/i18n-translate.mjs --dry-run` ends with 0 keys to translate and the manifest line has no held-back locales.
- [ ] `node -e "console.log(require('./public/locales/manifest.json').locales.length)"` prints a count equal to the number of locale files other than `manifest.json` and `localized-pages.json`.
- [ ] `node scripts/i18n-translate.mjs --lint` and `npm run i18n:lint` exit 0 and print no problems.
- [ ] `npx vitest run tests/i18n-manifest-publish.test.js` and `node --test tests/i18n-*.test.js` pass.
- [ ] Browser check recorded: the switcher lists all locales on a built page, `ar` renders RTL, and three locales (RTL, CJK, Latin) show no raw keys or overflow.
- [ ] The report states the reconciliation of 623 versus the top-level count versus the lint total.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Vertex 403/429 or billing hold, OpenAI inactive | Lower `--concurrency`, retry with backoff; Vertex spend is pre-approved. Fall back to gemini (`GOOGLE_API_KEY` from the service env), `threews` or anthropic; probe each with one key first; report the hold |
| Rate limits mid-run | The script is resumable and re-runs only translate missing keys; shard with `--locales=` and continue per locale |
| A few keys fail lint after translation | Run `npm run i18n:repair`; hand-fix remaining placeholders only; never hand-edit around the glossary lock |
| A key is untranslatable (brand, code) | Add it to the data-file allowlist with a reason |
| Manifest only updates on deploy | Commit the regenerated file; production pickup is the routine deploy gate |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/262-plan-i18n-restore-language-picker-manifest.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `262-plan-i18n-restore-language-picker-manifest.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `scripts/i18n-translate.mjs`.

- `docs/i18n.md`
- `prompts/finish/_context/production-100-OWNER-ACTIONS.md` (section "Open rows")
- `docs/ops/site-health-audit-2026-09-15.md`
- `docs/ops/production-sweep-2026-09-15.md`
- `docs/ops/swarm-100-audit.md`
