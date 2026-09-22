# 13. Chat gateways: talk to your agent from Telegram and Discord

Read `docs/prompts/README.md` first.

## The problem

Telegram is outbound only today (alerts, digests, the changelog push in `api/cron/changelog-push.js`, launch delivery in `api/pump/[action].js`). Discord appears only as embed card metadata. The one conversational bot in the tree, `workers/okx-chat-bot/`, is a partner lane, not a three.ws agent gateway. A user cannot open Telegram, message their agent, get a reply that used the agent's tools and wallet, and continue the same conversation on the web. The best agent platforms live where the user already is, from a single gateway process, with continuity across surfaces.

## Build

### Gateway worker

A new `workers/agent-gateway/` (Node, Cloud Run, its own `cloudbuild.yaml` pinning the build and runtime service accounts, README) that runs Telegram (grammY or telegraf, whichever is already a dependency; otherwise grammY) and Discord (discord.js) adapters behind one `Gateway` interface: `onMessage`, `sendText`, `sendMedia`, `sendChoice` (buttons), `editMessage`, `typing`. Long polling for Telegram in development, webhooks in production (`api/gateway/telegram.js`, `api/gateway/discord.js` verify signatures and enqueue). Both tokens come from the Cloud Run env (`TELEGRAM_BOT_TOKEN` exists; add `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`).

### Pairing

`/start` on Telegram or `/three link` on Discord prints a code; the user redeems it with `POST /me/link-code/redeem` from prompt 05 (through the settings page `/settings/connections`, in `data/pages.json`) or pastes a code the site generated. A migration for `gateway_links` (platform, platform user id, chat id, account, default agent, created, revoked). `/agents` lists the account's agents; `/use <agent>` sets the default for that chat; `/unlink` revokes.

### Conversation

- Every message runs through `POST /agents/:id/messages` from prompt 05 with a `channel` field, so history is one thread across web, Telegram and Discord (`three://agents/{id}/chat` shows all of it with the channel tag).
- Tool calls stream as a typing indicator plus a compact "working: swap_quote" status line edited in place; the final reply carries links to signatures and pages.
- Financial tools: the confirm flag is never set from chat text alone. The gateway renders the preview as a message with Approve and Cancel buttons; only the button press with the matching `preview_id` sets the flag, and it expires with the preview. The prompt 03 policy applies unchanged, including the per-key tool tier.
- Voice notes on Telegram are transcribed with the speech path already used by the assistant widget (`docs/assistant-widget.md`); images go to the vision path (`docs/3d-vision.md`).
- Slash commands on both platforms: `/balance`, `/portfolio`, `/runs`, `/launches`, `/help`, plus `/new` to start a fresh thread.
- Rate limits per link, and the gateway refuses to pair a chat to more than one account.

### Outbound continuity

Notifications from `api/_lib/notify-prefs.js` gain `telegram` and `discord` channels that deliver to the linked chat: alerts, run completions, received bids, incoming mail, so the user can reply in place.

## Docs and wiring

`docs/chat-gateways.md` (new) linked from `docs/start-here.md`: pairing, commands, what can and cannot be approved from chat, privacy. `workers/agent-gateway/README.md`. Cloud Scheduler is not needed; note the webhook URLs in `docs/ops/gcp-production.md`. `STRUCTURE.md` rows. `data/changelog.json` entry tagged `feature`.

## Acceptance

- Pair a Telegram chat with the QA account, ask "what is my balance", and receive the same number the web wallet shows.
- Ask for a swap: receive a preview with buttons; Cancel leaves no transaction; Approve stops at the owner's confirmation table in your report (gate 1).
- The exchange appears in the web chat history with the channel tag.
- Same on Discord in a server the owner controls.
- `npm test` green with adapter unit tests and webhook signature tests.
