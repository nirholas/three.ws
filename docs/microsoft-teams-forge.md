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

## Agent approvals in the same bot

The bot that runs the Forge also delivers agent approval requests. Card
actions with the verbs `approval.approve`, `approval.deny` and
`approval.refresh` are routed to
[`api/_lib/teams-approvals.js`](../api/_lib/teams-approvals.js) before the
Forge handler sees them; every other `adaptiveCard/action` still reaches the
Forge. Installation and message activities in a 1:1 chat also store the
conversation reference the approval cards are posted to, and uninstalling
clears it. The full flow, who may decide and the failure cases are in
[docs/approvals.md, Approving from Microsoft Teams](approvals.md#approving-from-microsoft-teams).

## Configuration

| Variable | Needed for | Without it |
|---|---|---|
| `MS_TEAMS_BOT_APP_ID` | Every Teams feature. It is the JWT audience every activity is verified against. | The bot rejects all activities. |
| `MS_TEAMS_BOT_APP_PASSWORD` | Posting cards: Send on the preview, the `forge` reply, the finished-card update for the whole chat, and approval cards in the owner's 1:1 chat | The action inserts the card into the compose box for the user to send, and the requester's refreshes keep it current. `forge <prompt>` cannot reply, and logs a warning. |
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

## Running in Outlook and the Microsoft 365 app

The same app package runs in Outlook (web, new Windows and outlook.com) and in
the Microsoft 365 app, not only in Teams. Manifest 1.13 or later is enough for
Microsoft 365 to load a personal tab and a search message extension in those
hosts
([personal tab](https://learn.microsoft.com/en-us/microsoftteams/platform/m365-apps/extend-m365-teams-personal-tab),
[message extension](https://learn.microsoft.com/en-us/microsoftteams/platform/m365-apps/extend-m365-teams-message-extension)).
The package is at 1.30.

### What runs where

| Feature | Teams | Outlook | Microsoft 365 app |
|---|---|---|---|
| Agents tab (`/microsoft/teams-tab`) | Yes | Yes, in the app bar | Yes, under Apps |
| Agent search (message extension) | Yes | Yes, in a new email | Not offered by the host |
| Agent link unfurl | Yes | Yes, in a new email | Not offered by the host |
| Create a 3D model (`createModel`) | Yes | No | No |
| `forge` bot command, approvals, activity feed | Yes | No | No |

`createModel` is Teams-only because its card refreshes itself with
`Action.Execute` and is delivered by the bot, and Outlook runs neither. The
manifest declares this in `elementRelationshipSet.oneWayDependencies`
(`createModel` depends on the bot), so Microsoft 365 hides the command where the
bot cannot run. If an invoke still arrives from Outlook, the bot answers with a
message that points to Teams instead of opening the form.

### Cards per host

The bot reads the host from the Bot Framework `channelId` on each activity
(`channelHostOf` in [`api/_lib/teams-bot.js`](../api/_lib/teams-bot.js)):

- `msteams` is Teams. The agent Glance card is Adaptive Cards 1.6 with rounded
  images.
- `m365extensions` is Outlook and the Microsoft 365 app. The card is Adaptive
  Cards **1.4**, uses `Action.OpenUrl` only, and has no `refresh` and no
  1.6-only styles. Microsoft documents `openURL` as the only card action
  Outlook supports for a message extension, with no bot-delivered cards; 1.4
  is the newest version every supported Outlook client renders, so the card
  targets it. Any unknown channel gets the same conservative card.

Both channels use the same Bot Framework token, verified by `verifyBotToken`
against the same issuer, keys and audience (`MS_TEAMS_BOT_APP_ID`). Nothing in
the auth path depends on the channel.

`tests/teams-outlook-host.test.js` validates the Outlook card against the
official 1.4 schema (`tests/fixtures/adaptive-card-1.4.schema.json`), checks
its actions, refresh, styles and size limit, checks the Teams card against 1.5,
and checks that both channels verify the same signed token.

### The tab in each host

The Agents tab loads TeamsJS only when it is framed. It reads the host from
`app.host.name` ([`src/microsoft-365-host.js`](../src/microsoft-365-host.js))
and follows the host theme (default, dark and high contrast), including live
theme changes. Every host-specific call is behind its capability's
`isSupported()`:

| Host | Share button | Calls |
|---|---|---|
| Teams | Share in Teams | `sharing.shareWebContent` |
| Outlook, the Microsoft 365 app | Email this agent | `mail.composeMail` |
| Plain browser | Share, or Copy link | Web Share API or the clipboard |

The tab and meeting stage routes in `vercel.json` allow every frame ancestor
Microsoft lists for these hosts, including `outlook.live.com` for outlook.com.

Check all three without a tenant (dev server on port 3132):

```
node scripts/microsoft-365-tab-hosts-check.mjs [--base http://localhost:3132] [--out dist/microsoft/tab-hosts]
```

It loads the tab standalone, framed by `https://outlook.office.com` answering
TeamsJS as Outlook (dark), and framed by `https://teams.microsoft.com` as Teams
(high contrast). It fails on any console error and saves a screenshot per host.
`npm run package:microsoft-app -- --check` validates the host declarations:
manifest version, valid domains, compose context and the relationship set.

### Turn it on

1. **Azure Bot channel.** In the Azure portal, open the three.ws Azure Bot,
   then **Channels**, and add **Microsoft 365 Extensions**. That channel
   delivers Outlook and Microsoft 365 app activities with `channelId`
   `m365extensions` to the same messaging endpoint. If the older **Outlook**
   channel is enabled, remove it.
2. **Sideload.** Build the package (`npm run package:microsoft-app`) and upload
   it in Teams under **Apps > Manage your apps > Upload an app > Upload a
   custom app**. Microsoft 365 then offers it in the other hosts for the same
   account.
3. **Outlook on the web.** Open outlook.office.com (or outlook.com), choose
   **New mail**, then **Apps** in the ribbon, and pick three.ws to search
   agents. Paste a `https://three.ws/agents/...` link to see the unfurl. The
   Agents tab is under **More apps** in the left app bar.
4. **Microsoft 365 app.** Open microsoft365.com, choose **Apps** in the left
   rail and open three.ws for the Agents tab.

## Activity feed notifications

A finished (or failed) 3D model, and agent events, reach a linked person's Teams
bell, feed and phone through Microsoft Graph
[sendActivityNotification](https://learn.microsoft.com/en-us/graph/api/userteamwork-sendactivitynotification).
It is the `teams` leg of the standard notification fan-out
([`api/_lib/notify.js`](../api/_lib/notify.js)), so any event that already rings
the three.ws bell can reach Teams. Delivery never blocks the job that raised it.

### Linking a Teams account

1. Install the three.ws app in Teams. The bot records the install from the
   `installationUpdate` event and from any message.
2. On three.ws open Settings, Notifications, Microsoft Teams, and choose
   **Create a link code**.
3. Send the bot `link ABCD-EFGH` with that code. The code works once and expires
   after ten minutes.

Uninstalling the app clears the link. **Unlink Teams** in settings clears it
from the three.ws side. The mapping lives in `teams_identities`
([migration](../api/_lib/migrations/20261116120000_teams_identities.sql)).

### Events

| Activity type | Raised by | Default |
|---|---|---|
| `forgeJobCompleted` | A 3D model finished | On |
| `forgeJobFailed` | A 3D model failed | On |
| `agentTaskCompleted` | An agent loop reported a finished task | Off |
| `agentMentioned` | An agent was mentioned | On |
| `agentMessageReceived` | A reply, direct message or agent mail arrived | On |

Each is a switch in settings (`PUT /api/notifications/teams`). The activity types
are declared in `activities.activityTypes` of the manifest, and a test fails if
the manifest and [`api/_lib/teams-activity.js`](../api/_lib/teams-activity.js)
disagree. Tapping a notification opens the Agents tab through a deep link whose
`subEntityId` is `job:<id>` (the model) or `agent:<id>`; Teams passes it to the
tab as `?sub=` (the tab URL maps `{subPageId}`).

A Forge job started in a Teams chat has no three.ws session, so it is announced
to whoever linked the requesting Teams identity, once per job.

### Admin consent and configuration

Sending needs the Graph **application** permission `TeamsActivity.Send` on the
bot's Entra app (`MS_TEAMS_BOT_APP_ID`), consented by an admin of each tenant
whose people should be notified. The provisioner declares the permission
([`resources.json`](../integrations/microsoft/provisioning/resources.json)); the
admin grants it at
`https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=<MS_TEAMS_BOT_APP_ID>`
(settings shows this link when Graph answers 403). Set `MS_APP_ID` (the Teams
app id from Partner Center, used to build the deep link) next to
`MS_TEAMS_BOT_APP_ID` and `MS_TEAMS_BOT_APP_PASSWORD`, with
`gcloud run services update --update-env-vars`, never `--set-env-vars`.
The manifest's `webApplicationInfo` names the bot app; submit the updated
package to Partner Center.

### Troubleshooting

| Symptom in settings | Cause | Fix |
|---|---|---|
| "Your Microsoft 365 admin has not approved notifications" | Graph 403 or token refused | Send the admin the consent link |
| "three.ws is not installed for you" | Graph 404 | Reinstall the app in Teams, then send the bot any message |
| Nothing arrives, no error | Event switched off, account not linked, or `MS_APP_ID` unset | Check the switches, relink, check the env vars |
| Test notification fails with 502 | Any of the above | The message under the button names the cause |

Verify the whole path without a tenant:
`node scripts/teams-activity-live-check.mjs` settles a Teams-started job on a
throwaway database and asserts the Graph request. Tests:
`npx vitest run tests/teams-activity.test.js tests/teams-identity.test.js`.

## Files

| File | Role |
|---|---|
| [`api/_lib/teams-forge-bot.js`](../api/_lib/teams-forge-bot.js) | Routes fetchTask, submitAction, adaptiveCard/action and the `forge` message |
| [`api/_lib/teams-forge.js`](../api/_lib/teams-forge.js) | Job records, the run and poll loop, refresh, dispatch, broadcast |
| [`api/_lib/teams-forge-cards.js`](../api/_lib/teams-forge-cards.js) | Form, progress, finished and error cards (AC 1.5) |
| [`api/_lib/teams-connector.js`](../api/_lib/teams-connector.js) | Bot Connector token, send, reply and update, with a host allowlist |
| [`api/microsoft-teams/forge-run.js`](../api/microsoft-teams/forge-run.js) | Internal run endpoint |
| [`integrations/microsoft/copilot-teams/manifest.template.json`](../integrations/microsoft/copilot-teams/manifest.template.json) | The `createModel` action command and the bot's `forge` command list |
| [`api/_lib/teams-activity.js`](../api/_lib/teams-activity.js) | Graph sender: per-tenant token cache, deep links, retry, permanent-failure handling |
| [`api/_lib/teams-identity.js`](../api/_lib/teams-identity.js) | Teams person to three.ws account mapping, link codes, install state |
| [`api/notifications/teams.js`](../api/notifications/teams.js) | Settings endpoint: link code, per-event switches, test notification, unlink |
| [`api/microsoft-teams/job.js`](../api/microsoft-teams/job.js) | What the tab shows when a notification opens a job |
