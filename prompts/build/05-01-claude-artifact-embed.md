---
mode: agent
description: 'Agent embeds cleanly inside a Claude.ai Artifact with the right iframe hints'
---

# 05-01 · Embed in a Claude Artifact

## Why it matters

The novel unlock of pillar 5. A Claude user pastes an agent URL into a chat → Claude renders it as an Artifact → the agent appears embodied, in-conversation, not as JSON. First visible win for "the universal frontend other agents must render into."

## Prerequisites

- 04-03 (embed iframe is reliable under CSP).
- 04-04 (agent-card.json exists).

## Read these first

- [public/agent/embed.html](../../public/agent/embed.html)
- Claude Artifacts documentation — find the CSP / iframe / allowed-source rules that apply. Link them in the PR description.
- [src/agent-resolver.js](../../src/agent-resolver.js) — lets `<agent-three.ws-id="X">` resolve without a manifest URL.

## Build this

1. **Claude-friendly HTML snippet** — produce a canonical Artifact-ready snippet and display it on `/agent/:id` under Share → "Claude Artifact":
    ```html
    <iframe
    	src="https://three.ws/agent/<ID>/embed?kiosk=1&bg=transparent"
    	width="100%"
    	height="520"
    	style="border:0;border-radius:16px"
    	allow="autoplay; fullscreen"
    	referrerpolicy="no-referrer-when-downgrade"
    >
    </iframe>
    ```
2. **Static HTML fallback** — under the iframe, include a "No-iframe fallback" snippet (for hosts that strip iframes): a link + a static thumbnail image. Claude sometimes strips iframes; graceful degradation matters.
3. **Dynamic resize** — Claude Artifacts can't observe `agent:resize` messages; size the iframe with a fixed aspect ratio fallback. Use a `padding-top: 100%` CSS trick wrapper for square.
4. **Test in a real Claude conversation** — paste the snippet, confirm rendering, record browser console errors if any. If CSP blocks something, narrow the permissions rather than widening.
5. **Document** in PR description exactly what Claude-side constraints apply (CSP, allow-list, script-src). Don't change our own CSP unless a real blocker shows up.

## Out of scope

- Lobehub integration (05-02).
- MCP tool for spawning agents (05-03).
- Adding OAuth to the embed (it's anonymous).

## Deliverables

- A "Claude Artifact" tab added to the share panel on `/agent/:id`.
- A short compatibility note in the PR.

## Acceptance

- Pasting the snippet into a Claude conversation renders the avatar inside the Artifact.
- Pasting into a hostile CSP renders the fallback gracefully.
- `npm run build` passes.
