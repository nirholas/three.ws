# Destination whitelist

The destination whitelist is the list of addresses an agent wallet may send funds to. A new address cannot receive anything until it has served a cooldown (24 hours by default, never less than 1 hour), you are told the moment one is added, and you can cancel it with one click. It exists so that a stolen session or a prompt-injected agent cannot add an attacker address and drain the wallet in one minute.

Open it in the wallet at [/agent-wallet](https://three.ws/agent-wallet) on the **Allowlist** tab (deep link: `/agent-wallet?agent=<id>&tab=whitelist`).

## How an address becomes usable

```
agent or API key        owner, with step-up
      |                        |
  proposed  ---approve--->  pending  ---cooldown ends--->  active
      |                        |                              |
      +-------cancel-----------+                           remove (instant)
```

| State | Can receive funds | How it gets there |
|---|---|---|
| `proposed` | No | An agent, API key or OAuth client asked for it. Inert until you approve it. |
| `pending` | No | You added or approved it. It serves the cooldown. `activates_at` says when. |
| `active` | Yes | The cooldown ended. |
| `cancelled` | No | You cancelled a pending or proposed address. |
| `removed` | No | You removed an active address. Takes effect instantly. |

Rules that hold on every path:

- **Adding, approving or editing an address needs step-up.** You re-authenticate with your password or an emailed six-digit code (a wallet signature also works over the API). The resulting grant is single-use and bound to your session, your account, the agent and a hash of the exact change, so a grant for "add address A" can never authorise "add address B".
- **An agent can only propose.** MCP tools, API keys and OAuth clients have no browser session, so they can never hold a step-up grant. They create a `proposed` entry and nothing more.
- **Removal is instant** and needs no step-up. Cancelling is one click and needs no step-up either: both only take access away.
- **Loosening protection is delayed.** A shorter cooldown, or turning the restriction off, needs step-up and then takes effect one full current cooldown later (visible as `pending_change`, cancellable until then). Making protection stronger is instant.
- **The first active address turns the restriction on** for an agent that never configured it. Agents that already had a withdraw allowlist keep it: it was converted to active entries and the restriction stays on.
- **The agent's own wallet is always allowed.**

## What it covers

The check runs inside the shared spend guards, at the signing boundary, so it covers: owner withdrawals, agent-to-agent transfers and tips, bridge sends, wallet intents and treasury sweeps, autopilot transfers, portfolio sends, invoice and order payouts, and EVM sends. Each is refused with a structured `403` before anything is signed:

| `error` | Meaning |
|---|---|
| `destination_not_whitelisted` | Not on the list and the restriction is on. |
| `destination_cooling_down` | On the list but still serving its cooldown. |
| `destination_awaiting_approval` | An agent proposed it and you have not approved it. |
| `destination_invalid` | Not a valid address, so it cannot be checked. |
| `destination_cap_exceeded` / `destination_daily_cap_exceeded` | The per-destination cap you set was exceeded. |

Not covered, on purpose: trades, token snipes and x402 payments (the destination is a venue or a merchant chosen per call, governed by their own limits), and platform-controlled destinations such as card purchases, marketplace escrow, vault moves and inference top-ups (`destinationTrust: 'system'` in code).

Every fund-moving confirmation shows the state, for example `On the allowlist: Cold wallet` or `BLOCKED: cooling down until 2026-10-11T09:00:00.000Z`: the withdraw dialog, the withdraw simulate response (`allowlist`), and the agent send preview (`confirmation.allowlist`).

## Per-destination caps

Each entry can carry `per_tx_cap_usd` and `daily_cap_usd`. They apply to that destination only, on top of the agent's global limits. The daily figure is the rolling 24 hours of sends to that address.

## Address safety

Addresses are compared by a canonical key, never by the text the user typed.

- Only printable ASCII is accepted. A zero-width space, a Cyrillic lookalike letter, a full-width digit or an embedded newline is rejected outright, not stripped into a different string.
- Solana addresses are case-sensitive base58 that must decode to 32 bytes. A re-cased string is a different address.
- EVM addresses compare case-insensitively. A mixed-case spelling must carry a valid EIP-55 checksum.
- Adding an address that shares the first and last characters of one already listed returns `lookalike_of` and is flagged in the notification, to catch address poisoning.
- Labels are plain text: control characters, markup and links are removed and the label is capped at 60 characters.

## Notifications

Every change notifies you immediately on every channel you have connected (in-app, push, Telegram, Discord) and by email. These notifications ignore your notification preference matrix on purpose: a quiet inbox must not be what lets a thief wait out the cooldown. The email and the notification for a new address carry a signed cancel link. The link works without signing in, is valid until two weeks after the cooldown ends, and cancels only that one pending or proposed address.

## REST API

One endpoint, `/api/wallet-whitelist`. Cookie sessions send the CSRF token on writes; bearer callers use the `wallet:read` / `wallet:write` scopes and are propose-only.

```bash
# List (add &history=1 for cancelled and removed entries too)
curl -s -b cookies.txt "https://three.ws/api/wallet-whitelist?agent=$AGENT_ID"
```

Writes are POSTs with an `action`:

| `action` | Body | Needs step-up | Principals |
|---|---|---|---|
| `add` | `agent_id`, `address`, `label?`, `per_tx_cap_usd?`, `daily_cap_usd?`, `grant` | Yes (owner session) | Owner session creates `pending`. Any other principal creates `proposed`. |
| `approve` | `agent_id`, `id`, `grant` | Yes | Owner session |
| `edit` | `agent_id`, `id`, `label?`, caps, `grant` | Yes | Owner session |
| `remove` | `agent_id`, `id` | No | Owner |
| `cancel` | `id`, or `token` from a cancel link | No | Owner, or anyone holding a valid cancel token |
| `settings` | `agent_id`, `cooldown_seconds?`, `enforced?`, `cancel_pending_change?`, `grant` | Loosening only | Owner session |
| `stepup_code` | `agent_id`, `kind`, `op` | n/a | Emails a six-digit code for that exact change |
| `stepup` | `agent_id`, `kind`, `op`, `method`, `proof` | n/a | Returns `{ grant }` |

`kind` is `add`, `approve`, `edit` or `settings`; `op` is the same body you will send with the action. `method` is `password` (`proof: { password }`), `email_code` (`proof: { code }`) or `wallet` (`proof: { message, signature }`, signing `three.ws step-up\nApprove allowlist change <op_hash>\nSession <session id>\nValid until <ISO time>`).

A write that needs step-up and has none answers `403 step_up_required` with `op`, `op_hash` and `methods`, so a client can start the step-up from the error alone.

```bash
# 1. Ask for a grant for exactly this change
curl -s -b cookies.txt -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"action":"stepup","agent_id":"'$AGENT_ID'","kind":"add","op":{"address":"'$ADDR'","label":"Cold wallet"},"method":"password","proof":{"password":"..."}}' \
  https://three.ws/api/wallet-whitelist
# 2. Use it once
curl -s -b cookies.txt -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"action":"add","agent_id":"'$AGENT_ID'","address":"'$ADDR'","label":"Cold wallet","grant":"<grant id>"}' \
  https://three.ws/api/wallet-whitelist
```

### The legacy whole-list write

`PUT /api/agents/:id/solana-wallet` (the limits endpoint) still accepts `withdraw_allowlist: [...]`, under the same rules. Addresses missing from the new list are removed at once. Addresses new to it become `pending` entries and the request must carry `grant` (a step-up grant for kind `set_list`), otherwise it answers `403 step_up_required`. The field in `GET` responses is the list of currently active addresses.

## MCP tools

| Tool | Tier | What it does |
|---|---|---|
| `get_whitelist` | read | The agent's entries (status, labels, caps, seconds until active), the cooldown and whether the restriction is on. |
| `add_to_whitelist` | write | **Proposes** an address. It cannot activate it. The result says the owner must approve it in the app. |
| `remove_from_whitelist` | write | Removes an address immediately. |

There is deliberately no tool that approves, activates or edits an address or the settings.

## Operating it

- Migration: `api/_lib/migrations/20261010160000_destination_whitelist.sql` (check with `npm run db:status` first).
- A cron, `/api/cron/whitelist-activate` (every 5 minutes), flips entries whose cooldown ended and applies due settings changes. Reads also activate due entries, so a send never waits on the cron. After a deploy that adds the cron, run `npm run deploy:gcp:sync-crons`.
- Selling or transferring an agent clears the seller's entries and settings.

Related: [Custody you can verify](./custody.md), [Agent wallet API](./agent-wallet-api.md), [Autonomous agent-to-agent payments](./a2a-payments.md), [MCP](./mcp.md).
