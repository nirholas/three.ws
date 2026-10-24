# Chat gateways

Talk to your three.ws agent from a chat app. A paired chat can ask for balances and portfolio, run `/pause` and `/kill`, approve or deny requests your spend policy holds, send voice notes and photos, and receive account notifications. Telegram and Discord are live today. Slack, WhatsApp, Signal, SMS and email share the same core.

The API only verifies and queues. The [agent-gateway worker](../workers/agent-gateway/README.md) drains the queue, runs the turn and replies.

## Platform capabilities

One table in [api/_lib/gateway/platforms.js](../api/_lib/gateway/platforms.js) drives behavior per platform.

| Platform | Buttons | Edit in place | Voice |
|----------|---------|---------------|-------|
| Telegram | yes | yes | yes |
| Discord | yes | yes | yes |
| Slack | yes | yes | yes |
| WhatsApp | yes | no | yes |
| Signal | no, reply with a six-digit code | no | yes |
| SMS | no, reply with a six-digit code | no | no |
| Email | no, reply with a six-digit code | no | yes |

## Pairing a chat

Three ways to pair, all ending in the same thing: a chat linked to exactly one account, by that account's owner.

1. **From the chat.** Send `/start`. The bot replies with a pairing code and a link to `/settings/connections?code=...`. Sign in on the site and confirm. Codes expire in minutes.
2. **From the site.** On [Connections](https://three.ws/settings/connections), press issue, then send `/link <code>` to the bot.
3. **From Linked devices.** On [Account, Linked devices](https://three.ws/dashboard/account#linked-devices), mint a code for a Telegram chat and send `/link <code>` in the chat. The chat claims the code, then the signed-in browser sees which chat is asking and must press Confirm. Nothing pairs until that confirmation. See [account-linking.md](./account-linking.md).

If the Telegram account that is chatting already signs in to a three.ws account (Telegram sign-in or a linked Telegram identity), a private chat resolves to that account without any code. Signing in with Telegram already proved control. Groups never auto-resolve, because a group is shared; they pair explicitly.

Rules that always hold:

- A paired group belongs to one person. Anyone else who writes there is told so and never reaches the owner's agent or wallet.
- A forwarded message is never an instruction. A forwarded `/link` pairs nothing, and a forwarded request is not run.
- `/unlink` disconnects a chat. The owner can also revoke it on Connections or Linked devices.

## Commands

`/balance`, `/portfolio`, `/runs`, `/launches`, `/agents`, `/use <agent>`, `/new`, `/voice on|off`, `/buy`, `/sell`, `/snipe`, `/orders`, `/cancel`, `/approvals`, `/positions`, `/pause`, `/kill`, `/unlink`, `/help`. `/help` is the source of truth; the list above mirrors [api/_lib/gateway/commands.js](../api/_lib/gateway/commands.js).

## Trading from chat

A paired chat takes five trade commands, as slash commands or as the bare words:

| Command | What it does |
| --- | --- |
| `/buy <mint or symbol> <sol> [tp=<pct>] [sl=<pct>]` | Quote a buy. `tp` and `sl` rest a linked take-profit and stop-loss pair after the buy fills. |
| `/sell <mint or symbol> <pct or all>` | Quote a sale of a percent of the wallet's holding. |
| `/snipe <mint> <sol>` | Quote a buy of a full mint. Refused when RugCheck reports high or critical risk. |
| `/orders` | List resting orders. |
| `/cancel [<order id>]` | Cancel an order by id prefix (a linked pair cancels together), or drop the trade waiting for a yes. |

Nothing signs from a command. Each one replies with a quote card: spend, expected output, route, price impact, RugCheck verdict, fees and slippage. The quote then waits for a typed confirmation.

- Only the exact word `yes` (case and surrounding space ignored), typed by the paired owner within 60 seconds, executes it. Anything else cancels it. A late `yes` sends nothing and says the quote expired.
- Voice notes, photos, forwarded messages and button presses never confirm a typed quote.
- A new trade command while one is waiting cancels the first and quotes the second.
- Execution goes through the same engine as the web app: kill switch, per-trade cap, daily budget, firewall, ledger and the mainnet real-funds agreement. A guard refusal comes back with its reason code.
- Symbols resolve only against tokens the wallet already holds, because a symbol is not an identity. Anything else needs the full mint.
- Token names and symbols come from the chain, so the quote card prints them stripped of links, mentions, markup and line breaks, in quotes, and never as instructions.
- `tp` and `sl` need the programmable orders engine switched on with `GATEWAY_TPSL_ORDERS=1`. While it is off a buy that asks for them is refused before it is quoted.

`/positions` lists open positions with live P&L, the last closed trades, and sends a PNG share card for each recent close (`/api/trade-og?id=<position id>&format=png`, the SVG card rasterized).

Code: [trade-parse.js](../api/_lib/gateway/trade-parse.js) (grammar, escaping, confirmation rule), [trade-commands.js](../api/_lib/gateway/trade-commands.js) (quote, confirm, exits, orders). Tests: [tests/gateway-trade-parse.test.js](../tests/gateway-trade-parse.test.js), [workers/agent-gateway/tests/trade-commands.test.js](../workers/agent-gateway/tests/trade-commands.test.js).

## What can and cannot be approved from chat

Trades the agent proposes in conversation never run from text alone, and the typed `/buy` family needs a typed `yes` (see Trading from chat). A preview arrives with Approve and Cancel buttons (or a six-digit code on platforms without buttons), expires after ten minutes, and only the exact approval executes it. Requests your spend policy holds arrive with Approve and Deny. `/pause` and `/kill` stop agents at once. Lifting a freeze is done on the web. Details: [approvals.md](./approvals.md#approving-from-telegram-and-discord). Changing a payout wallet is never auto-approved and always shows the old and new address.

## Telegram webhook

`POST /api/gateway/telegram` is the receiver. Telegram proves each delivery with the `X-Telegram-Bot-Api-Secret-Token` header it was given at `setWebhook`; an invalid header answers `401`. A verified update is stored in the inbox and answered `200` immediately. A retried `update_id` hits the inbox's unique key, so a redelivery never produces a second reply.

A sign-in magic link (`/start tl_<token>`) is claimed inline in the webhook, not queued, so the browser waiting for it sees the claim within a second. It only works in a private chat.

## Privacy

Messages are stored to run the turn and keep thread context. Pairing records hold the platform user id, chat id and display name, nothing else about the Telegram account. Unlinking revokes the pairing immediately. Every pair and unpair is in the audit log.

## Limits

| Limit | Value |
|-------|-------|
| Messages per paired chat | 20 per minute |
| Pairing codes issued per chat | 8 per hour |
| Settings writes per user | 30 per hour |

## Related

- [Account linking](./account-linking.md): Telegram sign-in, link codes, external wallets
- [Approvals](./approvals.md)
- [agent-gateway worker](../workers/agent-gateway/README.md)
