# Re-verify and correct the measured claims inside the November partner kits before they are sent

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/788-plan-growth-kits-stale-claims-refresh.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 18 of 100 inside the tier). **Area:** growth. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The QuickNode kit and field note quote measured production facts (failover behaviour, request volumes, endpoint names) that were true on the day they were written. A partner email that cites a number that is no longer true damages the relationship, and the owner sends these kits by hand. Re-measuring each claim against the code and production before the send is cheap and removes the risk. This order only corrects facts; it writes no new marketing.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- The kit and the field note quote RPC-failover behaviour, provider order and numbers. The code that decides it is the Solana RPC helper layer in `api/_lib/` (find it in Step 0).
- The kit itself flags one known stale sentence: the field note says the recovery-probe change (commit `ac1ba86ad`) is "not yet deployed" at 16:01Z on 2026-09-16, and the kit says it was live by 2026-09-17. The field note also carries an evidence table (cooldown constants in `connection.js`, `rpc_lanes` health reading, `METHOD_DEMOTION_MS`) dated 2026-09-16 that needs re-running.
- The kits are marked as owner-sent. Nothing in them has been sent by an agent.
- Other kits in `marketing/growth/kits/` make fewer measurable claims and were not found stale in this review.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
git merge-base --is-ancestor ac1ba86ad HEAD && echo probe-change-in-HEAD
curl -s https://three.ws/api/healthz | head -c 600
grep -n -i "[0-9][0-9,.]* \(req\|request\|ms\|%\|calls\|rpc\)" marketing/growth/kits/MKT-2026-11-QUICKNODE.md marketing/partner-packets/quicknode-*.md
grep -rn -i "quicknode" api/_lib src --include=*.js -l | head
curl -s https://three.ws/healthz | head -c 300
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. List every measurable claim (number, date, endpoint name, env var, provider order) in the three files. For each, record the evidence command and today's result in a table appended under a `## Re-verification` heading at the end of each file, with the date.
2. Correct every claim that no longer holds, in place, keeping the wording style. Remove claims that cannot be verified from the repo or a plain GET.
3. Check every link in the three files returns a non-error status with a plain GET and fix or remove broken ones.
4. Add a small script `scripts/check-kit-links.mjs` taking a markdown path and reporting dead links, so the owner can rerun it on the send day, plus a test for its link extraction.
5. Changelog entry is not needed for a docs-only correction; run `npm run audit:docs`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] Each of the three files ends with a dated re-verification table and no unverified number remains in the body.
- [ ] `node scripts/check-kit-links.mjs marketing/growth/kits/MKT-2026-11-QUICKNODE.md` exits 0.
- [ ] The link-extraction test passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A claim needs production logs | Use gcloud read access (`gcloud logging read` on `three-ws-api`); read-only is allowed. |
| A number cannot be reproduced | Delete the number and keep the qualitative statement. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/788-plan-growth-kits-stale-claims-refresh.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `788-plan-growth-kits-stale-claims-refresh.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `marketing/growth/kits/MKT-2026-11-QUICKNODE.md` (whole file)

~~~~markdown
# MKT-2026-11-QUICKNODE: how the production RPC path fails over without losing the user

**Kit status:** copy complete, verified 2026-09-17. Not blocked on engineering. campaigns.csv status
`awaiting_outreach`: the spotlight email and field note are ready and unsent, and the program contact's
name is not recorded in the repo.

## At a glance

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-QUICKNODE` |
| Publish date | 2026-11-17 |
| Summary | A candid field note: how a metered Quicknode reserve silently became the Solana RPC primary, and the four rules that now keep a multi-provider failover chain honest |
| Audience | Solana developers |
| Primary channel | Quicknode community or blog (Feature Friday or founder spotlight) |
| Secondary channels | X, GitHub Discussions, three.ws news |
| Proof | https://three.ws/docs/solana |
| Tracked links | X `https://three.ws/docs/solana?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-quicknode&utm_content=anchor`; GitHub `...utm_source=github&utm_medium=community&...&utm_content=discussion`; partner email `...utm_source=quicknode&utm_medium=email&...&utm_content=field-note` |
| The single CTA | Read the field note and test the open implementation |
| Partner ask | Founder spotlight or co-authored technical post |
| KPI | doc reads, repo visits, and partner placement |

## Audit: what already exists

| Channel | Existing asset | State | How this kit uses it |
|---|---|---|---|
| Partner ask (primary route) | [marketing/partner-packets/quicknode-spotlight-ask.md](../../partner-packets/quicknode-spotlight-ask.md) | Ready | Is the partner message, with one refresh below |
| Field note | [marketing/partner-packets/quicknode-rpc-failover-field-note.md](../../partner-packets/quicknode-rpc-failover-field-note.md) | Ready; one sentence now stale (below) | Attachment and the source for every post |
| Program membership graphics | [marketing/quicknode/](../../quicknode/) | Exist | Not used; this is a technical beat, not a membership beat |
| Media | [partner-packets/images/docs-solana-failover.png](../../partner-packets/images/docs-solana-failover.png) | Exists | Anchor image |
| X, GitHub Discussions, news | none | Missing | Written below |

**Stale sentence to fix before sending the field note:** it says the recovery-probe change from commit
`ac1ba86ad` is "not yet deployed". On 2026-09-17 that commit is an ancestor of the live commit
`477eb6f8c` from `/api/version`, so it has shipped. Change the sentence to "deployed" with the date of the
deploy that carried it.

## X

**Media:** `marketing/partner-packets/images/docs-solana-failover.png`.
**Alt text:** three.ws Solana docs explaining never to name the same endpoint as both primary and reserve,
followed by the cooldown table for failing RPC endpoints.

**Anchor** (170 weighted characters):

```text
We once set our metered @Quicknode reserve as the Solana RPC primary too. The chain keeps the first copy of a URL, so the reserve took every call: https://three.ws/docs/solana?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-quicknode&utm_content=anchor
```

This is a correction lead (voice contract pattern 3). The tag is defensible: the Quicknode endpoint is a
real rung in the production chain. The post does not blame Quicknode; the misconfiguration was ours.

**Thread (optional):**

2/ (210)
```text
The fix was a rule, not code: a reserve URL appears in the reserve list and nowhere else. Then we sized the bench to the failure: 6h on quota, 30m on a bad key, 10m on a 429, 2m on a 5xx, 30s on a network blip.
```

3/ (192)
```text
A 403 is not always a bad key. Some providers refuse one call shape and serve the rest, so now only that method is demoted on that endpoint, for 15 minutes, instead of benching the whole lane.
```

4/
```text
When every lane fails, the last good answer for the same read is served with an x-solana-rpc-stale header carrying its age, instead of an error. The code: https://github.com/nirholas/three.ws/blob/main/api/_lib/solana/connection.js
```

## GitHub Discussions (category: Show and tell)

**Title:** Field note: running a Solana RPC failover chain in production

```text
We wrote up what running a multi-provider Solana RPC failover chain in production taught us, including the day our metered reserve quietly became the primary.

Four rules we now hold:
1. Dedupe order is policy. The chain keeps the first copy of a URL, so a reserve must appear in the reserve list and nowhere else.
2. Size the bench to the failure: 6 hours on quota exhaustion, 30 minutes on a bad key, 10 minutes on a 429, 2 minutes on a provider 5xx, 30 seconds on a network error.
3. A 403 can be one method, not the lane: demote that method on that endpoint for 15 minutes.
4. Breakers are fleet-wide, so a new instance inherits "this lane is out of quota" instead of paying to learn it.

Docs: https://three.ws/docs/solana?utm_source=github&utm_medium=community&utm_campaign=mkt-2026-11-quicknode&utm_content=discussion
Code: api/_lib/solana/connection.js

If you run more than one RPC provider, what cooldowns do you use, and what did you get wrong first?
```

## three.ws news blurb

We published a field note on how three.ws keeps Solana RPC calls alive across several providers, starting
with the misconfiguration that turned our metered reserve into the primary. It covers dedupe order,
cooldowns sized to each failure class, per-method demotion for call-shape errors, and fleet-wide breakers,
with links to the open code. Read it in the Solana docs: https://three.ws/docs/solana.

## Partner message

Send the email in [marketing/partner-packets/quicknode-spotlight-ask.md](../../partner-packets/quicknode-spotlight-ask.md)
as a reply in the existing Quicknode Startup Program thread, with the field note attached. Refresh before
sending:

1. Fill `[program contact first name]` and `[Owner name]` from the real thread; neither is in the repo.
2. Its two proposed Fridays (2026-10-16, 2026-10-23) precede this campaign's date. Replace them with two
   Fridays after sending, for example 2026-11-20 and 2026-12-04, and confirm both are free.
3. Fix the stale "not yet deployed" sentence in the field note (above).
4. Swap the docs link in the email for the tracked
   `https://three.ws/docs/solana?utm_source=quicknode&utm_medium=email&utm_campaign=mkt-2026-11-quicknode&utm_content=field-note`.

If no thread exists in the owner's inbox, the packet names the public routes:
`https://www.quicknode.com/contact-us` and the Quicknode Discord.

## T+7 result fields

| Field | Source |
|---|---|
| Doc reads | web analytics, `/docs/solana` sessions with `utm_campaign=mkt-2026-11-quicknode` |
| Repo visits | GitHub Insights traffic for the week |
| Discussion replies | the Show and tell thread |
| Partner placement | Feature Friday slot, blog post URL, or "no response" |

## Claims check

| Claim | Proof | Verified |
|---|---|---|
| Production named the metered reserve as primary until 2026-07-28; `-32003` daily cap | [docs/solana.md](../../../docs/solana.md) line 71 | 2026-09-17 |
| Chain dedupes by URL and keeps the first occurrence | same doc; `solanaRpcEndpoints()` in `api/_lib/solana/connection.js` | 2026-09-17 |
| Cooldowns 6h, 30m, 10m, 2m, 30s | `QUOTA_COOLDOWN_MS`, `AUTH_COOLDOWN_MS`, `RATE_LIMIT_COOLDOWN_MS`, `SERVER_COOLDOWN_MS`, `NETWORK_COOLDOWN_MS` in `connection.js` | 2026-09-17 |
| Per-method demotion for 15 minutes | `METHOD_DEMOTION_MS = 15 * 60_000` in `connection.js` | 2026-09-17 |
| Last good answer served with `x-solana-rpc-stale` | `connection.js` around line 340 | 2026-09-17 |
| Fleet-wide breakers | field note source table; `rpcLaneHealth()` comment in `connection.js` | repo |
| Member of the Quicknode Startup Program; Quicknode is a rung, not the whole chain | [docs/partners.md](../../../docs/partners.md) | repo |
| Recovery-probe commit `ac1ba86ad` is deployed | `git merge-base --is-ancestor ac1ba86ad 477eb6f8c` succeeds; `/api/version` commit `477eb6f8c` | 2026-09-17 |

Dropped: the point-in-time "all lanes cooling" health reading from 2026-09-16 (a snapshot, not a claim to
repeat publicly), and request volume through Quicknode (not measured in the repo).

## Owner does

Reply in the existing Quicknode Startup Program thread with the refreshed email and field note, then post
the X anchor with the docs image.
~~~~

### `marketing/partner-packets/quicknode-rpc-failover-field-note.md` (whole file)

~~~~markdown
# Field note: running a Solana RPC failover chain in production

*three.ws, September 2026. One page, written for the Quicknode Startup Program team and for any
builder running more than one RPC provider. Every sentence below is checked against
[`api/_lib/solana/connection.js`](../../api/_lib/solana/connection.js),
[`api/_lib/solana/rpc-fallback.js`](../../api/_lib/solana/rpc-fallback.js),
[docs/solana.md](../../docs/solana.md), and the production service on 2026-09-16.*

---

three.ws gives AI agents Solana wallets, reads balances for them, and verifies agent-to-agent payments.
All of that is JSON-RPC, and none of it may depend on a single endpoint. Server-side calls build one
priority-ordered chain and rotate past any lane that is rate-limited or cooling down.

**The chain, in order.** An explicit endpoint a call site passes; the operator's `SOLANA_RPC_URL`; a
dedicated Quicknode endpoint when `QUICKNODE_RPC_URL` is set; other keyed providers; operator-supplied
free fallbacks; a curated keyless public set ending with the most-throttled public cluster; and last,
`SOLANA_RPC_LAST_RESORT_URLS`, the metered reserve that serves only when every free lane is down. In
production today the Quicknode endpoint sits in that reserve slot on purpose.

**Lesson 1: dedupe order is policy.** The chain removes duplicate URLs and keeps the first occurrence.
Until 2026-07-28 production named the metered Quicknode endpoint as both `SOLANA_RPC_URL` and the
reserve. It was therefore the primary, took all traffic, and hit its daily cap
(`-32003 daily request limit reached`) while the free lanes sat idle. The fix was configuration: a
reserve URL appears in the reserve list and nowhere else. A second guard stops a bare public-cluster
default (roughly 35 call sites wrote one) from jumping ahead of every paid lane.

**Lesson 2: size the bench to the failure.** `cooldownMsFor()` parks a lane for 6 hours on quota
exhaustion, 30 minutes on a bad key or dead URL, 10 minutes on a plain 429, 2 minutes on a provider
5xx, and 30 seconds on a network error. Park too long and you waste paid capacity; too short and every
caller rediscovers the outage.

**Lesson 3: a 403 is not always a bad key.** Some providers answer HTTP 403 "Request blocked" for one
call shape, such as `getTokenAccountsByOwner` filtered by program, while serving everything else. We
used to bench the whole lane for 30 minutes on it, so routine balance reads evicted a healthy primary.
Now that call fails over alone and only that method is demoted on that endpoint, for 15 minutes.
Deterministic errors such as invalid params never rotate, because every lane would fail them the same
way.

**Lesson 4: breakers must be fleet-wide.** Cooldowns are mirrored through a shared cache, so a new
Cloud Run instance inherits "this lane is out of quota" instead of spending a request to learn it. A
lane-health sensor now reports whether any paid lane is still serving. Before 2026-07-29 the only
sensor watched one provider from per-instance memory, and it missed every paid lane being exhausted at
once. When every lane fails, the last good answer for the same read is served with an
`x-solana-rpc-stale` age header rather than an error.

**What is still hard.** Failover moves load; it does not create capacity. At 16:01Z on 2026-09-16 the
production health check reported all three paid lanes and all nine lanes cooling. A change committed
2026-09-15, not yet deployed, makes the outer wrapper probe once through cooldowns when everything is
parked, after warm instances returned fast 502s while fresh ones reached a healthy lane. The
remaining lever is plan sizing, which is where a provider conversation helps more than code.

*Code: [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), Apache-2.0. Docs:
[three.ws/docs/solana](https://three.ws/docs/solana).*

---

## Source check for every claim

| Claim | Source | Checked |
|---|---|---|
| Chain order, Quicknode slot after `SOLANA_RPC_URL`, reserve last | `solanaRpcEndpoints()` in `connection.js` | 2026-09-16 |
| Quicknode endpoint is in the production reserve list; `QUICKNODE_RPC_URL` and `SOLANA_RPC_URL` unset | `node scripts/read-service-env.mjs` (host name only inspected) | 2026-09-16 |
| The 2026-07-28 misconfiguration and `-32003` | [docs/solana.md](../../docs/solana.md) | 2026-09-16 |
| About 35 call sites with a public-cluster default | docs/solana.md | 2026-09-16 |
| Cooldown windows | Constants at `connection.js` lines 199 to 203; docs/solana.md table | 2026-09-16 |
| Method demotion, 15 minutes | `METHOD_DEMOTION_MS` in `connection.js` | 2026-09-16 |
| Deterministic errors do not rotate | docs/solana.md | 2026-09-16 |
| Fleet-wide cooldowns, lane-health sensor, 2026-07-29 blind spot | `rpcLaneHealth()` comment in `connection.js`; docs/solana.md | 2026-09-16 |
| Last-good serve with `x-solana-rpc-stale` | `serveLastGood()` in `connection.js` | 2026-09-16 |
| All paid lanes and all nine lanes cooling | `GET https://three.ws/api/healthz`, `rpc_lanes` subsystem, `checkedAt` 2026-09-16T16:01Z | 2026-09-16 |
| Recovery-probe change committed, not deployed | Commit `ac1ba86ad` (2026-09-15) is not an ancestor of live commit `58224bd69` from `https://three.ws/api/version` | 2026-09-16 |

**Before sending:** re-run `curl -s https://three.ws/api/healthz` and `curl -s https://three.ws/api/version`.
If the recovery-probe change has shipped, change "not yet deployed" to "deployed on [date]". If the lanes
are healthy, keep the incident sentence but say it was a point-in-time reading.

**Naming rule used here:** other RPC providers are described generically on purpose. Naming them in a
note sent to one provider is unnecessary and would put other companies' outages in writing.
~~~~

### `marketing/partner-packets/quicknode-spotlight-ask.md` (whole file)

~~~~markdown
# Quicknode startup spotlight ask

**Target:** Quicknode Startup Program
**Program page:** https://www.quicknode.com/startup (the pipeline's `/startup-program` URL also returns
200; the program text quoted below was read from `/startup` on 2026-09-16)
**Verified intake:** the program contact from the 2026-07 acceptance. The repo records acceptance and
approved credits ([docs/listings.md](../../docs/listings.md)) but **no contact name or email**. If none
exists in the owner's inbox, the public routes are https://www.quicknode.com/contact-us and the
Quicknode Discord.
**What the program publicly offers that fits:** "Join Feature Fridays to showcase your solutions",
"Present your vision at our events to an influential audience", and "partnership stages, from
Marketplace to Developer Relations" (program page, 2026-09-16). There is no published spotlight
application form.
**Deadline:** none published. Pipeline target **2026-10-09**.
**Owner's one step:** reply in the existing Quicknode Startup Program thread with the email below and
attach the field note.

---

## The email

**Subject:** Feature Friday idea: what running Quicknode as a Solana failover reserve taught us

> Hi [program contact first name],
>
> three.ws joined the Quicknode Startup Program in July. We run a multi-provider Solana RPC failover
> chain in production for AI agent wallets, balance reads, and payment verification, and Quicknode is
> the metered reserve at the end of it.
>
> We wrote up what we learned in one page, attached: why dedupe order silently turned our reserve into
> our primary until 2026-07-28, how long to bench a lane for each failure class, why a 403 is not always
> a bad key, and why breakers have to be fleet-wide. It includes what is still hard, not just what
> worked.
>
> Would the team consider it for a Feature Friday or a founder spotlight? We can present live, turn it
> into a co-authored post for your blog, or both. Two dates that work for us: Friday 2026-10-16 or
> Friday 2026-10-23. Code and docs are public: https://github.com/nirholas/three.ws and
> https://three.ws/docs/solana.
>
> Thanks,
> [Owner name]
> three.ws

Fill the two bracketed names from the real thread before sending; neither is recorded in the repo.

---

## Packet fields

**One-sentence pitch:** a startup-program member with a candid production write-up of running Quicknode
inside a multi-provider Solana failover chain.

**100-word abstract:** three.ws runs AI agent wallets, balance reads, and payment verification on
Solana, and routes every server-side RPC call through one priority-ordered failover chain with a
Quicknode endpoint as the metered reserve. The field note covers four production lessons: dedupe order
turned the reserve into the primary until July 28 and exhausted its daily cap; lanes are benched from
30 seconds to 6 hours by failure class; a call-shape 403 now demotes one method instead of a whole lane;
and cooldowns are shared across the Cloud Run fleet. It closes with what failover cannot fix: capacity,
the conversation this spotlight would start.

**Working link:** https://three.ws/docs/solana (200 on 2026-09-16)

**Screenshot:** [images/docs-solana-failover.png](images/docs-solana-failover.png), captured 2026-09-16.
Alt text: "three.ws Solana docs explaining never to name the same endpoint as both primary and reserve,
followed by the cooldown table for failing RPC endpoints."

**Founder bio:** not recorded in the repo; add two lines under the signature if Quicknode asks.

**Two proposed dates:** Friday **2026-10-16** or Friday **2026-10-23** (proposals, nothing booked).

**Requested action:** consider three.ws for a Feature Friday session or a founder spotlight, with the
field note as the technical basis.

**Approved relationship wording** (from [docs/partners.md](../../docs/partners.md) and
[docs/listings.md](../../docs/listings.md)): three.ws is a **member of the Quicknode Startup Program**,
accepted 2026-07, with approved infrastructure credits. Quicknode is **a rung in the Solana RPC
failover chain, not the whole chain**. The `/partners` "Infrastructure" chip is a grouping three.ws
chose, not a Quicknode tier. Quicknode styles its own name "Quicknode" on its site.

## Metrics used

| Metric | Value | Source | Captured |
|---|---|---|---|
| Program status | Accepted 2026-07, credits approved | docs/listings.md | repo |
| Quicknode position in production chain | Reserve (`SOLANA_RPC_LAST_RESORT_URLS`) | Cloud Run service env, host name only | 2026-09-16 |
| RPC lane health at capture | 3 of 3 paid lanes and 9 of 9 lanes cooling | `https://three.ws/api/healthz` | 2026-09-16T16:01Z |
| RPC request volume through Quicknode | **Not measured here.** Quicknode's own dashboard is the source; the repo keeps no per-lane request count | n/a | n/a |
~~~~

