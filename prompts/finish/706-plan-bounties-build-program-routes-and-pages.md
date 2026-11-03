# Ship the bounty feed and Build program: routes, /build and /build/leaderboard pages, submissions

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/706-plan-bounties-build-program-routes-and-pages.md`.

**Priority:** P2, new capability with clear value (score 62 of 100 inside the tier). **Area:** bounties. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Hackathon and bounty listings (Devfolio, Devpost, GitHub) are a developer acquisition channel, and a Build program with rounds, a leaderboard and payouts gives builders a reason to ship on three.ws. The normalization lib, sources and a full schema exist, but `/build`, `/build/leaderboard` and `/tasks` return 404 and no route reads the tables. The existing `/bounties` page is an older board and must not be broken.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Built: `api/_lib/bounties/{normalize,store}.js`, `sources/{devfolio,devpost,github,index,program}.js`, migration `20260922200000_bounties_build_program.sql` (bounty_listings, bounty_runs, bounty_venue_accounts, bounty_submit_previews, bounty_submissions_out, program_rounds, program_submissions, program_leaderboard, program_payouts, changelog_runtime_entries).
- Missing: `/api/bounties` v2 feed routes, a refresh cron, `/build`, `/build/leaderboard`, submissions flow, agent tools, tests, docs.
- Note: `/api/pump-bounties` currently returns 502 upstream; the feed must tolerate one source being down.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
for p in /build /build/leaderboard /tasks /bounties; do curl -s -o /dev/null -w "$p %{http_code}\n" https://three.ws$p; done
ls api/bounties api/cron | grep -i bount; ls tests | grep -i bount
grep -rn "bounty_listings\|program_rounds" api --include=*.js -l | grep -v migrations
npm run db:status 2>&1 | tail -6
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first (`tests/bounties-feed.test.js`): `normalize.js` maps fixture payloads of each source to one shape; a failing source does not fail the feed; dedupe by url; expired listings drop out. Use recorded real responses saved as fixtures.
2. Cron `api/cron/bounties-refresh.js` (add to `vercel.json` crons) running `sources/index.js` and `store.js` upserts with per-source error capture.
3. Routes: `GET /api/bounties/feed?source=&status=&q=&cursor=`, `GET /api/build/rounds`, `GET /api/build/leaderboard`, `POST /api/build/submissions` (auth, zod, one per user per round), `GET /api/build/payouts`. Payout execution is out of scope (owner gate); record intent only.
4. Pages `pages/build.html` (`/build`) and `pages/build-leaderboard.html` (`/build/leaderboard`) in `data/pages.json`: round header with countdown, submit dialog, leaderboard table, listing feed with filters. States: skeleton, empty, error with retry and a "source unavailable" notice per source, hover/focus/active, mobile.
5. Agent tools `list_bounties`, `submit_build_entry` (write tier).
6. Docs `docs/bounties-and-build.md`, STRUCTURE.md, changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/bounties-feed.test.js` passes.
- [ ] `curl localhost:3000/api/bounties/feed` returns real listings from at least two live sources even with `pump` source failing.
- [ ] `/build` and `/build/leaderboard` verified in a browser in all four states.
- [ ] Existing `/bounties` page still works.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A source API requires a key | Skip that source with a clear status in the feed response; ship the others. |
| Payouts | Record `program_payouts` rows as pending; do not send funds (owner gate). |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/706-plan-bounties-build-program-routes-and-pages.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `706-plan-bounties-build-program-routes-and-pages.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/27-bounties-and-hackathons.md` (whole file)

~~~~markdown
# 27. Bounties and hackathons: a bounty feed agents can work, and a platform program with prize pools

Read `docs/prompts/README.md` first.

## The problem

Agents on three.ws can earn by selling skills and answering x402 calls. They cannot find open bounties across the ecosystem, triage which ones they can win, plan the work, and submit. And the platform has no program of its own: no hackathon, no prize pool, no leaderboard, nothing that routes competition activity into the `$THREE` flywheel. Competitors run both and publicize the prize pool as a headline.

## Build

### Bounty feed

- `api/_lib/bounties/` aggregator over public bounty sources (launchpad bounty boards, task marketplaces, grant programs, our own program below), normalized into `bounties` with title, reward, currency, deadline, requirements, venue, url, and an LLM-generated triage: category, required capabilities, estimated effort, and a `fit` score against an agent's skills. Refresh by cron.
- Tools `bounties_feed` (filters, fit for an agent), `bounty_plan` (returns a step plan the agent can execute as a run from prompt 05), `bounty_submit` (where the venue has an API; otherwise returns the submission checklist), `bounty_payouts` (checks creator payouts across venues where public).
- Page `/bounties` (in `data/pages.json`) with the feed, filters, fit badges when signed in, and "work this with my agent" which creates a run. Every state designed.

### Platform program

- `three.ws Build` program: `program_rounds` with a prize pool denominated in `$THREE` and USDC, dates, tracks, judging criteria, sponsors; submissions tied to agents and launches; a public leaderboard of activity metrics (volume, calls served, launches) computed by the economy cron; a share of the round's fee revenue routed to the `$THREE` buyback and stated on the page.
- Pages `/build` (the program), `/build/leaderboard`, `/build/submit`; announcements through the changelog and the community lanes in `data/announce-priority.json`.
- Admin tooling to open a round, judge, and pay out through the existing payout rails (`api/billing/` payouts), owner-gated at the on-chain step.
- Docs: `docs/bounties.md` and `docs/build-program.md` linked from `docs/start-here.md`; changelog entry tagged `feature`.

## Acceptance

- The feed shows live bounties from at least three external sources and our own round.
- An agent creates a run from a bounty plan and its steps appear.
- Opening a round publishes to the changelog lane; a payout stops at the owner confirmation table (gate 1).
- `npm test` green.
~~~~

