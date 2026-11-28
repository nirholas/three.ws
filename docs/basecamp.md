# Make a 3D model from a Basecamp Campfire or Ping

The three.ws Basecamp chatbot generates a textured 3D model (GLB) without
anyone leaving the chat. Someone types `!threews a brass desk lamp` in a
Campfire or a Ping. The chatbot answers in the room at once, and posts the
finished model a minute or two later. That reply mentions the person who
asked and carries a poster image, a 3D viewer link, a phone AR link and a GLB
download.

Generation runs on the same free text-to-3D lane as the MCP `forge_free` tool
(`api/_mcp-studio/tools.js`), through the same server code as the Teams bot,
so a Basecamp job produces the same model the other surfaces produce.

Public setup guide: [three.ws/integrations/basecamp](https://three.ws/integrations/basecamp).
Basecamp's chatbot API: [bc3-api chatbots](https://github.com/basecamp/bc3-api/blob/master/sections/chatbots.md).

## Setting it up

1. A signed-in three.ws account opens **Settings, Basecamp chatbot**
   (`/dashboard/settings#basecamp-chatbot`) and creates a command URL. The URL
   is shown once.
2. A Basecamp admin opens any Campfire, chooses **Configure chatbots** from the
   ••• menu, adds a chatbot named `threews` and pastes the URL as its command
   URL. One chatbot works in every Campfire and Ping of that Basecamp account.
3. Anyone in that account types `!threews <description>`.

## Commands

- `!threews <description>`: a model at the standard tier. Descriptions are 3 to 1000 characters.
- `!threews <description> --draft`: the fastest tier.
- `!threews <description> --high`: the most detailed tier.
- `!threews` or `!threews help`: the usage line.

In a Ping, Basecamp sends the whole message, possibly with markup.
`parseCommand` strips tags, decodes entities and drops a leading `!name`
before reading it.

## How a command flows

1. Basecamp POSTs `{ command, creator, callback_url }` to
   `/api/basecamp/command/<token>`. vercel.json rewrites that to
   `api/basecamp/command.js?token=<token>`.
2. The handler resolves the token (`api/_lib/basecamp-chatbots.js`), parses
   the command, and checks that `callback_url` is a Basecamp chat-lines URL on
   a Basecamp host over https (`callbackTarget`). It then applies the
   per-connection rate limit (`basecampCommand`, 20 per 10 minutes).
3. It claims a job keyed by connection, callback URL, sender, tier, prompt and
   the current minute (`jobKey`, a `SET NX` in the shared cache). A repeat
   inside that minute (a Basecamp retry or a double send) gets the existing
   job's line instead of a second generation.
4. It dispatches the job to `POST /api/basecamp/forge-run` with the
   `CRON_SECRET` bearer and answers Basecamp with a 200 `text/html` line,
   "Making a 3D model...". Basecamp posts that line in the room.
5. `forge-run` sends its 202 headers at once and holds the request while
   `runBasecampForge` calls `forge_free` and then polls the job. Holding the
   request keeps the work on a full Cloud Run CPU. A generation still running
   after 13 minutes is handed to a fresh run, up to 3 runs. One that outlasts
   all three is reported as failed.
6. The settled line is POSTed as `{ content }` to the callback URL, exactly
   once (`deliverSettled`). 5xx, 429 and network errors back off and retry. A
   4xx on a line that mentions the sender is retried once without the
   mention, because the `attachable_sgid` came from an unsigned payload.

Without `CRON_SECRET` (a bare dev box), the run happens inside the command
request's process instead.

## Ownership and security

- **The token is the credential.** Basecamp signs nothing it sends to a
  command URL. Each URL carries a 32-byte random token (`bc_` plus base64url).
  Only its SHA-256 and the last four characters are stored
  (`basecamp_chatbots`, migration `20261128120000_basecamp_chatbots.sql`).
- **Replies only go to Basecamp.** Anyone holding a URL can POST any payload,
  so `callbackTarget` accepts only https chat-lines URLs on `basecamp.com`,
  `basecampapi.com` or their subdomains, with no credentials or port.
- **Models belong to the account.** The forge call uses
  `platformAuthHeaders({ onBehalf: true, userId })`, so every model is saved,
  unlisted, to the account that created the command URL.
- **Revoking a URL takes effect at once.** A revoked URL answers every later
  command with a line saying so and starts nothing. Tokens of a deleted
  account stop resolving.
- **Every answer is a 200 line,** including an unknown or revoked token. A
  status code would only show the person a generic chatbot error, while the
  line tells them what to do. A browser GET gets a short noindex page.

## API for the settings panel

- `GET /api/basecamp/chatbots` returns `{ chatbots }`, newest first, revoked ones included.
- `POST /api/basecamp/chatbots { label }` returns `{ chatbot, command_url }` (201). The URL appears only in this response. An account can have 10 active URLs; a POST over that limit gets 409 `limit_reached`.
- `DELETE /api/basecamp/chatbots?id=<uuid>` revokes one and returns `{ ok, chatbots }`.

All three need a session. POST and DELETE also need the CSRF header and are
rate limited (`basecampChatbotWrite`, 20 per hour).

## Tests and live check

- `tests/basecamp-forge.test.js`: parsing, the callback guard, dedupe keys, escaping, delivery retries, the run hand-off, dispatch.
- `tests/basecamp-chatbots.test.js`: the store and both handlers on PGlite with the production schema.
- Live end to end against a real forge, with Basecamp's callback answered at the network boundary:

  ```bash
  CRON_SECRET=$(node scripts/read-service-env.mjs CRON_SECRET --raw) \
    node scripts/basecamp-forge-e2e.mjs --owner <three.ws user uuid> "a low-poly lighthouse"
  ```

## Directory listing

The listing kit for [basecamp.com/extras](https://basecamp.com/extras) (icon,
`integrations.yml` entry, pull request body) is in
[integrations/basecamp/](../integrations/basecamp/README.md).
