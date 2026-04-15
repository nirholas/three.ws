---
mode: agent
description: "One-click share panel on the agent page — link, embed snippet, Claude Artifact, Lobehub"
---

# 04-06 · Share panel on /agent/:id

## Why it matters

The product only grows if owners can share their agent in 10 seconds. The agent page needs one button — "Share" — that opens a panel with the three surfaces that matter: a plain link, an HTML embed snippet, and one-click shares into Claude Artifacts and Lobehub (covered in pillar 5 prompts). Without this, the distribution loop never closes.

## Prerequisites

- 04-01 (agent page polish) merged.
- 04-02 (`<agent-avatar>` web component) merged.

## Read these first

- [public/agent/index.html](../../public/agent/index.html).
- [src/element.js](../../src/element.js) (if present — source of the web component tag).
- [api/agent-oembed.js](../../api/agent-oembed.js), [api/agent-og.js](../../api/agent-og.js).

## Build this

### Share button on the agent page

- Add a "Share" button in the owner-only action bar (owners) and next to the attribution (for all viewers, public agents only).
- Click → opens a panel (modal or bottom-sheet on mobile).

### Share panel contents

Three tabs:

1. **Link** — the canonical `/agent/:id` URL with a copy button. Shows a preview of the OG card so owners see what it looks like when pasted into Slack/Discord.
2. **Embed** — three one-click snippets:
   - **iframe** — for static sites.
     ```html
     <iframe src="https://3dagent.vercel.app/agent/ID/embed" width="400" height="500" frameborder="0" allow="camera; microphone"></iframe>
     ```
   - **web component** — for modern sites.
     ```html
     <script type="module" src="https://3dagent.vercel.app/agent-3d.js"></script>
     <agent-avatar agent-id="ID" height="500px"></agent-avatar>
     ```
   - **Markdown** — for GitHub READMEs (falls back to an image link to the OG card).
3. **Apps** — destination launchers (these link out; the actual integrations live in pillar 5 prompts):
   - "Open in Claude.ai" — links to a pre-filled prompt that asks Claude to render the agent via the Artifact shim.
   - "Install in Lobehub" — links to the Lobehub plugin install deep-link (see `05-02`).
   - "Download agent-card.json" — downloads the A2A card for other hosts.

### Copy UX

- Every snippet has a copy button with a 1s "Copied ✓" state.
- The active tab is remembered in `localStorage` keyed by `agentShareTab`.

### Mobile

- On narrow viewports, the panel becomes a bottom sheet with a drag handle.

## Out of scope

- Actually wiring up the Lobehub install or Claude Artifact integration — those live in pillar 5 prompts. This prompt only renders the links.
- Tracking share clicks (future `07-02` analytics prompt covers it).
- Generating custom OG images on the fly (that's `04-01-agent-og-image.md`).

## Acceptance

1. Visiting /agent/:id shows a Share button.
2. Clicking opens the three-tab panel.
3. Copying any snippet drops working HTML into the clipboard.
4. Pasting the iframe snippet into a blank HTML file and opening it renders the avatar.
5. Mobile viewport: the panel becomes a bottom sheet.
6. Keyboard-only users can open, navigate tabs, copy, and close the panel.
