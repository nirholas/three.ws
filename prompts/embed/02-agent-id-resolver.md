# Task 02 — `<agent-three.ws-id="...">` native resolver

## Why this exists

The `<agent-3d>` web component in [src/element.js](../../src/element.js) today only accepts `src="agent://chain/id"` or a manifest URL. The share panel on `/agent/:id` exposes a web-component snippet, but for a fresh hosted agent (no on-chain record, no manifest file yet), there is no way to embed via the component — only iframe works.

We want: `<agent-three.ws-id="ab12cd">` resolves directly against the hosted API (`/api/agents/:id` + `/api/avatars/:avatarId`) and builds an in-memory manifest on the fly. Zero on-chain dependency. Zero filesystem manifest required.

## Shared context

- [src/element.js](../../src/element.js) is the full `<agent-3d>` custom element. Its `_boot()` method currently:
    1. Calls `_resolveManifest()` which reads the `src` attribute.
    2. Loads the manifest, resolves `manifest.body.uri` as a GLB, constructs a `Viewer`, loads the GLB, wires Memory/Skills/Runtime.
- You are adding a **third path** into `_resolveManifest()` that activates when the element has an `agent-id` attribute (and no `src`).
- API:
    - `GET /api/agents/:id` → `{ agent: { id, name, description, avatar_id, skills, wallet_address, chain_id, meta, ... } }`
    - `GET /api/avatars/:id` → `{ avatar: { url, thumbnail_url, ... } }` — `url` is the GLB
- The existing manifest loader is in [src/manifest.js](../../src/manifest.js). The in-memory manifest you build should be shaped the same way a file-based manifest looks, so downstream code (`manifest.brain`, `manifest.body.uri`, `manifest.skills`, `manifest.id`, `manifest._baseURI`) just works.

## What to build

### 1. New resolver module

Create `src/agent-resolver.js`. Exports one function:

```js
export async function resolveAgentById(
	agentId,
	{ origin = location.origin, fetchFn = fetch } = {},
) {
	// 1. Fetch /api/agents/:id — throw a typed error on non-200
	// 2. Fetch /api/avatars/:avatar_id — throw if no avatar bound
	// 3. Return a manifest-shaped object:
	//    {
	//      name, description,
	//      id: { agentId, owner, chainId, walletAddress },
	//      body: { uri: avatar.url },
	//      brain: {},
	//      skills: agent.skills ?? [],
	//      memory: { mode: 'remote', namespace: agentId },
	//      _baseURI: `${origin}/agent/${agentId}/`,
	//      _source: 'agent-id',
	//    }
}
```

- No new dependencies.
- Use `credentials: 'include'` on both fetches (agents may be private).
- Throw instances of a local `AgentResolveError` class with a `.code` property (`not_found`, `no_avatar`, `network`, `unauthorized`) so callers can branch.
- Export the error class too.

### 2. Wire it into `<agent-3d>`

Edit [src/element.js](../../src/element.js):

- Add `'agent-id'` to the observed-attributes list (search for `observedAttributes` — if it exists). If re-renders on attribute change aren't supported for other attributes, don't add observation; just require it to be present on connect.
- In `_resolveManifest()` (or wherever `src` is read), add an early branch: if `this.hasAttribute('agent-id')` and no `src`, call `resolveAgentById(this.getAttribute('agent-id'))` and return its result. Bypass the rest of the URL/IPFS resolution path.
- If both `agent-id` and `src` are present, prefer `src` (the existing path) and log a one-line console warning.
- On resolver error, dispatch the existing error-phase event the element uses for manifest failures. Do not invent a new event type.
- Import:
    ```js
    import { resolveAgentById, AgentResolveError } from './agent-resolver.js';
    ```

### 3. Update the share-panel snippet (one-line edit)

In [public/agent/index.html](../../public/agent/index.html), find the `webcomponent` snippet in the `snippets` object:

```js
webcomponent: `<script type="module" src="${origin}/dist-lib/agent-3d.js"><\/script>\n<agent-3d src="${agentUrl}/manifest.json" style="width:420px;height:520px"></agent-3d>`,
```

Change it to use `agent-id`:

```js
webcomponent: `<script type="module" src="${origin}/dist-lib/agent-3d.js"><\/script>\n<agent-three.ws-id="${identity.id}" style="width:420px;height:520px"></agent-3d>`,
```

**Only this one line.** Do not touch anything else in `public/agent/index.html` — task 01 is editing `<head>` there.

## Files you own (create / edit)

- Create: `src/agent-resolver.js`
- Edit: `src/element.js`, `public/agent/index.html` (exactly the one line above)

## Files off-limits (other tasks are editing these)

- `public/agent/embed.html`, `api/agents/[id]/embed-policy.js`, anything under `public/dashboard/` — owned by task 03
- `api/agent-og.js`, `api/agent-oembed.js`, `<head>` of `public/agent/index.html`, `vercel.json` — owned by task 01
- `api/agents/[id].js`, `api/avatars/[id].js` — do not modify server endpoints; use them as-is

## Acceptance test

1. `node --check src/agent-resolver.js src/element.js` passes.
2. `npx vite build` — note result (the web-component bundle should still build).
3. Manual test — write a tiny ad-hoc HTML page (do not commit it) that loads `<agent-three.ws-id="REAL_AGENT_ID">` against a local or deployed backend and confirm:
    - Avatar GLB loads in the stage
    - Agent name appears in the chrome
    - Console shows no unhandled errors
4. Edge case: `<agent-three.ws-id="does-not-exist">` — confirm it dispatches the manifest-error event without throwing uncaught.

## Reporting

Report:

- `src/agent-resolver.js` line count and exported symbols
- Exact diff summary for `src/element.js` (which methods touched)
- The one-line diff for `public/agent/index.html`
- `node --check` / `vite build` results
- Whether manual smoke test passed, or why it couldn't be run
- Any unrelated bugs noticed in `src/element.js` (there may be dead code; don't fix, just note)
