---
name: website-concierge
description: Answer a question grounded in a real web page, and generate copy-paste embed code to add a three.ws Concierge (an AI chat widget with a talking 3D avatar) to a website. Use when a site owner wants a chat concierge, or you need a sourced answer from a page.
---

# Website Concierge

The plugin's `.mcp.json` launches `npx -y @three-ws/concierge-mcp`. It needs no key, signer or payment. It calls the public three.ws Concierge API (`POST /api/concierge`) for answers; embed code and the avatar list are generated offline.

## Tools

- `concierge_ask`: answer a question from real content. Parameters: `question` (required, up to 2000 chars), `url` (page to fetch and harvest), `siteName`, `knowledge` (curated facts, up to 8000 chars, which lead over page text), `content` (raw text when no url, up to 6000 chars), `persona` (tone), `lang` (BCP-47).
- `concierge_embed`: build install code. Parameters: `siteName`, `flavor` (`script`, `web-component`, `npm`, `imperative`, or `all`, the default), `accent` (CSS color), `avatar` (an id from `concierge_avatars`), `customAvatar` (URL of a rigged GLB), `position` (`bottom-right` or `bottom-left`), `theme` (`auto`, `dark`, `light`), `greeting`, `persona`, `knowledge`, `suggestions` (up to 4 prompt chips), `endpoint`, `muted`, `open`, `noPicker`, `noTeaser`, `lang`.
- `concierge_avatars`: list the catalog of avatar ids. Takes no arguments. Call it before choosing `avatar`.

## Workflows

Grounded answer: call `concierge_ask` with `question` and `url`. Add `knowledge` when you hold authoritative facts such as pricing or policy, since those take precedence over harvested page text.

Add a concierge to a site: call `concierge_avatars`, pick one, then call `concierge_embed` with `siteName`, `avatar`, `accent`, a `greeting` and `knowledge` drawn from the site's FAQ. Paste the `script` flavor before the closing body tag, or use `flavor: "all"` to show the options. The tool only composes code; it installs nothing.

## Example

User: "Add a concierge to my bakery site with an orange accent."

1. `concierge_avatars` and choose an id.
2. `concierge_embed` with `{"siteName": "Rye Bakery", "accent": "#f97316", "flavor": "script", "greeting": "Hi, ask me about today's bread.", "knowledge": "Open 7am to 3pm. Closed Mondays."}`.
3. Give the user the returned snippet and where to paste it.

## Environment

Optional: `THREE_WS_BASE` (default `https://three.ws`, for self-hosting or previews), `THREE_WS_TIMEOUT_MS` (default 45000), `CONCIERGE_PAGE_TIMEOUT_MS` (default 12000, page fetch).
