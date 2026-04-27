# 12 — `<agent-three.ws-id="...">` attribute resolver

## Why

Today embedding requires a full manifest URL. A bare `agent-id` attribute makes the embed snippet 3x shorter and is what we paste into Claude.ai / LobeHub. The resolver must translate `agent-id="xyz"` → manifest URL → full boot.

## Parallel-safety

You own ONE existing file, [src/agent-resolver.js](../../src/agent-resolver.js), and may create one new sibling if needed. You do NOT edit the web-component definition directly (find it; it's likely in [dist-lib/](../../dist-lib/) generated output or [src/](../../src/) — read `vite.config.js` for the library entry).

## Read first

- [src/agent-resolver.js](../../src/agent-resolver.js)
- [src/agent-identity.js](../../src/agent-identity.js)
- [vite.config.js](../../vite.config.js) — library entry for `agent-3d.js`.
- The web-component definition file (grep for `customElements.define('agent-3d'`).

## Files you own

- Edit: [src/agent-resolver.js](../../src/agent-resolver.js) — add `resolveByAgentId(agentId)` export.
- Edit: the web-component file — ONLY the `connectedCallback` (or equivalent) to prefer `agent-id` attribute if `manifest` is absent.

## Deliverable

### `resolveByAgentId(agentId)`

```js
export async function resolveByAgentId(agentId) {
	// 1. GET /api/agents/:id — returns { agent: { ..., manifestUrl } } OR 404.
	// 2. If manifestUrl is absolute, return it.
	// 3. If relative, resolve against location.origin.
	// 4. Cache results in an in-memory Map for the page lifetime (max 100 entries, LRU optional).
	// 5. On 404, throw AgentResolverError('not-found').
	// 6. Respect AbortSignal passed as second arg.
}
```

### Web-component hook

Inside `connectedCallback`:

- If `this.hasAttribute('agent-id')` AND NOT `this.hasAttribute('manifest')`:
    - `const url = await resolveByAgentId(this.getAttribute('agent-id'))`
    - Set `this.setAttribute('manifest', url)` and continue the existing boot path.
- If both are present, `manifest` wins and `agent-id` is ignored.
- If resolution fails, render a minimal inline error (`<div class="agent-3d-error">Agent not found</div>`) instead of throwing on the element.

Also observe `attributeChangedCallback` for `agent-id` (add to `observedAttributes`). If it changes post-mount, reset and re-boot.

## Constraints

- No new deps.
- No new network fetches beyond the one `/api/agents/:id` call per unique id.
- Must work when the component is embedded in a cross-origin iframe (no `localStorage` access — use in-memory Map only).

## Acceptance

- `node --check` clean on all edited files.
- `npm run build:lib` rebuilds `dist-lib/agent-3d.js` cleanly.
- `<agent-three.ws-id="demo">` on a test page boots the demo agent. Removing the attribute and setting a new one re-boots.

## Report

- The exact file where `customElements.define('agent-3d'` lives.
- Whether the existing boot was inside `connectedCallback` or an observer; how you hooked in without regressing the manifest path.
