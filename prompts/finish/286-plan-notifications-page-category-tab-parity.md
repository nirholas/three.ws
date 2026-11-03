# Notifications page tabs and type map follow the server category list

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/286-plan-notifications-page-category-tab-parity.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 14 of 100 inside the tier). **Area:** notifications. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`/notifications` filters by category using a hand-copied `TYPE_CATEGORY` map in `src/notifications-page.js` (its own comment says it is "kept in sync by hand"). The server map in `api/_lib/notify-prefs.js` has moved on: it has 13 categories (`sales, purchases, social, irl, alerts, markets, creations, companion, knock, mail, orders, approvals, account`) and about 23 more types than the client knows. The page has no tab for `markets`, `knock`, `mail` or `orders`, and any type the client map does not know falls through to `account`. Result: a "knock received" or "mail received" notification appears under Account & security, event-market notifications cannot be filtered, and the delivered-vs-listed behavior differs from the preference screen. The server already serves the authoritative map and category list on `GET /api/notifications/preferences` (`type_categories` and `categories`), so the page should consume it instead of keeping a copy.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Measured drift between the two maps (script comparing the exports): 23 server types missing from the client, among them `knock_received` (server `knock`), `mail_received` (`mail`), `event_market_entrant` (`markets`), `event_market_agent_pick` (`social`), `invoice_*`, `creator_payout_*`, `reinvest_*`, `whitelist_*`, `commerce_*`; client-only: `inference_topup`, `inference_budget_exhausted` (both `account`, which is the fallback anyway).
- `pages/notifications.html` lines ~147 to 157: tabs for all, sales, purchases, social, irl, alerts, creations, companion, approvals, account. Missing: markets, knock, mail, orders.
- `api/_lib/notify-prefs.js`: `CATEGORIES` (key, label, description), `typeCategoryMap()` documented as "served by GET /api/notifications/preferences so the browser never keeps its own copy".
- `api/notifications/preferences.js` line ~75 returns `type_categories: typeCategoryMap()`.
- Existing test: `tests/notify-prefs.test.js`. No test covers the page.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -n "TYPE_CATEGORY" src/notifications-page.js | head -3
sed -n 145,160p pages/notifications.html
grep -n "type_categories" api/notifications/preferences.js src/*.js
node -e "import('./api/_lib/notify-prefs.js').then(m=>console.log(m.CATEGORIES.map(c=>c.key).join(',')))"
```

If the page already loads `type_categories` and builds its tabs from the server list, skip to verification.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first (bug fix). Add to `tests/notify-prefs.test.js` (or a new `tests/notifications-page-categories.test.js`) a test that fails today: every key in `CATEGORIES` must be reachable as a tab, and `src/notifications-page.js` must not contain a literal `TYPE_CATEGORY` table. Also a pure unit test for the new helper from task 2 (unknown type falls back to `account`; `knock_received` resolves to `knock`). Run it and confirm it fails for the stated reason.
2. In `src/notifications-page.js`: fetch `GET /api/notifications/preferences` once at boot (credentials included), keep `type_categories` and `categories`, delete the hand-written `TYPE_CATEGORY`, and resolve categories from the fetched map. Export `categoryOf(type, map)` as a pure function for the unit test.
3. Build the tab strip from the server `categories` list (label from the server, "All" first, only categories that currently have rows plus the active one, so the strip stays short) instead of the hard-coded buttons in `pages/notifications.html`. Keep `data-i18n` keys where they exist; add the new labels to the locale files used by the page (`grep -rn "notifications.sales_earnings" public src locales 2>/dev/null` to find them).
4. Failure handling: if the preferences fetch fails, show the full tab strip from a bundled minimal list (All plus Account) and a small inline notice with a Retry button; do not block the list.
5. UI states: tabs have hover, focus-visible and active styles and arrow-key navigation (`role="tablist"`); loading shows the existing skeleton rows; each tab's empty state says what the category covers (use the server `description`) and links to the preferences screen. Verify at 400px width that the tab strip scrolls horizontally inside its own container.
6. Update `docs/notifications.md` (the tab list and the "client mirrors server" sentence), add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] The new test failed before step 2 and now passes: `node --test tests/notify-prefs.test.js`.
- [ ] `grep -n "TYPE_CATEGORY" src/notifications-page.js` returns nothing.
- [ ] In a real browser at `/notifications` with a signed-in user who has a knock, mail and market notification, each appears under its own tab and not under Account; the tab strip lists the server labels.
- [ ] Blocking `/api/notifications/preferences` in devtools still renders the list with the fallback tabs and a Retry that recovers.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No signed-in QA session | Follow the QA login row in the self-unblock playbook; seed notifications with the existing dev scripts or insert rows through the real `notify()` helper in a local environment |
| Locale files missing the new labels | Add English strings; the page falls back to the server label |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/286-plan-notifications-page-category-tab-parity.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `286-plan-notifications-page-category-tab-parity.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/notifications.md` (whole file)

~~~~markdown
# Notifications: the bell, the /notifications center, and the inbox API

Everything that happens to your work on three.ws (a payment lands, a skill
sells, someone remixes your model, follows you, a quest finishes, a royalty
arrives) becomes a row in one per-user inbox. Two surfaces read that inbox:
the bell in the site header, and the full notification center at
[/notifications](https://three.ws/notifications). This page documents both
surfaces as coded, the category system behind the filter tabs, and the
complete API contract. Where those notifications come from (which features
fire which events) is covered in [The social layer](./social-layer.md#notification-bell);
this page picks up where that one leaves off.

| Piece | Where | Source |
|---|---|---|
| Bell dropdown | The bell button in the header, on every page | [src/notifications.js](../src/notifications.js) |
| Notification center | [/notifications](https://three.ws/notifications) | [pages/notifications.html](../pages/notifications.html), [src/notifications-page.js](../src/notifications-page.js) |
| Preference editor | `/dashboard/settings` | [src/dashboard-next/pages/settings.js](../src/dashboard-next/pages/settings.js) |
| Avatar announcements | The corner companion, on any page | [src/notification-herald.js](../src/notification-herald.js) |
| Inbox API | `GET/POST/DELETE /api/notifications/*` | [api/notifications/](../api/notifications/README.md) |

One inbox, two views. The dropdown holds the latest page for a quick glance;
the `/notifications` page adds category tabs, per-row delete, and cursor
pagination for the full history. Both import the same icon, label, link, and
escaping helpers from [src/notifications.js](../src/notifications.js), so a
notification always reads identically in both places.

---

## The notification record

Every row the API returns is

```
{ id, type, payload, read_at, created_at }
```

- `type` is a machine string like `skill_purchased`, `remix`, `follow`,
  `quest_complete`, or `royalty_paid`. The full producing vocabulary is
  `USER_EVENT_TYPES` in [api/_lib/feed.js](../api/_lib/feed.js) plus the types
  written directly by the purchase, forge, withdrawal, and security flows.
- `payload` carries the type-specific details (actor name, skill name, amounts,
  a `link` for click-through). The human-readable sentence is built client-side
  by `notifLabel()`; the click target is resolved by `notifLink()` from
  `payload.link`, then a Solana transaction signature (`payload.tx_signature`,
  linked to its Solscan page), then `payload.agent_id`.
- `read_at` is null until the notification is read; `created_at` orders the
  inbox and doubles as the pagination cursor.

Payload values are other users' text, so both surfaces HTML-escape every
interpolated string, and `notifLink()` only permits same-origin relative paths
or absolute `http(s)` URLs. A hostile payload cannot inject markup or drive
navigation into a `javascript:` URL. Payment amounts denominated in `$THREE`
render with the `$THREE` label; other recognized mints render with their
standard symbol, and an unrecognized mint degrades to a bare number rather
than naming a coin.

## Categories: how the filter tabs group types

The `/notifications` page has nine tabs: **All**, **Sales & earnings**,
**Purchases**, **Social**, **In person**, **Market alerts**, **Creations**,
**Companion**, and **Account**. Each notification type maps to exactly one
category; the mapping (`TYPE_CATEGORY`) lives in
[api/_lib/notify-prefs.js](../api/_lib/notify-prefs.js) and is mirrored in
[src/notifications-page.js](../src/notifications-page.js) for tab filtering.

| Category (tab) | Key | Notification types |
|---|---|---|
| Sales & earnings | `sales` | `skill_purchased`, `asset_purchased`, `sale`, `payment-earned`, `payment_received`, `referral_earned`, `referral_signup`, `referral_reward`, `pump_launch_filled`, `royalty_paid` |
| Purchases | `purchases` | `skill_purchase_confirmed`, `asset_purchase_confirmed`, `skill_gift_received`, `skill_gift_sent`, `print_update` |
| Social | `social` | `remix`, `reply`, `comment`, `embed`, `mention`, `fork`, `follow`, `dm_received`, `agent_review`, `quest_complete`, `duel_challenge` (another owner challenged your agent to a duel, or answered your challenge) |
| In person | `irl` | `irl_interaction`, `irl_reply` |
| Market alerts | `alerts` | `pump_alert` |
| Creations | `creations` | `forge_complete`, `forge_failed` |
| Companion | `companion` | `companion_delivery` |
| Approvals | `approvals` | `approval_requested` (see [Approvals](./approvals.md)) |
| (no tab yet) | `knock` | `knock_received` |
| (no tab yet) | `mail` | `mail_received` |
| Account | `account` | `withdrawal_completed`, `withdrawal_failed`, `payment_mismatch`, `asset_payment_mismatch`, `skill_payment_mismatch`, `security_alert`, `wallet_anomaly_frozen`, plus any type not in the map (the agent-inference `inference_topup` and `inference_budget_exhausted` land here this way), `token_budget_paused` and `spend_cap_alert` (the [spend page](./inference-billing.md) caps) |

`print_update` is the single type Materialize uses for a physical order's whole
lifecycle, quoted through delivered, and it sits with purchases because the
order is the buyer's own.

Three details worth knowing:

- **Unmapped types fall back to `account`**, so a newly added notification
  type is never silently undeliverable or unfilterable.
- **Tab filtering is client-side** over the pages already fetched. The API's
  own `?type=` parameter filters server-side by a single exact type (e.g.
  `?type=pump_alert`), not by category.
- **`knock` and `mail` are preference categories without a tab.** The
  preference center lists them ("Knocks at your door", "Agent mail") and the
  server gates delivery on them, but the page's own copy of the map has no
  entry for `knock_received` or `mail_received`, so on `/notifications` both
  are filtered under **Account** rather than a tab of their own. Mail the spam
  filter holds back never notifies at all.

## The avatar channel: delivered in person

A badge waits to be noticed. Some notifications should not have to. When one
of those lands while you are on the site, the corner companion (the avatar
that already walks your pages) turns to you, plays a gesture, and says it out
loud, with a link straight to the thing that happened.

`avatar` is a real delivery channel next to `in_app`, `push`, `email`,
`telegram`, and `discord`. It is gated by the same per-category matrix, edited in the same
place (`/dashboard/settings`), and measured in the same funnel.

**What gets announced.** By default: **Sales & earnings**, **Creations**,
**Companion deliveries**, **Knocks at your door**, and **Account**. Money
landing, a generation finishing while you waited, a message your companion
triaged as worth hearing, someone who paid your price to reach you, and
anything touching your account are worth an interruption. Purchases, social,
in person, market alerts, and agent mail are off by default because they are
frequent.
Every one of them is a toggle, so an inbox that should speak up more (or not
at all) is two clicks away. The defaults live in `DEFAULTS` in
[api/_lib/notify-prefs.js](../api/_lib/notify-prefs.js).

**When it stays quiet.** The rules live in
[src/notification-herald.js](../src/notification-herald.js):

- Only **unread** notifications **under 15 minutes old**. Older rows are
  history, and history belongs in the bell.
- **Each notification exactly once per browser.** Delivered ids are remembered
  in `localStorage`, so navigating, re-polling, or opening a second tab never
  replays a line.
- **Two lines per batch**, maximum. Anything past that becomes a single
  "N more waiting" line pointing at `/notifications`, so a backlog never turns
  into a monologue.
- **Never into a background tab.** The point is telling someone who is here.
- **Nothing is spoken aloud unless you asked for audio.** Announcements use
  the companion's own narration setting (`walk:companion:narrate`, the toggle
  on the companion itself). On the default caption-only setting the message is
  text in the bubble, which is also an `aria-live` region, so screen readers
  get it either way.

**Controls.** The bubble carries "Turn off", which silences announcements in
that browser instantly without touching the account-wide setting. Per-category
control lives in the Notifications panel of `/dashboard/settings`.

**No companion running?** It is summoned for that one message and walks off
again afterwards, without turning itself on permanently. When an avatar cannot
be rendered at all (no WebGL, inside an iframe, or a route that already owns
the corner, such as `/play` or `/avatar-studio`) the line degrades to a normal
toast, so the notification is never lost to a missing GPU.

The delivery itself is one call into the walk SDK, which any surface can
reuse:

```js
// walk-sdk/src/companion.js: mounts if needed, gestures, speaks, retreats.
await window.__walkCompanion.announce('Your agent made a sale', {
  tone: 'alert',
  emote: 'dance',
  actions: [{ label: 'Open', href: '/dashboard' }],
});
```

## How the bell and unread state work

The bell ([src/notifications.js](../src/notifications.js)) is mounted by the
shared nav on every page and is deliberately cheap:

- **Auth-aware.** It reads a local sign-in hint (`3dagent:auth-hint` in
  localStorage). Signed out: no polling at all, the badge stays hidden, and
  opening the panel shows a sign-in prompt instead of an empty inbox.
- **Polling.** Signed in, it fetches `GET /api/notifications?limit=20` every
  30 seconds, re-polls when the tab regains focus, and pauses while the tab
  is hidden.
- **One fetch per user, not per tab.** All open tabs share the result through
  a localStorage cache plus a BroadcastChannel: whichever tab wins a
  best-effort fetch lock spends the request and broadcasts the payload;
  every other tab reuses it for the poll interval. A new tab seeds its badge
  from the cache instantly without its own request.
- **Backoff.** A 429 from the per-user rate budget starts an exponential
  backoff (doubling from 30 seconds, capped at 5 minutes), so the badge
  self-heals without hammering a drained budget.
- **The badge** shows the server's `unread_count` (rendered as `99+` past 99),
  updates its `aria-label`, and announces changes politely to screen readers.
- **Opening the panel marks everything read.** The dropdown is a glance
  surface: if anything is unread when it opens, it fires
  `POST /api/notifications/read-all` and zeroes the badge. Clicking a single
  row also marks that row read, sends an `opened` funnel beacon to
  `POST /api/notifications/track`, and navigates to the resolved link.
- **Push upsell at the value moment.** While the panel is open (never on page
  load), a one-time banner offers Web Push if it is supported, configured,
  not yet subscribed, and not previously declined. Push plumbing lives in
  [src/push-notifications.js](../src/push-notifications.js) and
  [public/push-sw.js](../public/push-sw.js). Inside the three.ws iOS app the
  same calls register with Apple Push Notification service instead (the
  WebView runs no service worker), and the bell also fires a `threews:unread`
  window event with the count so the app can keep its icon badge in step.

## The notification center: /notifications

[pages/notifications.html](../pages/notifications.html) (served at
`/notifications`, `noindex`) is the overflow surface the dropdown never has
to be: full history, filterable, deletable.

- **Auth wall.** Without the local sign-in hint (or on a 401 from the API)
  the page shows a sign-in wall linking to `/login?next=/notifications`.
- **Category tabs** filter the fetched list client-side per the table above.
  The active tab is reflected with `aria-selected`; each empty category has
  its own designed empty state.
- **Pagination.** Pages of 30 load via the `before` cursor: the Load more
  button passes the last row's `created_at` back to the API and appends the
  result. The button renders only while the API reports `has_more`.
- **Per-row actions.** Clicking a row marks it read, tracks the open, and
  navigates. The delete button on each row removes it permanently
  (`DELETE /api/notifications/:id`), optimistically in the UI and
  fire-and-forget on the wire. Mark all read clears everything at once.
- Unlike the dropdown, the page never auto-marks the whole inbox read on
  open; unread rows stay highlighted until clicked or bulk-cleared.

## API contract

All endpoints require authentication: a session cookie or a bearer credential
(API key / OAuth). Unauthenticated calls answer
`401 { "error": "unauthorized" }`. State-changing routes additionally require
a CSRF token for cookie sessions (fetch one from `GET /api/csrf-token`, echo
it in the `X-CSRF-Token` header); bearer callers are CSRF-exempt, which is
what the examples below use. Every query is scoped to the caller's `user_id`,
so one user can never read, mark, or delete another's notifications. The
same endpoints are exposed as MCP tools by
[packages/notifications-mcp](../packages/notifications-mcp/README.md).

### List the inbox

```
GET /api/notifications?limit=20&type=<type>&before=<iso>
```

`limit` is 1..50 (default 20). `type` filters one exact notification type.
`before` pages past a `created_at` cursor.

```sh
curl -s 'https://three.ws/api/notifications?limit=5' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

```json
{
  "notifications": [
    {
      "id": "5f3c9c2a-1111-4222-8333-444455556666",
      "type": "remix",
      "payload": { "actor": "mira", "royaltyPaid": true, "royaltyUsd": 0.012, "link": "/viewer?src=..." },
      "read_at": null,
      "created_at": "2026-07-30T09:14:02.511Z"
    }
  ],
  "unread_count": 3,
  "has_more": false
}
```

> Source: [api/notifications/index.js](../api/notifications/index.js).

### Mark one read

```sh
curl -s -X POST \
  'https://three.ws/api/notifications/5f3c9c2a-1111-4222-8333-444455556666/read' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

Returns `{ id, read_at }`. Idempotent: an already-read row keeps its original
`read_at`. 404 if the row is not the caller's.

> Source: [api/notifications/[id]/read.js](../api/notifications/%5Bid%5D/read.js).

### Mark everything read

```sh
curl -s -X POST 'https://three.ws/api/notifications/read-all' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

Returns `{ marked_read: <count> }`.

> Source: [api/notifications/read-all.js](../api/notifications/read-all.js).

### Delete one

```sh
curl -s -X DELETE \
  'https://three.ws/api/notifications/5f3c9c2a-1111-4222-8333-444455556666' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

Returns `{ ok: true, id, deleted: true }`; 400 for a non-UUID id, 404 if the
row is not the caller's. Removal is permanent.

> Source: [api/notifications/[id]/index.js](../api/notifications/%5Bid%5D/index.js).

### Track a funnel event

```
POST /api/notifications/track
{ "notification_id": "<uuid>", "channel": "push" | "in_app" | "avatar", "event": "opened" | "returned" }
```

An idempotent analytics beacon closing the sent-to-opened-to-returned loop:
the service worker fires `opened` on a push click, the corner companion fires
`opened` when you click through from a line it announced, and the app fires
`returned` when it boots from a push-sourced open. Session-cookie auth only (no bearer),
CSRF-exempt, deduplicated server-side.

> Source: [api/notifications/track.js](../api/notifications/track.js).

### Preferences

```sh
# Read the resolved category x channel matrix
curl -s 'https://three.ws/api/notifications/preferences' \
  -H 'Authorization: Bearer YOUR_API_KEY'

# Turn push off for the social category
curl -s -X PUT 'https://three.ws/api/notifications/preferences' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'content-type: application/json' \
  -d '{ "categories": { "social": { "push": false } } }'
```

GET returns
`{ categories, channels, type_categories, prefs, push: { subscribed_devices, ios_devices }, gateways: { telegram, discord } }`:
the categories from the table above, the channels (`in_app`, `push`, `email`,
`telegram`, `discord`, `avatar`), the type-to-category map (so a browser client
can resolve a category without a round trip per notification), the caller's
resolved matrix, the push device count (browsers plus iPhones enrolled through
the iOS app, with the iPhones also counted alone), and how many chats paired
through the Telegram and Discord chat gateways have notifications on. The
`telegram` and `discord` channels deliver to those paired chats. PUT returns
`{ ok: true, prefs }`: it stores a sparse override, unknown categories,
channels, and keys are dropped, and `prefs` is the re-resolved matrix. The
body also accepts `telegram_chat_id` (digits, settable and clearable) for the
Telegram channel.

Delivery gating notes, all enforced in
[api/_lib/notify-prefs.js](../api/_lib/notify-prefs.js):

- Muting `in_app` for a category writes no inbox row at all for it: nothing
  in `unread_count`, nothing in `GET /api/notifications`, and turning it back
  on is not retroactive. The channels are independent, so a muted bell with
  push left on still delivers the OS notification.
- The `account` category's `in_app` channel is locked on. It is the durable
  record of withdrawals and security events, and the fallback bucket for
  unmapped types; every other channel stays fully mutable.
- A user who never saved gets the defaults, and new categories light up
  automatically without a backfill.

The visual editor for all of this is the Notifications panel in
`/dashboard/settings` ([source](../src/dashboard-next/pages/settings.js)),
one click from the gear icon in both notification surfaces.

> Source: [api/notifications/preferences.js](../api/notifications/preferences.js).
> The endpoint-level README at
> [api/notifications/README.md](../api/notifications/README.md) covers the
> same routes from the operator's side (rate limits, table names, routing).

---

## Related pages

- [The social layer](./social-layer.md): where notification events come from
  and how they connect to the feed, follows, and portfolios.
- [api/notifications/README.md](../api/notifications/README.md): the
  endpoint directory's own reference.
- [packages/notifications-mcp](../packages/notifications-mcp/README.md): the
  same inbox as MCP tools for machine clients.
~~~~

### `docs/knock.md` (whole file)

~~~~markdown
# Knock

**A priced door to a person. Pay their price, get one message through, and their
3D companion delivers it in person.**

Cold outreach is free to send and expensive to receive. That asymmetry is the
whole problem: the person on the receiving end drowns, and the one message that
mattered is lost in the pile. Knock inverts it. You publish a door, you set what
one message from a stranger costs, and the price does the filtering. A stranger
who genuinely needs you buys thirty seconds of your attention for a nickel. A
spammer cannot buy a million of them.

The delivery is the other half. A knock is not a badge on a tab you will get to
later: your [companion](./companion.md) walks on screen wherever you are on
three.ws, turns to you, and says who is at the door and what they paid.

Open yours at **[three.ws/knock](https://three.ws/knock)**.

- **The money is yours.** The USDC settles directly to the wallet you name.
  three.ws never takes custody of it and takes no cut of it.
- **Both kinds of visitor.** A person pays with the wallet in their browser. An
  agent pays over [x402](./x402.md) with no human in the loop.
- **Nothing lands for free.** Price, daily cap, message length, and a block list
  are all yours to set. Every refusal happens before any payment, so a knock
  that was never going to land is never a knock somebody paid for.
- **One message, one door.** Knock is not a chat. It is a way in, once.

---

## Opening your door

1. Pick a username, if you have not (your door lives at `/knock/<username>`).
2. Open [three.ws/knock](https://three.ws/knock) and set:
   - **Price**: anything from $0.001 to $1,000, or `0` for a free door.
   - **Solana wallet**: where the USDC lands. Solana is the home chain and the
     lane an agent settles on by default. A Base address is optional and is only
     advertised when you set one.
   - **Headline and greeting**: what a visitor reads before they write. Tell
     them what you actually want to hear about; it is the cheapest filter you
     have.
   - **Daily cap** and **message length**.
3. Flick **Door open**. Share the link.

A priced door cannot be opened without a payout address. The API refuses the
save rather than quietly routing a stranger's money into the platform's wallet.

**Listed** is separate from **open**. An unlisted open door is reachable by
anyone with the link but never appears in the public directory, which is what
you want if you are handing the link to a specific set of people.

---

## What a visitor sees

`three.ws/knock/<handle>` renders your price, your greeting, and a box. The
message is capped at the length you set, with a live counter.

A **subject** line is optional and is the only thing spoken aloud. The body is
shown in full, in the bubble and in your inbox, but it is never read at you by
your own avatar: a long or hostile paragraph should not be able to hijack your
companion's mouth.

When the knock lands, the sender gets a **receipt URL**. It carries its own
proof (an HMAC over the knock id), so they can check on it later without an
account here, and it exposes exactly two things: the status, and the reply if
you wrote one.

---

## What you see

Two views of the same thing.

**In person.** The knock becomes a companion event whose importance is derived
from the amount paid, so your avatar walks on and says, for example, *"Ada paid
$0.05 to reach you: Your x402 settle path."* Every paid knock scores above the
default interrupt threshold of 60; a free-door knock lands at 45, which puts it
in the feed and the bell without stopping your day. Raise your companion's
threshold if you want only the expensive ones to interrupt.

**In the inbox.** [three.ws/knock](https://three.ws/knock) lists every knock
with what it was worth, plus totals: waiting, all time, and earned. From a row
you can reply, mark read, dismiss, or block.

A **reply** is written back to the receipt link the sender already holds. That
is the whole return path, deliberately: answering someone never hands out your
email address or opens a thread.

A **block** matches on the wallet that paid when there was one, and on the
sender's name when the knock was free. A blocked sender gets the same answer a
shut door gives, so they cannot tell it was them specifically.

---

## For agents

### Read the door first

<!-- runnable: 404 the handle answers 200 only while its owner has a door open -->
```bash
curl -s 'https://three.ws/api/knock/door?handle=nirholas'
```

```json
{
  "door": {
    "handle": "nirholas",
    "display_name": "nirholas",
    "free": false,
    "price": "$0.05",
    "price_atomics": "50000",
    "currency": "USDC",
    "networks": ["solana"],
    "max_chars": 600,
    "headline": "Ask me about x402 on Solana",
    "endpoint": "https://three.ws/api/x402/knock?to=nirholas",
    "protocol": "x402"
  }
}
```

Public, cacheable, no credential. A handle nobody has opened a door for and a
handle that matches nobody both answer 404 with the same body, so this cannot be
used to enumerate accounts.

`GET /api/knock/directory` returns every open, listed door, cheapest first.

### Knock, and pay for it

The paid lane is a standard x402 endpoint:

```
POST https://three.ws/api/x402/knock?to=<handle>
```

```json
{
  "from": "Ada (research agent)",
  "subject": "Your x402 settle path",
  "message": "I index x402 endpoints and yours is the only one settling on Solana. Two questions about the facilitator.",
  "url": "https://example.com/ada",
  "sender_kind": "agent",
  "request_id": "ada-2026-08-28-001"
}
```

The first call answers `402` with the door's real price and the recipient's own
address as `payTo`. Pay it and retry with the `X-PAYMENT` header, exactly as
with any other x402 resource. A settled call returns:

```json
{
  "ok": true,
  "knock_id": "c1b0a2d4-…",
  "delivered_to": "nirholas",
  "announced": true,
  "importance": 74,
  "paid": "$0.05",
  "receipt_url": "https://three.ws/api/knock/reply?id=c1b0a2d4-…&token=…",
  "duplicate": false
}
```

`request_id` is an idempotency key. A retry after a settled payment returns the
first knock rather than knocking, and charging, twice.

Free doors take a plain POST instead, with the handle in the body:

```bash
curl -X POST https://three.ws/api/knock/send \
  -H 'content-type: application/json' \
  -d '{"to":"nirholas","from":"Ada","message":"a real message"}'
```

Posting to the wrong lane is not an error you have to guess at: a priced door
answers the free lane with `402` and the x402 endpoint to use, and a free door
answers the x402 lane with `400` and the plain one.

### With the SDK

```bash
npm install @three-ws/knock
```

```js
import { knock, quote } from '@three-ws/knock';
import { wrapFetchWithPayment } from 'x402-fetch';

const door = await quote('nirholas');   // read the live price first

const result = await knock({
	to: 'nirholas',
	from: 'Ada (research agent)',
	subject: 'Your x402 settle path',
	message: 'Two questions about the facilitator.',
	fetchWithPayment: wrapFetchWithPayment(fetch, wallet),
	maxPriceAtomics: 100_000n,          // never spend more than $0.10
	requestId: 'ada-2026-08-28-001',
});
```

The SDK never signs anything itself: you pass the paying `fetch` from the x402
client and wallet you already trust, so your keys and your chain stay yours.
`maxPriceAtomics` is checked against the door's live price before any payment is
attempted, which matters because an owner can raise their price between your
quote and your call.

From the terminal:

```bash
npx @three-ws/knock quote nirholas
npx @three-ws/knock send nirholas "Two questions." --from "Ada" --payer ./payer.mjs
```

A priced door prints the recipient, the amount, the token and the chain, and
stops for a yes. With no TTY it refuses rather than assuming consent.

### From an MCP client

```bash
claude mcp add knock -- npx -y @three-ws/knock-mcp
```

Six tools: `knock_quote`, `knock_directory`, `knock_send`, `knock_receipt`, and
(with `THREE_WS_API_KEY`) `knock_inbox` and `knock_act`.

The MCP server holds no wallet and cannot spend. On a priced door `knock_send`
returns the recipient, amount, token and chain and stops, so the decision to pay
stays with a human. See
[@three-ws/knock-mcp](https://www.npmjs.com/package/@three-ws/knock-mcp).

### Read the answer

<!-- runnable: 404 the id and token are placeholders; a real receipt answers 200 -->
```bash
curl -s 'https://three.ws/api/knock/reply?id=<knock id>&token=<receipt token>'
```

```json
{ "knock": { "status": "replied", "reply": "Ask away.", "seen": true, "amount": "$0.05" } }
```

Statuses: `pending`, `read`, `replied`, `dismissed`. A wrong or missing token is
a 404, not a 403: an id on its own should not confirm that a knock exists.

---

## Endpoints

| Endpoint | Auth | What it does |
| --- | --- | --- |
| `GET /api/knock/door?handle=` | none | One door's public terms. |
| `GET /api/knock/directory` | none | Every open, listed door, cheapest first. |
| `POST /api/knock/send` | none | Knock on a free door. |
| `POST /api/x402/knock?to=` | x402 payment | Knock on a priced door. |
| `POST /api/knock/escrowed` | on-chain escrow | Knock on a door that takes escrowed knocks, where the money only moves if you get an answer. |
| `POST /api/knock/escrow-sync` | none | Re-read one escrow on-chain and update the cached state on its delivered knock. Open to anybody: it can only write back what the program already recorded. |
| `GET /api/knock/reply?id=&token=` | receipt token | What became of a knock you sent. |
| `GET /api/knock/settings` | session, or a bearer with `profile` | Your door, your totals, your block list. |
| `PATCH /api/knock/settings` | session, or a bearer with `profile` (plus `wallet:write` to change a payout wallet) | Change any of it. |
| `GET /api/knock/inbox` | session or bearer | The knocks your door has taken. |
| `PATCH /api/knock/inbox/<id>` | session or bearer | Reply, mark read, dismiss, block. |

A bearer is an API key or OAuth access token. A cookie session carries every
scope; a bearer holds only what it was granted, and `/api/knock/settings`
answers `403 insufficient_scope` when it lacks `profile`. Moving the payout
(`pay_to_solana` or `pay_to_base`) needs `wallet:write` as well, because it
redirects every future paid knock.

Error codes are stable and mean what they say: `no_door`, `door_closed`,
`door_full` (429, retryable tomorrow), `message_too_long`, `message_too_short`,
`bad_url`, `missing_sender`, `free_door`, `payment_required`.

The escrowed lane adds `escrow_not_enabled` (409, and the body names the lane
to use instead), `no_payout_wallet` (409), `knock_not_found` (402, nothing is
escrowed at the address the request derives), and four 409s for an escrow that
exists but cannot be used: `already_settled`, `message_mismatch`,
`window_closed`, `underpaid`.

---

## The escrowed lane

The x402 lane sends your USDC to the recipient the instant the payment clears.
Between people who already know each other that is the right shape, and it is
why the lane exists. Between strangers it is the whole risk: a door can bank
every knock and answer none, and you have no recourse. Nobody is going to keep
paying strangers under those terms, and when they stop, the price stops meaning
anything, which was the entire point of pricing a door.

An escrowed door fixes that without giving three.ws your money either. You sign
a `knock` instruction on the [knock_escrow](https://github.com/nirholas/three.ws/tree/main/contracts/knock-escrow)
Solana program, which parks your payment in a vault owned by that knock's own
program address. From there exactly three things can happen to it:

| Outcome | Who can trigger it | Where your money goes |
| --- | --- | --- |
| Answered inside the window | the door's owner, and nobody else | to them, minus the protocol fee |
| Refused | the door's owner | **all of it back to you**, no fee taken |
| The window closes | **anyone at all** | **all of it back to you** |

There is no fourth path. three.ws holds no key that can move a parked knock,
and neither can the protocol authority: the vault's only authority is the
knock's own address. The worst case for a sender is that their money is
unavailable until the window they agreed to runs out.

Two details worth knowing:

**The refund is permissionless.** If only you could claim it back, the guarantee
would be worth exactly as much as your diligence, and an agent that knocked and
went away would leave the money stranded. Anybody can crank an expired refund,
and it can only ever pay the original sender.

**Refusing costs you nothing.** An owner who will not engage is better off
refusing than letting the clock run out: you get your money back immediately
rather than a day later. Reading something and declining to answer is not a
service, so it is not charged for.

### Sending an escrowed knock

```bash
# 1. Check the door takes escrowed knocks and read its price.
curl -s 'https://three.ws/api/knock/door?handle=nirholas'

# 2. Sign the on-chain `knock` instruction yourself, parking the price in escrow.
#    The knock's address derives from (door, your wallet, a nonce you choose).

# 3. Deliver the message against it.
curl -sX POST https://three.ws/api/knock/escrowed \
  -H 'content-type: application/json' \
  -d '{
        "to": "nirholas",
        "from": "Ada (research agent)",
        "message": "two questions about the facilitator, happy to pay for the time",
        "sender_wallet": "<the wallet that signed the knock>",
        "nonce": 7
      }'
```

The response carries the knock's address, its vault, the deadline, and the
seconds remaining. The message body itself never touches the chain: the escrow
commits to its SHA-256, so both sides can prove later what was actually sent
without publishing a stranger's private message to a public ledger. That hash is
also what stops a paid escrow being reused to deliver a different message.

Hash the **trimmed** message body, exactly the bytes you are about to send as
`message`. The API hashes the same trimmed string and refuses to deliver
anything whose hash is not the one on-chain, so a stray leading newline is the
difference between a delivery and a `message_mismatch`.

### Opening an escrowed door

```bash
curl -sX PATCH https://three.ws/api/knock/settings \
  -H 'content-type: application/json' \
  -d '{ "escrow_enabled": true, "escrow_window_hours": 24 }'
```

Off by default on every door, because turning it on changes what a stranger is
agreeing to when they pay. It needs a Solana address on the door: that address
is where an answer pays out, and it is half of the door's on-chain identity.
The window can be 1 hour to 30 days, the same band the program enforces.

That call only flips the switch on three.ws. The door also has to exist
**on-chain**, and only your wallet can create it: the account is derived from
your own address, so no server, including ours, can open, reprice or shut it for
you. Do it from [/knock](https://three.ws/knock), where the escrow panel reads
the chain and shows you one of three states.

| What the chain says | What the panel offers |
| --- | --- |
| No door account yet | **Open my door on-chain**. Until you do, escrowed knocks have nowhere to land and senders are shown the normal lane. |
| Open, and matching your settings | Nothing to do. It shows the on-chain price, window, and how many knocks it has answered. |
| Open but different, or shut | **Update it on-chain**, with the on-chain numbers spelled out, because those are the ones a sender is actually agreeing to. |

### Keeping the cache honest

The `escrow_*` columns on a delivered knock are a cache of what the program
recorded, and nothing ever tells this server that a settlement happened: answers,
refusals and refunds are transactions signed by wallets we do not hold. So the
only correct move is to look.

```bash
curl -sX POST https://three.ws/api/knock/escrow-sync \
  -H 'content-type: application/json' \
  -d '{ "knock": "<the knock address>" }'
```

It reads the account, writes back exactly the state the program recorded, and
answers with `{ state, changed, expires_at, expired }`. It is deliberately open
to anybody, because it cannot be used to claim anything: a caller who lies about
a settlement gets the truth written instead. The site calls it after an answer or
a refusal, which is what keeps a refunded knock from sitting in an inbox looking
like money still on the table.

### From the browser

Both sides of the lane work without an agent or a CLI.

**Knocking.** A door that takes escrow shows a chooser on its page: pay now, or
escrow. Pick escrow and the button says what it will do, a dialog states the
amount, who it goes to, the deadline and the escrow's own address, and nothing
is signed until you agree to that. Your wallet signs the `knock`; three.ws is
handed nothing but the message afterwards. The page then shows a live countdown
against the deadline, and the moment it passes, a button that cranks the refund
back to you.

**Answering.** An escrowed knock in your inbox says how long you have to answer
and what answering is worth. Writing a reply saves it first and then asks your
wallet to release the payment, in that order deliberately: a wallet prompt you
dismiss costs you the money, never the reply you already wrote. **Refuse and
refund** is offered beside it, and takes no fee.

---

## Why it is built this way

**Refuse before charging.** The message is read and validated against that
door's limits before the 402 is issued. A knock that is too long, a door that is
shut, a door that is full for the day, a sender who is blocked: all of them cost
nothing. The handler that records the knock also runs before settlement, so even
a payer who skipped the pre-flight gets refused without moving money.

**The price is the ranking.** A mail client guesses at importance from keywords.
A knock does not have to guess: the sender said what reaching you was worth, in
money. The companion's importance score is a log-scaled function of the amount,
so a $50 knock outranks a $0.05 one without a $5,000 knock being able to sit
permanently at the top of the feed.

**The body is never spoken.** Only the subject line is read aloud. Anything a
stranger writes is untrusted text, and untrusted text does not get to use your
avatar as a speaker.

**No custody, no cut.** `payTo` on the 402 challenge is the recipient's own
address. There is no platform wallet in the path to be drained, reconciled, or
argued about. The escrowed lane keeps that property while removing the trust it
used to require: the money sits in a vault whose only authority is the knock's
own program address, so three.ws cannot release it, refund it, or redirect it,
and neither can anyone else outside the three outcomes above.

---

## Related

- [The Companion](./companion.md) is what delivers a knock in person.
- [x402](./x402.md) is the payment protocol the priced lane speaks.
- [Notifications](./notifications.md) covers the per-category channel matrix; knocks are their own category, and the avatar channel is on for them by default.
~~~~

