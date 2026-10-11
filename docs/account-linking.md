# Account linking

Four ways to connect things to one three.ws account, each safe by construction: single use, short lived, rate limited, shown to a signed-in owner before it takes effect, and written to the audit log.

| You want to | Use |
|-------------|-----|
| Sign in with Telegram | [Telegram sign-in](#telegram-sign-in) |
| Link a phone, desktop app, CLI or Telegram chat | [Link codes](#link-codes) |
| Prove a Solana or EVM wallet as owner or payout wallet | [External wallets](#external-wallets) |
| See everything linked | `GET /api/auth/linked-accounts` and Account, Linked devices |

## Telegram sign-in

Two flows, same account result.

**Widget.** `GET /api/auth/telegram/start?intent=login|link|reauth&next=` opens Telegram's login widget. The callback verifies the payload server-side: HMAC-SHA256 over the sorted fields keyed by the SHA-256 of the bot token, constant-time compare, a five-minute freshness window on `auth_date`, and replay protection (a payload hash is stored and a second use is refused). `reauth` proves the person at the keyboard for sensitive actions, with a five-minute window.

**Magic link.** `POST /api/auth/telegram/magic {intent:'login'|'link', next?}` returns `{id, poll_secret, deep_link, bot_username, expires_in}`. The page shows a QR and an Open in Telegram button. Telegram sends `/start tl_<token>` to the bot, the webhook claims it once, and the page, polling `GET /api/auth/telegram/poll?id&secret`, completes. The token lives ten minutes, is single use, and only works in a private chat. A link request never signs in as someone else: `link` binds to the session that started it.

Other routes: `GET /api/auth/telegram/status`, `POST /api/auth/telegram/unlink` (needs a password or fresh reauth; refused if Telegram is the last sign-in method).

Outcomes surface on `/login?error=telegram_<code>` or `/dashboard/settings?telegram=<code>`: `invalid_hash`, `stale`, `replayed`, `expired`, `not_linked`, `identity_in_use`, `already_linked`, `cancelled`, `failed`, `unavailable`. Needs `TELEGRAM_BOT_TOKEN` and the bot username; with neither set the login page shows no Telegram button.

## Link codes

A short code, `BCDF-GHJK`, minted on [Account, Linked devices](https://three.ws/dashboard/account#linked-devices) by a signed-in owner.

1. **Mint** `POST /api/auth/link-codes/mint {device_kind, label?, scopes?}` with `device_kind` one of `phone`, `desktop`, `cli`, `telegram`. Ten-minute life, single use, only the hash is stored.
2. **Claim** (device side, no login) `POST /api/auth/link-codes/claim {code, device_kind, device:{name, platform, client}}` returns a claim secret.
3. **Confirm** the owner's page lists the pending claim with the device name, platform, client, IP and, for Telegram, the chat. The owner can narrow the scopes and presses Confirm or Reject (`POST /api/auth/link-codes/decide`). A different signed-in account cannot decide it (`wrong_account`), and scopes can never be widened (`scope_widened`).
4. **Poll** `GET /api/auth/link-codes/poll?id&secret` returns the credential once: a session for a phone, an API key for a desktop app or CLI, a gateway pairing for Telegram. A second poll gets `consumed`.

Devices are listed with `GET /api/auth/link-codes/devices` and removed with `POST /api/auth/link-codes/revoke {id}`, which kills the credential.

Money-moving scopes are not linkable this way; mint those on the API keys page.

**On the device**

- CLI: `npx three-ws link BCDF-GHJK` claims, waits for your confirmation, and stores the key.
- Phone or desktop app: open `/link-device?code=BCDF-GHJK`.
- Telegram: send `/link BCDF-GHJK` to the bot.

Limits: 20 mints per user per 10 minutes, 20 claims per IP per 10 minutes. Errors: `invalid_code`, `unknown_code`, `wrong_kind`, `expired`, `already_used`, `wrong_account`, `scope_widened`, `no_chat`, `unknown_claim`.

## External wallets

Attach a Solana or EVM wallet proved by a signed message.

```
POST /api/auth/external-wallet/challenge {chain:'solana'|'evm', address, role:'owner'|'payout', agent_id?}
POST /api/auth/external-wallet/verify    {chain, message, signature, password?}
```

The challenge returns a message with a one-time nonce and expiry. Sign it with the wallet and verify. A nonce burns on use, so a replay fails.

- `role: owner` links the wallet as a sign-in wallet.
- `role: payout` sets the agent's payout wallet. A first wallet is live at once. **Replacing a live payout wallet needs step-up** (password or fresh reauth, else `403 step_up_required` with the current address) and takes effect after a **24 hour cooldown**, during which the previous wallet keeps receiving. Where an approval is required, the request appears in the [approvals inbox](./approvals.md) as a payout wallet change and is never auto-approved.

The same policy guards `PUT /api/monetization/wallet` and `POST /api/billing/payout-wallets`.

MCP tools: `set_external_wallet` (challenge and verify steps) and `get_linked_accounts` on the main server. See [mcp.md](./mcp.md).

## Linked accounts

`GET /api/auth/linked-accounts` returns `{sign_in, wallets, payout, devices, chats}`.

## Audit log

Every link, unlink, reject, revoke, reauth and payout-wallet change is recorded (`link_*`, `unlink_*`, `reauth:telegram`, `link_code_*`), visible on the Account page activity and in `/api/audit-log`.

Related: [authentication.md](./authentication.md), [chat-gateways.md](./chat-gateways.md), [approvals.md](./approvals.md).
