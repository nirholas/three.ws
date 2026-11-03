# The operator can extend, rename or end the live event through an authed override without a redeploy

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/254-plan-play-event-config-live-override.md`.

**Priority:** P0, live defect, security, or broken money rail (score 86 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`public/event.json` is baked into the container image, and four independent readers consume it: the browser (`src/shared/event-config.js`, countdown, agenda, fireworks), the API (`api/_lib/event-config.js`, read from disk, cached a minute), and the game server (`multiplayer/src/event-window.js`, HTTP poll of `/event.json` every minute, failure closed). Today the only way to change the window during an event is to edit the file and run the full production deploy. If the meetup runs long, starts late or must be cancelled on 2026-11-06, the operator has no live control, and a wrong window silently removes the quest line, leaderboard payouts and souvenir grant. Broadcast and the go-live moment already shipped; this config override is the single open item of that spec.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `public/event.json` holds `three-community-meetup-3`, starts 2026-11-06 16:00Z. Edited only via `npm run event:schedule -- ... --apply` (`scripts/schedule-event.mjs`), validated by `npm run check:event` (`scripts/check-event-window.mjs`, which exports `validateEventConfig`, `NO_EVENT_DOC`, `isNoEventSentinel`).
- `api/_lib/event-config.js`: synchronous `eventConfig()` with a 60 s cache, `readFileSync(public/event.json)`, parsed by `parseEventWindow` from `multiplayer/src/event-window.js`. Callers: `api/play/event-leaderboard.js`, `api/internal/event-score.js`, `api/_lib/feed.js`, `api/_lib/sentry.js`, `api/_lib/event-markets/resolvers/event_leaderboard.js`, `api/_lib/event-markets/sources/platform-event.js`.
- `multiplayer/src/event-window.js` fetches `${WORLD_API_BASE}/event.json`.
- `app_settings (key, value)` table exists (created in `api/_lib/migrations/20260922210000_free_tier_models.sql`) and is used for stale-while-revalidate settings in `api/_lib/fade-radar.js`.
- Admin auth: `requireAdmin(req, res)` in `api/_lib/admin.js`. HMAC-signed ops precedent: `POST /internal/announce` in `multiplayer/src/index.js`; ops auth: `authorizeOps` in `api/_lib/ops-auth.js`.
- No override path exists (`grep -rn "event_override\|event-override" api src multiplayer scripts` is empty). The operator copy is `docs/event-readiness/LIVE-OPS.md`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
cat public/event.json
grep -rn "event_override\|event-override" api src multiplayer scripts docs | head
sed -n 1,80p api/_lib/event-config.js
sed -n 60,140p multiplayer/src/event-window.js
sed -n 40,75p src/shared/event-config.js
grep -n "export async function authorizeOps" -B3 -A25 api/_lib/ops-auth.js
npm run check:event
npm run db:status
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. Add `tests/event-config-override.test.js`: the effective config equals the static file when no override exists; an override with a later `endsAt` extends the window for all three readers; an override naming the no-event sentinel ends it; an invalid override (fails `validateEventConfig` rules, end before start, window longer than the cap, unknown id change that would orphan the leaderboard) is rejected at write time and ignored at read time; a failed override read falls back to the static file and never opens a closed gate by accident (the game server stays fail-closed on a cold start); an unauthenticated write is refused. Confirm each fails before the code exists.
2. Storage: persist the override in `app_settings` under key `event_override` (JSON value plus `updated_by` and `updated_at`). No migration should be needed since the table exists; verify with `npm run db:status` and do not run `db:migrate` unless you add a migration, in which case apply only your own file.
3. API: create `api/event-config.js` (route `/api/event-config` in `vercel.json`, registered the way sibling routes are): `GET` public, returns the effective event document (static file merged with a valid override), `Cache-Control: public, max-age=15`; `POST` admin only (`requireAdmin`, plus the HMAC ops path from `api/_lib/ops-auth.js` so an operator script can call it without a browser session) accepting `{ startsAt?, endsAt?, name?, tagline?, link? }` or `{ clear: true }` or `{ end: true }`, validated with the exact rules from `scripts/check-event-window.mjs` (import `validateEventConfig`; do not copy it). Audit-log each write (who, before, after).
4. Make all readers honour it: `api/_lib/event-config.js` keeps its synchronous signature by holding the override in a stale-while-revalidate cache refreshed from `app_settings` every 15 s in the background (the 60 s file cache becomes a 15 s effective cache); `multiplayer/src/event-window.js` polls `/api/event-config` first and falls back to `/event.json`, preserving the fail-closed behaviour; `src/shared/event-config.js` reads `/api/event-config` and falls back to `/event.json` so the browser still works if the API is down.
5. Operator tooling: add `scripts/event-override.mjs` (`--extend <minutes>`, `--end`, `--rename "..."`, `--clear`, `--show`; signs the ops request; prints the effective window in the zones used by `schedule-event.mjs`), an `npm run event:override` script, and document the exact curl and the script in `docs/event-readiness/LIVE-OPS.md`, `docs/event-readiness/10-event-day-runbook.md` and `docs/play-live-events.md`.
6. Verification on `npm run dev` with the multiplayer server: open /play, run `npm run event:override -- --extend 30`, and observe within about a minute the countdown/live pill, the API's `GET /api/play/event-leaderboard` window and the game server's quest gate all move to the new end; then `--end` and observe all three close; then `--clear` and confirm the static file governs again. Record timings and the commands used.
7. `npm run check:event` must remain green and also report the effective window when an override exists (print a warning that production differs from the file). Docs, `data/changelog.json` entry, `STRUCTURE.md` row for `api/event-config.js` if the surface table lists API routes, `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/event-config-override.test.js tests/check-event-window.test.js tests/multiplayer-server-boot.test.js` passes.
- [ ] `curl -s http://localhost:3000/api/event-config` returns the effective document; an unauthenticated `POST` returns 401 or 403.
- [ ] After `npm run event:override -- --extend 30`, the API, the game server and the browser all show the same new end within 90 seconds (observed and pasted in the report).
- [ ] With the API unreachable the game server and browser fall back to `/event.json` and the gate stays closed on a cold start (asserted in a test).
- [ ] `grep -n "event:override" docs/event-readiness/LIVE-OPS.md` matches.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No admin session locally | Use the HMAC ops path (`api/_lib/ops-auth.js`) with the local shared secret, or the QA login in the self-unblock playbook. |
| Multiplayer server not running locally | Run `multiplayer/src/event-window.js` against the local API in a unit test and start the server per `multiplayer/README.md` for the browser half. |
| Is it safe to apply a production `app_settings` write now | The override is inert until an operator writes it; this order never writes a production override. State the exact event-day commands in the report instead. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/254-plan-play-event-config-live-override.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `254-plan-play-event-config-live-override.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/11-event-live-ops.md` (whole file)

~~~~markdown
# Feature 11: live event ops (broadcast, stage moments, event config)

Tomorrow the $THREE world hosts a live event. The countdown already exists (`src/game/event-countdown.js` reads `public/event.json` through the shared `src/shared/event-config.js` reader and mounts a lobby banner + in-world pill). The live layer has since shipped in two of its three parts: the operator can speak to everyone in the world at once (`/internal/announce` + `scripts/announce-play.mjs`), and the world reacts when the event goes live (`src/game/meetup-event.js` agenda beats, go-live banner, and `src/game/fireworks.js`; the walkthrough is [docs/play-live-events.md](../play-live-events.md)). What is still missing is item 3, changing the event config without a redeploy. The list below records what exists so a rerun builds only the gap.

## Where the code lives

- Event config + countdown: `public/event.json`, `src/game/event-countdown.js` (self-attaching, zero edits to the core modules; keep that pattern). The same file is read by the API (`api/_lib/event-config.js`, from disk, cached a minute) and the game server (`multiplayer/src/event-window.js`, polled over HTTP every minute). Between events it holds an explicit no-event state (`id: null`) so `/event.json` still answers 200; edit it only through `npm run event:schedule -- --start <ISO> --duration <minutes> --apply` (`--rehearse 10` for a local dry run, `--clear` to reset) and gate the deploy on `npm run check:event`
- Multiplayer server (in-repo): `multiplayer/src/rooms/WalkRoom.js`, `multiplayer/src/social-hub.js`, the announce webhook in `multiplayer/src/index.js`; client socket + event bus: `src/game/community-net.js`
- In-world screens for takeover moments: `src/game/x402-jumbotron.js`, `src/game/chart-screen.js`
- Celebration FX precedent: the reaction-bar confetti in `src/game/coincommunities-ui.js`
- Admin/API patterns: look at existing authed admin endpoints under `api/` before inventing a new auth scheme

## What to build

1. **Operator broadcast.** Shipped as `POST /internal/announce` on the multiplayer server (`multiplayer/src/index.js`): HMAC-signed with `MULTIPLAYER_SHARED_SECRET` (falling back to `HOLDER_PASS_SECRET`) and timestamp-bound, so an unsigned or stale call is rejected before it reaches a room; there is no separate rate limit, the signature is the gate. It broadcasts on the existing `notice` channel (`kind: 'event'`, text capped at 300 characters, optional `title` 80 and `detail` 200, `durationMs` capped at 120 s) to every live `walk_world` room or one coin's world, so older clients get a toast and newer ones the centre-screen banner. Verify the banner queues, dismisses, and never overlaps chat or the joystick.
2. **Go-live moment.** Shipped in `src/game/meetup-event.js` (agenda, go-live banner) and `src/game/fireworks.js`, on the countdown pill's pulsing LIVE state. Everything reads the one config and mounts nothing when there is no event; keep it that way.
3. **Event config hardening.** Still open. `event.json` is baked into the image at build time, which means a config change mid-event needs a redeploy (today: `npm run event:schedule -- ... --apply`, `npm run check:event`, then the deploy runbook). Add a small authed read path (for example an `app_settings`-backed override checked after the static file, in `api/_lib/event-config.js` and `multiplayer/src/event-window.js` alike, since both read the file independently) so the operator can extend, rename, or end the event live without a deploy. Document the exact curl in the runbook (`10-event-day-runbook.md`).
4. **Broadcast script.** Shipped as `scripts/announce-play.mjs` (`node scripts/announce-play.mjs --title "Wheel hour" --detail "..." --coin <mint> --duration-ms 30000 "message"`; `--server http://localhost:2567` for a local test). It prints how many rooms and players it reached; the operator copy is in [LIVE-OPS.md](LIVE-OPS.md).

## Verify

- Two browser windows on `npm run dev` joined to the same coin world: a broadcast reaches both within a second; the banner queues, dismisses, and never overlaps the chat panel or mobile joystick.
- `event.json` state transitions (upcoming, live, over) exercised by editing the local file; nothing mounts when it is absent.
- `npm test` green; the broadcast endpoint's unsigned-call refusal is covered in `tests/multiplayer-server-boot.test.js`; add tests for the config override's auth.

## Report format

What shipped (files + one line each), the exact operator commands for event day, and anything deliberately deferred with a one-line reason. Add the `data/changelog.json` entry (feature tag) and a row in `STRUCTURE.md` for the live-ops surface.
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

