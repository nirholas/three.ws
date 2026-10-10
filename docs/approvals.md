# Approvals: the inbox for actions your agents pause to ask about

Some actions are yours to decide. When you set an agent's spend policy to
**Ask me** (the Policy tab at `/agent/<id>/wallet`), the agent no longer moves
funds on its own for that rule: it writes an **approval request**, tells you
on every channel you have connected, and waits. You answer from a push
notification's Approve or Deny button, from the email, or from the inbox at
[/approvals](https://three.ws/approvals). Approving runs exactly the action you
were shown, once. Denying, ignoring it, or letting it expire runs nothing.

| Piece | Where | Source |
|---|---|---|
| Inbox page | [/approvals](https://three.ws/approvals), deep links `/approvals/<id>?t=<token>` | [pages/approvals.html](../pages/approvals.html), [src/approvals-page.js](../src/approvals-page.js) |
| Library (lifecycle, hashing, links, policies) | server | [api/_lib/approvals.js](../api/_lib/approvals.js) |
| Inbox API | `GET/POST /api/approvals`, `GET/POST /api/approvals/:id`, `GET/POST/DELETE /api/approvals/policies` | [api/approvals/](../api/approvals) |
| Wallet intent wiring | where a gated transfer or swap becomes a request, and where an approved one executes | [api/_lib/wallet-intents.js](../api/_lib/wallet-intents.js), [api/_lib/agent-trade-guards.js](../api/_lib/agent-trade-guards.js) |
| Push Approve/Deny buttons | the browser service worker | [public/push-sw.js](../public/push-sw.js) |
| Schema | `approval_requests`, `approval_auto_policies` | [api/_lib/migrations/20261010120000_approval_requests.sql](../api/_lib/migrations/20261010120000_approval_requests.sql) |
| Tests | tamper, expiry, idempotency, policy matching | [tests/approvals.test.js](../tests/approvals.test.js) |

---

## What triggers a request

A spend rule set to **Ask me** makes the spend-limit check raise
`policy_step_up` instead of letting the action through. The wallet intent
engine catches that and calls `createApprovalRequest()` with the exact action
it was about to take. Approving lifts only that step-up rule. Your numeric
caps, block rules, and any wallet freeze still apply when the approved action
runs, so an approval can never push an action past a limit you set elsewhere.

Each request stores:

- the **payload**: the exact action the executor will run, nothing more;
- a **confirmation table** built from it: action, amount, asset and chain,
  recipient (with a label when the address is known), the USD value when it
  can be priced, the venue, and the expiry;
- **risk notes**, such as "first transfer to this address";
- the **gate reason**: which rule asked you;
- an **idempotency key** (and a `source_ref`), so an agent retrying the same
  action never stacks duplicate requests.

## Lifecycle

```
pending ──approve──> approved ──> executing ──> executed
   │                                     └────> failed
   ├──deny──────────> denied
   └──deadline──────> expired
```

- **pending**: waiting on you. A swap waits 15 minutes, because prices move;
  a transfer of a fixed amount waits 6 hours.
- **approved / executing**: claimed by your decision. The move from
  `approved` to `executing` is a conditional update, so even two decisions
  arriving at the same instant (push on your phone, click on your laptop) run
  the action once. The second caller gets the request's current state back
  with `idempotent: true`.
- **executed**: done, with the transaction signature and an explorer link.
- **failed**: the executor ran and refused or errored (for example, a cap
  you set later now blocks it). A failed request is never retried
  automatically; the agent asks again if the action is still wanted.
- **denied / expired**: terminal, nothing ran. Expiry is lazy: a request
  past its deadline is written as `expired` the next time anything reads or
  decides it, so no cron is involved, and an expired request can never be
  approved.

## Why approving is safe

**The payload hash.** Every request carries the SHA-256 of its payload in
canonical JSON (keys sorted). The inbox shows the action and sends that hash
back with your approval. If the stored action differs from the one you were
shown, the approval answers `409 payload_mismatch` and nothing runs. The
executor re-hashes the stored payload once more right before it runs, so an
edit to the row after approval also fails closed.

**Signed deep links.** Every delivery carries a link of the form
`/approvals/<id>?t=a1.<claims>.<hmac>`. The claims bind the request id, its
owner, its payload hash, and its expiry, signed with the server secret. The
page shows "This link matches the request on file" when it verifies, or says
why it does not (`payload_changed`, `wrong_request`, `bad_signature`,
`malformed`). A decision made through a link that does not match is refused
with `409 link_mismatch`.

**Your session, not a key.** Reading the inbox works with a session or a
read-only bearer. Deciding needs a signed-in browser session plus a CSRF
token. A machine credential, which an agent could hold, can never approve
its own request. A paired chat is the one other place a decision can come
from, and only from the person the chat is paired to (below).

## Delivery

A new request goes out through the same fan-out as every notification, in
the **Approvals** category (on by default for every channel):

| Channel | What you get |
|---|---|
| Bell and [/notifications](https://three.ws/notifications) | A row that opens the request's deep link. |
| Web push | A notification with **Approve** and **Deny** buttons. Each request has its own tag, so two pending approvals never replace each other. The Approve button sends the request's payload hash, so it executes exactly what the notification described. |
| iOS app | An APNs alert that opens the deep link. |
| Telegram and Discord | A message in every paired chat with the full confirmation table, the risk notes, the payload fingerprint, the deadline, the deep link, and signed **Approve** and **Deny** buttons. See [Approving from Telegram and Discord](#approving-from-telegram-and-discord). |
| Email | The fallback. Sent only when no push device or chat received the request, and only if email is on for Approvals in `/dashboard/settings`. It carries the full confirmation table, the risk notes, and the deep link. |

Turn browser push on from the **Turn on push** button in the inbox header.
Change channels from **Delivery settings**, which opens `/dashboard/settings`.

## The inbox

[/approvals](https://three.ws/approvals) has:

- **Status tabs**: Pending, Done, Denied, Expired, All, each with a live count.
- **An agent filter** listing only the agents that have asked you something.
- **Cards** with the confirmation table, copy buttons for the recipient and
  amounts, risk notes, and a countdown to the deadline. Approve is two steps
  (click, then **Confirm approve**; Escape cancels) so a stray click never
  moves money.
- **Bulk deny**: select pending requests, or select all, and deny them in
  one action.
- **Auto-approve rules** (below).
- **An activity log** of every request, approval, denial, execution,
  failure, and rule change, read from the account audit log.

Opening a deep link pins that request on top of the list with its payload
fingerprint and the link check result.

## Approving from Telegram and Discord

Pair a chat once from `/settings/connections` (or send `/start` to the bot),
and every new request lands there as a message like this one (a real render,
from the gateway test suite). When the recipient is shown shortened, a
`Full address:` line follows with the whole address.

```
Approval needed from Treasury Bot
Send 0.5 SOL to the treasury wallet

Recipient: THREEsynthetic11111111111111111111111111111
Amount: 0.5 SOL (~$75.00)
Asset: SOL
Chain: Solana devnet
Venue: Transfers to addresses this wallet has paid before
Held because: Above your per-transfer approval threshold

Risk notes:
- First transfer to this address

Payload hash: 60c9369d86304139...
Expires in 15 min. Nothing runs unless you press Approve.
Review on the web: https://three.ws/approvals/<id>?t=...

[ Approve ]  [ Deny ]
```

Pressing a button decides the request through the same path as the inbox, so
everything in [Why approving is safe](#why-approving-is-safe) still holds, and
the message is edited in place to the outcome ("Approved and executed." with
the signature, "Denied. Nothing was sent.", "Expired before a decision",
or why it did not execute). The buttons are removed once a request is decided.

**What makes a button safe to press.** Each button's callback data
(`ar1<verb><id><expiry><mac>`, at most 64 bytes, the Telegram limit) carries
an HMAC under the server secret over the platform, the verb, the request id,
the paired link, the presser's platform account, the request's payload hash,
and its deadline. A press is refused, and nothing runs, when:

| Case | What the owner sees |
|---|---|
| The request's payload or hash changed after the message was sent | "This button does not match the request on file, so nothing ran." The request stays pending for review on the web. |
| The stored payload was edited under an unchanged hash | The executor's re-hash fails, the request is marked `failed` with `integrity: false`, and the message says it did not execute. |
| The button was altered, or pasted into another chat of the same account | "does not match", nothing ran. |
| Someone other than the paired owner presses it (a group chat) | "Only the account owner paired to this chat can approve or deny." |
| The chat is not paired | "This chat is not paired to a three.ws account, so these buttons do nothing here." |
| The deadline passed | "Expired before a decision. Nothing was sent." |
| The button is pressed again after a decision | The outcome is redrawn ("Already executed."); the action never runs twice. |

A chat decision is recorded with `decided_via` set to `telegram` or
`discord`, and shows in the activity log like any other.

### Chat commands

| Command | What it does |
|---|---|
| `/approvals` | Sends every pending request (up to five, soonest deadline first), each with its own signed buttons. |
| `/agents` | Lists your agents; `/use <number or name>` picks the one this chat talks to. |
| `/positions [agent]` | Open Solana positions for the chat's agent (or the named one): entry, live value, and P&L. |
| `/pause [agent]` | Freezes one agent: outbound spending frozen (withdrawals still work), discretionary trading off, its sniper off. |
| `/kill` | Does the same for every agent on the account, engages the account-wide strategy kill switch, and denies every pending request. |

Anything that is not a command is a message to the chat's agent. Chat
control only moves in the safe direction: a chat can stop agents and deny
requests, but lifting a freeze is done on the web (the agent's wallet,
**Withdraw**, then **Limits & Safety**), so a lost or hijacked chat account can
halt your agents and never unfreeze them. Every `/pause` and `/kill` is
written to the audit log as `gateway.pause_agent` or `gateway.kill_all`.

### What a chat ignores

- **Unpaired chats.** A command from a chat that is not paired gets only the
  pairing prompt. Nothing reaches an agent or a wallet.
- **Other people in a paired group.** They are told the chat belongs to
  someone else, and their buttons are refused.
- **Forwarded messages.** Anything forwarded (from a person, a channel, or
  posted through another bot) is someone else's words, so it is never run as a
  command or passed to the agent, even when it reads as `/kill` or "send my
  SOL to ...". The owner is told it was ignored; an unpaired chat gets no reply,
  and a forwarded `/link` pairs nothing.

Telegram delivery runs on the [agent-gateway worker](../workers/agent-gateway/README.md).

## Auto-approve rules

The default is that every gated action asks you. An auto-approve rule is an
explicit exception you create:

- **venues**: which kinds of action it covers. `jupiter` (token swaps) and
  `wallet_transfer` (transfers). A rule for swaps never covers transfers.
- **max_usd**: the largest single action it covers, capped at $1,000 per
  action. Anything larger always asks.
- **agent_id** (optional): limit it to one agent. **team_id** (optional):
  limit it to one team.
- **expires_at** (optional): the inbox offers 1 day, 7 days, 30 days, or no
  expiry.

Three kinds of request are never auto-approved, whatever rules exist: a
transfer to an address this wallet has never paid before, an action whose
USD value cannot be priced, and anything outside the rule's venues or size.
When several rules match, the one with the smallest cap wins. An
auto-approved request is recorded as `approved` via `auto_policy` with the
rule id, and shows up in the inbox and the activity log like any other.
Revoking a rule stops it immediately; the row stays for the audit trail.

## API

All endpoints answer `{ error, error_description }` on failure. Reads accept
a session or bearer; writes need a session plus `x-csrf-token`.

```
GET    /api/approvals?status=pending|done|denied|expired|all&agent=<uuid>&limit=&cursor=
POST   /api/approvals            { action: "bulk_deny", ids: [uuid, ...] }
GET    /api/approvals/:id?t=<link token>
POST   /api/approvals/:id        { decision: "approve"|"deny", payload_hash, token?, via? }
GET    /api/approvals/policies
POST   /api/approvals/policies   { venues, max_usd, agent_id?, team_id?, expires_at?, label? }
DELETE /api/approvals/policies?id=<uuid>
```

`GET /api/approvals` returns `{ items, counts, agents, next_cursor }`.
`POST /api/approvals/:id` returns `{ request, idempotent }`. Errors worth
handling:

| Status | Code | Meaning |
|---|---|---|
| 400 | `payload_hash_required` | Approve was sent without the hash of the action shown. |
| 404 | `not_found` | No such request on your account. |
| 409 | `payload_mismatch` | The stored action differs from the one you approved. Nothing ran. |
| 409 | `link_mismatch` | The deep link does not match the request on file. Nothing ran. |
| 409 | `already_denied` / `already_decided` | The request is already terminal. |
| 410 | `expired` | The deadline passed. Nothing ran. |

Example: approve the request you just read.

```js
const { request } = await fetch(`/api/approvals/${id}`, { credentials: 'include' }).then((r) => r.json());
const csrf = await fetch('/api/csrf-token', { credentials: 'include' }).then((r) => r.json());
const res = await fetch(`/api/approvals/${id}`, {
	method: 'POST',
	credentials: 'include',
	headers: { 'content-type': 'application/json', 'x-csrf-token': csrf.token },
	body: JSON.stringify({ decision: 'approve', payload_hash: request.payload_hash }),
});
```

## Adding a new kind of request

A source registers an executor in the `EXECUTORS` map in
[api/_lib/approvals.js](../api/_lib/approvals.js). The contract:
`executor(row)` receives the stored row, executes only `row.payload`, and
returns `{ status: 'ok'|'error'|'paused'|'skipped', signature?, note?, usd? }`.
Registered sources include `wallet_intent` (agent transfers and swaps from
wallet intents) and `mail_rule` (an [agent mail](./agent-mail.md) rule in
`approve` mode: approving starts a read-only, zero-budget run on the email that
matched, and its table names the agent, the email and the instruction with
`Spend: None`). Then call `createApprovalRequest()` where the source hits
its step-up gate, with an idempotency key derived from the action. Engines
that execute inline (an auto-approved request) call `runApproved(row, run)`,
which provides the same once-only and integrity guarantees.

Related: [Notifications](./notifications.md) for the delivery fan-out and the
preference matrix, [STRUCTURE.md](../STRUCTURE.md) for where everything lives.
