---
mode: agent
description: "Produce a Lobehub plugin manifest so an agent URL renders embodied in Lobehub chat"
---

# 05-02 · Lobehub plugin manifest

## Why it matters

The user maintains a Lobehub fork. The product's killer demo is: paste an agent URL into Lobehub → the 3D body appears in-line in the chat stream. Not a link card, not JSON — the avatar.

## Prerequisites

- 04-03 (embed works in iframes).
- 04-04 (agent-card.json exists).

## Read these first

- Lobehub plugin docs (external). Link and summarize in the PR description — Lobehub uses a `lobe-chat-plugin` manifest convention. We need to produce:
  - A plugin manifest JSON.
  - An openapi-ish schema describing inputs.
  - A render hint so Lobehub renders our iframe rather than JSON.
- [public/agent/embed.html](../../public/agent/embed.html)
- Existing `src/element.js` — `<agent-3d>` web component.

## Build this

1. **New endpoint** `GET /.well-known/lobehub-plugin.json` (or the exact path Lobehub requires — confirm from the docs):
   - Describes the plugin: name, description, icon, author, homepage.
   - Declares a `renderer` of type `iframe` pointing at `/agent/{id}/embed?kiosk=1`.
   - Inputs: `agent_id` (string).
2. **New endpoint** `POST /api/lobehub/resolve`:
   - Accepts `{ agent_id }`, returns `{ iframe_url, card_url, name, description }`.
   - Uses `agent-card.json` internally for the metadata.
3. **Installation snippet** — on `/agent/:id` Share panel, add a "Lobehub" tab with:
   - A one-click "Install in your Lobehub" link that deep-links into the user's Lobehub fork plugin registry (confirm Lobehub deep-link format from docs).
   - A manual JSON snippet for users whose Lobehub doesn't support deep-link install.
4. **User's fork** — note in the PR: if the plugin needs to be pre-registered in the fork's plugin registry rather than self-hosted, we add a PR to the fork. Don't write that PR here; flag it as next step.

## Out of scope

- Modifying Lobehub itself — plugin lives at our domain.
- Multi-agent chat (we resolve one agent at a time per iframe).
- Chat protocol with the agent — Lobehub's chat is the host LLM; our iframe is a body, not a model. Hook that up only if stack item says so.

## Deliverables

- `api/lobehub/plugin.js` (well-known manifest) or static JSON at `public/.well-known/lobehub-plugin.json`.
- `api/lobehub/resolve.js`.
- Share-panel "Lobehub" tab.

## Acceptance

- Installing the plugin in a fresh Lobehub instance and pasting an agent URL renders the iframe embodied in the chat.
- `curl /.well-known/lobehub-plugin.json` returns a valid manifest.
- `npm run build` passes.

## Report

Note in the PR exactly which Lobehub version / fork commit you tested against.
