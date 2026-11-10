# Multiplayer rooms survive more than one Cloud Run instance by turning on the Redis presence and driver, with a two-instance load test

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/724-plan-play-multiplayer-redis-scale-out.md`.

**Priority:** P2, new capability with clear value (score 55 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The Colyseus multiplayer service (`multiplayer/`) runs as a single Cloud Run instance because rooms live in process memory. The code already supports a Redis presence and driver, activated by `REDIS_URI`, but production has none set, so the service cannot scale beyond one instance without splitting players across disjoint room sets, and a restart drops every live room. Plays on `/play`, the agora and the club all share this service, so the ceiling is the busiest launch day.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `multiplayer/src/index.js` (around line 329) wires `@colyseus/redis-driver` and `@colyseus/redis-presence` only when `REDIS_URI` or `REDIS_URL` is present. If the dynamic import throws it logs `staying single-instance` and carries on, a silent fallback that would recreate the split-brain on a scaled fleet. `/health` (line 74) returns only `{ ok, name }`, so nothing shows which driver is live.
- `multiplayer/deploy-cloudrun.sh` already defaults `MAX_INSTANCES` to 10 when `REDIS_URI` is set and 1 otherwise, with `MIN_INSTANCES=1`, `CONCURRENCY=1000`, 4 CPU, 8Gi. The script passes the plain `REDIS_URI` (check whether it is passed as a secret).
- No Redis instance exists for it and the live service runs single-instance. `multiplayer/` has no `test/` directory and no `test` script in `package.json`; the only script is `scripts/fish-smoke.mjs`.
- A game-token hardening change landed in `c832c83c3` (multiplayer game token) and needs to hold across instances: tokens must verify on any instance.
- Memorystore for Redis (or a small GCE Redis) is a Google Cloud surface covered by the standing credits approval.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
grep -n -iE 'REDIS|max-instances|min-instances|concurrency' multiplayer/deploy-cloudrun.sh multiplayer/src/index.js multiplayer/README.md
gcloud run services describe $(grep -oE 'SERVICE=[^ ]+' multiplayer/deploy-cloudrun.sh | head -1 | cut -d= -f2) --region us-central1 --project aerial-vehicle-466722-p5 --format='value(spec.template.metadata.annotations)' 2>&1 | tail -3
ls multiplayer multiplayer/test 2>/dev/null
gcloud redis instances list --region us-central1 --project aerial-vehicle-466722-p5 2>&1 | tail -3
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read `multiplayer/src/index.js` end to end and list every piece of per-process state outside Colyseus' presence (maps of tokens, rate limiters, matchmaking caches, in-memory counters, `setInterval` jobs). Each must be either moved to Redis, made idempotent per instance, or documented as safe.
2. Provision Redis: create a Memorystore instance (smallest basic tier is fine) in us-central1 on the same VPC the service can reach through a Serverless VPC connector or Direct VPC egress; record the exact `gcloud` commands in `multiplayer/README.md`. Store the URI as a Secret Manager secret (`MULTIPLAYER_REDIS_URI`) and bind it to the multiplayer service through `--update-secrets`, never plaintext.
3. Add a local reproduction first (test-first for the failure it prevents): `multiplayer/test/two-instance.test.js` (new directory) starts two server processes against a local Redis (docker `redis:7` or `redis-server` on a random port, skipped with a clear message only when neither binary exists), connects client A to instance 1 and client B to instance 2, and asserts both see the same room state and chat. Run it without `REDIS_URI` and confirm it fails because the rooms are disjoint; then with `REDIS_URI` and confirm it passes.
4. Make the driver choice explicit and observable: add `presence: "redis"|"local"` to the existing `/health` and `/healthz` JSON (`multiplayer/src/index.js` line 74); when `REDIS_URI` is set but the deps fail to import or Redis is unreachable, exit non-zero at boot with a clear error instead of the current `staying single-instance` fallback (that fallback recreates the split-brain this order removes). Cover with a test that boots the server with a bad `REDIS_URI` and asserts a non-zero exit.
5. In `multiplayer/deploy-cloudrun.sh`, pass the Redis URI through Secret Manager (`--update-secrets REDIS_URI=MULTIPLAYER_REDIS_URI:latest`) instead of a plain env value, keep the existing 1/10 `MAX_INSTANCES` defaults, and add `package.json` `test` script wiring the new tests.
6. Load test with real WebSocket clients: `scripts/multiplayer-load-test.mjs` opens N clients (default 200) spread across rooms, drives chat and movement for 60 seconds, and reports join latency p50/p95, dropped sockets and cross-instance delivery. Run it against the redeployed service with 2 or more instances live and record the numbers in `multiplayer/README.md`.
7. Browser verification: open `/play` in two browser contexts that land on different instances (set `MAX_INSTANCES=2`; add a temporary instance-id field to `/health` output or log lines to prove the two sockets landed on different instances), confirm each sees the other. Add the `data/changelog.json` entry and `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test multiplayer/test/two-instance.test.js` fails without `REDIS_URI` and passes with it.
- [ ] `gcloud run services describe <multiplayer service>` shows `MULTIPLAYER_REDIS_URI` from Secret Manager and `maxScale` greater than 1.
- [ ] Load test report in `multiplayer/README.md` shows cross-instance delivery 100 percent and p95 join latency recorded.
- [ ] Two browsers on different instances see each other on `/play`.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No local Redis binary for the test | Use `docker run redis:7`, or run the test against the new Memorystore through the Cloud Shell path; never mock Redis. |
| VPC connector missing | Create one with `gcloud compute networks vpc-access connectors create` in us-central1 (credits pre-approved). |
| Service env replaced by mistake | Always `--update-env-vars` / `--update-secrets`. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/724-plan-play-multiplayer-redis-scale-out.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `724-plan-play-multiplayer-redis-scale-out.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `multiplayer/src/index.js`, `multiplayer/deploy-cloudrun.sh`.

- `multiplayer/README.md`
- `prompts/finish/_context/production-100-OWNER-ACTIONS.md` (section "Open rows")

## Status 2026-11-10 (verified on a Memorystore-backed test fleet, live promotion remains)

Done: dedicated Memorystore `three-ws-multiplayer` and Secret Manager `MULTIPLAYER_REDIS_URI` exist; `multiplayer/src/tunnel.js` bridges sockets that land on a non-owner instance (Cloud Run cannot route `/<processId>/<roomId>`; before it, 200 of 200 joins failed with `seat reservation expired`); `multiplayer/test/*` 6 passing against a real Redis; a separate test service (min 2 / max 3, secret-bound `REDIS_URI`, since deleted) ran the load test at 200 clients, 4 coins, 60 s: 0 failed joins, 0 drops, join p50 679 ms / p95 1555 ms, 186000 of 186000 chat deliveries; two Chromium contexts on `CommunityNet` saw each other with upgrades logged on different instances. Numbers are in `multiplayer/README.md`.

Remaining, owner-gated (production deploy of the live service): run `cd multiplayer && USE_REDIS_SECRET=1 ./deploy-cloudrun.sh` outside any event window, wait for the revision to settle, confirm `curl https://three-ws-multiplayer-lp642k3kpa-uc.a.run.app/health` shows `"presence":"redis"` and that `gcloud run services describe three-ws-multiplayer` shows `maxScale` 10 and `REDIS_URI` from `MULTIPLAYER_REDIS_URI`. Then delete this order.
