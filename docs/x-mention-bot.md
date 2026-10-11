# The X @-mention reply bot

Internal operator runbook. Not a product surface: nothing here is linked from
the public site until the bot goes live (owner order 928). It documents the
pieces that answer an `@`-mention of `@trythreews` or one of our agents'
connected X accounts: how a mention becomes a decision, where that decision is
reviewed, and what is and is not wired yet.

For the sibling capability that lets an X account *sign in* to three.ws
(rather than be read as a mention), see the "Account linking" section below.
For the launch-by-mention intent (`launch <NAME> $<TICKER>`), see
`prompts/finish/925-parity-15-mention-to-launch.md`: it plugs its reply into
the same parser and the same ledger this doc covers, and this file is the one
place it should extend rather than write a second mention doc.

## Design rules

These come from `prompts/finish/_context/x-grok-00-CONTEXT.md` and apply to
every piece below, not just the ones that enforce them automatically yet
(see "What is not wired yet"):

1. **Mention text is untrusted.** A tweet, a bio, a quoted post, or image alt
   text is data, never an instruction. No path from it reaches a spend, a
   transfer, a launch, or a post to anyone other than the author who tagged
   us, in the same conversation.
2. **No spend through this path.** The bot can read, generate, and reply. It
   can never move funds, pay x402, or launch a coin itself; a launch intent
   only ever builds a `/launch` link the author reviews and signs themselves.
3. **Dry run by default.** Every write path is gated by an env flag
   (`X_MENTION_BOT_LIVE`) and, per agent, by that agent's own policy. With it
   unset, the pipeline reads, decides, and records what it would have
   replied, and posts nothing.
4. **Reply only when addressed**, one reply per mention, never to our own
   replies.
5. **`$THREE` is the only coin this bot promotes or recommends.**

## The ledger: `x_mention_events`

Every mention is recorded exactly once, before anything else happens. Table
`x_mention_events` (migration
[`api/_lib/migrations/20261008170000_x_mention_events.sql`](../api/_lib/migrations/20261008170000_x_mention_events.sql)),
keyed by `tweet_id` so two readers that both see the same mention race on one
`INSERT ... ON CONFLICT DO NOTHING` and exactly one wins the right to handle
it. Columns: which account was mentioned (`account_kind` company/agent,
`account_ref`), the author, the raw mention text, the intent the parser gave
it, the `decision` (`reply | skip | rate_limited | unsafe | budget | error |
pending | paused`, null while undecided), the reply text/media/link it sent
or would send, whether it was a `dry_run`, and timestamps. Reader/writer:
[`api/_lib/x-mention-store.js`](../api/_lib/x-mention-store.js)
(`recordMention`, `updateDecision`, `recentDecisions`, `adminListMentions`,
`adminCountMentions`, `countConversationReplies`). Polling cursors live in
`app_settings` under `x_mentions_cursor:<kind>:<ref>`, not in this table.

## Turning a mention into an intent

[`api/_lib/x-mention-intents.js`](../api/_lib/x-mention-intents.js) is a pure
module (no network, no DB, no clock): `parseMentionIntent` reads a normalized
mention and our account, and returns one of seven intents, deterministically:

| Intent | What it is |
|---|---|
| `make` | A 3D-model request from a text description. |
| `image3d` | Turn an attached, quoted, or replied-to image into a 3D model. |
| `avatar` | Turn the author into a rigged avatar (including "3D my pfp"). |
| `help` | Commands/usage, or any mention the parser cannot read safely. |
| `launch` | `launch <NAME> $<TICKER> [description]` grammar (925's intent). |
| `chat` | Anything else addressed to us, answered without a tool call. |
| `ignore` | Not addressed to us (only inherited through a reply chain, etc). |

Safety is enforced inside the parser, before any model ever sees the text:
phrasing that asks for funds to move, a signed transaction, or a secret
(private key, seed phrase, API key) is forced to `help` rather than reaching
`chat` or any generator, and the same happens for instruction-override
phrasing ("ignore previous instructions", "you are now..."). Untrusted text
is also normalized first (`normalizeText`: NFKC fold, invisible/bidi
character stripping, length cap) so lookalike characters and zero-width
tricks cannot dodge the rules above. `addressing()` classifies how a post
reached us (`direct`, `inherited` through a reply chain, or `absent`), and
only `direct` ever produces a reply. Tested in
[`tests/x-mention-intents.test.js`](../tests/x-mention-intents.test.js),
including hostile fixtures.

## Reading mentions: the two inputs

Two independent readers feed the same ledger, so either one can be the
trigger without the other existing:

- **Polling.** [`api/_lib/x-mentions.js`](../api/_lib/x-mentions.js) calls
  `GET /2/users/:id/mentions` since a cursor, for the company account (app
  OAuth 1.0a) or an agent's own connected account (its OAuth2 user token).
  Typed failures (`XTierUnavailable`, `XRateLimited`, `XAuthFailed`,
  `XMentionsError`) let a caller act without parsing strings. A scheduled
  cron that calls this on a loop, decides each mention, and sends the reply
  is not built on this branch yet; see "What is not wired yet."
- **The Account Activity webhook.** `GET /api/x/webhook` answers X's
  Challenge-Response Check; `POST /api/x/webhook` verifies the
  `x-twitter-webhooks-signature` header (HMAC-SHA256 over the raw body with
  the app's OAuth 1.0a consumer secret, constant-time compared), normalizes
  the delivery with
  [`api/_lib/x-webhook-events.js`](../api/_lib/x-webhook-events.js)
  (`normalizeActivityEvent`, producing the same shape the poller does), and
  records it through `recordMention`, leaving `decision = null` for the
  decision step to pick up. It is disabled by default
  (`X_WEBHOOK_ENABLED`) and, when enabled without company X credentials
  configured, acks `{ok:true,disabled:true}` without touching the database.
  `scripts/x-webhook-register.mjs` registers, lists, or deletes the
  subscription (`--dry-run`, `--list`, `--delete`, `--url`). X's Account
  Activity API needs an Enterprise or Pay-Per-Use tier, capped at 3
  subscriptions: owner order 926's gap, named in the handler's own top
  comment. Tests:
  [`tests/api/x-webhook.test.js`](../tests/api/x-webhook.test.js).

## Account linking: mapping an X author to a three.ws account

[`api/_lib/x-identity.js`](../api/_lib/x-identity.js) exports
`findUserByXId(authorId)`, the one shared answer to "is this X user one of
ours": it checks `social_connections` (an owner's own account, connected to
post) and falls back to `agent_x_connections` (a single agent's connected
account), both scoped to `disconnected_at is null`. The mention-reply flow,
the creation-claim flow, and order 925's launch flow all share this lookup
rather than each resolving identity their own way.

An X account can also **sign in** to three.ws, not just be read as a mention
author: `api/auth/x/[action].js`'s `login` action reuses the existing OAuth2
client (scopes `tweet.read users.read offline.access`, read-only) and signs
in through three branches: already linked (`findUserByIdentity`), already
connected for posting (`findUserByXId`, links and signs in), or a new
passwordless account on the same `@wallet.local` placeholder pattern
`api/auth/siws/[action].js` already uses for wallet sign-in (X's OAuth2
profile never reliably carries a verified email, so there is no
email-matching step like Google's). `public/login.html` shows the button
once `api/config.js`'s `xLoginEnabled` is true, which needs
`X_OAUTH_CLIENT_ID`/`X_OAUTH_CLIENT_SECRET` configured; neither exists on any
deployment of this repository yet. Tests:
[`tests/x-identity.test.js`](../tests/x-identity.test.js),
[`tests/user-identities-provider-constraint.test.js`](../tests/user-identities-provider-constraint.test.js).

## Per-agent mention settings

An agent owner controls whether their agent answers mentions of its own
connected X account from the Social tab of
[`pages/agent-edit.html`](../pages/agent-edit.html): enable/dry-run toggles, a
daily reply cap (0 to 50), and which intents it may act on, over
`GET`/`PUT /api/x/agents` ([`api/x/agents.js`](../api/x/agents.js)). Four
columns on `agent_x_policies`
(migration
[`20261011220000_agent_mention_policy.sql`](../api/_lib/migrations/20261011220000_agent_mention_policy.sql)):
`mention_replies_enabled`, `mention_replies_dry_run`,
`mention_replies_daily_cap`, `mention_replies_allowed_intents`, validated by
[`api/_lib/x-agent-policy.js`](../api/_lib/x-agent-policy.js) (an unknown
intent id or an out-of-range cap is a `validation_error`). The panel also
shows the agent's own recent decisions
(`GET /api/x/mention-decisions`,
[`api/x/mention-decisions.js`](../api/x/mention-decisions.js), owner-only,
limit 1 to 20) with the decision badge, author, reason, would-be reply text,
and media thumbnail. Tests:
[`tests/x-mention-decisions-endpoint.test.js`](../tests/x-mention-decisions-endpoint.test.js),
[`tests/agent-mention-policy-migration.test.js`](../tests/agent-mention-policy-migration.test.js).

## The operator console: `/x/ops`

Admin-only, `noindex`, not in the public sitemap: [`pages/x-ops.html`](../pages/x-ops.html)
+ [`src/x-ops.js`](../src/x-ops.js), backed by
[`api/x/ops/[action].js`](../api/x/ops/%5Baction%5D.js) and
[`api/_lib/x-mention-admin.js`](../api/_lib/x-mention-admin.js). It is the
review surface over the ledger above, not a second decision engine:

| Action | What it does |
|---|---|
| `list` / `status` | Filter the ledger by account, intent, decision, dry-run status; read the kill switch and blocklist. |
| `pause` / `resume` | Flip `app_settings` key `x_mention_bot_paused` (also honored via env `X_MENTION_BOT_PAUSED`). Pausing never needs a redeploy. |
| `block` / `unblock` | Edit the `app_settings`-backed JSON blocklist (key `x_mention_blocklist`) of author ids. |
| `send` | For exactly one dry-run `reply` row with no `reply_tweet_id` yet: resolve the posting target (company OAuth 1.0a or the agent's own OAuth2 connection), upload media if present, post, and flip the row to `dry_run: false` with the real tweet id. Gated by CSRF and, in the UI, a native confirmation naming the account, tweet id, and reply text before the request fires. |

Every mutating action is admin-authenticated and CSRF-checked before it runs.
Tests: [`tests/x-ops-authorization.test.js`](../tests/x-ops-authorization.test.js)
(43 cases: anonymous 401, non-admin 403, CSRF enforced per action, success
shapes).

## Health and public status

Two surfaces, same signals, different audiences:

- **Operator:** `gatherMentionBotHealth()` in
  [`api/_lib/x-mention-health.js`](../api/_lib/x-mention-health.js) feeds
  `api/healthz.js`'s `subsystems` array (key `x_mention_bot`). Derived
  entirely from `x_mention_events` plus the pause/live switches (no
  dependency on a poll cron or budget module existing): `ok` / `degraded` /
  `paused` / `unknown`. `degraded` at more than 10 minutes of oldest-undecided
  lag, or more than 20% hourly error rate at a minimum 5-decision sample (so
  one early error never flaps it); `paused` always wins over lag or errors,
  since mentions are still recorded while paused, just never decided or
  sent.
- **Public:** `GET /api/x/mention-bot/status`
  ([`api/x/mention-bot/status.js`](../api/x/mention-bot/status.js)), rate
  limited and cached 60s, returns `status`, `mode`, `handlesServed`,
  `repliesLast24h`, `medianReplySeconds`, `checkedAt`. Explicitly no mention
  text, author identity, or budget data. Shown live on
  [`/grok`](https://three.ws/grok) as a four-stat section. Tests:
  [`tests/x-mention-health.test.js`](../tests/x-mention-health.test.js).

## What is not wired yet

Documented plainly rather than papered over, since this file is the single
source of truth for everything in this subsystem:

- **No poll cron runs the pipeline end to end on this branch.** The pieces
  above (reader, parser, ledger, webhook) record mentions and leave
  `decision = null`, or let an admin manually compose and send a reply
  through `/x/ops`. A scheduled cron that calls `x-mentions.js` on a loop,
  runs the parser, decides, and replies automatically does not exist here
  yet (tracked as x-grok order 060, blocked on reconciling this branch
  against the version of this subsystem built independently on `main`; see
  `prompts/finish/_context/x-grok-PROGRESS.md`, 2026-10-11 entries).
- **No standalone safety-guard module** (kill switch + blocklist + rate caps
  enforced automatically before a reply is composed) runs on this branch.
  The kill switch and blocklist exist and are enforced manually by the
  `/x/ops` console; an automatic per-mention guard that calls them before
  composing a reply is part of the same cron gap above.
- **No budget/degrade-ladder module** throttles reply generation by cost
  tier as X API usage approaches a cap. `DECISIONS` already reserves a
  `budget` value for this.
- **No automatic reply composition.** Nothing on this branch turns a `make`
  / `image3d` / `avatar` intent into a generated 3D model and a composed
  reply; that is also owned by the cron gap above.
- **Creation claiming** (moving what the bot made into the author's library
  once they link X) has no `/x/claim` page or `forge_creations.x_author_id`
  column on this branch yet.

None of these gaps block what is documented above: the ledger, the parser,
the webhook, the per-agent settings, the ops console, and the health/status
endpoints are all real, tested, and independently useful (an admin can
already review real mentions and send a real, manually-reviewed reply
through `/x/ops` today). Going fully live, i.e. setting
`X_MENTION_BOT_LIVE=1` and whatever automatic pipeline eventually drains the
ledger, stays owner order 928.
