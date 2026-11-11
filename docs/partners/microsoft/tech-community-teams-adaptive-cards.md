# Tech Community article: an app for Teams built on Adaptive Cards

**Where:** Microsoft Tech Community, the Microsoft Teams developer or Microsoft 365 platform space that fits best when posting.
**Status:** draft, not posted. Posting is an owner step.
**Every number** below is sourced in [sources.md](./sources.md#tech-community-teams-adaptive-cards).

**Before posting, check these, because they change:**

1. The Teams app package is built and validated but not yet registered or submitted. If the owner has since completed the Azure Bot registration and the store submission, update the "Where it stands" section; until then keep the wording exactly as it is, because the app is not available in Teams.
2. Rerun `npm run package:microsoft-app -- --check` and the three test suites, and update the counts if they moved.
3. Run `node scripts/microsoft-pack/check-wording.mjs docs/partners/microsoft/tech-community-teams-adaptive-cards.md`.

---

## One Adaptive Card, two Microsoft hosts: building a Teams message extension and tabs for live 3D agents

three.ws turns a prompt or a photo into a 3D AI agent with a body, a voice and a public page. Each agent also has a small status card: its name, a one-line headline about what it is doing, a headline metric and three stats. We first built that card for the Windows 11 widgets board, which renders Adaptive Cards. When we built a Teams app package, the obvious question was whether the same card could carry over to Teams unchanged.

It could. This post walks through what we built, with the real code: a message extension that searches agents and unfurls agent links into live cards, two personal tabs, an MCP tool connector for Microsoft 365 Copilot agents, and the packaging script that validates all of it against the published manifest schema.

### Where it stands

The package is built and passes validation. The Bot Framework endpoint is deployed. It is **not** available in Teams yet: the Azure Bot registration and the store submission are still to be done, and until the bot is registered the endpoint answers every call with `503 not_configured`. Nothing below describes usage, because there has not been any.

### What is in the package

The manifest (schema v1.30) declares three kinds of capability. Two personal tabs:

```json
"staticTabs": [
  { "entityId": "threews-viewer", "name": "3D Viewer",
    "contentUrl": "https://three.ws/viewer", "scopes": ["personal"] },
  { "entityId": "threews-agents", "name": "Agents",
    "contentUrl": "https://three.ws/microsoft/teams-tab?theme={theme}", "scopes": ["personal"] }
]
```

A message extension with one search command and a link unfurler for our own domain:

```json
"composeExtensions": [{
  "botId": "${MS_TEAMS_BOT_APP_ID}",
  "commands": [{
    "id": "searchAgents", "type": "query", "title": "Agents",
    "initialRun": true, "context": ["compose", "commandBox"],
    "parameters": [{ "name": "searchQuery", "title": "Agent name", "inputType": "text" }]
  }],
  "messageHandlers": [{
    "type": "link",
    "value": { "domains": ["three.ws", "www.three.ws"], "supportsAnonymizedPayloads": true }
  }]
}]
```

And an agent connector that points Microsoft 365 Copilot and Copilot Studio agents at our remote MCP server, with the tool descriptions shipped in the package as `mcptools.json` (16 tools: text to 3D, photo to 3D, auto-rigging, an avatar from a prompt, a CC0 catalog search, model inspection and agent personas).

One honest scoping note: there is no `bots` entry. The Bot Framework endpoint exists only to serve the message extension. It does not join chats or answer messages, and the handler returns an empty `200` for any activity that is not an invoke.

### A messaging endpoint that never holds a client secret

The endpoint is a single serverless handler, `POST /api/microsoft-teams/messages`. Message extension invokes are answered synchronously in the HTTP response, so the bot never calls back through the Bot Connector, and so it never needs a client secret. What it does need is to refuse anything not sent by the Bot Framework:

```js
export async function verifyBotToken(authorization, { serviceUrl }) {
  const appId = teamsBotAppId();
  if (!appId) throw new TeamsBotError('not_configured', 'the Teams bot is not configured', 503);
  const match = /^Bearer\s+(.+)$/i.exec(authorization || '');
  if (!match) throw new TeamsBotError('missing_token', 'a Bot Framework bearer token is required');
  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], botFrameworkJwks(), {
      issuer: BOTFRAMEWORK_ISSUER, audience: appId, clockTolerance: 300 }));
  } catch (err) {
    throw new TeamsBotError('invalid_token', `the Bot Framework token did not verify: ${err?.code || err?.message}`);
  }
  checkBotClaims(payload, { appId, serviceUrl });
  return payload;
}
```

The keys come from `https://login.botframework.com/v1/.well-known/keys` through `jose`'s remote key set, which caches them and refetches when a new key id appears. The claim check is a separate pure function so it can be tested without a signed token: the issuer must be `https://api.botframework.com`, the audience must include this bot's app id, and when the token names a `serviceurl` the activity must not point anywhere else. That last rule matters, because the activity body is attacker-controlled until the token has been checked against it.

The route itself is short: method check, rate limit, parse, `verifyBotToken`, then `handleActivity` on the verified activity.

### Search and unfurl in one switch

All the message extension behaviour is one function over the invoke name:

```js
switch (activity.name) {
  case 'composeExtension/query': {
    if (activity.value?.commandId && activity.value.commandId !== SEARCH_COMMAND_ID) {
      return messageResponse('That command is not available in this version of the app.');
    }
    const text = searchTextOf(activity.value);
    const cards = await searchAgents(text);
    if (!cards.length) {
      return messageResponse(text
        ? `No three.ws agents match "${text}". Try a shorter name, or create one at https://three.ws/create`
        : 'No agents were active this week. Type a name to search every three.ws agent.');
    }
    return resultResponse(cards.map(attachmentFor));
  }
  case 'composeExtension/queryLink':
  case 'composeExtension/anonymousQueryLink': {
    const id = agentIdFromUrl(activity.value?.url);
    const card = id ? await loadGlanceCard(id) : null;
    if (!card) return messageResponse('This three.ws link is not an agent page.');
    return resultResponse([attachmentFor(card)]);
  }
  default:
    return {};
}
```

Three details we would recommend to anyone building a search-based extension:

- **Design the initial run.** With `initialRun: true`, Teams sends the query before the user types anything. `searchTextOf` returns an empty string for that case, and an empty search returns the agents with the most actions in the last seven days instead of nothing. An empty result is answered with a message that tells the user what to do next, not a blank list.
- **Handle the anonymous unfurl.** With `supportsAnonymizedPayloads`, Teams can ask for a link preview without user identity. Because every agent card is public data, both invoke names share one code path.
- **Cap the work.** Search text is trimmed and capped at 100 characters, and results are capped at 10: names and descriptions both match, names that start with the search text rank first, then the newest agents.

Each result is two cards: the full Adaptive Card that lands in the conversation, and a thumbnail card Teams uses in the result list.

```js
export function attachmentFor(card) {
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: adaptiveCardFor(card),
    preview: {
      contentType: 'application/vnd.microsoft.card.thumbnail',
      content: {
        title: card.name,
        text: card.description || card.headline,
        ...(card.image ? { images: [{ url: card.image, alt: card.name }] } : {}),
        tap: { type: 'openUrl', value: card.url },
      },
    },
  };
}
```

### One layout function, a template and a bound card

This is the part we are happiest with. The Windows widgets board wants an **unbound template** plus data, and binds them itself. Teams wants a card that is **already bound**. Two hand-maintained JSON files would drift within a week, so both come from one layout function that takes a `field()` callback:

```js
/** The unbound template the Windows widgets board fetches once. */
export function adaptiveTemplate() {
  return layout((path, fallback) => {
    const expr = binding(path);
    return fallback ? `\${if(${expr}, ${expr}, '${fallback}')}` : `\${${expr}}`;
  });
}

/** The same card with this agent's values already in it. */
export function adaptiveCardFor(card) {
  return layout((path, fallback) => {
    const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), card);
    if (value === null || value === undefined || value === '') return fallback ?? '';
    return typeof value === 'number' ? String(value) : value;
  });
}
```

The layout (Adaptive Cards 1.6) is a `ColumnSet` with the agent image and name, a large metric, a `FactSet` of three stats and two `Action.OpenUrl` buttons. In the layout, paths are written the way JavaScript reads them, `stats.0.label`. That hides a trap worth knowing: Adaptive Expression Language indexes arrays with brackets, and a dot before a number is a parse error. The templating engine then throws on the whole card rather than skipping one binding, so one dotted index empties the widget slot. A one-line `binding()` rewrites `.0` to `[0]` for the template path only.

The payloads stay small. Measured against a real agent's card data from our production card endpoint, the bound card is 1,321 bytes, the template 1,350 bytes, one attachment with its thumbnail preview 1,779 bytes, and a full 10-result response 17,880 bytes.

### A tab that needs no session

The Agents tab is a normal page on our site, loaded in an iframe. Third-party cookies are unreliable in Microsoft 365 hosts, so the tab is built to need no session at all: the agent list, the live 3D stage (the same `<agent-3d>` web component any site embeds) and the stats card are all public reads.

Teams passes its theme in the tab URL through the `{theme}` placeholder in `contentUrl`. A tiny inline script in the page head maps `default` to the light theme and `dark` or `contrast` to the dark one before first paint, so the tab never flashes the wrong theme. Outside Teams the same page falls back to the visitor's saved site theme.

It remembers the last agent picked in `localStorage`; where a Teams webview blocks storage, it opens on the most popular agent instead.

### Validating the package before anyone uploads it

Partner Center rejects a package late and with little detail, so we validate early. `scripts/build-microsoft-app-package.mjs` fills the manifest template, validates it with Ajv against the published v1.30 schema (vendored in the repo), checks that every tool in `mcptools.json` has a name, description and input schema with no duplicates, checks that the icons are a 192x192 color PNG and a 32x32 white-on-transparent outline, and refuses any non-ASCII character in the manifest, tool file or intro text. A `--refresh-tools` flag rewrites the tool file from the live MCP server's `tools/list`, mapping typographic punctuation to ASCII on the way.

Owner-only values (the app id, legal entity name, Key Vault URL and bot app id) come from the environment and are never defaulted. A `--check` mode substitutes clearly marked check-only values so everything else can be validated in development:

```
$ npm run package:microsoft-app -- --check
OK: manifest, schema v1.30, 16 tools, icons and ASCII checks pass (owner values not checked).
```

The resulting zip is 63,338 bytes, five files, with fixed timestamps so the same sources always produce the same bytes.

### Tests

The message extension, the card and the packager have 43 tests across three Vitest suites: 13 for the bot (claim checks, search parsing, link parsing, envelopes, unknown commands and invokes), 21 for the card and 9 for the package builder.

### What we would tell another team

- If you already render Adaptive Cards anywhere, start your Teams work from that card. Generate template and bound forms from one source.
- Answer message extension invokes synchronously and you can skip the client secret entirely.
- Verify the Bot Framework token before you trust a single field of the activity, including `serviceUrl`.
- Make the empty search and the empty result helpful; they are the first thing a user sees.

The code is open source at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws): start at `integrations/microsoft/copilot-teams/` and `api/_lib/teams-bot.js`. Questions and corrections are welcome in the comments.

*Microsoft, Microsoft Teams, Microsoft 365, Copilot, Copilot Studio, Adaptive Cards, Windows and Azure are trademarks of the Microsoft group of companies.*
