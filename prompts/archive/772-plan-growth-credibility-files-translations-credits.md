# Ship the free credibility files and crawlable-locale fixes that funding and listing programs check for

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/772-plan-growth-credibility-files-translations-credits.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 30 of 100 inside the tier). **Area:** growth. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Several open-source funds, directories and curators check for files and signals that cost nothing to add and that three.ws does not have: a `funding.json` manifest (FLOSS/fund requires it), a `.zenodo.json` so a release mints a DOI, a visible "Powered by Pollinations" credit (a stated requirement of the Pollinations app catalog), and locale pages that crawlers can read. The sweep also flagged that the server always sends `<html lang="en">`, so translated text may be invisible to Baidu and Naver. All of this is repo and site work an agent can finish; only the final account connections (Zenodo, OpenSSF badge, FLOSS/fund submission) belong to the owner.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Done already: `CITATION.cff` at the repo root; translated READMEs for zh-CN, ja, ko in `docs/readme/` and linked from `README.md` line 9; OpenRouter attribution shipped.
- Missing: `https://three.ws/funding.json` and `/.well-known/funding-manifest-urls` both return 404; no `.zenodo.json` at the repo root; no "Powered by Pollinations" text anywhere in `src/` or `pages/` (the lane is in `api/_lib/ai-image-lanes.js`, `api/_mcp3d/text-to-image.js`); `.github/FUNDING.yml` lists only `https://three.ws` (the sweep says the Sponsor button target is an owner decision, leave it).
- `curl -sL https://three.ws/zh-CN/` redirects then 404s, and the home HTML for any locale starts with `<html lang="en">`. Locale selection is client-side in `src/i18n.js`, hreflang alternates come from `public/locales/localized-pages.json` via the sitemap (`scripts/build-page-index.mjs`, test `tests/i18n-localized-pages.test.js`).
- 63 locale catalogs exist in `public/locales/`. README translations stop at three languages while the site covers es, pt-BR, hi, ru and more.
- The locale manifest `public/locales/manifest.json` is rewritten by a running `scripts/i18n-translate.mjs`. Never commit it while a translation run is in flight.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls CITATION.cff .zenodo.json funding.json public/funding.json 2>&1
for p in funding.json .well-known/funding-manifest-urls; do curl -s -o /dev/null -w "$p %{http_code}\n" https://three.ws/$p; done
grep -rn -i "powered by pollinations" src pages api | head
ls docs/readme
curl -s "https://three.ws/?lang=ja" | grep -o '<html[^>]*>' | head -1
grep -n "lang" src/i18n.js | sed -n 1,25p
pgrep -af i18n-translate || echo "no translation run in flight"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. `funding.json`. Read the current spec at `https://floss.fund/funding-manifest/` (plain GET) and write `public/funding.json` against it: entity (the project), projects (three.ws, `@three-ws/mcp-server`, the viewer), history, channels, plans. Use only facts that exist in the repo and on production (license, repo URL, package names). Serve it at `/funding.json` and list it in `public/.well-known/funding-manifest-urls` (one URL per line) as the spec requires. Do not list any other crypto project. Test first: `tests/funding-manifest.test.js` validates required keys and that every URL in it returns a non-error status shape (offline: check URL syntax; online check is a Step 0 curl).
2. `.zenodo.json`. Add it at the repo root with title, description, creators, license, keywords and related identifiers taken from `CITATION.cff` so the two never disagree. Add a test that parses both and asserts the title, license and creator names match.
3. Pollinations credit. Where Pollinations-lane output is shown to a user (find the UI that renders image or text results from `api/_lib/ai-image-lanes.js` and `api/_mcp3d/text-to-image.js`, including the response metadata the API already returns), add a small visible "Powered by Pollinations" credit linking to pollinations.ai, shown only when that lane actually produced the result. Add the lane name to the API response if it is not there, and test that the credit renders for that lane and not for others. Hover, focus and contrast states per the house tokens.
4. Crawlable locales. First measure whether any server-rendered path sets `<html lang>` and hreflang per locale. Then make the server (the Cloud Run static/HTML layer that serves `pages/*.html`, see `server/index.mjs`) emit `<html lang="<locale>">` and `rel="alternate" hreflang` links when a request carries `?lang=<supported locale>`, with a canonical that points at the un-parameterized URL. Test first in `tests/` beside `i18n-localized-pages.test.js` using the server's request handler directly. Do not break the existing client-side switch in `src/i18n.js`.
5. README translations. Using the repo's own translation tooling (`scripts/i18n-translate.mjs` or the same model path it uses), produce `docs/readme/README.es.md`, `README.pt-BR.md`, `README.hi.md`, `README.ru.md`, then extend the language line in `README.md`. Keep product names, code blocks and URLs untouched. Add a test that every file linked from the README language line exists and has the same number of top-level headings as the English README.
6. Local evidence runs (read-only, no posting): run the OpenSSF Scorecard CLI against the repo if it can be installed without a GitHub Action (record the score and the failing checks in `docs/security/` or the existing security doc); fix any failing check that is a file or setting inside the repo (for example a missing `SECURITY.md` section or pinned dependencies), and list the ones that are not.
7. Write `docs/ops/credibility-submissions.md` (or extend an existing partners doc) with the exact remaining owner steps and ready-to-paste values: Zenodo GitHub connect then cut a release, Software Heritage "Save Code Now" request, OpenSSF Best Practices badge registration, FLOSS/fund submission at `dir.floss.fund/submit` with the live `funding.json` URL. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test` (or `npx vitest run`) for the new tests passes: funding manifest, zenodo/citation agreement, Pollinations credit, locale head tags, README language line.
- [ ] After deploy (or against the local server before): `curl -s https://three.ws/funding.json | python3 -m json.tool` succeeds and `/.well-known/funding-manifest-urls` returns the URL with 200.
- [ ] `curl -s "https://three.ws/?lang=ja" | grep -o '<html[^>]*>'` shows `lang="ja"`.
- [ ] `python3 -c "import json;json.load(open('.zenodo.json'))"` succeeds.
- [ ] The Pollinations credit is seen in a real browser on a Pollinations-produced result and absent on another lane.
- [ ] `public/locales/manifest.json` is unchanged in the diff, and `git diff --stat` shows nothing unrelated.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The funding-manifest spec changed | Build to the version served at floss.fund today and record the version in the file's comments-free metadata field. |
| A translation run is in flight | Do not touch `public/locales/manifest.json`. Do the README translations through the tool without committing the manifest. |
| Scorecard CLI cannot be installed | Run it as a container image or via `go install`; if neither works, record the failure and list the checks to run manually. |
| Zenodo, OpenSSF and FLOSS/fund need owner accounts | Prepare every file and the paste-ready runbook; those four connections are owner-only and stay in the final report. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/772-plan-growth-credibility-files-translations-credits.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `772-plan-growth-credibility-files-translations-credits.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `marketing/growth/sweep-2026-09-18.md`
