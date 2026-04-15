# Task 04 — Drop the CZ agent into the LobeHub fork's chat

## Why this exists

The "embodied, not JSON" moment of the demo. CZ opens your LobeHub fork and sees his agent standing next to the chat, reacting to his messages in real time — not as a chat bubble, as a presence. Same agent as `/cz`, hydrated from the same onchain record.

## Shared context

- You maintain a LobeHub fork. That repo is **separate** from this one. This task produces:
  1. Instructions + a patch/diff for the LobeHub side.
  2. The iframe embed source + postMessage protocol on the 3D side.
- 3D side embed URL: `/agent/chain/:chainId/:agentId/embed` (or `/embed?chain=...&agent=...` — reuse whichever lands from [../lobehub-embed/04-embed-from-chain.md](../lobehub-embed/04-embed-from-chain.md)).
- 3D side embed page: [public/agent/embed.html](../../public/agent/embed.html) already supports a `postMessage` bridge. Extend it with a defined protocol (see [../lobehub-embed/02-postmessage-protocol.md](../lobehub-embed/02-postmessage-protocol.md)).

## What to build

### 1. Define the parent ↔ embed postMessage protocol (confirm or extend)

Messages the **host → embed**:
```
{ type: 'agent/user-message', text: string, role: 'user'|'assistant' }
{ type: 'agent/set-theme', theme: 'light'|'dark' }
{ type: 'agent/identity', address: '0x...' }   // host-signed-in user
```

Messages the **embed → host**:
```
{ type: 'agent/ready' }
{ type: 'agent/speak', text: string, sentiment: number }
{ type: 'agent/skill-done', skill: string, result: {...} }
{ type: 'agent/request-claim' }    // if the embed sees the agent is unclaimed
```

Both sides must check `event.origin` — embed against a known LobeHub origin from env; host against `APP_ORIGIN`.

If [../lobehub-embed/02-postmessage-protocol.md](../lobehub-embed/02-postmessage-protocol.md) defines this already, use its version and do not duplicate. Note which file is authoritative.

### 2. LobeHub-side patch (produce as a `.patch` file, not applied in this repo)

Create `scripts/cz-demo/lobehub/0001-agent-sidebar.patch`:

- Adds a sidebar component `<AgentSidebar />` that iframes `{APP_ORIGIN}/agent/chain/{chainId}/{agentId}/embed`.
- Subscribes to the chat's current message stream; on every new user message, `iframe.contentWindow.postMessage({ type: 'agent/user-message', text, role })`.
- Listens for `agent/speak` / `agent/skill-done` from the iframe; optionally surfaces the agent's sentiment as a small emoji badge next to its avatar in the chat header.
- Env var `NEXT_PUBLIC_AGENT_EMBED_BASE` (or equivalent for LobeHub's config system) — do not hardcode the origin.

The patch file is for **operator application** — they'll apply it in the LobeHub fork repo separately. Keep it small and readable.

### 3. Drop-in HTML fallback

If a full LobeHub patch is too invasive for the demo timeline, provide `public/cz/lobehub-embed-demo.html` — a static page that **looks** like LobeHub's chat and iframes the agent embed. Useful for rehearsal and as a backup if the fork patch isn't ready.

Simple two-column layout:
- Left 60%: fake chat with three preset CZ messages. Typing simulated in JS.
- Right 40%: iframe of the agent embed. Reacts to each message via postMessage.

### 4. Wire CZ agent to `window.ethereum` claim state

If the host page has `window.ethereum` and the embed's iframe cannot inherit it (browser isolation), provide a "Claim" button inside the embed itself that opens a popup to `/cz#claim` for the actual signature flow — then postMessages `agent/identity` back to host.

## Files you own

- Create: `scripts/cz-demo/lobehub/0001-agent-sidebar.patch`, `scripts/cz-demo/lobehub/README.md` (how to apply the patch), `public/cz/lobehub-embed-demo.html`
- Edit: `public/agent/embed.html` (only if the protocol defined above is new and not in [../lobehub-embed/02-postmessage-protocol.md](../lobehub-embed/02-postmessage-protocol.md); otherwise wait for that task)

## Files off-limits

- Don't modify `src/element.js` or `src/agent-resolver.js` — owned elsewhere
- Don't modify the LobeHub fork repo from this repo; produce a patch file only

## Acceptance test

1. Open `public/cz/lobehub-embed-demo.html` locally. The fake chat streams three messages; the agent embed reacts visibly (empathy + gesture) to each.
2. Network tab: exactly one iframe load of `/embed?...`, no broken `postMessage` drops.
3. Apply the patch to a checkout of the LobeHub fork: `git apply 0001-agent-sidebar.patch`. Build LobeHub. Open a chat. Agent iframe is in the sidebar.
4. Type a message in LobeHub chat — avatar inside the iframe nods / smiles / emits `skill-done`.

## Reporting

Report: line count of the patch, which messages were exchanged during the rehearsal, any `postMessage` failures due to origin-mismatch, whether the fallback HTML was used during rehearsal, any gaps between the protocol defined here and the one in [../lobehub-embed/02-postmessage-protocol.md](../lobehub-embed/02-postmessage-protocol.md).
