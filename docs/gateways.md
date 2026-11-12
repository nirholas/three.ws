# Slack, WhatsApp and voice gateways

Talk to your three.ws agent from Slack, from WhatsApp, or out loud. These three platforms join Telegram and Discord on the same chat gateway: the same pairing, the same commands, the same approvals, the same rate limits. [Chat gateways](./chat-gateways.md) covers what a paired chat can do. This page covers how each of the three new platforms connects, what is different about it, and how an operator turns it on.

Users manage all of it on [Connections](https://three.ws/settings/connections). Each platform has a card that shows whether it is enabled, the steps to connect, how many chats are paired and when the last message arrived.

## How a message flows

The API only verifies and queues; the [agent-gateway worker](../workers/agent-gateway/README.md) runs the turn.

1. The platform calls a receiver: `POST /api/gateway/slack`, `POST /api/gateway/whatsapp`, or `POST /api/gateway/voice?leg=recorded`.
2. The receiver checks the platform's signature over the exact request bytes. A missing, wrong or stale signature gets `401` and nothing is stored.
3. A verified delivery becomes one `gateway_inbox` row keyed by the platform's own message id, so a redelivery never produces a second reply.
4. The worker's adapter for that platform turns the row into the common message shape, runs the gateway core (pairing, commands, the agent, previews), and sends the reply in the platform's own format.

The one exception is the browser voice panel, which runs the turn inside the request (see [Voice](#voice)).

## Slack

**For users.** Press **Add to Slack** on the Slack card, approve the app for your workspace, then message the app directly or mention it in a channel. It answers with a pairing code; paste it on Connections, or run `/three link CODE` with a code issued there. After that:

- Replies land in the thread of the message that asked, so a channel stays readable.
- `/three <command>` runs any gateway command (`/three balance`, `/three positions`). The answer is ephemeral: only you see it.
- Trade previews arrive with Approve and Cancel buttons. Pressing one updates the card in place.
- Voice clips and images you upload are transcribed or read like any other chat.
- Removing the app from the workspace revokes its stored token at once.

**For operators.** Create a Slack app at api.slack.com/apps and set:

| Setting | Value |
|---|---|
| Bot token scopes | `app_mentions:read`, `chat:write`, `commands`, `files:read`, `files:write`, `im:history`, `im:read`, `im:write` |
| Event Subscriptions request URL | `https://three.ws/api/gateway/slack` (Slack's `url_verification` challenge is answered automatically) |
| Bot events | `app_mention`, `message.im`, `app_uninstalled`, `tokens_revoked` |
| Interactivity request URL | `https://three.ws/api/gateway/slack` |
| Slash command | `/three`, request URL `https://three.ws/api/gateway/slack` |
| OAuth redirect URL | `https://three.ws/api/gateway/slack?leg=oauth` |
| App Home | Messages tab on, so users can DM the app |

There are two ways to run it:

- **Any workspace (OAuth).** Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`. The **Add to Slack** button appears and each install's bot token is stored encrypted (the same secret box as agent wallets) in `gateway_slack_installs`.
- **One workspace.** Set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`. There is no install button; users find the app in that workspace.

`SLACK_BOT_USER_ID` is optional and strips the bot's own mention from a message before it reaches the agent.

**Signatures.** Every Slack request carries `X-Slack-Signature`, an HMAC-SHA256 over `v0:<timestamp>:<raw body>` with the signing secret. A request older than five minutes is refused as a replay even when its signature is valid.

## WhatsApp

**For users.** Message the three.ws number (the card links it with `/start` filled in). The reply carries a pairing code and a link back to Connections; confirm the chat there. Text, voice notes and images all work. Approve and Cancel arrive as reply buttons.

WhatsApp only lets a business message you freely within 24 hours of your last message. Replies to what you send are always inside that window. Anything the gateway sends later (a reply to a slow turn, for example) goes out as the approved template named by `WHATSAPP_NOTIFY_TEMPLATE`, which tells you to open the chat; without a template it is dropped and logged rather than retried forever.

**For operators.** In Meta for Developers, create a Business app with the WhatsApp product, then:

1. Under WhatsApp, Configuration, set the callback URL to `https://three.ws/api/gateway/whatsapp` and the verify token to the value of `WHATSAPP_VERIFY_TOKEN`. Meta's `GET` handshake is answered with the challenge when the token matches.
2. Subscribe the webhook to the `messages` field.
3. Create a permanent System User access token with `whatsapp_business_messaging` and set it as `WHATSAPP_ACCESS_TOKEN`.
4. Optional: get a utility template approved for the out-of-window notice and set its name as `WHATSAPP_NOTIFY_TEMPLATE`.

Meta signs each delivery with the app secret in `X-Hub-Signature-256` (HMAC-SHA256 over the raw body); an unsigned or mis-signed delivery gets `401`. If the app owns several numbers, only deliveries for `WHATSAPP_PHONE_NUMBER_ID` are queued. Delivery and read receipts are dropped.

## Voice

Voice has two legs. The browser leg needs nothing beyond speech in and out; the phone leg is off unless an operator turns it on.

**In the browser.** The Voice card on Connections has a **Talk** button. Press it, speak, and press it again. The clip goes to `POST /api/gateway/voice?leg=web` (session and CSRF required), is transcribed, runs through the gateway core as your own voice chat, and comes back as text plus an MP3 of the agent's reply in your agent's voice. Trade previews show Approve and Cancel buttons under the reply. The first time you talk, a "Browser voice" chat appears under Paired chats with your first agent as its default; change or unpair it like any other chat.

**On the phone.** With telephony on, people can call the number in `GATEWAY_VOICE_NUMBER`. The call is greeted, records after the beep, and each recording becomes one queued turn. The worker downloads the recording from Twilio, transcribes it, runs the turn, speaks the reply and stores it; the call polls every two seconds and plays the reply as soon as it is ready, then records again. An unpaired caller hears a pairing code spelled out letter by letter, to type on Connections.

Two rules protect a phone call, because caller ID can be forged:

- **A call never approves a trade.** A preview proposed on a call is cancelled on the spot and the caller is told to approve it in the app or a paired chat. The browser leg, which is signed in, does keep the buttons.
- **Only attested caller IDs are answered.** By default a call is answered only when the carrier verified the caller ID with STIR/SHAKEN level A (`StirVerstat=TN-Validation-Passed-A`). Withheld numbers are always refused. Set `GATEWAY_VOICE_REQUIRE_ATTESTATION=0` only for numbers whose callers cannot get attestation, and know that a forged caller ID can then talk to (but never trade from) the paired account.

Every Twilio leg is checked against `X-Twilio-Signature` (HMAC-SHA1 over the public URL and the sorted form fields, keyed by the auth token). The reply MP3 is served at an unguessable id and expires with the turn.

**For operators.** Buy a voice number in Twilio, set its "A call comes in" webhook to `POST https://three.ws/api/gateway/voice?leg=call`, enable caller ID verification, and set `GATEWAY_VOICE_TELEPHONY=1`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `GATEWAY_VOICE_NUMBER`.

## Environment variables

Set these on `three-ws-api` (receivers and the Connections page) and on the `agent-gateway` worker (replies). Use `gcloud run services update <service> --update-env-vars`, never `--set-env-vars`, which replaces the whole set.

| Variable | Where | Purpose |
|---|---|---|
| `SLACK_SIGNING_SECRET` | API | Verifies every Slack request. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | API, worker | OAuth installs to any workspace. |
| `SLACK_BOT_TOKEN` | API, worker | Single-workspace mode instead of OAuth. |
| `SLACK_BOT_USER_ID` | Worker, optional | Strips the bot's own mention. |
| `WHATSAPP_APP_SECRET` | API | Verifies Meta's delivery signature. |
| `WHATSAPP_VERIFY_TOKEN` | API | Meta's subscription handshake. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | API, worker | Sending, and the number this deployment serves. |
| `WHATSAPP_DISPLAY_NUMBER` | API | The number shown and linked on Connections. |
| `WHATSAPP_GRAPH_VERSION` | Worker, optional | Graph API version, default `v21.0`. |
| `WHATSAPP_NOTIFY_TEMPLATE`, `WHATSAPP_NOTIFY_TEMPLATE_LANG` | Worker, optional | The out-of-window template and its language (default `en`). |
| `GATEWAY_VOICE_TELEPHONY` | API, worker | `1` turns the phone leg on. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | API, worker | Signature checks and recording downloads. |
| `GATEWAY_VOICE_NUMBER` | API | The number shown on Connections. |
| `GATEWAY_VOICE_REQUIRE_ATTESTATION` | API | `0` answers calls without level-A attestation. |
| `GATEWAY_PLATFORMS` | Worker, optional | Comma list to run only some adapters. |

The browser voice leg uses the speech setup that already exists: NVIDIA Riva (`NVIDIA_API_KEY` plus `NVIDIA_ASR_FUNCTION_ID`) or Gemini on Vertex for transcription, and the gateway's TTS lanes for the reply. The Voice card says which half is missing when one is.

## Code and tests

- Receivers: [api/gateway/slack.js](../api/gateway/slack.js), [api/gateway/whatsapp.js](../api/gateway/whatsapp.js), [api/gateway/voice.js](../api/gateway/voice.js)
- Signatures and inbox mapping: [api/_lib/gateway/webhooks.js](../api/_lib/gateway/webhooks.js); Slack installs: [api/_lib/gateway/slack-installs.js](../api/_lib/gateway/slack-installs.js); call turns and TwiML: [api/_lib/gateway/voice-calls.js](../api/_lib/gateway/voice-calls.js)
- Worker adapters: [workers/agent-gateway/src/adapters/](../workers/agent-gateway/src/adapters)
- Tests: [slack-adapter.test.js](../workers/agent-gateway/tests/slack-adapter.test.js), [whatsapp-adapter.test.js](../workers/agent-gateway/tests/whatsapp-adapter.test.js), [voice-adapter.test.js](../workers/agent-gateway/tests/voice-adapter.test.js), each against a real Postgres and a real receiver socket with fixture deliveries.

## Related

- [Chat gateways](./chat-gateways.md): pairing, commands, trading, approvals, limits
- [agent-gateway worker](../workers/agent-gateway/README.md)
- [Approvals](./approvals.md)
