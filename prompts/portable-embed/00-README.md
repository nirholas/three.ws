# Band 4 — Portable Embed (the view + embed polish band)

## The end state

Anyone with the share URL sees a public, interactive three.ws page. Anyone with the embed snippet can paste it into their Substack / blog / docs / README and the avatar loads with chrome-free styling. Owners can get a one-click snippet from the agent's page.

## Current state

- Public viewer exists at `public/agent/index.html`; embed at `public/agent/embed.html`.
- OG/oEmbed metadata partially shipped (see `prompts/embed/01-og-oembed.md`).
- Agent-id resolver work in flight (`prompts/embed/02-agent-id-resolver.md`).
- Per-agent embed allowlist spec exists (`prompts/embed/03-embed-allowlist.md`) — _not_ a priority right now; owners can worry about it later.

## Prompts in this band

| #   | File                                                            | Depends on |
| --- | --------------------------------------------------------------- | ---------- |
| 01  | [share-panel.md](./01-share-panel.md)                           | —          |
| 02  | [embed-snippet-generator.md](./02-embed-snippet-generator.md)   | 01         |
| 03  | [public-agent-page-polish.md](./03-public-agent-page-polish.md) | —          |
| 04  | [embed-sizing-and-theming.md](./04-embed-sizing-and-theming.md) | —          |

All four can run in parallel after a quick scan of `public/agent/`.

## Done = merged when

- Owner clicks **Share** on `/agent/:slug`; a panel shows a short public URL, an iframe snippet, a JS snippet, and an OG preview card.
- Pasting the iframe snippet into a WordPress / Substack / README renders the avatar with no scrollbars, no chrome.
- The embed iframe is responsive (16:9 default, optional square, `?height=` / `?width=` params).
- The public page has OG / Twitter / oEmbed metadata that renders a proper preview card in Slack, Discord, iMessage.

## Off-limits for this band

- Don't do Claude.ai / LobeHub integration here — that's band 5. This band is about the _generic_ embed being solid first.
- Don't build a CDN. R2 is the blob store; Vercel serves the HTML.
- Don't introduce a new model-viewer component. `<model-viewer>` is fine.
