# Task 02 — Extended embed-policy JSONB shape, helper, API, and dashboard UI

## Why this exists

Today the per-agent `embed_policy` JSONB column on `agent_identities` only holds `{ mode: 'allowlist'|'denylist', hosts: [...] }` — an origin allowlist for the iframe page. We're extending it to a single configuration object that controls **three** axes: which **origins** can embed, which **render surfaces** are allowed (script tag / iframe / widget / MCP), and how the embedded agent's **brain** calls are paid for and rate-limited.

Other prompts (03 surface enforcement, 04 LLM proxy) consume the new keys. This prompt is the source-of-truth for the shape, the helper, the API, and the owner-facing UI.

See [00-README.md](00-README.md) for the full design and how this prompt fits with the other four.

## What you're building

Four deliverables:

1. **Helper:** `api/_lib/embed-policy.js` — `defaultEmbedPolicy()`, `readEmbedPolicy(agentId)`, `validateEmbedPolicy(input)`, `normalizeLegacyPolicy(input)`.
2. **API:** Extend [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) GET to return the normalized extended shape (legacy rows auto-migrate on read), PUT to accept the extended shape with backwards-compat for legacy `{ mode, hosts }` payloads.
3. **UI:** Extend [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html) with three new `<fieldset>` sections (surfaces, brain, storage) wired to the same PUT endpoint.
4. **Idempotent ALTER** at the bottom of [api/\_lib/schema.sql](../../api/_lib/schema.sql) so this prompt can run before prompt 01.

## The extended shape

```jsonc
{
  "version": 1,
  "origins": {
    "mode": "allowlist" | "denylist",   // default: "allowlist" with empty hosts = "deny all third-party origins"
    "hosts": ["example.com", "*.substack.com"]
  },
  "surfaces": {
    "script":  true,   // <agent-3d> on a third-party page
    "iframe":  true,   // <iframe src="/agent/:id/embed">
    "widget":  true,   // /w/:id widget pages
    "mcp":     false   // exposed as an MCP tool over /api/mcp
  },
  "brain": {
    "mode":               "we-pay" | "key-proxy" | "wallet-gated" | "none",
    "proxy_url":          null,           // required iff mode === "key-proxy"
    "monthly_quota":      10000,          // null = unlimited; whole-number completions
    "rate_limit_per_min": 20,             // null = unlimited
    "model":              "claude-opus-4-6"
  },
  "storage": {
    "primary":          "r2" | "ipfs",
    "pinned_ipfs":      false,
    "onchain_attested": false
  }
}
```

### Defaults (`defaultEmbedPolicy()`)

```js
{
  version: 1,
  origins:  { mode: 'allowlist', hosts: [] },
  surfaces: { script: true, iframe: true, widget: true, mcp: false },
  brain:    { mode: 'we-pay', proxy_url: null, monthly_quota: 1000, rate_limit_per_min: 10, model: 'claude-opus-4-6' },
  storage:  { primary: 'r2', pinned_ipfs: false, onchain_attested: false }
}
```

Note: an empty allowlist would lock the agent out of every site. Treat `origins.mode === 'allowlist' && origins.hosts.length === 0` as **"first-party only"** — i.e. `three.ws` and any value of `env.APP_ORIGIN` are always allowed regardless of the list.

### Backwards-compat (`normalizeLegacyPolicy(input)`)

If the row's stored value matches the legacy shape `{ mode: 'allowlist'|'denylist', hosts: [] }` (no `version` key, no `origins` key), wrap it as `{ ...defaultEmbedPolicy(), origins: input }` and return. If `input` is `null`, return `defaultEmbedPolicy()`. If `input` already has `version: 1`, return it merged on top of defaults so missing keys fill in.

## Read first (in this order)

1. [00-README.md](00-README.md) — the band-level design.
2. [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) — full file, 75 lines. The shape you're extending.
3. [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html) — full file. The UI you're extending.
4. [api/\_lib/http.js](../../api/_lib/http.js) — for `cors`, `json`, `error`, `wrap`, `method`, `readJson` (use these — never `res.end(JSON.stringify(...))`).
5. [api/\_lib/db.js](../../api/_lib/db.js) — for `sql` tagged-template (never instantiate a Pool).
6. [api/\_lib/auth.js](../../api/_lib/auth.js) — for `getSessionUser`.
7. [api/\_lib/validate.js](../../api/_lib/validate.js) — for `parse`. Define your zod schema inline in `embed-policy.js` and re-export, since it's not a generic shape.
8. [api/CLAUDE.md](../../api/CLAUDE.md) — endpoint conventions you must follow.
9. [api/\_lib/schema.sql:235-266](../../api/_lib/schema.sql#L235-L266) — the additive-migrations block at the bottom of the `agent_identities` section.

## What to change

### 1. Create `api/_lib/embed-policy.js`

```js
// Per-agent embed policy: one JSONB column on agent_identities holding
// origins + surfaces + brain + storage config. See prompts/embed-hardening/.

import { z } from 'zod';
import { sql } from './db.js';

const hostPattern =
	/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export const POLICY_VERSION = 1;

export const policySchema = z.object({
	version: z.literal(1).optional(),
	origins: z.object({
		mode: z.enum(['allowlist', 'denylist']),
		hosts: z.array(z.string().trim().toLowerCase().min(1).max(253).regex(hostPattern)).max(100),
	}),
	surfaces: z.object({
		script: z.boolean(),
		iframe: z.boolean(),
		widget: z.boolean(),
		mcp: z.boolean(),
	}),
	brain: z
		.object({
			mode: z.enum(['we-pay', 'key-proxy', 'wallet-gated', 'none']),
			proxy_url: z.string().url().nullable(),
			monthly_quota: z.number().int().nonnegative().nullable(),
			rate_limit_per_min: z.number().int().nonnegative().nullable(),
			model: z.string().min(1).max(100),
		})
		.refine((b) => b.mode !== 'key-proxy' || !!b.proxy_url, {
			message: 'proxy_url is required when brain.mode === "key-proxy"',
			path: ['proxy_url'],
		}),
	storage: z.object({
		primary: z.enum(['r2', 'ipfs']),
		pinned_ipfs: z.boolean(),
		onchain_attested: z.boolean(),
	}),
});

export function defaultEmbedPolicy() {
	return {
		version: POLICY_VERSION,
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

export function normalizeLegacyPolicy(input) {
	if (!input) return defaultEmbedPolicy();
	const isLegacy =
		!('version' in input) && !('origins' in input) && 'mode' in input && 'hosts' in input;
	if (isLegacy) {
		const d = defaultEmbedPolicy();
		return { ...d, origins: { mode: input.mode, hosts: input.hosts ?? [] } };
	}
	const d = defaultEmbedPolicy();
	return {
		version: POLICY_VERSION,
		origins: { ...d.origins, ...(input.origins || {}) },
		surfaces: { ...d.surfaces, ...(input.surfaces || {}) },
		brain: { ...d.brain, ...(input.brain || {}) },
		storage: { ...d.storage, ...(input.storage || {}) },
	};
}

export async function readEmbedPolicy(agentId) {
	const [row] = await sql`
		SELECT embed_policy FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) return null; // agent not found
	return normalizeLegacyPolicy(row.embed_policy);
}

export function validateEmbedPolicy(input) {
	return policySchema.parse(normalizeLegacyPolicy(input));
}
```

### 2. Extend `api/agents/[id]/embed-policy.js`

Replace the existing `policySchema` import and the GET / PUT handlers so they delegate to `api/_lib/embed-policy.js`. Keep the file's overall shape (still uses `wrap`, `cors`, `json`, `error`, `method`).

- **GET:** call `readEmbedPolicy(id)`. If null, return 404. Otherwise return `{ policy }` (always the normalized extended shape).
- **PUT:** read the JSON body, run through `validateEmbedPolicy(body)` (which auto-normalizes legacy payloads), then `UPDATE ... SET embed_policy = ${JSON.stringify(normalized)}::jsonb`. Return `{ policy: normalized }`.
- **DELETE:** unchanged — still nulls the column.

Keep the auth + ownership check exactly as it is today.

### 3. Extend `public/dashboard/embed-policy.html`

Add three new `<fieldset>` blocks below the existing origin allowlist UI: **Surfaces**, **Brain**, **Storage**. Wire them into the same form submission. Specifically:

- **Surfaces** — four checkboxes (script / iframe / widget / mcp), each labelled with a short description.
- **Brain** — a `<select>` for `mode` (we-pay / key-proxy / wallet-gated / none), an `<input type="url">` for `proxy_url` (shown only when `mode === "key-proxy"`), `<input type="number">` for `monthly_quota` and `rate_limit_per_min` (allow blank → null), `<input>` for `model` (default `claude-opus-4-6`).
- **Storage** — a `<select>` for `primary` (r2 / ipfs), checkboxes for `pinned_ipfs` and `onchain_attested` (read-only display for now — future prompts handle the actual pin / attestation flow).

The existing form's `submit` handler must:

1. Build the full extended-policy object from all four fieldsets.
2. PUT to `/api/agents/:id/embed-policy` with `credentials: 'include'`.
3. On success, repopulate the form from the response (so the user sees what was actually stored).
4. On 400 validation error, surface `error_description` to the user.

Keep the page's existing styling. Match indentation. Do not introduce any new CSS framework or build tooling.

### 4. Append the schema migration (idempotent)

At the end of the additive-migrations block in [api/\_lib/schema.sql:266](../../api/_lib/schema.sql#L266), add **one** line if it isn't already there:

```sql
alter table agent_identities add column if not exists embed_policy    jsonb;
```

If prompt 01 has already shipped this line, leave it; do not duplicate.

## Files you own (create / edit)

- Create: `api/_lib/embed-policy.js`
- Edit: [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js)
- Edit: [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html)
- Edit: [api/\_lib/schema.sql](../../api/_lib/schema.sql) — append one ALTER if missing

## Files off-limits (other prompts edit these)

- Anything in [src/](../../src/) — surface enforcement (prompt 03)
- Any new `api/llm/*` files — LLM proxy (prompt 04)
- Anything in [src/runtime/](../../src/runtime/) — providers / brain wiring (prompt 04)
- The `avatars` table schema, any new `storage_mode` column — prompt 05
- [public/dashboard/storage\*.html](../../public/dashboard/) (if it appears) — prompt 05

## Idempotency / parallel-safety notes

- If prompts 03 or 04 ship before this one and inline a local copy of `defaultEmbedPolicy()` / `readEmbedPolicy()`, your `api/_lib/embed-policy.js` becomes the source of truth. Their PRs should refactor to import from your file in a follow-up; do **not** edit their files yourself.
- The legacy `{ mode, hosts }` shape must keep round-tripping: a legacy row read via `readEmbedPolicy()` returns the extended shape; a subsequent PUT of the same value persists the extended shape. Test this explicitly.
- The endpoint must be safe to call against a database where the `embed_policy` column doesn't exist yet (i.e. neither this prompt nor prompt 01 have applied). In that case the SELECT will throw — catch the specific `column does not exist` error in `readEmbedPolicy` and return `null` so the API returns the default policy on GET. (`PUT` can still throw — that's an operator error, log loudly.)

## Acceptance test

1. `node --check api/_lib/embed-policy.js api/agents/[id]/embed-policy.js` passes.
2. `npx prettier --write api/_lib/embed-policy.js api/agents/[id]/embed-policy.js public/dashboard/embed-policy.html api/_lib/schema.sql` clean.
3. `npx vite build` passes.
4. With a local dev server (`npm run dev`) and a signed-in session:
    - `GET /api/agents/<your-agent-id>/embed-policy` → 200 with extended shape, `version: 1`, defaults filled in.
    - `PUT /api/agents/<your-agent-id>/embed-policy` with the legacy body `{"mode":"allowlist","hosts":["foo.com"]}` → 200 with extended shape; `policy.origins` reflects the legacy input; other sections at defaults.
    - `PUT` again with the full extended body → 200, all keys persisted.
    - `PUT` with a bad body (e.g. `brain.mode === 'key-proxy'` but no `proxy_url`) → 400 `validation_error` with a clear field path.
    - `GET /api/agents/<random-other-agent>/embed-policy` (not yours) → 200 read still works; `PUT` to it → 403.
5. Open `/dashboard/embed-policy.html?id=<your-agent>` in a browser. All four sections render, populate from the GET, persist via PUT.

## Reporting

- **Files changed** with line counts.
- **Commands run + output:** `node --check`, `prettier`, `vite build` last lines.
- **Manual API test results:** the four PUT/GET cases above with response shape excerpts.
- **Manual UI test:** screenshot or 1-line confirmation that all four sections appear and persist.
- **Skipped:** anything you couldn't run, with reason.
- **Unrelated bugs noticed:** list, do not fix.
- **Off-limits files confirmation:** confirm none touched.
