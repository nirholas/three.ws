# Listing three.ws in the Slack Marketplace

Everything Slack's review asks for, ready to paste. The app, its install flow, the
public page and the privacy section are built and tested in this repository. What
is left needs the owner: creating the app under the company's Slack account,
approving two deploys, reaching ten active workspaces, and pressing Submit.

## Where things stand

- **App definition:** [manifest.json](manifest.json) (bot scopes, events, `/three`,
  Home and Messages tabs, interactivity). `npm run slack:app` creates the app from it
  and wires production in one command.
- **Install flow:** `https://three.ws/api/gateway/slack?leg=install` works for anyone,
  signed in or not, and binds the OAuth callback to the browser that started it.
- **Landing page:** [three.ws/slack](https://three.ws/slack) (source
  [pages/slack.html](../../pages/slack.html)) with the Add to Slack button, what the
  app does, setup steps, commands, scopes with reasons, privacy and an FAQ. It shows
  the result of every install attempt.
- **Privacy:** [three.ws/legal/privacy#slack](https://three.ws/legal/privacy#slack)
  (section 10c).
- **Support:** [three.ws/support](https://three.ws/support).
- **Icon:** [assets/icon-1024.png](assets/icon-1024.png), 1024 x 1024.

## Owner steps, in order

1. **Approve the API deploy** (`npm run deploy:gcp:full`, see the deploy runbook).
   Production still runs the receiver from before the login-free install, the status
   leg and the `/slack` page, so `https://three.ws/slack` returns 404 until then.
2. **Create the app and wire production.** At https://api.slack.com/apps, under
   "Your App Configuration Tokens", generate a token for the workspace that should
   own the app, then:

   ```bash
   npm run slack:app -- --dry-run   # read-only plan
   npm run slack:app                # paste the token when asked
   ```

   Run it with gcloud signed in to the account that owns the project serving
   three.ws: `aerial-vehicle-466722-p5` until the DNS cutover in
   [gcp-project-migration.md](../../docs/ops/gcp-project-migration.md), then prefix
   `GCP_PROJECT=three-ws`. It stores the three Slack secrets in Secret Manager,
   attaches them to `three-ws-api`, proves the live receiver verifies signatures, turns events on and
   probes the install link. It exits 0 only when Add to Slack works end to end.
3. **Approve the agent-gateway worker deploy** ([workers/agent-gateway](../../workers/agent-gateway/README.md)).
   The worker answers messages, publishes the Home tab and runs commands; the API only
   verifies and queues. As of 2026-11-28 it is not deployed in either GCP project, so
   without it an installed app stays silent. It mirrors the API's env on deploy, so it
   picks up the Slack secrets with no extra step.
4. **In the app's settings:**
   - Basic Information, Display Information: upload `assets/icon-1024.png`.
   - Manage Distribution: set the direct install URL to
     `https://three.ws/api/gateway/slack?leg=install`, complete the checklist and
     activate public distribution.
5. **Reach ten active workspaces.** Slack only accepts a submission once the app is
   installed on at least ten workspaces that used it in the past 28 days. Point
   existing users at three.ws/slack. `countSlackInstalls()` in
   [slack-installs.js](../../api/_lib/gateway/slack-installs.js) counts live installs
   (`SELECT count(*) FROM gateway_slack_installs WHERE revoked_at IS NULL`); activity
   is Slack's own measure, shown in the app's settings.
6. **Capture screenshots from a real workspace** (list below), then open
   "Submit to the Slack Marketplace" in the app's settings and paste the answers
   from this file.

## Listing copy

**App name:** three.ws

**Short description** (the manifest's `description`, 120 characters max):

> Talk to your three.ws AI agent in Slack: balances, positions, trade approvals with buttons, and account alerts.

**Long description:** the manifest's `long_description`, which `npm run slack:app`
already applies. Paste it from [manifest.json](manifest.json) if the form asks again.

**Category suggestions:** Productivity; Finance.

**Pricing:** Free to install. three.ws accounts are free; paid three.ws features are
billed on three.ws, never through Slack.

**Landing page:** https://three.ws/slack
**Support page:** https://three.ws/support
**Privacy policy:** https://three.ws/legal/privacy#slack
**Direct install URL:** https://three.ws/api/gateway/slack?leg=install

## Scope justifications

Each line is the reason the review form asks for. They match the scope list on
three.ws/slack, and `tests/slack-page.test.js` fails if the page and the requested
scopes ever drift apart.

- `app_mentions:read`: receive messages that mention the app in a channel it was
  invited to, so a mention gets an answer in its thread.
- `chat:write`: post the agent's replies, trade previews with Approve and Cancel
  buttons, and account alerts.
- `commands`: add the `/three` slash command; its answers are ephemeral.
- `im:history`: read the messages a user sends the app in its DM, which is where most
  conversations happen.
- `im:read`: know which DM channel belongs to which user, so a pairing code is tied to
  the right person.
- `im:write`: open a DM with a paired user to deliver alerts and approval requests
  they turned on.
- `files:read`: download a voice clip or image a user attaches to a message to the
  app, so the agent can transcribe or read it.
- `files:write`: upload the spoken version of a reply when the user turned voice
  replies on.

The app requests no user scopes and no channel-history scopes. It cannot read
channels it is not mentioned in.

## Data handling and security answers

Only what the code does today:

- **Data read:** DMs sent to the app, messages that mention it, files attached to
  those, slash commands and button presses. Nothing else.
- **Data stored:** per workspace, the team ID and name, bot user ID and bot token. The
  token is encrypted at rest (AES-GCM secret box, the one used for custodial wallet
  keys). Per paired user: Slack user ID, username, DM channel ID and the chosen agent.
- **Message retention:** inbound events are queued in `gateway_inbox` and deleted 7
  days after they are handled. Conversations from paired chats are saved to the
  agent's thread (shown on the web too) until the agent or account is deleted, or on
  request to privacy@three.ws. Unpaired chats only get pairing instructions and are
  never saved to a thread.
- **Uninstall:** `app_uninstalled` and `tokens_revoked` erase the stored bot token at
  once (covered by `workers/agent-gateway/tests/slack-marketplace.test.js`).
- **Request verification:** every request from Slack is checked against the signing
  secret (HMAC-SHA256 over `v0:<timestamp>:<body>`); requests older than five minutes
  are refused as replays.
- **OAuth:** the install state is HMAC-signed, expires after 15 minutes and carries a
  nonce that must match an HttpOnly, SameSite=Lax cookie set when the install
  started.
- **Third parties:** message content goes to the AI model providers listed in the
  privacy policy (section 10) to produce the answer. It is not sold or shared beyond
  that.
- **Money movement:** no Slack message can move funds. Trades are previews that only
  the paired owner can approve with a button; unanswered previews expire after ten
  minutes.
- **Hosting:** Google Cloud Run (us-central1), Postgres for state.

Answer any certification question (SOC 2, ISO 27001, penetration test) with what is
true at submission time. As of 2026-11-28 three.ws holds none of them; do not claim
one.

## Reviewer instructions

Paste into the "Testing instructions" field. Put the reviewer account's credentials
in the form only, never in this repository.

1. Install the app with the Add to Slack button on https://three.ws/slack.
2. Open the app in Slack. The Home tab explains the app and shows "Not connected
   yet".
3. Send the app any direct message. It replies with a pairing link. Open it, sign in
   to three.ws with the reviewer account below, and confirm. The Home tab now names
   the connected agent.
4. Try `/three balance`, `/three portfolio`, `/three agents` and `/three help` in any
   channel; only you see the answers. Ask the agent a question in the DM, then
   mention `@three.ws` in a channel the app was invited to; the answer arrives in the
   thread.
5. Remove the app from the workspace. Its token is erased; reinstalling starts fresh.

The reviewer account needs an agent (create one at https://three.ws/create in a
minute). Its wallet can stay empty: balance and portfolio answer with zero holdings.

## Screenshots to capture

From a real workspace with a paired reviewer account. Never mock them up. Check the
size the form asks for at submission time (Slack has asked for 1600 x 1000 PNGs).

1. The Home tab before pairing ("Not connected yet").
2. The Home tab after pairing, naming the agent and listing commands.
3. A DM conversation with the agent.
4. A channel mention answered in its thread.
5. An ephemeral `/three portfolio` answer.
6. A trade preview with Approve and Cancel buttons, if the reviewer agent has
   something to trade; otherwise `/three approvals`.

## After approval

- Add the Marketplace URL to three.ws/slack and to `data/listings.json`
  (`slack-marketplace`), set its status to `live` only after fetching the listing,
  then `npm run listings:build`.
- Re-run `npm run slack:app -- --app-id <id>` after any manifest change; Slack
  re-reviews scope changes.
