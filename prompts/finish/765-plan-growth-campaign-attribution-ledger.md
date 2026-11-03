# First-party campaign attribution so each marketing kit's results can be measured without a third-party tool

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/765-plan-growth-campaign-attribution-ledger.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 34 of 100 inside the tier). **Area:** growth. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The marketing program assigns campaign IDs (`marketing/growth/campaigns.csv`) and UTM conventions (`marketing/growth/measurement.md`), but there is no first-party record of which campaign brought a visitor, a signup, an agent creation or a paid action. PostHog is loaded only on the home page, so a visitor who lands on `/forge`, `/docs/mcp` or a partner landing page from a tagged link is invisible. Without that, the operating plan's decisions (which partner kits to push, which listings paid off) are guesses. A small, privacy-respecting first-party ledger closes the loop without adding a new vendor.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/acquisition-analytics.js` exists. `api/_lib/openrouter-attribution.js` covers OpenRouter only.
- `marketing/growth/measurement.md` defines `utm_source`, `utm_medium`, `utm_campaign` naming and says PostHog is the only analytics, loaded on the home page.
- `marketing/growth/campaigns.csv` holds the campaign IDs (for example `MKT-2026-11-GCP-AGENT`).
- Local working tree has uncommitted edits to `src/analytics.js` and a new `tests/analytics-event-allowlist.test.js` by another agent. Read them before touching anything; extend, do not overwrite, and re-read before each edit.
- No table or endpoint records first-touch campaign per user (verify in Step 0).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
git status --short src/analytics.js src/acquisition-analytics.js tests/analytics-event-allowlist.test.js
sed -n 1,80p src/acquisition-analytics.js
grep -rn "utm_" src api --include=*.js -l | head
grep -rn "first_touch\|campaign_id\|utm_campaign" api/_lib/migrations | head
head -5 marketing/growth/campaigns.csv
npm run db:status
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first: `tests/campaign-attribution.test.js` covering parse of `utm_*` plus a `c=` short campaign id against the IDs in `marketing/growth/campaigns.csv`, rejection of unknown or oversize values, and that no PII (no IP, no full referrer path beyond host) is stored.
2. Capture on every page: extend `src/acquisition-analytics.js` (not PostHog) so the first landing with a valid campaign tag stores `{campaign, source, medium, landing_path, ts}` in first-party storage with a 30 day window, honoring any existing consent or Do-Not-Track setting the site already respects. Never overwrite an existing first touch.
3. Server ledger: a migration (read `npm run db:status` first) creating `campaign_touches` (anonymous id, campaign, source, medium, landing path, created_at) and `campaign_conversions` (touch id or user id, event in `signup | agent_created | forge_generation | paid_call`, created_at). Endpoint `api/growth/touch.js` (POST, rate limited with the existing limiter) and server-side conversion writes at the existing signup, agent-creation and paid-call code paths, guarded so a failure never breaks the user flow.
4. Read side: `api/growth/report.js` (admin only, reuse the existing admin auth) returning touches and conversions per campaign over a date range, and a small admin page section or `scripts/campaign-report.mjs` that prints it joined to `campaigns.csv`. Empty state tells the operator which tagged link to open to generate the first touch.
5. Tag helper: `scripts/campaign-link.mjs <campaign-id> <url>` that prints the correctly tagged URL, refusing IDs not in `campaigns.csv`, and the docs update in `measurement.md` replacing "PostHog on home only" with the real flow.
6. Allowlist: if `tests/analytics-event-allowlist.test.js` exists after Step 0, add the new events to its allowlist rather than bypassing it.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/campaign-attribution.test.js` passes and was first seen failing.
- [ ] Opening `https://<dev>/forge?utm_campaign=MKT-2026-11-GCP-AGENT&utm_source=test` in a real browser creates exactly one row in `campaign_touches`, and a second visit with a different campaign does not replace the first touch.
- [ ] A signup in the same browser writes a `campaign_conversions` row.
- [ ] `node scripts/campaign-report.mjs` prints a per-campaign table from the real database.
- [ ] `npm run db:status` shows the migration applied and nothing else pending.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Another agent is editing `src/analytics.js` | Put new code in `src/acquisition-analytics.js` and new files; re-read before each edit. |
| Consent policy unclear | Follow whatever the site already does for PostHog opt-out; store nothing before consent where it requires it. |
| Admin auth shape unknown | Reuse the helper used by existing admin endpoints (grep `requireAdmin`). |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/765-plan-growth-campaign-attribution-ledger.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `765-plan-growth-campaign-attribution-ledger.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `marketing/growth/campaigns.csv`.

### `marketing/growth/measurement.md` (whole file)

~~~~markdown
# Marketing measurement system

The measurement goal is to connect **partner validation and community attention** to a real
three.ws action. Views and likes are useful diagnostics; they are not the outcome by
themselves.

## Campaign IDs and links

Every anchor and utility campaign has an immutable ID in
[`campaigns.csv`](./campaigns.csv):

```text
MKT-YYYY-MM-SHORT-NAME
```

Every link under our control uses:

```text
utm_source=<venue-or-account>
utm_medium=<social|community|partner|event|email|directory>
utm_campaign=<campaign_id in lowercase>
utm_content=<asset-or-post-variant>
```

Example for the Open Source Friday X anchor:

```text
https://three.ws/rig-doctor?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-09-osf&utm_content=anchor-video
```

Example for an IBM Community event page:

```text
https://three.ws/play?utm_source=ibm-community&utm_medium=partner&utm_campaign=mkt-2026-09-ibm-event&utm_content=event-page
```

Use lowercase ASCII and hyphens. Do not rename a campaign after links are live. A repost by a
partner gets its own `utm_source` and `utm_content=partner-repost` while preserving the
campaign ID.

## Funnel

Measure each campaign through five layers:

| Layer                     | Definition                              | Examples                                                                    |
| ------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| Distribution              | The content was actually delivered      | impressions, partner newsletter sends, event-page views                     |
| Engagement                | A person chose to interact              | substantive replies, reposts, saves, article reads, registrations           |
| Product action            | The visitor used the proof              | generation completed, demo started, Agent Card fetched, listing opened      |
| Community/economic action | The visitor joined the ecosystem        | event attendance, issue claimed, PR opened, utility used, paid call settled |
| Earned escalation         | A third party deepened the relationship | partner comment, repost, listing, speaker, newsletter, case-study intro     |

The north-star count is **qualified actions**: product actions, community/economic actions,
and earned escalations attributed to a campaign. Report distribution and engagement beside
it so a weak conversion can be diagnosed.

## Required campaign result

Record this at 24 hours and again at seven days:

| Field                    | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| Campaign ID              | Immutable ID from `campaigns.csv`                                        |
| Live URLs                | Canonical page and every published post                                  |
| Spend                    | Cash cost; organic time is recorded separately in hours                  |
| Impressions / views      | Per channel, not summed when audiences overlap                           |
| Engagements              | Likes, reposts, comments, saves, and partner interactions split out      |
| Landing sessions         | Sessions carrying the campaign UTM                                       |
| Primary product action   | Campaign-specific action and count                                       |
| Utility/community action | Campaign-specific deeper action and count                                |
| Partner response         | None, acknowledged, commented, reposted, listed, speaker, editorial lead |
| Reusable learning        | One sentence about what to repeat or stop                                |
| Next escalation          | The one ask earned by this result                                        |

## Weekly scorecard

The Monday review answers seven questions:

1. Did last week's anchor ship on its primary channel?
2. Did the partner receive the brief before publication?
3. Did it produce a qualified action?
4. Did the partner respond, and at which engagement-ladder level?
5. Which content format and opening beat the four-week median?
6. Which channel produced the highest action rate, not the most impressions?
7. What single earned placement does the proof justify asking for next?

Track these rollups:

| Metric                            |               90-day goal | Notes                                                 |
| --------------------------------- | ------------------------: | ----------------------------------------------------- |
| Anchor campaigns shipped          |                        12 | One per week                                          |
| $THREE utility proofs shipped     |                        12 | One per week                                          |
| Partner amplifications            |         4 distinct brands | Comment, repost, newsletter, or partner-authored post |
| New partner-owned live listings   |                         3 | Live URL required                                     |
| Community events held             |                         3 | Live event plus recap                                 |
| Partner briefs sent before launch | 100% of partner campaigns | Minimum 48 hours before publication                   |
| Campaigns with seven-day result   |                      100% | No result means campaign remains open                 |

## Decision rules after four weeks

- Repeat a format when its qualified-action rate beats the rolling four-week median and the
  campaign produced at least one substantive community or partner response.
- Rewrite the landing path when engagement is healthy but product-action conversion is below
  the median.
- Stop a channel-specific format after three comparable attempts below the median. Keep the
  story and move it to a better-fit venue.
- Escalate a partner ask only after giving the partner a result it can reuse: a working demo,
  useful article, attendance, customer outcome, or measured community response.
- Do not compare the small historical token and partner samples as if they were stable
  forecasts. Recalculate lift after each four-week block.

## Data sources

| Source                                    | What it supplies                                              | Cadence                                      |
| ----------------------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `data/x-archive/`                         | X post content and engagement                                 | Refresh weekly and after large partner posts |
| `docs/x-archive/trythreews-engagement.md` | Format and topic baselines                                    | Regenerate after archive refresh             |
| Web analytics                             | UTM sessions and conversion events                            | 24 hours and 7 days                          |
| `data/changelog.json`                     | Shipping volume and story discovery                           | Weekly editorial review                      |
| IBM Community catalog                     | Members, articles, discussions, events                        | Monthly and after each event                 |
| Partner dashboards/portals                | Listing traffic, leads, installs, marketplace activity        | Weekly while launching, monthly after        |
| Public product/stat endpoints             | Utility usage and transaction proof                           | Capture at publication and seven days        |
| GitHub                                    | Stars, clones, issues, PRs, contributors, discussion activity | Seven days after builder campaigns           |

## Integrity rules

- Preserve raw counts and their capture times. Never overwrite a result with a newer count
  without retaining the date.
- Separate organic, partner-amplified, and paid delivery.
- Do not sum impressions from channels with overlapping audiences into “people reached.”
- Mark bot traffic, unreliable counters, and missing data as excluded rather than zero.
- Attribute $THREE utility only to a verifiable action; do not infer a token purchase from a
  page view.
- Never report a submission as a listing or a partner acknowledgement as endorsement.

The initial baseline window is **2026-09-15 through 2026-10-12**. Add rate targets only after
that window closes.
~~~~

### `marketing/OPERATING-PLAN.md` (whole file)

~~~~markdown
# three.ws marketing operating plan

**Operating window:** 2026-09-15 through 2026-12-15  
**North star:** turn shipped proof into partner-owned distribution, community participation,
and repeated use of three.ws and `$THREE`.

This is the control page for the marketing push. It does not replace the detailed work already
in the repository. It puts that work in an execution order, names the scorecard, and makes clear
which actions require the owner.

The central decision is to spend the next 90 days distributing what already exists. The product
has 409 audited surfaces; only 47 have received a dedicated announcement and 285 have never been
mentioned on X. Eleven long-form articles, multiple partner announcement packs, two event plans,
and several listing submissions are already written. More undirected drafting would increase the
inventory without increasing reach.

## The strategy in one loop

```text
shipping proof
    -> a useful story on a partner or community surface
    -> official listing, reply, guest, or co-marketing support
    -> community creates, contributes, or uses a $THREE utility
    -> the result becomes the next proof asset
```

Every campaign must complete the loop. A partner logo without a user action is not a campaign.
A product post without a distribution partner or community follow-up is an isolated post. A token
post without a utility someone can use is speculation, not marketing.

## What wins, based on our own archive

The account-level evidence is in [the announcement voice](../docs/announce-voice.md), measured from
158 posts with usable metrics:

| Signal | Median lift over the account median | Operating consequence |
|---|---:|---|
| `$THREE` or token utility | 13.3x | Lead with `$THREE` when the demonstrated action genuinely uses it |
| A truthful partner mention | 4.5x | Build campaigns with partners, then tag only the partner involved |
| 100 to 179 characters | 3.0x | Default X post length |
| A real product image | 2.3x | No finished X pack without a current screenshot |
| A destination link | 1.5x | Give every post one action and one link |

The two largest avoidable losses were one-line posts and text-only posts. The house rules remain:
one checkable claim, real media, one destination, no hashtags, no emoji, no generic launch copy.

## The four programs

### 1. Partner proof, 35% of output

Turn existing relationships into things hosted, listed, replied to, or distributed by the partner.
The order is:

1. official catalog or directory listing;
2. partner-domain article, event page, or showcase;
3. partner social acknowledgement;
4. our announcement of that external proof;
5. a follow-up case study with measured use.

The current action queue is canonical in
[Partnership and listing pipeline](../docs/partners/opportunities.md). The most valuable immediate
asks are the IBM Agent Connect application id, the OpenAI directory and Showcase submissions, the
NVIDIA catalog follow-up, IBM marketing-program access, and the second IBM community event date.

Every partner request should arrive as a forwardable packet: one-sentence pitch, 100-word abstract,
working link, screenshot, speaker bio if relevant, two proposed dates, exact requested action, and
approved relationship wording. Do not ask a partner to invent the campaign for us.

### 2. `$THREE` utility, 25% of output

The editorial rule is **show the action, not the ticker**. Each utility post must answer all three:

- What can a holder do now?
- Where does `$THREE` enter the action?
- What verifiable result comes out?

Run the series as five chapters, each anchored to a live surface and current proof:

| Chapter | Story | Call to action |
|---|---|---|
| Access | `$THREE` changes the price or access path for a real service | Complete the action on the relevant live page |
| Agent work | Agents hire, earn, or settle work using the platform economy | Inspect a real receipt or task lifecycle |
| Creation | Community creation becomes an event entry, asset, or reward | Make and publish one creation |
| Community | The token connects a shared world, contest, or commemorative reward | Attend, vote, or claim through the event flow |
| Transparency | Supply, holders, buybacks, burns, and activity are shown from live sources | Verify the figures on `/three-token` |

Never lead a utility campaign with price. Re-read every number from the live surface on posting day,
and link to the action rather than a generic home page. The long-form foundation is
[The `$THREE` thesis](../docs/three-thesis.md).

### 3. Shipped-product proof, 25% of output

Work down the announcement backlog in clusters rather than spraying 285 unrelated features. One
cluster supplies a hero demo, three to five follow-up posts, a community challenge, and a technical
article. Prioritize capabilities that are visible in under ten seconds:

1. Forge Max, Motion Swap, Mocap Studio, and the creation loop;
2. Rig Doctor, retargeting, animation, and Open Source Friday;
3. Guardian, receipts, labor, and the agent economy;
4. Wardrobe, Fits, worlds, and community identity;
5. developer tooling: the MCP fleet, SDKs, packages, and embeddable agents.

The full inventory, strongest candidates, and per-surface "announced on X" state are in
[Announcement coverage](../docs/announcement-coverage.md). Do not announce a route merely because
it is unannounced. It must support one of the four programs and a measurable action.

### 4. Community participation, 15% of output

The community should be making the proof, not only reacting to it. Maintain three rhythms:

- a daily or weekly creation prompt that takes less than three minutes;
- one live show, demo, office hour, or contributor session each month;
- one headline event each quarter.

The recommended headline event is the
[Forge-Off Open](../docs/ibm-next-event.md): five daily creation themes, a community vote, and a
finale in the three.ws world. IBM participation is upside, not a launch dependency. The event can
run on our surfaces, our date, and our stream if no partner slot arrives.

## The next 14 days

This is the launch order as of 2026-09-15. External posts, submissions, email, bookings, and event
commitments are owner actions. Everything linked in the Asset column is already prepared.

| Due | Action | Owner | Asset | Done when |
|---|---|---|---|---|
| Sep 15 | Book a GitHub Open Source Friday slot and reply to approved issue #254 | Owner | [Stream plan](../docs/open-source-friday-plan.md) | Date is visible in the issue and calendar |
| Sep 15 | Publish the approval beat after the booking reply | Owner | [Announcement pack](../docs/announcements/open-source-friday.md) | Post URL is recorded in the pack |
| Sep 16 | Send the IBM Agent Connect application-id request | Owner | [Submission pack](ibm-partner-plus/agent-connect-listing.md) | Request exists in the partner thread |
| Sep 16 | Bundle the IBM directory, social, marketing-kit, and event asks into that thread | Owner | [IBM visibility map](../docs/ibm-visibility-map.md) | Each ask has an owner or IBM response state |
| Sep 17 | Submit the OpenAI Showcase and directory packets | Owner | [Channel map](../docs/openai-listing-channels.md) | Confirmation links or receipts are recorded |
| Sep 18 | Choose the second IBM community-event kickoff date and prize pool | Owner | [Event proposal](../docs/ibm-next-event.md) | The event has a real date and budget |
| Sep 18 | Decide whether a local Hacktoberfest venue is viable | Owner | [Tentpole brief](#hacktoberfest-2026-tentpole) | Venue, city, capacity, and host are named, or the idea is closed |
| Sep 19 | Publish the first prepared partner-domain article | Owner | [Publishing program](../docs/publishing-program-2026-09.md) | Canonical URL is recorded and answered |
| Sep 20 | Submit the Hacktoberfest Fest application if a venue exists | Owner | [Tentpole brief](#hacktoberfest-2026-tentpole) | Application receipt is recorded |
| Sep 22 | Publish `$THREE` utility chapter 1 with current live proof | Owner + marketing | [Token thesis](../docs/three-thesis.md) | Post drives one instrumented utility action |
| Sep 23 | Publish the next prepared technical-community article | Owner | [Publishing program](../docs/publishing-program-2026-09.md) | Canonical URL is recorded and discussion answered |
| Sep 25 | Follow up on the NVIDIA catalog request if still unanswered | Owner | [Visibility map](../docs/nvidia-visibility-map.md) | Response or next follow-up date is logged |
| Sep 26 | Announce the Forge-Off Open save-the-date | Owner | [Event proposal](../docs/ibm-next-event.md) | Landing page and registration/action URL are live |
| Sep 29 | Review the scorecard and choose the next two-week slate | Owner + marketing | [Scorecard](#weekly-scorecard) | Stop, continue, and double-down decisions are written |

If a date slips, do not compress two partner articles or two major announcements into one day. Move
the later item. The goal is sustained proof with room to answer people, not clearing a checklist.

## Weekly publishing rhythm after the sprint

| Day | Primary beat | Community follow-through |
|---|---|---|
| Monday | `$THREE` utility demonstrated on a live surface | Ask holders to complete or verify the action |
| Tuesday | Partner-domain or technical-community article | Answer every substantive reply |
| Wednesday | Creation prompt, user artifact, or contributor issue | Feature the strongest community result |
| Thursday | Partner listing, integration proof, or product cluster | Ask the named partner for a reply or repost only when pre-coordinated |
| Friday | Open-source build, livestream, or week-in-shipping proof | Direct people to one claimable issue or live demo |

Three strong primary posts per week is enough. Tuesday and Thursday can be the same beat when a
partner article lands. Community replies, clips, and quote posts extend the beat without creating a
second campaign.

## Campaign tentpoles

### Open Source Friday

**State:** approved, awaiting date.  
**Job:** acquire contributors and earn GitHub-owned recognition.  
**Hero action:** a newcomer claims a rig convention issue; the fix is reviewed and merged live.  
**Reuse:** approval post, date post, contributor call, reminder, live clip, merged-PR proof, replay,
and a permanent first-contribution path.  
**Primary measure:** first-time contributors who comment, open a PR, merge, and return within 30 days.

The date is the only blocker. Do not spend the approval news before the issue has the selected date.

### Forge-Off Open with IBM

**State:** format complete, date unchosen.  
**Job:** turn partner reach into first creation and next-day return.  
**Hero action:** type one sentence, publish a real 3D creation, vote, then return for the next theme.  
**Reuse:** IBM event page, five daily prompts, daily winner cards, finale stream, world screenshots,
winner gallery, and a responsible-AI case study.  
**Primary measure:** unique creators, published creations, voters, day-two return, and finale attendance.

### Hacktoberfest 2026 tentpole

**State:** [applications are open](https://hacktoberfest.com/host/) on a rolling basis; venue is
the gate.  
**Job:** put three.ws into an official open-source event directory and recruit local contributors.  
**Format:** choose a one-day Hack Day if the team can support hands-on building, or a Meet Up if the
goal is talks and community. Both are in person. A Hack Day can qualify for event-expense support;
both formats receive organizer support and program promotion.  
**Hard requirements:** a safe accessible venue, reliable Wi-Fi, power, seating, event check-in, and
post-event evidence under the [official FAQ](https://hacktoberfest.com/questions/). Do not apply
until a real venue and accountable host exist.  
**three.ws angle:** "Give an AI agent a body": a short prompt-to-avatar workshop followed by teams
improving a rig convention, animation, accessibility feature, or embed.  
**Primary measure:** checked-in builders, first-time contributors, PRs opened, PRs merged, and
participants who return within 30 days.

### The `$THREE` utility season

**State:** live product proof exists; editorial packaging is next.  
**Job:** replace abstract token messaging with repeated, verifiable utility.  
**Format:** five weekly chapters from the utility table above, each with a live action, screenshot,
and end-of-week receipt.  
**Primary measure:** completed utility actions by unique wallets, repeat actions, and the share of
participants who also use a non-token product surface.

## The content reuse rule

One real event or release should yield a complete asset stack:

| Moment | Asset |
|---|---|
| Before | Partner pitch, event/listing page, save-the-date, community prompt |
| During | One wide screenshot, one vertical clip, one quote, one live metric, one participant artifact |
| Within 24 hours | Result post with a verifiable number and destination link |
| Within 72 hours | Partner/community recap and winner or contributor profile |
| Within two weeks | Technical case study, searchable docs update, and next-action invitation |
| One month later | Outcome update with retention, usage, or merged-contribution evidence |

Never repost the same body across venues. Reuse the proof and media while rewriting the opening for
the audience. The detailed venue rules and eleven finished drafts are in the
[publishing program](../docs/publishing-program-2026-09.md).

## Weekly scorecard

Record this every Monday for the previous Monday through Sunday. Use raw counts and conversion rates,
not a blended "engagement" score.

| Funnel | Required measures | Decision it supports |
|---|---|---|
| Partner distribution | submissions sent, official listings live, partner-domain posts, partner replies/reposts | Which partner relationship produces durable reach |
| Community | unique creators, creations published, voters, live attendees, seven-day return | Which programs create participation rather than applause |
| `$THREE` utility | unique wallets completing the named action, total actions, repeat rate | Which utility is understood and repeatedly used |
| Open source | issue claimants, first-time PR authors, PRs opened, PRs merged, 30-day return | Whether recognition becomes a contributor pipeline |
| Content | impressions, destination clicks, click-through rate, action completions, completion rate | Which story and channel create product use |

Attach a campaign id and UTM source, medium, and campaign to every controllable link. Record the
baseline before launch. A result without a baseline can still be interesting, but it cannot prove
lift.

### Stop, continue, double down

- **Stop** a recurring format after three runs with no attributable product action or useful
  partner/community conversation.
- **Continue** a format that produces the target action even when raw impressions are modest.
- **Double down** when a partner-owned surface or community artifact converts at twice the account's
  four-week baseline. Reuse that mechanism with a new proof point within seven days.

## Ownership and gates

| Work | Default owner |
|---|---|
| Research, briefs, drafts, screenshots, tracking, analytics | Marketing/engineering |
| External booking, submission, email, post, publication, or promise | Owner |
| Partner claim and badge review | Owner against the relevant partner guide |
| `$THREE` figures | Marketing, refreshed from the live surface immediately before publication |
| Event prize transfers | Owner with explicit transaction confirmation |

Marketing can prepare everything up to the external boundary. It must never silently turn an
approved relationship into an endorsement claim, announce an unbooked date, publish stale token
figures, or automate a prize transfer.

## Source map

- [Partnership and listing pipeline](../docs/partners/opportunities.md): single next action and owner
  for every active relationship or listing.
- [OpenAI, IBM, and NVIDIA growth plan](../docs/partners/openai-ibm-nvidia-growth-plan.md): detailed
  partner-specific routes and prepared assets.
- [Publishing program](../docs/publishing-program-2026-09.md): eleven long-form drafts, short-form
  venue kit, order, and per-venue rules.
- [Announcement coverage](../docs/announcement-coverage.md): every shipped surface versus its public coverage.
- [Announcement voice](../docs/announce-voice.md): measured format rules and content QA.
- [Open Source Friday plan](../docs/open-source-friday-plan.md): application, run of show, and campaign.
- [Second IBM event](../docs/ibm-next-event.md): Forge-Off Open proposal and engineering scope.
- [Listings](../docs/listings.md): public status record.
~~~~

