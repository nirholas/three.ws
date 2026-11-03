# Forge-Off themed event boards with daily windows and a landing page

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/771-plan-forge-off-themed-event-boards-landing.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 30 of 100 inside the tier). **Area:** forge. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The Forge-Off is a weekly, no-login, community-voted creation board with a crowning cron, and the IBM event plan builds its headline format on it: five daily themes, one board and one small prize per day, an overall winner, and a landing page. Today the board knows only two windows (`all` and the current Monday to Monday week) and the week has no theme, no landing page and no way to scope a board to a day. A person who finds the contest on Wednesday sees a generic strip. Making the window and theme config-driven turns any partner or community contest into a data entry rather than a build, and gives the Forge a front door that the existing `/docs/forge-off` page is not.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/forge-store.js`: `listShowcase({ limit, voterKey, sort, window })` with `window` of `all` or `week`; `forgeOffWeekStart()` at line ~1501; Monday to Monday UTC week.
- `api/forge-gallery.js` line ~49: `window` accepted only as `week`, otherwise `all`.
- `api/cron/forge-off-crown` is scheduled in `vercel.json` (line ~7642) and crowns the weekly winner to the hall of fame and the Sketchfab showcase.
- `docs/forge-off.md` documents voting (one per browser, `forge:cid`, IP hashing, rate limits).
- No `/forge-off` page: `grep -n forge-off vercel.json` finds only the cron. `pages/` has `forge.html`, `forged.html`, `forge-funnel.html`, none for a themed event.
- The plan's daily themes (docs/ibm-next-event.md): object your job wishes existed (/forge), give it a face and a name (/create), make it move (choreographer), put it in your room (/irl), bring it to the party (/play).
- The event plan notes the entry screen on public creations is an NVIDIA classifier, not Granite Guardian, until the Guardian lane is deployed.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -n "window" api/forge-gallery.js | head
grep -n "forgeOffWeekStart\|listShowcase" api/_lib/forge-store.js | head
ls pages | grep -i "forge-off"; grep -n "forge-off" vercel.json data/pages.json | head
sed -n 7636,7650p vercel.json
ls tests | grep -i forge
```

If themed or daily windows already exist, only build the remaining pieces.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. Add `tests/forge-off-events.test.js` with failing cases: (a) `window=day` returns only creations from the current UTC day; (b) `event=<slug>` returns creations whose creation time is within that event's day or week window and ignores creations outside; (c) an unknown event slug answers 404 and a malformed one 400; (d) day boundaries are UTC and DST-independent; (e) the existing `all` and `week` outputs are unchanged.
2. Config: `data/forge-off-events.json` with `{ slug, title, starts_at, ends_at, days: [{ date, theme, surface, surface_href }], prizes_note }`. Validate it with a small loader in `api/_lib/forge-store.js` (or a new `api/_lib/forge-off-events.js`) that throws at boot on malformed config. Seed it with the five-day plan from the source doc as the example event (the dates are the event's real dates when the owner sets them; commit with the proposed week and say so).
3. API: extend `api/forge-gallery.js` with `window=day` and `event=<slug>&day=<n>`; add `GET /api/forge-off/event?slug=` returning the event config plus per-day top 3 and the overall leader (sum of votes across days). Keep the voting rules identical (no-login, one per browser).
4. Crown: extend `api/cron/forge-off-crown` so a day that closes inside an active event crowns that day's winner into the hall of fame with the day's theme, and the event end crowns the overall winner. Do not change the weekly crown behavior when no event is active (regression test).
5. Landing page `pages/forge-off.html` with `src/forge-off-event.js`, route `/forge-off` and `/forge-off/<slug>` in `vercel.json`, entry in `data/pages.json`: hero with the live day's theme and countdown to the day's close, a "Make one now" button to the surface for that day with the theme prefilled where the surface supports it, the day's board (vote pills reuse the existing Forge-Off vote component and endpoint), the overall standings, past days collapsed, and share cards. States: skeleton cards while loading; empty board ("No entries yet today. Be first: it takes about a minute") with the CTA focused; error state with Retry; hover, focus-visible and active on every control; keyboard navigable; works at 400px; honors `prefers-reduced-motion`.
6. Update `docs/forge-off.md` (events, windows and the landing page), correct the classifier sentence in `docs/ibm-event-offer-map.md` only if the Guardian lane is live at the time (check `/api/guardian/assess`), add a `data/changelog.json` entry, and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test tests/forge-off-events.test.js` exits 0; the day-window cases failed before the change.
- [ ] `curl -s "http://localhost:3000/api/forge-gallery?scope=community&sort=top&window=day"` returns only today's creations; `window=week` and `all` outputs are byte-identical to before for the same data.
- [ ] `curl -s "http://localhost:3000/api/forge-off/event?slug=<slug>"` returns the config, per-day leaders and an overall leader.
- [ ] `/forge-off` renders in a real browser at desktop and 400px with the live day's board, voting works without login, and there are no console errors.
- [ ] `npm run audit:docs` passes with the new page.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Event dates are not confirmed by IBM | Ship with the proposed dates in config and mark them as proposed in the report; the page also renders a "no active event" state that lists the standing weekly board |
| Few real creations to test with | Create real entries through the Forge on a dev database (free text-to-3D lane); do not seed fake rows |
| Crowning cron needs credentials to test | Call the handler directly in a test against the dev database; do not run the production cron |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/771-plan-forge-off-themed-event-boards-landing.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `771-plan-forge-off-themed-event-boards-landing.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/ibm-next-event.md` (section "Option A: The Forge-Off Open (recommended)")

~~~~markdown
### Option A: The Forge-Off Open (recommended)

**The pitch.** A one-week, open creation contest that anyone can enter in under a minute
with one sentence and no account. Go to `/forge`, type a description of a thing, get a real
textured 3D model, publish it to the board. Anyone can vote, no login. Highest voted wins.
It opens with a live "make one with me" session in the IBM Community group and closes with
a crowning ceremony held inside the three.ws world.

**The daily drip is the actual design.** A single week with one theme produces one visit.
Five daily themes, each three minutes of work, produce five visits and walk a newcomer
through the entire product without a single sentence of documentation:

| Day | Theme prompt | Surface it teaches |
| --- | --- | --- |
| 1 | The object your job wishes existed | `/forge`: prompt to 3D model |
| 2 | Give it a face and a name | `/create`: prompt to rigged avatar |
| 3 | Make it move | Choreographer and the animation library |
| 4 | Put it in your actual room | `/irl`: AR placement, and a photo to share |
| 5 | Bring it to the party | `/play`: walk into the world with it |

Each day is its own board and its own small prize, so a person who finds us on Wednesday
has not missed the event. The week ends with an overall winner across all five.

**Why it beats a developer hackathon on the stated goal.** The entry funnel is one page
deep and auth-free, so the drop-off between "saw the post" and "made something" is close to
zero. The addressable audience is not developers, it is anyone who can describe an object
in words, which includes the entire non-technical half of IBM's community that has never
had an event aimed at it. And the artifact count is the metric that compounds: hundreds of
public creations, each with a share card and a permanent page, is a better outcome than
twelve repositories nobody clones.

**Why IBM says yes.** It gives their community something it structurally does not get,
which is a creative program with no prerequisite. The technical story underneath is the
interesting half and it is genuinely theirs: **an open, no-login, public creation contest is
only survivable because every entry passes a safety classifier before another human ever
sees it.** That is Granite Guardian and the publish-safety layer doing unglamorous
load-bearing work, and it is a far better responsible-AI story than a slide about
responsible AI. Winners also flow automatically to a public Sketchfab account with
attribution, so the program's output stays visible long after the week ends.

**What we build:** an event landing page, and the daily theme copy. The board, the voting,
the tallying, the crowning and the distribution already run.

**Risk:** vote brigading, and a thin first day. Votes are already one-per-browser with IP
hashing and rate limits, and the daily reset means a brigade wins one small prize rather
than the event. The thin-first-day risk is handled by the kickoff session ending with the
board on screen and everyone making one live.
~~~~

### `docs/forge-off.md` (whole file)

~~~~markdown
# Forge-Off: community voting on the Forge

Forge-Off turns the passive "Fresh from the Forge" strip on [/forge](/forge)
into a live, competitive board. Every public creation can be upvoted, the strip
can be re-sorted from newest to most-voted, and the top model each week is
crowned into a permanent hall of fame that feeds the [Sketchfab
showcase](/docs/sketchfab).

It is **auth-free**, like the rest of the Forge: one vote per browser, no login.
A vote is keyed to the same anonymous browser id (`forge:cid`) the Forge already
uses to scope "Your creations", so a visitor's own upvotes light up across the
strip without an account.

## For visitors

On the "Fresh from the Forge" section of [/forge](/forge):

- **Upvote**: each card has an upvote pill (chevron + count). Tap it to vote,
  tap again to remove your vote. The count is the whole community's; the filled
  state is only yours. The button is optimistic and reconciles against the
  server tally, so a double-tap or a slow network never leaves it wrong.
- **Fresh / Top this week**: a toggle in the section header. *Fresh* is the
  historical newest-first, visual-first strip. *Top this week* is the Forge-Off
  board: the most-voted public models created during the current Forge-Off week
  (Monday→Monday UTC), highest first.
- **The weekly winner**: every Monday the top-voted model of the week just
  ended is crowned permanently. Later votes never rewrite a past week's winner.

The same strip and voting appear on the signed-in [/forge-studio](/forge-studio)
surface.

## API

### Cast or remove a vote

```
POST /api/forge-vote
Content-Type: application/json
x-forge-client: <stable browser id>

{ "creation_id": "<uuid>", "vote": true }     # upvote
{ "creation_id": "<uuid>", "vote": false }    # remove your vote
```

Response:

```json
{ "ok": true, "creation_id": "<uuid>", "vote_count": 5, "voted": true }
```

- `vote_count` is the fresh authoritative tally (recomputed from the vote table,
  never a drifting counter).
- `voted` is *your* state after the call.
- Voting is idempotent: a second upvote from the same browser is a no-op.
- A missing or shared (`anon`) client id is rejected `400 no_client_id`: a real
  vote needs a real, unique voter so the tally means something.
- Votes are only accepted on public, finished, non-rejected creations. Anything
  else returns `404 not_votable`.
- An invalid `creation_id` returns `400 invalid_creation`.

Rate limit: 120 votes / 10 min per IP (the one-vote-per-creation primary key
already caps real influence; this just blunts carpet-voting).

### Read the board

```
GET /api/forge-gallery?scope=community&sort=top&window=week&limit=24
x-forge-client: <stable browser id>   # optional, resolves your `voted` flags
```

- `sort=fresh` (default): newest, visual-first.
- `sort=top`: ranked by `vote_count` desc, `created_at` desc.
- `window=week`: with `sort=top`, narrow to the current Forge-Off week.
- Each returned creation carries `vote_count` and, when a client id is sent,
  `voted`. An anonymous read is CDN-cacheable; a voter-aware read is `private`,
  and the response varies on `x-forge-client`, so the edge never hands the
  anonymous copy to a browser that sent a client id.
- The read is CORS-open to any origin: it is the same public catalogue the
  standalone AR studio (npm: `3d-ar-studio`) shows as its Community tab from
  whatever page embeds it. Rate limiting is the control, not the origin.

## How it fits together

```
visitor taps upvote
      │  POST /api/forge-vote  (voter = hashed forge:cid)
      ▼
forge_votes  ──(recompute)──►  forge_creations.vote_count
      │                               │
      │  GET ?sort=top&window=week     │  Mon 00:07 UTC
      ▼                               ▼
"Top this week" board          api/cron/forge-off-crown
                                       │  writes the week's winner
                                       ▼
                               forge_board_winners  ──►  Sketchfab showcase
```

The [Sketchfab showcase cron](/docs/sketchfab) reads `forge_board_winners` and
`vote_count` to decide what to distribute to the official three.ws Sketchfab
account. Before Forge-Off shipped, nothing wrote votes or crowned winners, so
that pipeline's strongest tier was starved; voting + the weekly crown feed it.

## Implementation

| Piece | Where |
|---|---|
| Vote / board store logic | [api/_lib/forge-store.js](../api/_lib/forge-store.js): `castVote`, `removeVote`, `listShowcase` (sort/window/voter), `forgeOffWeekStart` |
| Vote endpoint | [api/forge-vote.js](../api/forge-vote.js) |
| Board read | [api/forge-gallery.js](../api/forge-gallery.js) (`scope=community`) |
| Weekly crowning cron | [api/cron/forge-off-crown.js](../api/cron/forge-off-crown.js) (`7 0 * * 1`) |
| UI (vote button, Fresh/Top toggle) | [src/forge-showcase.js](../src/forge-showcase.js) and its `/forge-studio` twin [src/forge-studio/forge-showcase.js](../src/forge-studio/forge-showcase.js) |
| Schema | [migration 20260625120000_forge_board.sql](../api/_lib/migrations/20260625120000_forge_board.sql): `forge_votes`, `forge_creations.vote_count`, `forge_board_winners` |

A creator deleting their own creation (`DELETE /api/forge-creation?id=`, the
two-tap delete on a "Your creations" card) takes its `forge_votes` rows with
it; a past week's `forge_board_winners` row survives with its creation
reference cleared, so the hall of fame never loses a week.

Backfill a past week's winner (owner): `GET /api/cron/forge-off-crown?week=YYYY-MM-DD`
(add `&dry_run=1` to preview). Authorized with `CRON_SECRET`.
~~~~

### `docs/ibm-event-offer-map.md` (whole file)

~~~~markdown
# Everything three.ws can offer an IBM Community event

A working inventory for planning events with the
[Three.ws User Group on IBM Community](https://community.ibm.com/community/user/usergroup?CommunityKey=e71510cc-d953-408f-9a1c-019f5c0a7016).
It answers one question: across the whole platform, what do we actually have that an IBM
audience would show up for, and which of it works today.

It sits beside two existing documents and does not replace them:

- [ibm-next-event.md](./ibm-next-event.md) argues for one headline format (the Forge-Off Open)
  and carries a 12-idea bank.
- [marketing/growth/events/ibm-event-two.md](../marketing/growth/events/ibm-event-two.md) is
  the paste-ready kit for a one-hour in-world session, and
  [three-world-session.md](../marketing/growth/events/three-world-session.md) is the monthly
  template.

Every status below was checked against the code or the live site on 2026-09-18. Anything
IBM-facing that comes out of this document is read against [ibm.md](./ibm.md) and
[badge-usage.md](../marketing/ibm-partner-plus/badge-usage.md) before it ships.

---

## 1. Where we stand today

| Fact | State | Why it matters |
| --- | --- | --- |
| Meetup #2 is already configured | `public/event.json` holds "$THREE Community Meetup #2", Friday 2026-09-25, 16:00 to 17:00 UTC, souvenir `star-shades-meetup-2`. Committed in `0e184e441`, passes `npm run check:event`. **Not deployed**: the live `/event.json` still answers the no-event state | The date exists in the repo and nowhere else. IBM Community shows 0 upcoming events, and T-7 is today |
| The first meetup | 2026-08-07, nine hours inside `/play`, peak 3,145 concurrent avatars in the open world | The format is proven and the audience is mostly the open world, not the 18 group members |
| Group size | 18 members, 7 blogs, 8 threads, 2 past events | Small. Events should recruit into the group, not assume it |
| No IBM model is serving in production | Verified live: `/api/ibm/galaxy` answers `watsonx_not_configured` and `/api/guardian/assess` answers `guardian_unconfigured`. The Cloud Run service carries no `WATSONX_*` and no `GRANITE_GUARDIAN_*` variable, and the self-hosted Guardian GPU worker in `workers/granite-guardian/` is not deployed | Every idea below marked "needs Granite" is code-complete and dark. Restoring this is the single highest-leverage fix on the page (section 6) |
| One room holds 100 people | `WALK_ROOM_MAX_CLIENTS` defaults to 100 and is not set on the live service. Past the cap, new joiners land silently in a parallel copy of the world | A crowd above 100 does not see itself as one crowd. Host announcements still reach every copy |
| Moderation | Automatic slur gate and rate limits only. No mute, no kick, no ban | Plan a human answer, or build the tools first |
| In-world stage | `StageRoom`, the show director and `/stage` all work. The plaza landmark `src/game/plaza-stage.js` is never imported by the world, and the show module it lazy-loads does not exist | Living Stage shows run at `/stage` today, not inside `/play`. The event-two kit's tour beat that points at a Plaza Stage marquee will find nothing |
| Host broadcast | `node scripts/announce-play.mjs` raises a banner in every live room, HMAC-signed | This is the host microphone that exists |
| Post-event numbers | Nothing records peak concurrency. `/api/play/population` is instantaneous | Leave `npm run event:watch -- --interval 15` running and keep its output, or the recap has no number |

---

## 2. What we can offer, by who is in the room

IBM Community is not one audience. Each group below gets a different hour.

### Non-technical members (the largest untapped group)

Everything here needs no account and finishes in under five minutes.

| Surface | What they do | Event use |
| --- | --- | --- |
| `/forge`, `/create/prompt` | One sentence becomes a textured model or a rigged avatar | The opening "make one with me" beat |
| `/create/selfie`, `/avatar-studio` | One selfie, or a from-scratch builder for the camera-shy | Everyone arrives as themselves |
| `/daily` | A new creative challenge every day with a streak, no sign-up | The retention layer under any event |
| `/ar`, `/ar/view` | Prompt to model to the table in front of you, QR handoff from desktop | One QR on screen, the whole audience places the same object |
| `/portal` | Paste a web address and walk through the site in 3D | Walk through a site the audience names |
| `/diorama` | Describe a scene and walk around inside it | Audience-directed world building |
| `/holo` | A procedural holographic sticker with your own text, downloadable | The 60-second event badge |
| `/walkthroughs/build-your-first-agent` | Five guided steps to a named agent, before sign-in | The safest guided group exercise we have |
| `/timeline`, `/tour`, `/pitch` | Company history as a walkable scene, a narrated site tour, a slide deck with a live avatar in it | Replaces every slide a host would otherwise make |

### Developers

| Surface | What they do | Event use |
| --- | --- | --- |
| Free 3D Studio MCP (`/docs/mcp-studio`) | No-auth server: connect Claude, ChatGPT or Cursor and generate, rig and edit models from chat | The best hands-on lab we have: two minutes to connect, works on any laptop |
| `npm create @three-ws/agent` | One command, one sentence, a rigged character and a demo page. No key, no account | The whole room types the same command |
| `/3d` and `/docs/3d-api` | Keyless text-to-3D and glTF validation over plain HTTP with live OpenAPI | `curl` from the audience |
| `<agent-3d>` and `/studio` | Web component plus a no-code snippet builder | Everyone leaves with a working embed |
| `/cookbook` | Runnable recipes: text-to-3D CLI, parallel asset packs, an MCP 3D tool, a self-correcting generation loop, a CI quality gate | One recipe per breakout |
| `/embed-doctor`, `/inspect`, `/rig-doctor`, `/diff` | In-browser diagnostics, nothing uploaded | A live clinic on attendees' own files and pages |
| `/tty` | `curl three.ws/tty` and a rigged agent walks in the terminal | The one-liner that gets a room typing |
| `/spatial-mcp` | An open, CC0 standard for returning a live 3D scene as an MCP tool result | A standards talk, and an invitation for others to implement it |
| `@three-ws/ibm-watsonx-mcp` | Five watsonx.ai tools on the caller's own IBM Cloud key | **Works today**, because the attendee brings the credentials. The right IBM-specific lab while our own keys are absent |
| `@three-ws/ibm-x402-mcp`, `/api/ibm-mcp` | Granite chat, code, embeddings, document analysis and forecasting, paid per call, no IBM account | Needs our watsonx credentials restored |

### Enterprise, governance and risk people

This is IBM's home audience and the one we have shown the least.

| Surface | What it shows | Event use |
| --- | --- | --- |
| `/ledger` | Every consequential agent decision, its reasoning, its prediction and the outcome, tamper-evident and independently verifiable | The auditability centerpiece |
| `/autopilot-activity` | Every autonomous action, the memory that motivated it, signed and reversible | Explainable autonomy, shown rather than claimed |
| `/payments`, `/pay/simulator` | Budget-limited sessions with spend caps, allowlists and expiry; dry-run a spend policy against real prices with no money moving | "Give an agent a budget, not a key", demonstrated safely |
| `/docs/agent-runtime` | The seven-layer policy engine that preflights every fund-moving tool call | The security architecture talk |
| `/docs/mcp-safety`, `/api/mcp-policy` | What each tool's safety annotation means, and a ready-to-paste allowlist in three profiles | The answer to "can my IT team approve this" |
| `/guardian` | Threshold-approved, time-locked wallet recovery that never exposes a key | Continuity and key management |
| `/brownout`, `/status`, `/guards` | Every fallback proven by breaking its upstream inside the real request path; 90-day uptime; a repo with no CI held correct by local guards | A reliability engineering session that is genuinely unusual |
| `/smart-home` and its privacy pages | An agent that runs a real house and stops to ask before it unlocks, opens or disarms anything; role scopes; data that is never stored | Physical-world consent, the subject of the governance post published to the group on 2026-09-18 |
| `/api/guardian/assess`, `@three-ws/guardian` | Granite Guardian verdicts plus a hash-chained audit ledger and per-period spend caps | The IBM-native governance demo. Dark until Guardian is restored |
| `/agent-identities`, `/pill` | A brand brief becomes a rigged mascot with studio renders; the write-up of rigging a flat logo into a 52-bone character | "We can rig your mascot", made concrete |
| `/concierge`, `/assistant`, `/herald`, `/glance` | One-tag site concierge, floating assistant, a character that announces events with an accessible fallback, an agent card on the Windows widgets board or in Slack | The embeds-on-your-site commercial track |
| 85 locales | The site UI is translated and swapped at runtime | A global community can attend in its own language |

### Accessibility and education

| Surface | What it does | Event use |
| --- | --- | --- |
| `/sign-language` | Avatars fingerspell any word, sign chat replies, and read your fingerspelling back by webcam | The flagship accessibility demo |
| `/sign-mirror` | The avatar forms a letter, the camera grades your handshape and names the finger that is off. On-device, no video uploaded | A group drill with a clean privacy story |
| `/asl-alphabet` | Every letter, the look-alikes, and a reading drill | Five-minute learning exercise |
| `/docs/stage` | Living Stage shows carry live captions and late joiners sync | A captioned Q&A format |
| `/glossary`, `/what-is` | Plain-English definitions and introduction | The handout for people new to all of this |

### Camera, microphone and body demos (the "how is that a browser" moments)

| Surface | What happens |
| --- | --- |
| `/sonar` | Hand gestures steer an avatar with no camera, using an inaudible tone and the microphone |
| `/mocap-studio` | Live webcam facial capture onto an avatar |
| `/lipsync/mic` | The avatar's mouth tracks a live voice |
| `/motion-swap` | Upload a video of yourself and get it back with your avatar performing the motion |
| `/capture` | A phone video of a room becomes an explorable point cloud |
| `/voice` | Hundreds of voices, or clone your own from a short recording |
| `/assembly` | A radial engine and a steam locomotive generated from code with solved linkages and exploded views |
| `/stream` | A GLB whose first 50 KB is already a complete avatar, raced against a classic load |

### Inside the world itself

Verified shipped in `/play`: spatial voice, world chat, emotes and a reaction bar, avatar
switching mid-session, `/forge <prompt>` in chat placing a prop for everyone, collaborative
voxel building that persists, fishing, chopping, mining and cooking, vehicles, a store and
bank, the wheel, quests and an event quest line with a server-scored leaderboard
(`/api/play/event-leaderboard`), King of the Totem and tag rounds, a synced dance floor, a
kickable ball, Coin Wars from a portal in the plaza, the Agent Exchange where one agent pays
another with a real on-chain receipt, photo mode that stamps the event name, synchronized
fireworks, the countdown chip and agenda drawer, and a free event-tier souvenir granted
server-side to everyone present.

Specified but not built (each has a prompt pack in
[event-readiness/](./event-readiness/README.md)): a welcome concierge NPC, a hype ticker,
an in-world invite sheet with QR, chat scrollback for late joiners, parties, a projector or
spectator mode, a signature wall, and judged dance-off rounds. A live event-config override
is also unbuilt, so changing the window means a deploy.

---

## 3. The format menu

Grouped by what kind of event it is. "Ready" means it can run on what is deployed today.
The IBM group rule still applies to all of them: one post a week at most, tutorials that
stand alone, and no token or price content on IBM's platform.

### A. In-world gatherings (the format that drew 3,145)

| # | Format | The hour | Ready |
| --- | --- | --- | --- |
| 1 | **Community Meetup, numbered and monthly** | The configured Sep 25 run of show: build, wear it, forge into the world, an agent pays for a tool, showcase, Q&A, photo | Yes, after a deploy |
| 2 | **Build Night** | One landmark, built together with the voxel tools, left standing. Hosted by voice, progress broadcast with the announce script | Yes |
| 3 | **Quest Hour** | The event quest line switched on for the window, the leaderboard on screen, winners named at the close. Prizes settle manually | Yes |
| 4 | **Furnish the Venue** | Every attendee forges one object for a shared room by typing in chat. The room is the group photo | Yes, with one rehearsed prompt. There is no size ceiling on forged props yet, which is the documented way to crash a phone tab |
| 5 | **Office Hours in the plaza** | No agenda. The team stands at spawn for an hour each week and answers anything. Spatial voice makes it a hallway, not a webinar | Yes |
| 6 | **Docs Walk** | `/docs/world` turns the documentation into 14 walkable pavilions. A guided group walk with stops | Yes |
| 7 | **Living Stage show** | An embodied AI host takes typed questions with captions, monthly, with one human guest | Yes at `/stage`. Not reachable from inside `/play` |
| 8 | **Opening Night** | The month's best community creations curated into a built exhibition, creators present beside their work | Yes, needs curation time |

### B. Workshops in IBM's own webinar format (the 2026-06-23 format)

These fit IBM Community's event tooling directly and need nothing from the world.

| # | Format | The hour | Ready |
| --- | --- | --- | --- |
| 9 | **MCP in ten minutes** | Everyone connects the free 3D Studio server to their own assistant and builds a model from chat, then rigs it | Yes |
| 10 | **watsonx from any MCP client** | Attendees install `@three-ws/ibm-watsonx-mcp` with their own IBM Cloud key and call Granite from their editor. Community-built connector, framed that way | Yes, and the only Granite lab that does not depend on our credentials |
| 11 | **Embed clinic** | Attendees bring a page. `/studio` builds the snippet, `/embed-doctor` names the line that breaks it | Yes |
| 12 | **Bring your own model clinic** | Drop a GLB into `/inspect`, `/rig-doctor` and `/diff`. Nothing uploads, so enterprise attendees can use real assets | Yes |
| 13 | **Agents with budgets** | `/pay/simulator` dry-runs a spend policy, `/payments` shows the session limits, `/ledger` shows the audit trail. No money moves | Yes |
| 14 | **When an agent can open your front door** | The smart-home consent model as a governance case study, following the post already published to the group | Yes as a talk. The Granite Guardian live verdicts need Guardian restored |
| 15 | **Sixty-second speedrun** | A timed race from blank prompt to a live embedded agent. A segment, not an event | Yes |
| 16 | **Open source hour** | The seven verified first issues in [open-source-friday-menu.md](../marketing/growth/events/open-source-friday-menu.md), four of which need no 3D knowledge. A rig that did not animate, animating, by the end | Yes |

### C. Programs longer than an hour

| # | Format | Shape | Ready |
| --- | --- | --- | --- |
| 17 | **The Forge-Off Open** | One week, five daily themes, no-login entry and voting, crowned in-world. Full case in [ibm-next-event.md](./ibm-next-event.md) | Needs a landing page and theme copy. The pitch must say the entry screen is an NVIDIA classifier, not Granite Guardian |
| 18 | **30-Day Forge Streak** | `/daily` wrapped in a leaderboard and weekly prizes | Nearly free |
| 19 | **Sign Week** | A letter a day on `/sign-mirror`, closing with a fingerspelled relay in the world | Surfaces ready. Requires deaf collaborators before it is announced, and must be framed as fingerspelling, one narrow slice of ASL |
| 20 | **Mascot Week** | Companies submit a mascot or logo and get back a rigged, talking agent with a one-line embed. Published as a gallery | Ready. The only format that produces embeds on other companies' sites |
| 21 | **Crews Cup** | A team layer over any other format: an office or a chapter enters as a crew and stands in one HQ | Ready |
| 22 | **Remix chain** | `/creations` tracks lineage. Each entrant remixes the previous entry, and the family tree is the artifact | Ready |
| 23 | **Granite Agent Jam** | A two-week builders division for agents that think on Granite | Needs Granite restored, or entrants bring their own keys through format 10 |

### D. Physical and hybrid

| # | Format | Shape | Ready |
| --- | --- | --- | --- |
| 24 | **TechXchange side meetup** | IBM TechXchange runs 2026-10-26 to 10-29 in Atlanta. Speaking is closed. A user-group gathering, in person or as an in-world session that week timed for attendees, is still open to ask for. `/irl` pins and printable `/irl/sign` sheets give a physical room something to scan | Surfaces ready. The ask goes in the same email as the event date |
| 25 | **World Lines hunt** | Agents placed at real coordinates issue a signed proof of presence at roughly one-kilometre granularity. IBM offices as anchor pins, with a virtual twin of each pin in the world so geography locks nobody out | Surfaces ready, coverage is the work |
| 26 | **Two Rooms, One Stage** | A physical room and the world wired together for a finale | About two weeks of new work, and a single point of failure in someone else's wifi |
| 27 | **Printed prize** | `/materialize` turns the winning model into a printed object with a certificate page at `/cert` | Ready, and the payment step is owner-gated |

### E. What Granite unlocks once it is serving again

All of this is code-complete and tested, and all of it is dark today.

| Surface | The demo |
| --- | --- |
| `/galaxy` | Every public agent placed in 3D by Granite embeddings, searched by meaning |
| `/api/ibm/vision` | Granite Vision reads an avatar image into a full agent identity |
| `/api/ibm/twin` | Granite TimeSeries back-tests itself and runs what-if scenarios |
| `/api/guardian/assess` | Allow, review or block, with a hash-chained ledger and a spend cap that makes an agent refuse |
| Granite as the avatar brain | Provider `watsonx` in the chat proxy, with Guardian inline before any autonomous money action |
| watsonx Orchestrate as the brain | Provider `orchestrate`: a three.ws avatar as the embodied front end of an enterprise Orchestrate agent. For an IBM audience this is the strongest single demo in the repo, and it has never been shown |
| A Granite-hosted Living Stage | The `/stage` host thinking on Granite and taking the community's questions with captions |

Avoid a live model-against-model comparison on any IBM stage. An event where Granite might
place second is not one IBM can co-host.

---

## 4. What we can offer IBM as an institution

Events are one lane. These are the others, and most are already built and waiting on a
single message.

| Offer | State | Blocker |
| --- | --- | --- |
| The 3D Studio MCP server in the watsonx Orchestrate Agent Catalog | Submission pack complete in [agent-connect-listing.md](../marketing/ibm-partner-plus/agent-connect-listing.md), icon built to IBM's spec | One email to `IBMAgentConnect@ibm.com` for the `APP_ID` |
| three.ws framed inside IBM's partner surfaces | Production CSP already allows `*.ibm.com` and `*.seismic.com` to frame the site | Nobody has asked |
| A partner-authored recap on an IBM surface | We supply the recording, screenshots and captured numbers within 24 hours | Part of the event ask |
| A mascot and an in-world home for the user group | `/agent-identities` builds the character, `/crews` gives the group an HQ, `/three` lists branded worlds | Owner decision |
| A souvenir per event | The grant path is server-side and idempotent. Souvenir one was never granted because the world server was on an old build | Redeploy the multiplayer service before every event |
| My Digital Marketing, the Build track Partner Marketing Kit, co-marketing funding, digital badging | Entitled and never requested, per [ibm-partner-plus.md](./partners/ibm-partner-plus.md) | One request |
| IBM Champions self-nomination | Packet written in `marketing/partner-packets/ibm-champions-nomination.md`, waiting on three facts only the nominee can supply. Treat 2026-11-20 as the latest safe date | Owner |
| The two June commitments still open | More co-promotion from IBM, and a page on the IBM domain | The same email as the event date |

---

## 5. A season instead of a single event

One meetup is a spike. The pattern that holds a community is a rhythm, a habit and a
headline, all running at once. Every item below is independently cancellable.

| When | What | Format |
| --- | --- | --- |
| Fri 2026-09-25 | Community Meetup #2, already configured | 1 |
| Weekly from then | Office Hours in the plaza, same hour each week | 5 |
| Early October | MCP in ten minutes, in IBM's webinar format, to recruit developers into the group | 9 |
| Thu 2026-10-15 | The event-two session with an IBM guest, doubling as the Forge-Off Open kickoff | 17 |
| Week of 2026-10-26 | TechXchange week: an in-world session timed for attendees, in person if IBM opens the user-group route | 24 |
| November | "When an agent can open your front door", the governance session, ideally with Guardian live | 14 |
| Tue 2026-11-24 (fallback Nov 17) | Meetup #3, "An agent pays for its own tool", already drafted in the monthly template | 1 |
| Underneath all of it | The 30-Day Forge Streak on `/daily` | 18 |

If only one new thing gets added to a repeat of the meetup, make it a second audience. The
first meetup was a tour. A session for the governance and risk crowd (13 or 14) reaches
the people IBM Community is actually full of, and nobody else can run it inside a product
that does the thing being discussed.

---

## 6. Before Sep 25, in order

1. **Tell IBM.** The date lives only in this repo. Create the event in the IBM Community
   group and send the relationship note. The same message carries the five standing asks
   listed in [ibm-visibility-map.md](./ibm-visibility-map.md).
2. **Deploy.** The event config and the souvenir are committed and not live. The
   multiplayer service needs its own redeploy, or souvenir two repeats souvenir one. Then
   run `node scripts/play-souvenir-conformance.mjs` and `npm run audit:meetup`.
3. **Set the room size.** Decide `WALK_ROOM_MAX_CLIENTS` (ceiling 500) before the doors
   open. One room of several hundred has not been load-tested as a single crowd, so run
   `npm run event:capacity` against the chosen value.
4. **Restore one IBM model.** Either create a watsonx.ai API key and project and set
   `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` on the Cloud Run service, or deploy the
   self-hosted Guardian worker and set `GRANITE_GUARDIAN_URL`. Until one of these lands,
   no Granite claim, no live Granite beat and no `@IBM` tag.
5. **Fix the run of show.** The kit's plaza tour points at a Plaza Stage marquee that the
   world never mounts. Cut that stop or mount the landmark.
6. **Plan moderation.** There is no mute and no kick. Name a moderator, and keep the
   announce script open in a terminal.
7. **Capture the numbers.** Start `npm run event:watch -- --interval 15` before doors and
   keep the log. It is the only source for a headcount.
8. **Refresh the runbook.** [event-readiness/LIVE-OPS.md](./event-readiness/LIVE-OPS.md)
   still carries the first meetup's release SHA and revisions.

Worth building before the October session, smallest first: chat scrollback for late
joiners, a triangle and file-size ceiling on forged props, host mute and kick, mounting the
plaza stage, and a projector mode for a physical room.
~~~~

