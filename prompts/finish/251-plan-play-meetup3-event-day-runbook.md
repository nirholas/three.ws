# Production health sweep, platform smoke battery and a refreshed live-ops sheet for the 2026-11-06 meetup

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/251-plan-play-meetup3-event-day-runbook.md`.

**Priority:** P0, live defect, security, or broken money rail (score 90 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Deadline: the meetup is 2026-11-06. After that date, re-scope this order to the next scheduled event or close it as moot.

The next event is $THREE Community Meetup #3 on 2026-11-06 16:00Z to 17:00Z. `docs/event-readiness/LIVE-OPS.md` is the one-page operator sheet, but it was written on 2026-08-08 for the previous event: its release SHA, revision names and scale table describe August. At review time production reports commit `ab4b79e90` while the working tree is 24 commits ahead, so what the owner thinks will be live may not be. A stale runbook is worse than none on the day. This order verifies production, runs the platform battery, applies the pre-approved config-only scaling, rehearses rollback by command (not by shifting traffic), and regenerates LIVE-OPS.md for this event with the one remaining owner-gated step stated as a single command.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `curl -s https://three.ws/api/version` returned status ok, version 1.5.2, commit `ab4b79e90`; `git log -1` locally is `b1a2da5dd`, 24 commits later.
- `public/event.json`: `three-community-meetup-3`, 2026-11-06T16:00:00Z to 17:00:00Z, link to the canonical $THREE /play URL.
- LIVE-OPS.md (311 lines) targets "$THREE Community Day", records scale `three-ws-api` min 6 / max 100, `three-ws-multiplayer` 1 / 1 hard (4 CPU, 8Gi), `three-ws-redis-proxy` 3 / 10, and has a rollback section with a rehearsal dated 2026-08-08.
- Tooling present: `npm run smoke:prod`, `audit:web`, `audit:web:login`, `audit:links`, `audit:pages`, `check:pages`, `audit:console`, `audit:overlays`, `audit:inline-handlers`, `audit:routes`, `audit:route-shadowing`, `audit:docs`, `logs:errors`, `audit:cron-liveness`, `check:cron-drift`, `db:status`, `check:relayer-balances`, `audit:service-wallets`, `check:event`, `clean:worktrees`, `deploy:gcp:purge-cdn`, `deploy:gcp:full`. Agents: `deploy-preflight`, `x402-economy-triage`; skill `gcp-triage`.
- The event override from `docs/event-readiness/11-event-live-ops.md` may or may not exist yet (`ls api/event-config.js`); if it does, LIVE-OPS.md must document the `event:override` commands; if not, the sheet documents the file-edit plus deploy path.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
R="--region us-central1 --project aerial-vehicle-466722-p5"
curl -s https://three.ws/api/version; git log -1 --format='%h %s'; git log --oneline "$(curl -s https://three.ws/api/version | python3 -c 'import sys,json;print(json.load(sys.stdin)["commitShort"])')..HEAD" | wc -l
cat public/event.json | head -8; npm run check:event
gcloud run services list $R --format='table(metadata.name,status.latestReadyRevisionName,spec.template.metadata.annotations)'
npm run db:status
ls api/event-config.js 2>/dev/null; sed -n 1,40p docs/event-readiness/LIVE-OPS.md
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Production sweep (audit 08), recording a binary state for each item: liveness (`/api/version`, healthz, `npm run smoke:prod`); error logs for 24 h (`npm run logs:errors` plus the `gcloud logging read` query) with every recurring error root-caused and fixed or accepted with a stated reason; crons (`npm run audit:cron-liveness`, `npm run check:cron-drift`) all firing, including the changelog push; database (`npm run db:status` read only, resolve any pending migration deliberately and never run `db:migrate` casually); one real generation per public lane (text to 3D at minimum) proven end to end on production, with failover proven for any lane with a broken primary; x402 economy (`npm run check:relayer-balances`, `npm run audit:service-wallets`; if settles fail, run the `x402-economy-triage` agent before concluding wallets are dry); abuse posture (rate limits on chat, generation and auth must not throttle a venue NAT sharing one IP; raise or re-key now if they would); TLS, DNS and CDN freshness (`npm run deploy:gcp:purge-cdn` after the final deploy). Solana first in the summary.
2. Platform smoke battery (audit 07) against production, then fix on `npm run dev`: `smoke:prod`, `audit:web`, `audit:web:login`, `audit:links`, `audit:pages`, `check:pages`, `audit:console`, `audit:overlays`, `audit:inline-handlers`, `audit:routes`, `audit:route-shadowing`, `audit:docs`. Fix priority: 404 or blank pages, console errors, dead links and buttons, layout at 320, 768 and 1440 px. Walk the event funnel by hand signed out: home, /play with the canonical URL, /launches, /changelog and the nav between them; ensure a visitor can reach "what is three.ws" and "launch your own coin world" from /play in two clicks or fewer. Verify OG tags and images for /play and the home page via `api/page-og.js` and `api/play-og.js`. Rerun until clean; adjust audit rules for false positives rather than ignoring them.
3. Deploy state. Run the `deploy-preflight` agent and `npm run check:event`; confirm the intended event build is what is committed, and stage everything so shipping is one command (`npm run deploy:gcp:full`). The deploy itself and any `git push` stay owner-gated: put the exact command and the commit list that would go live (24 or more commits, summarised by area) in the report.
4. Pre-scale (config-only, pre-approved): raise `three-ws-api` min-instances (the August value was 6; use `--update-env-vars` style discipline, here `gcloud run services update ... --min-instances=N` only), confirm max and concurrency leave headroom per `docs/ops/gcp-credits-plan.md`, keep `three-ws-multiplayer` at max-instances 1 and raise only CPU, memory or concurrency based on the capacity figure from `scripts/play-net-audit.mjs` if present (or a fresh burst test), and size `three-ws-redis-proxy`. Record old and new values.
5. Worktree hygiene and rollback: `npm run clean:worktrees` then `--apply`; for each service write down the current and previous revision and the exact one-line `gcloud run services update-traffic --to-revisions` command; verify the previous revision exists and is routable (read `status.traffic` and revision readiness; do not shift traffic).
6. Third-party dependency failover: list every external dependency in the event path (Solana RPC, Pump.fun feed, IPFS gateway for coin images, LLM and TTS providers, the multiplayer Redis) and prove each failover rung works today (block or time out the primary in a controlled test), not only that it is configured.
7. Capacity smoke: drive a burst of concurrent sessions at /play at least 2x the expected meetup peak (state the assumed peak and its source), watch p95 latency, error rate and instance count, and fix or pre-scale whatever bends.
8. Regenerate `docs/event-readiness/LIVE-OPS.md` for Meetup #3 with zero fluff: the event URL (canonical, from `docs/event-readiness/README.md`) and the live release SHA; three health curls; two log commands; per-service rollback commands pre-filled with the real revisions; current and raise-further scale commands; accepted known failure modes with what to do if each fires; escalation map (`x402-economy-triage`, `gcp-triage`, `scripts/play-mobile-repro.mjs`); the broadcast commands (`scripts/announce-play.mjs`) and the event config path (override commands if they exist, else file edit and deploy). Remove all August facts. Add a scheduled "T minus" checklist for 2026-11-05 and 2026-11-06 with times in UTC.
9. Add `scripts/check-live-ops-fresh.mjs` (and wire it into `npm run check:event` or document it beside it) that fails when LIVE-OPS.md names an event id, start time or release SHA that disagrees with `public/event.json` or with `/api/version`, so the sheet cannot silently go stale again. Add a test in `tests/` for its parsing.
10. Report: Solana-first status, the eight sweep items with binary states and log queries for anything fixed, the battery results before and after, scale old and new, rollback rehearsal result, and the single remaining owner-gated command.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -n "three-community-meetup-3" docs/event-readiness/LIVE-OPS.md` matches and `grep -n "Community Day" docs/event-readiness/LIVE-OPS.md` returns nothing.
- [ ] `node scripts/check-live-ops-fresh.mjs` exits 0 on the regenerated sheet and non-zero when the event id in the sheet is altered (test covers both).
- [ ] `npm run smoke:prod`, `audit:links`, `audit:pages` and `audit:console` finish clean or with a one-line justified exception each.
- [ ] `npm run db:status` shows no unintended pending migration; `npm run check:event` passes.
- [ ] `gcloud run services describe` for the three services shows the recorded scale values, with `three-ws-multiplayer` max-instances still 1.
- [ ] The report names the single remaining deploy command and the list of commits it ships.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `gcloud` not on PATH | `export PATH="$HOME/google-cloud-sdk/bin:$PATH"`; auth per the self-unblock playbook GCP row. |
| `npm run audit:console` times out on a busy machine | Lower `CONCURRENCY`, raise `SETTLE_MS` and `SERVER_BOOT_MS`; treat an all-timeout run as unmeasured and rerun when quiet. |
| x402 settles look failed or wallets look dry | Run the `x402-economy-triage` agent before concluding anything. |
| Production is behind the working tree | That is expected: do not deploy (owner gate). Verify findings on both, fix locally, and list what the pending deploy contains. |
| A pending migration blocks the sweep | Read `npm run db:status`, apply only a migration you have read and that belongs to shipped code; never apply others. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The final production deploy and any `git push` are owner-approved steps; stop at "one command left". Scaling changes are config-only and pre-approved. No spend, mint or on-chain action is part of this order.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/251-plan-play-meetup3-event-day-runbook.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `251-plan-play-meetup3-event-day-runbook.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/07-platform-smoke-sweep.md` (whole file)

~~~~markdown
# Audit 7: whole-platform smoke sweep (every page, every link)

Event visitors will not stay on /play; they will click around. Every page declared in `data/pages.json` must load clean, every link must resolve, every button must do something.

## The tooling (all already in the repo)

Run these against production first to find real user-facing breakage, then against `npm run dev` to fix:

- `npm run smoke:prod`: sweeps every page in `data/pages.json` against the live site.
- `npm run audit:web`: unauthenticated browser sweep. `npm run audit:web:login`: authed sweep using the QA account (`AUDIT_EMAIL`/`AUDIT_PASSWORD` in `.env`). Both accept route paths as arguments to narrow the sweep and `--engine webkit` or `--engine firefox` to run it outside Chromium (`npx playwright install webkit` once); a WebKit run counts one failed resource as one finding, not three. `npm run ui:review` is the visual sweep over the same route list.
- `npm run audit:links`: dead links. `npm run audit:pages` and `npm run check:pages`: pages.json integrity.
- `npm run audit:console`: console errors per page. `npm run audit:overlays`, `npm run audit:inline-handlers`, `npm run audit:routes`, `npm run audit:route-shadowing`: overlay/handler/route health.
- `npm run audit:docs`: dead doc links and commands naming scripts that no longer exist.

`audit:console` drives a real browser per route, so a machine already busy with
other browser fleets or test workers distorts it: navigations blow the 30s
budget and the dev server itself can miss its boot window, and both land in the
report as page failures they are not. It reuses a dev server already answering
on :3000 when there is one, which is the cheapest way to keep a long sweep
honest. Four env knobs cover the rest: `CONCURRENCY` (default 5) routes checked
at once, `SETTLE_MS` (default 3000) the per-route wait for async work to land,
`SERVER_BOOT_MS` (default 240000) how long Vite gets to come up, and
`REUSE_PROBE_MS` (default 20000) how long the :3000 reuse probe waits for an
answer. Lower the first, raise the rest, on a loaded box. Treat a run whose
failures are all navigation timeouts or `net::ERR_*` as unmeasured rather than
red, and re-run it when the machine is quiet.

## What to do

1. Run the full battery above. Triage every failure into: broken for users (fix now), cosmetic (fix now if under 15 minutes), false positive (note why).
2. **Fix priority order:** pages that 404 or render blank, then console errors, then dead links/buttons, then layout breakage at 320px/768px/1440px.
3. **The event funnel gets extra depth.** Walk these by hand, signed out, as a stranger would: home page, /play (canonical $THREE URL in `docs/event-readiness/README.md`), /launches, /changelog, the nav between them. Every step must be obvious and fast.
4. **Cross-linking check.** From /play, can a curious visitor find what three.ws is and how to launch their own coin world? If the path is more than 2 clicks or invisible, wire it (a HUD link, a share control, whatever fits the existing design language).
5. **OG cards.** The event link will be pasted into Telegram/X/Discord. Verify /play and the home page return correct og:image, title, and description (play.html uses /api/page-og; confirm it renders live).
6. Re-run the battery until clean, fixing as you go. A false positive that will confuse the next person gets its audit rule adjusted, not ignored.

## Verify

- All listed audits pass (or have a one-line justified exception in the report).
- `npm test` stays green.

## Report format

Battery results before and after, fixes grouped by page, the manual event-funnel walkthrough result, and any exception you accepted with its reason.
~~~~

### `docs/event-readiness/08-api-production-health.md` (whole file)

~~~~markdown
# Audit 8: production API and infrastructure health

Everything server-side must be verifiably healthy before the event: Cloud Run, crons, database, the x402 economy, and the failover chains. Use the gcp-triage skill if available; otherwise follow this checklist directly.

Project `aerial-vehicle-466722-p5`, region `us-central1`, service `three-ws-api`. If `gcloud` is not on PATH: `export PATH="$HOME/google-cloud-sdk/bin:$PATH"`. Full runbook: `docs/ops/gcp-production.md`.

## What to check and fix

1. **Liveness.** `curl -s https://three.ws/api/version` (live SHA + revision; confirm it is the commit you expect) and the healthz endpoint. `npm run smoke:prod` for the page layer.
2. **Error logs, last 24h.** `npm run logs:errors`, and for depth: `gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" severity>=ERROR' --freshness=24h`. Every recurring error gets root-caused and fixed or explicitly accepted with a reason. "It has always logged that" is not a reason.
3. **Crons.** `npm run audit:cron-liveness` and `npm run check:cron-drift`. All Cloud Scheduler jobs (synced from vercel.json's crons array) firing and succeeding; pay attention to `/api/cron/changelog-push` since we will ship changelog entries before the event.
4. **Database.** `npm run db:status` (read only; NEVER run `db:migrate` casually, it applies immediately with no dry run). Pending migrations at event time are a deploy-gate failure waiting to happen: resolve them deliberately today. Check `forge_creations` for elevated generation error rates.
5. **Generation lanes and LLM chain.** Exercise one real generation per public lane (text-to-3D at minimum) end to end on production. A lane with a broken primary must be proven to fail over, not assumed to.
6. **x402 economy.** If any settle failures or stalls appear in logs, run the x402-economy-triage agent before concluding anything about wallet balances; settle-floor starvation and capital dispersion look identical from outside. Also `npm run check:relayer-balances` and `npm run audit:service-wallets`.
7. **Rate limits and abuse posture.** The event link will be public. Confirm the obvious abuse surfaces (chat, generation endpoints, auth) have rate limiting that will not also throttle legitimate burst traffic from one venue IP/NAT. If venue NAT would trip an IP-based limit, raise or key it differently now.
8. **TLS/DNS/CDN.** Certificate validity, and confirm the CDN serves current content (a stale edge after the last deploy shows phantom failures; the purge command is `npm run deploy:gcp:purge-cdn`).

## Verify

Each numbered item ends in a binary state: healthy, or fixed-and-now-healthy, or a named owner-level decision with exactly what remains.

## Report format

Solana-first status summary, then the 8 items with their binary states, then log evidence links/queries for anything you fixed.
~~~~

### `docs/event-readiness/10-event-day-runbook.md` (whole file)

~~~~markdown
# Audit 10: event-day readiness runbook (run last, after fixes have shipped)

Everything is fixed and deployed; now make the platform boringly reliable for the traffic spike and give the owner a one-page live-ops position. This prompt both executes the pre-scaling and produces the runbook.

Project `aerial-vehicle-466722-p5`, region `us-central1`. Pre-approved scaling and quota posture: `docs/ops/gcp-credits-plan.md`. Full production runbook: `docs/ops/gcp-production.md`. Config-only `gcloud run services update` changes are pre-approved; use `--update-env-vars` only, never `--set-env-vars`.

## Execute now (day before)

1. **Deploy state.** Confirm the intended final build is live: `curl -s https://three.ws/api/version` matches the release SHA. If a deploy is still pending, run the deploy-preflight agent and stage everything so shipping is one command; the deploy itself stays owner-gated.
2. **Pre-scale.** Raise `min-instances` on `three-ws-api` (and the /play world server if it is a separate service; check `gcloud run services list`) so the first traffic wave never hits a cold start. Confirm max-instances and concurrency leave headroom per the credits plan. Config-only, pre-approved: do it, record old/new values.
3. **Worktree hygiene.** `npm run clean:worktrees` (then `--apply`) so a mid-event hotfix deploy cannot die on a full disk.
4. **Rehearse rollback.** Identify the current and previous Cloud Run revisions and write down the exact one-line traffic-rollback command for each service. Verify the previous revision still exists and is routable.
5. **Monitoring loop.** Set up the recurring production check for event day (the gcp-triage sweep or `npm run logs:errors` + `npm run smoke:prod` on an interval). Confirm alerting actually reaches a human.
6. **Capacity smoke.** Drive a burst of concurrent sessions at /play (Playwright contexts or a load tool) at least 2x the expected peak. Watch p95 latency, error rate, and instance count. Fix or pre-scale whatever bends.
7. **Third-party dependencies.** List every external dependency in the event path (Solana RPC, Pump.fun feed, IPFS gateway for coin images, LLM providers) and verify each has a working failover rung today. Test the failover, not just its existence.

## Produce: the one-page live-ops sheet

Write `docs/event-readiness/LIVE-OPS.md` containing, with zero fluff:

- The event URL (canonical $THREE /play link from `docs/event-readiness/README.md`) and the release SHA that is live.
- Health: the 3 curl commands that prove the site is up.
- Logs: the 2 log commands for fast triage.
- Rollback: the exact per-service revision-rollback command, pre-filled.
- Scale: current min/max instances and the command to raise them further.
- Known failure modes from audits 1-9 that were accepted rather than fixed, and what to do if each one fires.
- Escalation: which subsystem maps to which triage tool (x402-economy-triage, gcp-triage, `scripts/play-mobile-repro.mjs`).

## Report format

Old/new scaling values, capacity smoke numbers, rollback rehearsal result, and the link to LIVE-OPS.md. Anything owner-gated (the final deploy) stated as the single remaining command.
~~~~

### `docs/event-readiness/LIVE-OPS.md` (whole file)

~~~~markdown
# LIVE-OPS: $THREE Community Day

One page. Everything an operator needs while the event is running, and nothing else.
Prepared 2026-08-08. Project `aerial-vehicle-466722-p5`, region `us-central1`.

---

## The link and the release

**Event URL** (the canonical $THREE world, from [README.md](README.md)):

```
https://three.ws/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three&image=%2Fapi%2Fimg%3Furl%3Dhttps%253A%252F%252Fipfs.io%252Fipfs%252Fbafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q%26seed%3DFeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump
```

**Live release as of this writing:** `c1e600a04` on revision `three-ws-api-00364-n65`.
The world server runs an image built 2026-08-06 (revision `three-ws-multiplayer-00010-g89`).

> The release SHA above is NOT the event build. The event features (quest line,
> photo mode, live event board, `/event` landing page, operator announce, the
> `/population` endpoints) are committed but unshipped. See
> [Ship the release](#ship-the-release-owner-gated) at the bottom. Confirm the SHA
> with `curl -s https://three.ws/api/version` after the deploy and update this line.

---

## Health: three commands that prove the site is up

```bash
# 1. API alive, and which build is actually serving
curl -s https://three.ws/api/version

# 2. API subsystems (x402, monitor, speech, alerts) - status must be "ok"
curl -s https://three.ws/api/healthz | head -c 400

# 3. The world server itself. If this is not {"ok":true}, /play is dead
#    no matter what the site says.
curl -s https://three-ws-multiplayer-93741856042.us-central1.run.app/health
```

Continuous version, one terminal, quiet unless something changes:

```bash
npm run event:watch                  # every 30s
npm run event:watch -- --interval 15 # tighter during the opening rush
npm run event:watch -- --once        # single sweep; exit 1 if anything is down
```

It watches the API, the live release SHA, the `/play` page (including that the
game bootstrap is still in the HTML), the world server, and the live player
count. It is plain HTTPS on purpose: it keeps working when `gcloud` auth has
expired, which it does on its own schedule in this environment.

---

## Logs: two commands for fast triage

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"

# Errors across the whole fleet, last 6h
npm run logs:errors

# The world server specifically - join refusals, origin rejections, room churn
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="three-ws-multiplayer" severity>=WARNING' \
  --freshness=1h --limit=50 --project aerial-vehicle-466722-p5
```

Deeper sweep when the cause is not obvious: `npm run triage:gcp:deep`.

---

## Rollback: pre-filled, per service

**These three revisions are the known-good pre-event state.** They are live right
now and all report Ready. After tomorrow's release deploy creates new revisions,
these are what you roll back TO.

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
R="--region us-central1 --project aerial-vehicle-466722-p5"

# API + frontend
gcloud run services update-traffic three-ws-api $R \
  --to-revisions=three-ws-api-00364-n65=100

# The /play world server (kicks everyone in-world; they auto-reconnect)
gcloud run services update-traffic three-ws-multiplayer $R \
  --to-revisions=three-ws-multiplayer-00010-g89=100

# Redis proxy (presence, durable builds)
gcloud run services update-traffic three-ws-redis-proxy $R \
  --to-revisions=three-ws-redis-proxy-00004-bwk=100
```

Then purge the edge or the CDN keeps serving the bad build:

```bash
npm run deploy:gcp:purge-cdn
```

Return to normal afterwards with `--to-latest` instead of `--to-revisions`.

**Rehearsal result (2026-08-08):** every target above exists and reports
`Ready=True` with 100% of traffic. Traffic was not actually shifted, because
shifting it and back is itself two world-server restarts on the eve of the event;
the commands are the same `update-traffic` calls that created the current
routing, and the revisions are the ones already serving.

---

## Scale: what is set, and how to raise it

Pre-scaled 2026-08-08 (config-only, pre-approved per
[docs/ops/gcp-credits-plan.md](../ops/gcp-credits-plan.md)):

| Service | min | max | concurrency | CPU / memory | changed from |
|---|---|---|---|---|---|
| `three-ws-api` | **6** | 100 | 160 | 2 / 4Gi | min was 2 |
| `three-ws-multiplayer` | 1 | **1 (hard)** | 1000 | **4 / 8Gi** | was 2 CPU / 4Gi |
| `three-ws-redis-proxy` | **3** | **10** | 80 | default | was min 2 / max 4 |

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
R="--region us-central1 --project aerial-vehicle-466722-p5"

# More API headroom (safe, instant)
gcloud run services update three-ws-api $R --min-instances=12 --max-instances=200

# More world-server headroom. NOTE: raise CPU/RAM or concurrency, never max-instances.
gcloud run services update three-ws-multiplayer $R --cpu=8 --memory=16Gi
gcloud run services update three-ws-multiplayer $R --concurrency=2000
```

**`three-ws-multiplayer` max-instances must stay 1.** Colyseus rooms live in one
process. A second instance is only correct when the room registry and presence
are shared through Redis *and* each instance is individually addressable so a
seat reservation lands on the box hosting the room. Cloud Run gives every
instance the same URL, so instance 2 would silently split players in the same
world into two invisible crowds. A Memorystore Redis exists
(`three-ws-redis`, `10.234.231.139:6379`) and `REDIS_URI` would switch the driver
on, but the addressability half is not solved and the eve of an event is not when
to find out. Use CPU, memory, and concurrency instead.

---

## Capacity: measured, not assumed

`npm run event:capacity -- --n 400 --ramp 45 --hold 150` against live production,
2026-08-08:

| | |
|---|---|
| requested / joined | 400 / 400 (100%) |
| held for the full 150s | 400 |
| join latency | p50 155ms · p95 219ms · max 388ms |
| mid-run drops | 0 |
| moves sent / state patches | 269,633 / 415,418 |
| verdict | PASS on all four thresholds |

The single world instance carried 400 concurrent players walking at 8 Hz with
zero drops. The known cliff is the concurrency ceiling: at 1000 simultaneous
connections Cloud Run wants a second instance and `max-instances=1` refuses it.
If the count approaches that, raise `--concurrency`, not `--max-instances`.

One caveat baked into the harness: at 400 clients its own event loop stalls, so
the page-latency figure it prints measures the machine running it, not the
origin. It now prints its own loop lag next to that number and says so. An idle
`curl` during the same run measured `/play` at a steady 420-490ms.

---

## Known failure modes and what to do

Audits 1-9 did not leave an accepted-risk register, so this is derived from the
code's own documented landmines plus what was measured on 2026-08-08.

| If this happens | Why | Do this |
|---|---|---|
| `/play` loads but nobody sees anyone else | World server restarted or a second instance appeared | `curl .../health`; confirm `max-instances=1`; rollback command above |
| Players kicked seconds after joining, phones only | Mobile memory kill, not a network fault | `node scripts/play-mobile-repro.mjs` reproduces it; it reads as bytes, not as a networking bug |
| `/walk` looks completely offline while `/play` works | Someone set `PLAY_GATE_MINT`/`THREE_MINT` on the world server. `/walk` sends no play pass, so every join throws `play_pass_required` (landmine documented in `multiplayer/src/rooms/WalkRoom.js`) | Unset it: `gcloud run services update three-ws-multiplayer $R --remove-env-vars=PLAY_GATE_MINT,THREE_MINT` |
| NPC / concierge replies slow or absent | Paid LLM tier is degraded today: OpenRouter `402 Payment Required`, OpenAI `429`. Vertex Gemini is healthy and the free-first chain leads, so players still get answers (measured 8-16s first token after live demotions) | Nothing during the event. Topping up OpenRouter is an owner spend decision |
| Wallet balances read as zero / holder tier collapses to Member | Helius and Alchemy are both `429` today. 6 free rungs plus the QuickNode reserve carry it (proven by poisoning the primary) | `npm run event:failover` to see which rungs are live now |
| Coin image missing on the event link or OG card | `4everland.io` gateway times out, `gateway.pinata.cloud` is slow (~4s). `api/img.js` races five gateways and takes the first valid one | Nothing. 4 of 5 gateways served the CID on 2026-08-08 |
| An x402 / boutique payment does not settle | `/api/healthz` shows 50,442 settle failures with `fee_runway_exhausted`. This is settle-floor starvation, which looks identical to "the wallets are dry" and has a different fix | Run the `x402-economy-triage` agent BEFORE concluding anything about wallet balances |
| A deploy dies at `npm ci` with "package.json and package-lock.json are not in sync" | Almost certainly NOT a dependency mistake. `FROM node:24-slim` floats, so a newer bundled npm resolves the tree differently and rejects an untouched lockfile. This took the 2026-08-08 release build down | The Dockerfile now pins `ARG NPM_VERSION`. If it recurs, compare `npm --version` locally against `docker run --rm node:24-slim npm --version` and set the pin to the version that produced the lockfile |
| Something breaks and nobody is told | Push alerting is thin. `TELEGRAM_ALERTS_CHAT_ID` is unset in production, so `/api/healthz` reports `telegram_push: "disabled"` and platform alerts land only in the `ops_alerts` table | Email now works: two uptime checks (site + world server) and two alert policies (uptime failure, `three-ws-api` 5xx rate) were created 2026-08-08 and page `nich@sperax.io`. Email is slow, so also keep `npm run event:watch` open on a screen |

---

## Talk to the whole world mid-event

`scripts/announce-play.mjs` pushes a message to every player standing in a live
world, right now. It is the host's microphone: use it to call each agenda beat,
to tell people where to go, and to say anything that cannot wait for chat to
scroll. Requires the world server to be running the event build (the endpoint is
`/internal/announce`; a 404 means the deploy below has not happened yet).

```bash
# Every live world, toast only
node scripts/announce-play.mjs "Totem showdown starts in 2 minutes. Get to the plaza."

# With a title: also raises the centre-screen banner for 12s
node scripts/announce-play.mjs \
  --title "Wheel hour" \
  --detail "Free spin at Fortune's Folly, prizes on every wedge" \
  "Wheel hour is open. Head to the plaza wheel."

# Only the $THREE world, and hold the banner 30s
node scripts/announce-play.mjs --coin FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump \
  --duration-ms 30000 --title "Fireworks" "Look up."
```

It prints how many rooms and players it reached, so `0 player(s)` is your cue
that nobody is in the world yet (or that you targeted the wrong coin). The
request is HMAC-signed with `MULTIPLAYER_SHARED_SECRET` (falling back to
`HOLDER_PASS_SECRET`, which is in `.env`), and the server rejects an unsigned or
stale call, so the endpoint is safe to leave exposed. Announcements ride the same
`notice` channel the game already uses, so they reach every connected client
regardless of which build the player loaded.

---

## Escalation: which tool for which subsystem

| Subsystem | Tool |
|---|---|
| x402 payments, settles, the ring, "wallets are dry" | `x402-economy-triage` agent. Do not diagnose by hand; settle-floor starvation and capital dispersion look the same from outside |
| Cloud Run, crons, logs, DB migrations, TLS, fleet readiness | `gcp-triage` skill, or `npm run triage:gcp:deep` |
| Phones dropping out of the world | `node scripts/play-mobile-repro.mjs` |
| Any page 404/500 across the site | `npm run smoke:prod` |
| A third-party provider suspected down | `npm run event:failover` |
| World capacity under a crowd | `npm run event:capacity -- --n <2x current peak>` |

---

## Ship the release (owner-gated)

Two services, two commands. Both need explicit owner approval.

```bash
# 1. API + frontend (26+ commits ahead of what is live)
npm run deploy:gcp:full

# 2. The world server - required for the event features and /population.
#    Its image predates every event commit.
cd multiplayer && ./deploy-cloudrun.sh
```

`deploy-cloudrun.sh` now defaults to `CPU=4 MEMORY=8Gi` so a redeploy cannot
silently undo the pre-scaling above. `gcloud run deploy` replaces resource limits
on every run, so a hotfix deploy with the old defaults would have halved the
world server's CPU mid-event.

After either deploy: `curl -s https://three.ws/api/version`, then
`npm run event:watch -- --once`, then update the release SHA at the top of this
page.

---

## Open items

1. **`TELEGRAM_ALERTS_CHAT_ID` exists nowhere** (not `.env`, not `.env.local`, not
   the Cloud Run service). Every alerting path in `api/_lib/alerts.js` is already
   wired behind it; it needs one private chat/DM id, which only the owner can
   create. Then:
   `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars=TELEGRAM_ALERTS_CHAT_ID=<id>`
   (`--update-env-vars`, never `--set-env-vars`.) It must be a private chat: alerts
   carry stack traces, URLs, and IPs.
2. **Email alerting now exists; it did not before 2026-08-08.** Created that day
   and wired to the existing verified `nich@sperax.io` channel:

   - uptime check `three.ws API healthz` on `https://three.ws/api/healthz`
   - uptime check `three.ws world server` on the world server's `/health`
   - policy "Event: three.ws or the /play world server is DOWN" (uptime failing
     from more than 2 probe locations)
   - policy "Event: three-ws-api 5xx rate elevated" (5xx above 5/s for 5 minutes)

   Both policies link back to this page. Email is minutes-slow by nature, so it is
   the backstop, not the primary: `npm run event:watch` is the primary.

3. **The release build failed once on 2026-08-08** at the `npm ci` layer, root
   caused to the floating base image (see the failure-modes table). The Dockerfile
   pin is committed; the build has not been re-run since, so the release still
   needs a green build before the deploy commands above are known good.

4. **`gcloud` auth expires on its own schedule here.** It died mid-session
   (`invalid_grant: reauth related error (invalid_rapt)`) and was restored with
   `gcloud auth login --no-launch-browser`. Verify with a real call
   (`gcloud run services describe three-ws-api --region us-central1`), never with
   `gcloud auth list`, which reports an expired account as ACTIVE.

## Removing a signature from the wall

The signature wall (`docs/signature-wall.md`) filters slurs and links on the way in,
but a human can still sign something that should come down. Removal is owner-only
(Bearer `CRON_SECRET`) and by signature id. Find the id in the wall's public read
(`curl "https://three.ws/api/play/signature-wall?limit=50"`, each record has `id`
and `no`) or in a share link (`/api/play/signature-wall-og?id=<id>`).

```bash
curl -X DELETE -H "Authorization: Bearer $CRON_SECRET" \
  "https://three.ws/api/play/signature-wall?id=<id>"
```

Returns `{ "ok": true, "removed": "<id>", "total": N }`, or 404 for an unknown id.
Players in the world drop the tile at their next full reload (within 5 minutes). The
signer's one-signature claim is kept on purpose, so removal cannot be used to
re-sign the same thing.
~~~~

