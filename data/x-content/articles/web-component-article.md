**Drop one `<agent-3d>` web component on your site and give any page an AI with a body.** LLM brain with memory and emotions. Physical DOM awareness. An on-chain identity that persists forever. And it covers its eyes when you type a password.

```
<script src="https://three.ws/agent.js"></script>
<agent-3d agent-id="your-agent-id"></agent-3d>
```

That's it. The component is a standard HTML custom element, no framework, no build step, no bundler. It renders in any browser that supports WebGL, which is all of them.

## What <agent-3d> ships with

### An LLM brain with memory and emotions

The agent runs on the LLM you configure in the three.ws studio, Claude, GPT, and others. It has persistent memory across sessions so it remembers who it's talking to. Its emotion state, happy, curious, concerned, excited, is updated by the LLM with each response and drives the avatar's body language in real time.

### Physical DOM awareness

The agent knows what's on the page. It can read element content, observe DOM mutations, understand layout, and physically react to it. In demos: watch it hop from card to card as you scroll. It can point to specific UI elements when explaining them. It moves through the page's actual space, not floating in a fixed corner disconnected from the content.

### Password field privacy

When the browser's focus moves to an `input[type="password"]` element, the agent covers its eyes. It's a small interaction, but it immediately communicates that the agent is aware of what's happening, respects user privacy, and has social intelligence, not just chat capability.

### An on-chain identity that lives

Every agent is minted as a Solana NFT with an ERC-8004 cross-chain wallet. The on-chain identity is the agent's persistent self, it carries the agent's history, reputation, and accumulated interactions. The agent doesn't disappear when you close the tab. Its identity is on-chain and it persists anywhere it's embedded.

## Why a web component

Web components work everywhere HTML works. No React. No Next.js. No framework lock-in. You can drop `<agent-3d>` into a WordPress page, a Webflow site, a vanilla HTML file, or a React component tree, it behaves identically in all of them. The shadow DOM keeps the agent's internal structure isolated from the host page's styles, and the custom element API lets the host page communicate with the agent through standard attributes and events.

This was a deliberate choice. The internet is mostly not React. The 3D layer for the internet has to work on the whole internet.

## The action bridge

The agent communicates bidirectionally with the host page through a secure postMessage bridge. The host page can:

-   Send events to the agent ("user clicked checkout", "price alert triggered", "form submitted")
-   Set the agent's emotion or animation state from page JavaScript
-   Receive events from the agent ("agent completed task", "user wants to pay", "agent needs clarification")

The bridge is gated by allowed origins, you configure which domains the agent will accept messages from in the Widget Studio. This is required: add your embedding domain to the allowed origins list or the action bridge will be blocked by CORS.

## CORS note for embedders

Add the domain you're embedding on to the widget's allowed origins list in the three.ws studio before going live. Without it, the action bridge is blocked and the agent won't be able to communicate with your page, it will still render and chat, but page-level integrations won't work.

## Get started

-   Widget Studio: [three.ws/widget-studio](https://three.ws/widget-studio)
-   Web component docs: [three.ws/docs](https://three.ws/docs)
-   Open source: [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws)

---

Originally published at [three.ws/blog/agent-3d-web-component](https://three.ws/blog/agent-3d-web-component).
