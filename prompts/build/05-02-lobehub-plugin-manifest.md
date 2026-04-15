# 05-02 — Lobehub plugin: render the agent embodied in LobeChat

**Branch:** `feat/lobehub-plugin`
**Stack layer:** 5 (Host embed — Lobehub — the user's primary integration target)
**Depends on:** 04-02 (embed policy), 04-03 (public decorate), 05-01 (web component bundle)
**Blocks:** 06-* (onchain → Lobehub demo)

## Why it matters

The user has a Lobehub fork — the primary integration target for the whole project. Lobehub plugins can render in the chat pane. This prompt ships a LobeChat-compatible plugin manifest + backend that renders the agent as an embodied widget inside a LobeChat conversation.

## Read these first

| File | Why |
|:---|:---|
| LobeChat plugin schema — `lobe-chat-plugin-sdk` docs | Plugin manifest shape, API route conventions. Confirm before wiring. |
| [src/element.js](../../src/element.js) | `<agent-3d>` — the embeddable render surface. |
| [api/agents.js](../../api/agents.js) with 04-03 applied | Public agent fetch. |
| [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) from 04-02 | Lobehub's origin must be added to default allowlists here. |

## Build this

### Plugin manifest — `GET /api/lobehub/manifest.json`

Serve a valid LobeChat plugin manifest with:
- `identifier`: `3dagent`
- `version`: from `package.json`
- `api`: a single tool — `showAgent(agentId: string)` — that returns a `text/html` widget embedding `<agent-3d agent-id="<id>" host="lobehub"></agent-3d>`.
- `ui`: if LobeChat supports an inline widget mode, declare it. Otherwise use a standard iframe.

### Endpoint — `POST /api/lobehub/show-agent`

- Body: `{ agentId }`
- Looks up the agent via the public endpoint (04-03-hardened).
- If the agent's embed policy blocks `https://chat.lobehub.com` (or the user's Lobehub fork origin), respond with a helpful error telling the owner to allowlist the origin.
- Otherwise, return the embed HTML payload LobeChat expects.

### `host=lobehub` behaviour in `<agent-3d>`

Mirror the `host=claude` treatment from 05-01:
- Kiosk defaults.
- Listen for LobeChat theme messages (dark / light) via postMessage and apply to the canvas background.
- Cap DPR to 2.

### Docs

Ship a single README snippet (in the PR description, not a new `.md` file) telling the user how to install the plugin into their Lobehub fork: point at `/api/lobehub/manifest.json`.

### Env

No new secrets unless absolutely needed. If LobeChat requires a signed plugin token, add `LOBEHUB_PLUGIN_SECRET` to `.env.example`.

## Out of scope

- Do not build two-way chat yet — that requires MCP and agent-skills wiring. Separate prompt.
- Do not fork the LobeChat code. This project is the plugin; LobeChat hosts it.
- Do not hardcode the user's fork URL — make it configurable.

## Acceptance

- [ ] `GET /api/lobehub/manifest.json` validates against the LobeChat plugin schema (paste into LobeChat plugin installer → no errors).
- [ ] In the user's Lobehub fork, invoking the `3dagent.showAgent(<id>)` tool renders the 3D agent in the chat pane.
- [ ] A blocked embed policy yields a friendly error, not a silent failure.
- [ ] `host=lobehub` responds to LobeChat's theme postMessage.
