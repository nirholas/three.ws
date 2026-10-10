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
its own request.

## Delivery

A new request goes out through the same fan-out as every notification, in
the **Approvals** category (on by default for every channel):

| Channel | What you get |
|---|---|
| Bell and [/notifications](https://three.ws/notifications) | A row that opens the request's deep link. |
| Web push | A notification with **Approve** and **Deny** buttons. Each request has its own tag, so two pending approvals never replace each other. The Approve button sends the request's payload hash, so it executes exactly what the notification described. |
| iOS app | An APNs alert that opens the deep link. |
| Telegram and Discord | A message with the summary, the confirmation lines, and the deep link, through your paired chat. |
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
Today the registered source is `wallet_intent` (agent transfers and swaps from
wallet intents). Then call `createApprovalRequest()` where the source hits
its step-up gate, with an idempotency key derived from the action. Engines
that execute inline (an auto-approved request) call `runApproved(row, run)`,
which provides the same once-only and integrity guarantees.

Related: [Notifications](./notifications.md) for the delivery fan-out and the
preference matrix, [STRUCTURE.md](../STRUCTURE.md) for where everything lives.
