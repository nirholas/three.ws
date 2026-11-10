---
name: agent-glance-cli
description: Show a three.ws agent's live card in the terminal, or generate a README badge, SVG file or embed snippet for it. Use when someone wants to put a three.ws agent on a README, Slack message, web page or home screen widget.
---

# agent-glance

`@three-ws/agent-glance` is a zero-dependency CLI and ESM library (Node 18 or newer). It reads public cards from `https://three.ws/api/glance/card` and needs no key. The agent id must be a uuid; anything else is rejected before any request.

## CLI

```
npx @three-ws/agent-glance <agent-id>              # print the card (ANSI)
npx @three-ws/agent-glance <agent-id> --json       # raw card model
npx @three-ws/agent-glance <agent-id> --markdown   # README snippet (image linked to the agent)
npx @three-ws/agent-glance <agent-id> --html       # <agent-glance> embed snippet
npx @three-ws/agent-glance <agent-id> --svg card.svg
npx @three-ws/agent-glance <agent-id> --watch 60   # redraw every 60 seconds
```

Options: `--size small|medium|large` (default medium), `--theme auto|light|dark` (default auto), `--origin <url>` (default `https://three.ws`), `--no-color`.

`--markdown` and `--html` build URLs locally and make no network call. `--json`, the default card and `--svg` fetch from three.ws. A 404 means no such agent.

## Library

```js
import {
  fetchGlanceCard, fetchGlanceAdaptiveCard, glanceCardUrl, glanceImageUrl,
  glanceMarkdown, glanceEmbedHtml, renderGlanceAnsi, GlanceError,
} from '@three-ws/agent-glance';
```

- `fetchGlanceCard(agentId, { origin, timeoutMs, signal, fetchImpl })` returns the card model (8 second default timeout).
- `fetchGlanceAdaptiveCard(agentId)` returns an Adaptive Card for Teams or the Windows widgets board.
- `glanceImageUrl(agentId, { size, theme, origin })` gives an `<img>`-ready SVG URL.
- `glanceMarkdown(agentId, { alt, size, theme })` and `glanceEmbedHtml(agentId, { size, theme })` return snippets.
- `renderGlanceAnsi(card, { color, width })` renders a terminal card.

## Worked example

Add a live badge for an agent to a README:

1. Run `npx @three-ws/agent-glance 123e4567-e89b-12d3-a456-426614174000 --markdown --size small --theme dark` (substitute the real agent uuid).
2. Paste the printed Markdown into the README.

Errors print as `glance: <message>` with exit code 1.
