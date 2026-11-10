# Add a drift check for the UX Flow Atlas and trace the highest-traffic routes it never covered

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/781-plan-docs-ux-flows-atlas-route-coverage.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 24 of 100 inside the tier). **Area:** docs. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`docs/ux-flows/` is a hand-traced reference of what each page does, cited to real source, and it is also the quickest map for an agent or QA person who has to verify a flow. It was written once (clusters 01 to 12) and has no check. Measured today, only about 232 of the 1,014 pages in `data/pages.json` appear in it, and the atlas cites at least 63 routes (for example `/create-review`, `/scan`, `/agent/new`, `/marketplace-analytics`, `/walk-embed`) that are not in the page index, so some are aliases or dynamic and some may be dead. Nothing flags either problem. The docs contain no open defects (the only "fixed" note is the 2026-08-06 CSRF repair on the account page), so this is a P3 reference-quality order, not a bug hunt, but a drift gate keeps the reference trustworthy and gives the QA sweeps a coverage list.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Twelve cluster files, 01 to 12; the `03` to `12` files are in this batch. Each flow has Steps, Decision points, Empty/error states, External calls, with file and symbol citations.
- Page index: `data/pages.json` (1,014 `path` values by a recursive walk), built into `public/sitemap/index.html` and `public/atlas-index.json` by `scripts/build-page-index.mjs` and `scripts/build-atlas-index.mjs`.
- Existing neighbors that must not be duplicated: the guided tour atlas (`scripts/build-tour-atlas.mjs --check` as `npm run audit:tour-atlas`, which is about tour stops and screenshots, not these docs) and `scripts/audit-page-index.mjs`.
- No script reads `docs/ux-flows/` for coverage: `grep -rn "ux-flows" scripts` only matches the docs search-index builder.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
node -e '
const fs=require("fs");const j=JSON.parse(fs.readFileSync("data/pages.json","utf8"));const paths=new Set();
(function w(o){if(Array.isArray(o))o.forEach(w);else if(o&&typeof o==="object"){if(typeof o.path==="string")paths.add(o.path);Object.values(o).forEach(w)}})(j);
const txt=fs.readdirSync("docs/ux-flows").filter(f=>/^\d+.*\.md$/.test(f)).map(f=>fs.readFileSync("docs/ux-flows/"+f,"utf8")).join("\n");
console.log(paths.size,[...paths].filter(p=>txt.includes("`"+p+"`")).length)'
ls scripts | grep -i "audit-page-index\|build-atlas-index"
sed -n 1,30p scripts/audit-page-index.mjs
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Write `scripts/audit-ux-flows.mjs` (and `npm run audit:ux-flows`): parse every `docs/ux-flows/NN-*.md`, extract each backticked route in the routing tables and flow headings, and report (a) cited routes that resolve nowhere (not in `data/pages.json`, not a rewrite in `vercel.json` or `vite.config.js`, not a known dynamic prefix), (b) pages in `data/pages.json` marked as user-facing that no flow cites, ranked by whether the page is linked from the home or nav (use `public/atlas-index.json`). Exit non-zero only on (a); (b) is a report with a committed baseline `scripts/audit-ux-flows.baseline.json` so coverage can only grow.
2. Unit test `tests/audit-ux-flows.test.js`: route extraction from a fixture markdown string, alias resolution through the route table, and the baseline ratchet.
3. Resolve every (a) finding: for each stale route, either the page was renamed (update the doc line and its file citations after re-reading the source), or it is dead (remove the flow and say so in the commit message). Do not guess; re-read the entry module cited.
4. Trace the 12 highest-value uncovered routes into a new cluster file `docs/ux-flows/13-additional-routes.md` in the same format (Steps, Decision points, Empty/error states, External calls, with real file and symbol citations): rank by the (b) report, prefer money and onboarding routes (`/credits`, `/payments`, `/pay/simulator`, `/agent-wallet`, `/wallet`, `/trading`, `/markets`, `/dashboard/account`, `/login`, `/agora`, `/play`, `/launches`) over marketing pages. Each flow is traced from code, not from running the site.
5. Wire the doc into search: confirm `scripts/build-docs-search-index.mjs` picks up the new file; run `npm run build:docs-search`.
6. If a traced flow reveals an unreachable state or a visible bug, do not fix it in this order; write it as a one-line `Finding:` under that flow and report it so the owner can route it (most should be none).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm run audit:ux-flows` exits 0 with zero stale routes; the baseline file exists.
- [ ] `npx vitest run tests/audit-ux-flows.test.js` passes.
- [ ] `docs/ux-flows/13-additional-routes.md` exists with at least 12 flows, each citing real files that exist (the audit script also checks that cited file paths exist on disk).
- [ ] `npm run audit:docs` and `npm run check:rules -- --paths docs/ux-flows scripts/audit-ux-flows.mjs` clean.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A cited route is a dynamic pattern (`/agent/:id`) | Resolve against the route table patterns in `vercel.json`; treat a matching pattern as resolved. |
| A page's entry module is huge (the 9k-line marketplace) | Trace by the handler symbols and say "structural read" as the existing docs do. |
| Disagreement between code and doc | Code wins; update the doc and cite the symbol. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/781-plan-docs-ux-flows-atlas-route-coverage.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `781-plan-docs-ux-flows-atlas-route-coverage.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/ux-flows/12-home-and-content.md`
- `docs/ux-flows/07-crypto-trading-analytics.md`
- `docs/ux-flows/09-x402-agent-commerce.md`
