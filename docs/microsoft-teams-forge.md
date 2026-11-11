# Create a 3D model from a Teams or Copilot chat

The three.ws Teams app can generate a textured 3D model (GLB) without anyone
leaving the conversation. A person describes one object, and a card appears
in the chat. It shows the prompt, who asked and the job's real state, and
it turns into the finished model when the generation settles.

Generation runs on the same free text-to-3D lane as the MCP `forge_free`
tool (`api/_mcp-studio/tools.js`), through the same server code. A chat job
is therefore exactly what the MCP and ChatGPT surfaces produce.

## Two ways in

| Entry point | Where | What happens |
|---|---|---|
| **Create a 3D model** (message-extension action, `createModel`) | The compose box `+` menu, the command box, or a message's `...` menu (which prefills the prompt from that message) | A form opens with a prompt (3 to 1000 characters) and a quality tier (draft, standard, high). Submitting starts the job. |
| **`forge <prompt>`** (bot command) | Any 1:1 chat, group chat or channel where the bot is present | The bot replies in the thread with the progress card. A bare `forge` replies with how to use it. |

Both entry points derive the job key from the Teams activity id
(`teams-` plus a SHA-256 of the conversation and activity ids). Teams retries a
`composeExtension/submitAction` up to twice when the bot takes longer than 5
seconds, and every retry resolves to the same job. One submit never produces
two generations.

## The cards

All cards are Adaptive Cards schema **1.5**, the version Teams documents for
Universal Actions
([overview](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/overview)).
The builders live in [`api/_lib/teams-forge-cards.js`](../api/_lib/teams-forge-cards.js),
beside the Glance card builder `api/_lib/glance-adaptive.js`. Every card in the
test suite is validated against the published 1.5 schema, vendored at
`tests/fixtures/adaptive-card-1.5.schema.json`.

| Card | Shows | Actions |
|---|---|---|
| Progress | The prompt, the requester, and the job's real state: starting, submitted, GPU waking up (with the boot time left when the lane reports it), queued, or rendering (with elapsed seconds and the lane's own estimate). No invented percentages. | Check progress (Action.Execute) |
| Finished | A rendered poster of the model, its name, the prompt and the tier | Open in 3D (opens the three.ws viewer as a Teams stage view), Download GLB, Make a variation, Model page |
| Error | What failed, in plain words (for example, the generator was unreachable or the lane rejected the job). A prompt the safety check refuses never gets this far: the form shows why. | Try again |

**Make a variation** generates the same prompt with a new random seed. The seed
is part of the forge result-cache key, so a variation is a new model, not the
cached one. With the bot secret configured, the variation posts as a new card
linking back to the original. Without it, the card is replaced in place.

## How the card stays current

Two mechanisms work together:

1. **Refresh for the requester.** Each progress card carries
   `refresh: { action: Action.Execute forge.refresh, userIds: [<requester MRI>] }`.
   Teams sends an `adaptiveCard/action` invoke with `trigger: "automatic"`
   when the card is displayed to a listed user. The bot answers with the
   current card. Teams limits that refresh as follows
   ([Work with Universal Actions](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/work-with-universal-actions-for-adaptive-cards)):
   - `userIds` holds at most **60** user MRIs. This bot lists only the requester.
   - Without `userIds`, automatic refresh happens only in chats of **60 or fewer** members.
   - Refresh fires when the card is shown, not on a timer. A card nobody is
     looking at does not poll. A **Check progress** button gives every viewer a
     manual refresh.
2. **Bot-side update when the job settles.** The run that owns the job sends one
   `PUT /v3/conversations/{id}/activities/{activityId}`
   ([update a bot message](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/update-and-delete-bot-messages)),
   so everyone in the chat sees the finished or error card, not just the
   requester. The update is sent once per job (a cache claim guards it), well
   inside the Bot Connector's per-conversation limits
   ([rate limiting for bots](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/rate-limit)).
   A 429 is retried once after its `Retry-After`.

## Where the job runs

The messaging endpoint has to answer within seconds, and Cloud Run throttles
the CPU of work left running after a response is sent. The bot therefore
dispatches each job to `POST /api/microsoft-teams/forge-run`, an internal
endpoint authorised with `CRON_SECRET`. That handler sends its `202` headers at
once and holds its own request open while the job runs and polls (13 minutes
at most, inside Cloud Run's 900 second timeout). A job still running after
that is collected by the next card refresh. If the dispatch cannot be made,
the job runs in the bot's process instead.

Job records live in the shared cache for 3 days under `teams-forge:<key>`. A
record that never got past "starting" for 6 minutes is reported as failed, with
Try again, rather than spinning forever.

Abuse limits reuse the Forge studio's per-user buckets (`studioGenBurst`,
`studioGenHourly`, keyed by the Teams user id) and the global generation
budget. Prompts pass the same safety check as every other forge surface.

## Configuration

| Variable | Needed for | Without it |
|---|---|---|
| `MS_TEAMS_BOT_APP_ID` | Every Teams feature. It is the JWT audience every activity is verified against. | The bot rejects all activities. |
| `MS_TEAMS_BOT_APP_PASSWORD` | Posting cards: Send on the preview, the `forge` reply, and the finished-card update for the whole chat | The action inserts the card into the compose box for the user to send, and the requester's refreshes keep it current. `forge <prompt>` cannot reply, and logs a warning. |
| `MS_TEAMS_BOT_TENANT_ID` | Single-tenant bot registrations | Tokens are minted from `botframework.com` (multi-tenant). |
| `CRON_SECRET` | Dispatching runs to `/api/microsoft-teams/forge-run` | Runs happen in the bot's process (CPU-throttled after the response on Cloud Run). |

The Azure Bot's messaging endpoint is `https://three.ws/api/microsoft-teams/messages`.
Every activity, including `composeExtension/fetchTask`, `composeExtension/submitAction`
and `adaptiveCard/action`, is verified with `verifyBotToken`
(`api/_lib/teams-bot.js`) before anything is read.

## Try it

- **In Teams:** build the package with `npm run package:microsoft-app`, then
  upload it under Teams **Apps > Manage your apps > Upload an app > Upload a
  custom app** (sideloading must be allowed in the tenant). Open any chat,
  choose `+` then **Create a 3D model**, or message the bot `forge a brass desk lamp`.
- **Without a tenant:** `node scripts/teams-forge-e2e.mjs ["prompt"] [--tier draft|standard|high]`
  drives the real handler against the real forge (`STUDIO_API_BASE`, default
  `https://three.ws`). It submits the action, runs the job, refreshes, validates
  the finished card against AC 1.5, and fetches the GLB and the poster.
- **Tests:** `npx vitest run tests/teams-forge.test.js`. These use Microsoft's
  documented activity shapes for submit, refresh mid-job, refresh after
  success, variation, failure and retry, and real RS256-signed tokens for
  each invoke type.

## Files

| File | Role |
|---|---|
| [`api/_lib/teams-forge-bot.js`](../api/_lib/teams-forge-bot.js) | Routes fetchTask, submitAction, adaptiveCard/action and the `forge` message |
| [`api/_lib/teams-forge.js`](../api/_lib/teams-forge.js) | Job records, the run and poll loop, refresh, dispatch, broadcast |
| [`api/_lib/teams-forge-cards.js`](../api/_lib/teams-forge-cards.js) | Form, progress, finished and error cards (AC 1.5) |
| [`api/_lib/teams-connector.js`](../api/_lib/teams-connector.js) | Bot Connector token, send, reply and update, with a host allowlist |
| [`api/microsoft-teams/forge-run.js`](../api/microsoft-teams/forge-run.js) | Internal run endpoint |
| [`integrations/microsoft/copilot-teams/manifest.template.json`](../integrations/microsoft/copilot-teams/manifest.template.json) | The `createModel` action command and the bot's `forge` command list |
