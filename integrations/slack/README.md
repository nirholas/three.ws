# three.ws for Slack

The Slack app that brings a three.ws agent into Slack: DMs and channel mentions
answered by the agent, private `/three` commands, trade previews with Approve and
Cancel buttons, account alerts, and a Home tab that explains the app and shows
whether the DM is paired.

- Public page: [three.ws/slack](https://three.ws/slack), source [pages/slack.html](../../pages/slack.html)
- Install: `https://three.ws/api/gateway/slack?leg=install` (no sign-in needed)
- How it works and operator settings: [docs/gateways.md](../../docs/gateways.md#slack)
- Marketplace submission kit: [SUBMITTING.md](SUBMITTING.md)

## Files

- [manifest.json](manifest.json): the app definition (scopes, events, `/three`,
  Home and Messages tabs, interactivity). Every three.ws URL in it points at
  `https://three.ws`; `--origin` rewrites them for a staging host.
- [assets/icon-1024.png](assets/icon-1024.png): the app icon.

## Create or update the app

```bash
npm run slack:app -- --dry-run            # read-only plan
npm run slack:app                         # paste an app configuration token when asked
npm run slack:app -- --app-id A0123ABCD   # re-apply the manifest to an existing app
```

The token is read from stdin or a hidden prompt, never argv. The script is
[scripts/slack-app.mjs](../../scripts/slack-app.mjs); run `--help` for every step it takes.

## Code

- Receiver (events, commands, buttons, OAuth, install, status): [api/gateway/slack.js](../../api/gateway/slack.js)
- Installs, OAuth state and token storage: [api/_lib/gateway/slack-installs.js](../../api/_lib/gateway/slack-installs.js)
- Worker adapter and Home tab: [workers/agent-gateway/src/adapters/slack.js](../../workers/agent-gateway/src/adapters/slack.js), [slack-home.js](../../workers/agent-gateway/src/adapters/slack-home.js)

## Tests

```bash
npx vitest run tests/slack-app.test.js tests/slack-page.test.js
(cd workers/agent-gateway && npx vitest run tests/slack-marketplace.test.js tests/slack-adapter.test.js)
```

`tests/slack-app.test.js` keeps the manifest in step with the code (scopes equal
`SLACK_BOT_SCOPES`, the redirect equals `slackRedirectUri()`, every subscribed event
is handled). `tests/slack-page.test.js` does the same for the public page.
