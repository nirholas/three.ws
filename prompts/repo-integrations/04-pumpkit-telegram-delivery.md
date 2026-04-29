# 04 — Pumpkit Telegram delivery channel

**Branch:** `feat/pumpkit-telegram-delivery`
**Source repo:** https://github.com/nirholas/pumpkit
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

Some users want pump.fun signals (whales, claims, new mints, graduations) pushed to Telegram. Pumpkit ships this as a bot. We want a server-side delivery adapter the platform can target, so any agent skill or scheduled job can fan out a signal to a chat.

## Read these first

| File | Why |
| :--- | :--- |
| [services/pump-graduations/](../../services/pump-graduations/) | Existing pump signal source — your delivery code must consume one of these. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | API conventions. |
| [scripts/pumpfun-lifecycle-smoke.js](../../scripts/pumpfun-lifecycle-smoke.js) | Smoke pattern to mirror for delivery testing. |
| https://github.com/nirholas/pumpkit (Telegram bot module) | Reference for message formatting + bot wiring. |

## Build this

1. Add `src/pump/telegram-delivery.js` exporting:
    ```js
    export async function sendTelegramSignal({ botToken, chatId, signal })
    // signal: { kind: 'mint'|'whale'|'claim'|'graduation', mint, summary, refs?, ts }
    // Formats a Markdown message and POSTs to https://api.telegram.org/bot<token>/sendMessage
    // Returns { ok, messageId } | throws on non-2xx.
    ```
2. Add `api/pump/deliver-telegram.js` — POST endpoint:
    ```js
    // POST /api/pump/deliver-telegram
    // body: { chatId, signal }  (botToken comes from env TELEGRAM_BOT_TOKEN)
    // → { ok, messageId }
    ```
    Reject if `TELEGRAM_BOT_TOKEN` is not set or `chatId` is missing.
3. Add a vitest test `tests/pump-telegram-delivery.test.js` that mocks `fetch` and asserts the correct URL, method, body, and parse-mode are used.
4. Document the env var `TELEGRAM_BOT_TOKEN` at the top of `src/pump/telegram-delivery.js` in a single-line comment.

## Out of scope

- A persistent subscription / queue model. Delivery is request-driven only.
- Managing channels or chat membership.
- Inbound messages from Telegram (no webhook).
- Scheduling — the caller decides when to deliver.

## Acceptance

- [ ] `node --check` passes for both new files.
- [ ] `npx vitest run tests/pump-telegram-delivery.test.js` passes.
- [ ] Endpoint 400s without `chatId`, 500s without bot token, 200s on success.
- [ ] `npx vite build` passes.

## Test plan

1. Set `TELEGRAM_BOT_TOKEN` to a sandbox bot. POST a sample signal to a test chat. Verify the message arrives formatted correctly.
2. Unset the env var; confirm the endpoint 500s with a clear message.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
