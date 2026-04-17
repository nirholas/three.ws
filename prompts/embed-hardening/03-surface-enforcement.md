# Task 03 — Make every embed surface read the per-agent policy

## Why this exists

Today, only one of the four agent-rendering surfaces actually checks the per-agent `embed_policy`:

| Surface                 | Where                                                                                             | Checks policy today?                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `<agent-3d>` script tag | [src/element.js](../../src/element.js) (registered as `<agent-3d>`) — runs in the host page's DOM | **No**                                                  |
| Sandboxed iframe        | [agent-embed.html](../../agent-embed.html) → `/agent/:id/embed`                                   | Yes — origin allowlist via referrer / `ancestorOrigins` |
| Saved widget            | [api/widgets/page.js](../../api/widgets/page.js) → `/w/:id`                                       | **No** (uses a separate `is_public` flag)               |
| MCP tool                | [api/mcp.js](../../api/mcp.js)                                                                    | **No** — bearer-token gated only                        |

This prompt closes the gap. After it lands, all four surfaces consult the same `embed_policy` JSONB and **fail-closed** when the policy denies the surface or the calling origin.

See [00-README.md](00-README.md) for the band-level design.

## What you're building

Four surface checks plus one CSP header, each independent:

1. **`<agent-3d>` script tag** — at element-connect time, read the policy via the public API helper, refuse to mount (and emit `agent:error`) if `surfaces.script === false` OR if the host origin isn't allowed by `origins`.
2. **Iframe page** — extend [agent-embed.html](../../agent-embed.html) to also gate on `surfaces.iframe`.
3. **Widget page** — at [api/widgets/page.js](../../api/widgets/page.js), look up the widget's avatar→agent (best-effort; widgets aren't always tied to an agent identity, see notes), and if there is one, gate on `surfaces.widget` and `origins`.
4. **MCP** — at [api/mcp.js](../../api/mcp.js), inside any tool that returns or invokes a specific agent (`render_avatar`, future agent-specific tools), gate on `surfaces.mcp`.
5. **CSP `frame-ancestors`** — set on every response from [agent-embed.html](../../agent-embed.html) so browsers enforce the origin allowlist _in addition to_ the JS check.

## The shape you're checking against

This is the contract from [02-extended-policy.md](02-extended-policy.md):

```jsonc
{
  "version": 1,
  "origins":  { "mode": "allowlist|denylist", "hosts": ["example.com", "*.foo.com"] },
  "surfaces": { "script": bool, "iframe": bool, "widget": bool, "mcp": bool },
  "brain":    { ... },   // ignored here
  "storage":  { ... }    // ignored here
}
```

If `embed_policy` is null in the DB, treat it as **all surfaces allowed, all origins allowed** (legacy behaviour — first-party is always allowed regardless).

## Read first (in this order)

1. [00-README.md](00-README.md).
2. [api/\_lib/embed-policy.js](../../api/_lib/embed-policy.js) — **if it exists** (created by prompt 02). If it doesn't exist, you'll inline a minimal local version (see "Independence fallbacks" below).
3. [src/element.js](../../src/element.js) — focus on `connectedCallback()` and wherever the agent identity is resolved (search for `resolveAgentById` / `loadManifest`).
4. [agent-embed.html](../../agent-embed.html) — focus on lines 49–88 where the existing referrer / `ancestorOrigins` policy check lives.
5. [api/widgets/page.js](../../api/widgets/page.js) — see how `loadWidget` resolves the widget; check whether the widget row references an `agent_id` or just an `avatar_id`.
6. [api/mcp.js](../../api/mcp.js) — find the `render_avatar` tool and any other tool that takes an agent ID.
7. [api/\_lib/http.js](../../api/_lib/http.js) — for setting headers + writing responses.

## Origin matching

Implement once, in a small helper next to wherever you do the check (or in `api/_lib/embed-policy.js` if you create new exports — but only if you're certain prompt 02 has shipped; otherwise inline). Spec:

- Hosts are case-insensitive ASCII.
- Exact match: `example.com` matches `example.com` only.
- Wildcard prefix: `*.foo.com` matches `bar.foo.com` and `baz.bar.foo.com`, but **not** `foo.com` itself.
- The agent's own origin (`env.APP_ORIGIN`, plus `3dagent.vercel.app` and `localhost`-with-any-port for dev) is always allowed regardless of `origins.hosts`.
- An empty `origins.hosts` with `mode === 'allowlist'` means **first-party only** — third-party origins are denied.

```js
export function originAllowed(originUrl, policy, firstParty = []) {
	if (!originUrl) return false;
	let host;
	try {
		host = new URL(originUrl).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (firstParty.includes(host)) return true;
	const matches = policy.origins.hosts.some((h) => {
		const lower = h.toLowerCase();
		if (lower.startsWith('*.')) return host.endsWith(lower.slice(1)) && host !== lower.slice(2);
		return host === lower;
	});
	return policy.origins.mode === 'allowlist' ? matches : !matches;
}
```

## What to change

### 1. `<agent-3d>` element — refuse to mount when denied

Edit [src/element.js](../../src/element.js). After the agent identity is resolved (you'll find a path that calls `resolveAgentById` or similar), and **before** the viewer / runtime mount, fetch the policy:

```js
// Public read — no auth required.
const res = await fetch(`${apiOrigin}/api/agents/${agentId}/embed-policy`, { credentials: 'omit' });
if (res.ok) {
	const { policy } = await res.json();
	if (policy) {
		const hostOrigin = window.location.origin; // origin of the page the script is dropped into
		if (!policy.surfaces?.script) {
			this._fail('embed_denied_surface', 'This agent disallows the script-tag embed.');
			return;
		}
		const firstParty = ['3dagent.vercel.app', 'localhost'];
		if (
			!originAllowed(hostOrigin, policy, firstParty) &&
			!hostOrigin.startsWith('http://localhost')
		) {
			this._fail('embed_denied_origin', `This agent isn't permitted on ${hostOrigin}.`);
			return;
		}
	}
}
```

`apiOrigin` should be the origin from which the script itself was loaded — derive from `import.meta.url` (you'll see this pattern elsewhere in the bundle) so cross-origin embeds query the right backend, not the host page's origin.

`this._fail(code, message)` is a small helper you should add to the element: it dispatches `new CustomEvent('agent:error', { detail: { phase: 'policy', error: { code, message } }, bubbles: true, composed: true })` and renders a graceful in-element error state instead of throwing. Match the pattern of any existing error rendering in the file.

If the policy fetch itself fails (network / 404 / 500), **fail open** — log a warning, continue mounting. The proxy / quota guards in prompt 04 are the real spend protection; this surface check is a soft policy.

### 2. Iframe page — also check `surfaces.iframe`

In [agent-embed.html](../../agent-embed.html), after the existing origin check (around line 88), add:

```js
// surfaces.iframe gate — fail-closed
if (policy && policy.surfaces && policy.surfaces.iframe === false) {
	showError("This agent's iframe embed is disabled.");
	return;
}
```

The existing origin check already handles `origins`. Don't duplicate it. Make sure your gate runs **after** the origin check so the user sees the more specific error first.

### 3. Widget page — gate on `surfaces.widget` + origins

Edit [api/widgets/page.js](../../api/widgets/page.js). After `loadWidget(widgetId)` succeeds:

- If the widget row has an `agent_id`, fetch the policy via `readEmbedPolicy(agent_id)` (or inline SELECT — see fallback). If the agent isn't found, fall through to existing behaviour.
- If `policy.surfaces.widget === false`, return a 403-style HTML page (use the same `notFound(res)` style the file already has, but with status 403 and message "This widget's embed is disabled by the agent owner.").
- If the request's `Referer` header is set and `originAllowed(referer, policy, [APP_ORIGIN_HOST])` is false, do the same.

If the widget row has **no** `agent_id` (widget tied to a bare avatar), skip the agent-policy check — the widget's own `is_public` flag is the existing gate.

### 4. MCP — gate `render_avatar` on `surfaces.mcp`

Edit [api/mcp.js](../../api/mcp.js). Inside the `render_avatar` tool handler (and any other tool that takes an agent ID), after argument validation:

```js
import { readEmbedPolicy } from './_lib/embed-policy.js';
// ...
const policy = await readEmbedPolicy(agentId);
if (policy && policy.surfaces?.mcp === false) {
	return mcpError(-32000, 'embed_denied_surface', 'This agent disallows the MCP surface.');
}
```

Use the file's existing error helper / response shape — don't invent a new one.

### 5. CSP `frame-ancestors` on the iframe response

In [agent-embed.html](../../agent-embed.html) the page is static HTML. To set CSP, you have two options — pick **one**:

**Option A (preferred):** Add a `<meta http-equiv="Content-Security-Policy" content="frame-ancestors 'self' https://3dagent.vercel.app ...">` tag inside `<head>`. The hosts list must reflect the policy. Build this `<meta>` element dynamically in the existing inline script after the policy fetch, so the allowlist is per-agent.

**Option B (fallback):** Add a header in [vercel.json](../../vercel.json) for `/agent-embed.html` and `/agent/*/embed`. This is global, not per-agent, so use only if you can't set the meta dynamically.

Go with Option A. Build the meta tag's content from `policy.origins.hosts` (translating wildcards to CSP form: `*.foo.com` → `https://*.foo.com`), always include `'self'` and `https://3dagent.vercel.app`. Insert before the first `<script>` tag in `<head>`.

## Independence fallbacks

If [api/\_lib/embed-policy.js](../../api/_lib/embed-policy.js) does **not** exist when you start (prompt 02 hasn't shipped), inline a minimal local copy in each file that needs it:

```js
async function readEmbedPolicyInline(agentId, sql) {
	try {
		const [row] =
			await sql`SELECT embed_policy FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
		if (!row) return null;
		const p = row.embed_policy;
		if (!p) return defaultEmbedPolicyInline();
		if (!('version' in p) && 'mode' in p && 'hosts' in p) {
			return {
				...defaultEmbedPolicyInline(),
				origins: { mode: p.mode, hosts: p.hosts ?? [] },
			};
		}
		return { ...defaultEmbedPolicyInline(), ...p };
	} catch (err) {
		// embed_policy column may not exist yet
		if (/column .* does not exist/i.test(String(err?.message))) return null;
		throw err;
	}
}
function defaultEmbedPolicyInline() {
	return {
		version: 1,
		origins: { mode: 'allowlist', hosts: [] },
		surfaces: { script: true, iframe: true, widget: true, mcp: false },
		brain: {
			mode: 'we-pay',
			proxy_url: null,
			monthly_quota: 1000,
			rate_limit_per_min: 10,
			model: 'claude-opus-4-6',
		},
		storage: { primary: 'r2', pinned_ipfs: false, onchain_attested: false },
	};
}
```

For the `<agent-3d>` element, the inline fallback uses `fetch('/api/agents/:id/embed-policy')` instead of SQL — same logic, and the GET endpoint already exists today.

If the helper file appears later, the file's owner (prompt 02) is responsible for switching imports — leave the inline version in place; do not edit other prompts' files.

## Files you own (create / edit)

- Edit: [src/element.js](../../src/element.js) — add policy fetch + gate + `_fail` helper.
- Edit: [agent-embed.html](../../agent-embed.html) — add `surfaces.iframe` gate + dynamic CSP meta tag.
- Edit: [api/widgets/page.js](../../api/widgets/page.js) — add agent-policy gate when widget→agent is resolvable.
- Edit: [api/mcp.js](../../api/mcp.js) — add `surfaces.mcp` gate inside agent-touching tools.

## Files off-limits (other prompts edit these)

- [api/\_lib/embed-policy.js](../../api/_lib/embed-policy.js) — owned by prompt 02. You may **read** from it; do not write to it.
- [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) — owned by prompt 02.
- [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html) — owned by prompt 02.
- [api/\_lib/schema.sql](../../api/_lib/schema.sql) — owned by prompts 01, 02, 05. Do not edit.
- [src/runtime/providers.js](../../src/runtime/providers.js) — owned by prompt 04.
- Anything in `api/llm/` — owned by prompt 04.
- The `avatars` schema and any new `storage_mode` column — owned by prompt 05.

## Idempotency / parallel-safety notes

- All four surface checks are **read-only** against `embed_policy`. They do not write.
- Each gate fails closed on the **policy** (deny surface, deny origin) but fails open on **infrastructure** (network error, missing column, missing helper). This avoids self-DOS during partial deploys.
- The CSP meta tag is per-agent — re-building it on each load is fine; no caching to invalidate.
- Inlining the policy reader is OK in this prompt; do **not** export the inlined version, to avoid colliding with prompt 02's `api/_lib/embed-policy.js`.

## Acceptance test

1. `node --check src/element.js api/widgets/page.js api/mcp.js` passes.
2. `npx prettier --write` over all four edited files; commit clean.
3. `npx vite build` passes.
4. Manual test (with a local dev server + a signed-in agent owner):
    - **Origin allowlist on script:** Set `policy.origins = { mode: 'allowlist', hosts: ['example.com'] }` and `surfaces.script = true`. Drop the script tag on `localhost` (allowed: dev) → mounts. Drop on a different origin via a tiny test page → element renders error, dispatches `agent:error` with `code: 'embed_denied_origin'`.
    - **Surface deny on script:** Set `surfaces.script = false`. Reload the host page → element renders error, `code: 'embed_denied_surface'`.
    - **Iframe surface deny:** Set `surfaces.iframe = false`. `/agent/:id/embed` shows the iframe-disabled error.
    - **Widget surface deny:** Set `surfaces.widget = false` and visit a widget that's tied to that agent → 403 page.
    - **CSP frame-ancestors:** With a non-empty allowlist, view-source on `/agent/:id/embed` and confirm a `<meta http-equiv="Content-Security-Policy" content="frame-ancestors 'self' https://3dagent.vercel.app https://example.com">` is present.
    - **MCP:** Call the `render_avatar` MCP tool with an agent whose `surfaces.mcp = false` → returns the embed_denied_surface error.

If you can't run a particular surface (e.g. no MCP client handy), say so — do not skip it silently.

## Reporting

- Files changed with line counts.
- Whether `api/_lib/embed-policy.js` existed at start; if not, where you inlined the fallback.
- `node --check`, prettier, vite build outputs.
- Each manual test case result (pass / fail / not-run-because-X).
- Off-limits confirmation.
- Unrelated bugs noticed.
