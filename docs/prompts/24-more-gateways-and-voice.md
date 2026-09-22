# 24. Slack, WhatsApp, Signal, SMS, email and voice on the agent gateway

Read `docs/prompts/README.md` first.

## The problem

Prompt 13 adds Telegram and Discord. Users also live in Slack, WhatsApp, Signal, SMS and email, and send voice notes. The gateway worker should be the single process that serves all of them with the same pairing, approval and continuity rules.

## Build

Extend `workers/agent-gateway/` with adapters behind the same `Gateway` interface:

- **Slack:** app with Socket Mode for development and Events API in production, slash commands, DM and channel mentions, Block Kit approve and cancel buttons.
- **WhatsApp:** Cloud API business number, template messages for outbound notifications, interactive buttons for approvals.
- **Signal:** through a maintained bridge container deployed on Cloud Run with its own `cloudbuild.yaml`.
- **SMS:** through the messaging provider already on the account if one exists, otherwise list the credential as the single missing var; approvals by reply code, never by free text.
- **Email as chat:** an agent mailbox from prompt 11 accepts threaded replies as messages.
- **Voice:** inbound voice notes transcribed with the speech path in `docs/assistant-widget.md`; outbound replies optionally spoken with the TTS path used by the announcement voice (`docs/announce-voice.md`) when the user enables "voice replies".
- **Continuity:** every channel writes to the same thread with a channel tag; `/settings/connections` shows all links; notifications choose the channel the user prefers.
- Docs: `docs/chat-gateways.md` extended; `workers/agent-gateway/README.md`; changelog entry tagged `feature`.

## Acceptance

- Pair Slack and WhatsApp to the QA account and receive the wallet balance on both.
- A voice note asking for the portfolio returns a text and a spoken reply.
- A swap approval from any channel stops at the owner confirmation table (gate 1).
- `npm test` green.
