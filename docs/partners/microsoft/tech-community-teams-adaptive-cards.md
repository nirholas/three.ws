# Tech Community article: an app for Teams built on Adaptive Cards

**Where:** Microsoft Tech Community, the Microsoft Teams developer or Microsoft 365 platform space that fits best when posting.
**Status:** draft, not posted. Posting is an owner step.
**Every number** below is sourced in [sources.md](./sources.md#tech-community-teams-adaptive-cards).

**Before posting, check these, because they change:**

1. The Teams app package is built and validated but not yet registered or submitted. If the owner has since completed the Azure Bot registration and the store submission, update the "Where it stands" section; until then keep the wording exactly as it is, because the app is not available in Teams.
2. Rerun `npm run package:microsoft-app -- --check` and the test suites named in "Tests", and update the counts if they moved.
3. Run `node scripts/microsoft-pack/check-wording.mjs docs/partners/microsoft/tech-community-teams-adaptive-cards.md`.

---

## A 3D model from one sentence, inside a Teams chat: a bot, a message extension and tabs on Adaptive Cards

three.ws turns a prompt or a photo into a textured 3D model, and a model into an AI agent with a body, a voice and a public page. We built an app package for Teams with three jobs: share a live agent card into a conversation, generate a 3D model without leaving the chat, and keep a 3D viewer and an agent gallery one click away. Every message surface is an Adaptive Card. This post walks through the real code.

### Where it stands

The package is built and passes validation. The Bot Framework endpoint is deployed. It is **not** available in Teams yet: the Azure Bot registration and the store submission are still to be done, and until the bot is registered the endpoint answers every call with `503 not_configured`. Nothing below describes usage, because there has not been any.

### What is in the package

The manifest (schema v1.30) declares four capabilities:

- **Two personal tabs:** a 3D viewer and an Agents tab.
- **A message extension** with a search command (`searchAgents`), an action command (`createModel`, "Create a 3D model", reachable from the compose box, the command box and a message's `...` menu), and a link unfurler for our own domain.
- **A bot** in personal, group chat and team scopes with one command, `forge <prompt>`.
- **An agent connector** that points Microsoft 365 Copilot and Copilot Studio agents at our remote MCP server, with the 16 tool descriptions shipped in the package as `mcptools.json`.

### Verify the token before reading the activity

Everything arrives at one serverless handler, `POST /api/microsoft-teams/messages`. Before a single field of the activity is trusted, the Bot Framework JWT is checked:

```js
export async function verifyBotToken(authorization, { serviceUrl, keys = botFrameworkJwks() }) {
  const appId = teamsBotAppId();
  if (!appId) throw new TeamsBotError('not_configured', 'the Teams bot is not configured', 503);
  const match = /^Bearer\s+(.+)$/i.exec(authorization || '');
  if (!match) throw new TeamsBotError('missing_token', 'a Bot Framework bearer token is required');
  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], keys, {
      issuer: BOTFRAMEWORK_ISSUER, audience: appId, clockTolerance: 300 }));
  } catch (err) {
    throw new TeamsBotError('invalid_token', `the Bot Framework token did not verify: ${err?.code || err?.message}`);
  }
  checkBotClaims(payload, { appId, serviceUrl });
  return payload;
}
```

The keys come from `https://login.botframework.com/v1/.well-known/keys` through `jose`'s remote key set, which caches them and refetches when a new key id appears. The claim check is a pure function, testable without a signed token. Its most important rule: when the token names a `serviceurl`, the activity must not point anywhere else, because the body is attacker-controlled until the token has been checked against it.

Search, unfurling and card refreshes answer in the HTTP response of the invoke, so they need no credential at all. Only posting a card into a chat uses the Bot Connector and the bot's client secret. Without that secret, "Create a 3D model" inserts the card into the compose box instead, and the requester's own refreshes keep it current. The app degrades instead of failing.

### Search and unfurl: design the empty states

Search and link unfurling are one `switch` over the invoke name. Three details we would recommend to anyone building a search-based extension:

- **Design the initial run.** With `initialRun: true`, Teams sends the query before the user types anything. An empty search returns the agents with the most actions in the last seven days instead of nothing, and an empty result says what to do next: "No three.ws agents match ... Try a shorter name, or create one at https://three.ws/create".
- **Handle the anonymous unfurl.** With `supportsAnonymizedPayloads`, Teams can ask for a link preview without user identity. Agent cards are public data, so `queryLink` and `anonymousQueryLink` share one code path.
- **Cap the work.** Search text is capped at 100 characters and results at 10, names that start with the search text first.

### One layout function, a template and a bound card

The agent card started life on the Windows 11 widgets board, which wants an **unbound template** plus data and binds them itself. Teams wants a card that is **already bound**. Two hand-maintained JSON files would drift within a week, so both come from one layout function that takes a `field()` callback:

```js
export function adaptiveTemplate() {
  return layout((path, fallback) => {
    const expr = binding(path);
    return fallback ? `\${if(${expr}, ${expr}, '${fallback}')}` : `\${${expr}}`;
  });
}

export function adaptiveCardFor(card) {
  return layout((path, fallback) => {
    const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), card);
    if (value === null || value === undefined || value === '') return fallback ?? '';
    return typeof value === 'number' ? String(value) : value;
  });
}
```

The layout (Adaptive Cards 1.6) is a `ColumnSet` with the agent image and name, a large metric, a `FactSet` of three stats and two `Action.OpenUrl` buttons. Paths in the layout read the way JavaScript reads them, `stats.0.label`. That hides a trap: Adaptive Expression Language indexes arrays with brackets, a dot before a number is a parse error, and the templating engine then throws on the whole card. One dotted index empties the widget slot. A one-line `binding()` rewrites `.0` to `[0]` for the template path only.

The payloads stay small. Measured against a real agent's card data, the bound card is 1,363 bytes, the template 1,350 bytes, and a full 10-result search response 18,586 bytes.

### A card that updates itself: Universal Actions

Generating a model takes from a few seconds to several minutes, and Teams gives a message extension submit 5 seconds before it retries. So the submit never waits on the generator. It validates the prompt (3 to 1,000 characters, the same safety check the free MCP tools use, and per-user rate limits), records the job, dispatches it and answers at once with a progress card.

The job key is derived from the activity, `teams-` plus a SHA-256 of the conversation and activity ids, so a retried submit lands on the job already started. One submit never produces two generations.

The progress card is Adaptive Cards 1.5, the version Teams documents for Universal Actions, and it carries a `refresh` block:

```js
export function refreshFor(record) {
  const userIds = record?.by?.id ? [record.by.id].slice(0, REFRESH_USER_LIMIT) : [];
  return {
    action: { type: 'Action.Execute', title: 'Check progress', verb: VERB_REFRESH, data: { key: record.key } },
    userIds,
  };
}
```

Teams sends that `Action.Execute` back as an `adaptiveCard/action` invoke when the card is displayed to a listed user, and replaces the card with whatever the bot returns. Listing the requester in `userIds` (Teams accepts at most 60) makes the card refresh automatically for them in any conversation; everyone else gets a manual refresh. Every `Action.Execute` also carries an `Action.Submit` fallback for hosts older than 1.4.

The status line is built only from what the generator reports: starting, submitted, GPU waking up (with the boot time left when the lane reports it), queued, or rendering with elapsed seconds and the lane's own estimate. There is no invented percentage. When the job finishes, the card becomes a poster of the model with Open in 3D (a Teams stage view of our viewer), Download GLB, Make a variation and Model page.

One production detail: Cloud Run throttles the CPU of work left running after a response is sent. So the messaging endpoint dispatches each job to an internal route, `/api/microsoft-teams/forge-run`, which sends its `202` at once and holds its own request open while the job runs, within the 900-second request limit. If the job outlives that budget, the next card refresh collects it.

### A tab that needs no session

The Agents tab is a normal page on our site in an iframe. Third-party cookies are unreliable in Microsoft 365 hosts, so the tab needs no session: the agent list, the live 3D stage (the same `<agent-3d>` web component any site embeds) and the stats card are all public reads. Teams passes its theme through the `{theme}` placeholder in `contentUrl`, and an inline script in the page head applies it before first paint, so the tab never flashes the wrong theme.

### Validating the package before anyone uploads it

`scripts/build-microsoft-app-package.mjs` fills the manifest template, validates it with Ajv against the published v1.30 schema (vendored in the repo), checks every tool in `mcptools.json` for a name, description and input schema with no duplicates, checks both icons, and refuses any non-ASCII character. Owner-only values (the app id, legal entity name, Key Vault URL and bot app id) come from the environment and are never defaulted; a `--check` mode validates everything else in development:

```
$ npm run package:microsoft-app -- --check
OK: manifest, schema v1.30, 16 tools, meeting stage tab and RSC, icons and ASCII checks pass (owner values not checked).
```

The zip is written with fixed timestamps, so the same sources always produce the same bytes.

### Tests

97 Vitest tests cover this work: 13 for the bot's token, search and unfurl logic, 31 for the 3D generation flow and its cards (every card validated against the published Adaptive Cards 1.5 schema), 21 for the agent card, 21 for the stage view and 11 for the package builder.

### What we would tell another team

- If you already render Adaptive Cards anywhere, start your Teams work from that card, and generate the template and bound forms from one source.
- Verify the Bot Framework token before you trust a single field of the activity, including `serviceUrl`.
- Derive job keys from the activity id, and Teams' retries stop being a problem.
- Use `refresh` with `userIds` for long jobs, and report only real state.

The code is open source at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws): start at `integrations/microsoft/copilot-teams/`, `api/_lib/teams-bot.js` and `api/_lib/teams-forge-cards.js`. Questions and corrections are welcome in the comments.

*Microsoft, Microsoft Teams, Microsoft 365, Copilot, Copilot Studio, Adaptive Cards, Windows and Azure are trademarks of the Microsoft group of companies.*
