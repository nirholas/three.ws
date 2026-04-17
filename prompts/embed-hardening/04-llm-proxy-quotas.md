# Task 04 — We-pay LLM proxy with per-agent quotas and rate limits

## Why this exists — the flood-day risk

Right now, [src/runtime/providers.js:30](../../src/runtime/providers.js#L30) defaults its LLM calls to `https://api.anthropic.com/v1/messages` with no key when none is configured. That means:

- If someone drops `<script src="/agent-3d/1.5.1/agent-3d.js"></script><agent-3d src="agent://base/42">` on any third-party site today, the brain call goes straight to Anthropic with no credentials → fails silently, the agent appears broken.
- Any owner who injects a real API key via `api-key="sk-..."` exposes that key to every viewer of the page. The spec already warns against this.
- The only safe path today — setting `key-proxy="https://owner.example/llm"` — requires every owner to run their own backend. That's not going to happen.

This prompt builds the **we-pay** fallback: a single backend proxy at `/api/llm/anthropic` that authenticates the caller as a specific agent, enforces per-agent monthly quota + per-IP rate limit, proxies to Anthropic using a platform-owned key, and tracks usage. It's the piece that makes the one-line embed actually work on a third-party site **without** bankrupting us.

See [00-README.md](00-README.md) for how this fits with the other prompts in the band.

## What you're building

1. **New endpoint:** `api/llm/anthropic.js` — `POST` only, accepts an agent id + an Anthropic messages request body, applies quota + rate limit, proxies to Anthropic, records usage, returns the Anthropic response.
2. **New rate-limit preset:** `limits.embedLlmAgent` + `limits.embedLlmIp` in [api/\_lib/rate-limit.js](../../api/_lib/rate-limit.js).
3. **Vercel rewrite:** `/api/llm/anthropic` → `/api/llm/anthropic.js` in [vercel.json](../../vercel.json).
4. **Client wiring:** [src/runtime/providers.js](../../src/runtime/providers.js) defaults `proxyURL` to `<apiOrigin>/api/llm/anthropic?agent=<agentId>` when neither `apiKey` nor `proxyURL` is configured, and unconditionally when `policy.brain.mode === 'we-pay'`.
5. **Owner-facing usage view:** `public/dashboard/usage.html` — read-only page showing per-agent monthly call count against quota, from `usage_events`.
6. **Idempotent ALTER** for any new columns needed (none strictly required if you use `usage_events.meta` for quota accounting; see below).

## The flow

```
<agent-3d> on acme.com
    │
    │  POST /api/llm/anthropic?agent=<id>
    │  body: { system, messages, tools, model }
    ▼
api/llm/anthropic.js
    ├─ read embed_policy → require policy.brain.mode === 'we-pay'
    ├─ enforce surfaces.script + origins (Referer / Origin) — fail-closed
    ├─ per-agent monthly quota check (Upstash counter keyed by agentId + YYYY-MM)
    ├─ per-IP rate limit (limits.embedLlmIp)
    ├─ per-agent rate limit (limits.embedLlmAgent, from policy.brain.rate_limit_per_min)
    ├─ forward to api.anthropic.com with ANTHROPIC_API_KEY from env
    ├─ recordEvent({ kind: 'llm', tool: 'anthropic.messages', agentId, bytes, latencyMs })
    └─ return Anthropic response JSON
```

## Read first (in this order)

1. [00-README.md](00-README.md).
2. [src/runtime/providers.js](../../src/runtime/providers.js) — see how `AnthropicProvider.complete()` constructs the request. This is the caller.
3. [api/\_lib/rate-limit.js](../../api/_lib/rate-limit.js) — how `limits.*` are declared; add new preset here following the existing pattern.
4. [api/\_lib/usage.js](../../api/_lib/usage.js) — `recordEvent()` for per-call logging.
5. [api/\_lib/embed-policy.js](../../api/_lib/embed-policy.js) — **if it exists** (prompt 02). Otherwise inline the reader using the same fallback as prompt 03 (see "Independence fallbacks" below).
6. [api/\_lib/http.js](../../api/_lib/http.js), [api/\_lib/db.js](../../api/_lib/db.js), [api/\_lib/env.js](../../api/_lib/env.js).
7. [api/CLAUDE.md](../../api/CLAUDE.md) — endpoint conventions (copy the template).
8. [vercel.json](../../vercel.json) — for the rewrite. Add **inside** the routes array; order matters.
9. An existing endpoint for reference, e.g. [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js), for the idiomatic shape.

## What to change

### 1. Create `api/llm/anthropic.js`

Core shape — copy the endpoint template from [api/CLAUDE.md](../../api/CLAUDE.md) and specialize:

```js
import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { env } from '../_lib/env.js';
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { recordEvent } from '../_lib/usage.js';
import { readEmbedPolicy } from '../_lib/embed-policy.js'; // or inline fallback — see below

const bodySchema = z.object({
	system: z.string().max(64_000).optional(),
	messages: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: z.union([z.string(), z.array(z.any())]), // Anthropic blocks; pass through
			}),
		)
		.min(1)
		.max(200),
	tools: z.array(z.any()).max(64).optional(),
	model: z.string().max(100).optional(),
	max_tokens: z.number().int().positive().max(16_000).optional(),
	temperature: z.number().min(0).max(2).optional(),
	thinking: z.any().optional(),
});

const MODEL_ALLOWLIST = new Set([
	'claude-opus-4-6',
	'claude-opus-4-7',
	'claude-sonnet-4-6',
	'claude-haiku-4-5-20251001',
]);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agent');
	if (!agentId) return error(res, 400, 'validation_error', 'agent query param required');

	// 1. Policy check
	const policy = await readEmbedPolicy(agentId);
	if (!policy) return error(res, 404, 'not_found', 'agent not found');
	if (policy.brain?.mode !== 'we-pay') {
		return error(
			res,
			402,
			'payment_required',
			`brain.mode is "${policy.brain?.mode}"; caller must supply its own key or proxy`,
		);
	}
	if (policy.surfaces?.script === false) {
		// LLM proxy is only meant to power the script surface; iframe/widget have their own runtimes
		return error(res, 403, 'embed_denied_surface', 'script surface disabled for this agent');
	}

	// 2. Origin / referer check (fail-closed for third-party origins not in allowlist)
	const origin = req.headers.origin || req.headers.referer || '';
	if (!originAllowed(origin, policy)) {
		return error(
			res,
			403,
			'embed_denied_origin',
			"origin not permitted by this agent's embed policy",
		);
	}

	// 3. Per-IP rate limit
	const ipRl = await limits.embedLlmIp(clientIp(req));
	if (!ipRl.success) return error(res, 429, 'rate_limited', 'too many requests from this IP');

	// 4. Per-agent rate limit
	const perMin = policy.brain?.rate_limit_per_min;
	if (perMin && perMin > 0) {
		const agentRl = await limits.embedLlmAgent(agentId, perMin);
		if (!agentRl.success) return error(res, 429, 'rate_limited', 'agent rate limit exceeded');
	}

	// 5. Monthly quota check (Upstash counter)
	const quota = policy.brain?.monthly_quota;
	if (quota !== null && typeof quota === 'number') {
		const used = await incrementMonthlyQuota(agentId, quota);
		if (used > quota) {
			return error(res, 429, 'quota_exceeded', `monthly quota of ${quota} reached`);
		}
	}

	// 6. Validate + normalize body
	const body = parse(bodySchema, await readJson(req));
	const model = body.model || policy.brain?.model || 'claude-opus-4-6';
	if (!MODEL_ALLOWLIST.has(model)) {
		return error(res, 400, 'validation_error', `model "${model}" not allowed`);
	}

	// 7. Forward to Anthropic
	const t0 = Date.now();
	const upstream = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'anthropic-version': '2023-06-01',
			'x-api-key': env.ANTHROPIC_API_KEY,
		},
		body: JSON.stringify({ ...body, model }),
	});
	const upstreamText = await upstream.text();
	const latencyMs = Date.now() - t0;

	// 8. Record usage (fire-and-forget)
	recordEvent({
		kind: 'llm',
		tool: 'anthropic.messages',
		agentId,
		bytes: upstreamText.length,
		latencyMs,
		status: upstream.ok ? 'ok' : 'error',
		meta: { model, ip_hash: null /* fill if your privacy policy needs this */ },
	});

	// 9. Proxy the response faithfully
	res.statusCode = upstream.status;
	res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
	return res.end(upstreamText);
});
```

Add the `originAllowed` and `incrementMonthlyQuota` helpers inside the file (or next to `readEmbedPolicy` if you're inlining). `incrementMonthlyQuota` uses Upstash `redis.incr` with a key like `llm:quota:${agentId}:${yyyy}-${mm}` and `EXPIRE` of 40 days on first set; return the new count.

**Env:** `ANTHROPIC_API_KEY` must be added to the env schema in [api/\_lib/env.js](../../api/_lib/env.js). If it's already there, use it; if not, add it. Document in [.env.example](../../.env.example) — one line.

### 2. Add rate-limit presets

Edit [api/\_lib/rate-limit.js](../../api/_lib/rate-limit.js). Add:

```js
limits.embedLlmIp    = /* 60 / 1 min per IP */;
limits.embedLlmAgent = (agentId, perMin) => /* perMin / 1 min per agent, dynamic bucket */;
```

Match the surrounding pattern exactly (the file likely uses `Ratelimit.slidingWindow` from `@upstash/ratelimit`). If `perMin` is variable per agent, you'll need a factory that memoizes limiters by `perMin` value — keep this small and readable.

### 3. Vercel rewrite

Edit [vercel.json](../../vercel.json). Inside the routes array, **before** the generic `/api/(.*) → /api/$1` line, add:

```json
{ "src": "/api/llm/anthropic", "dest": "/api/llm/anthropic.js" },
```

### 4. Client wiring in `src/runtime/providers.js`

Edit [src/runtime/providers.js](../../src/runtime/providers.js). Extend the `AnthropicProvider` constructor so:

- If `proxyURL` is explicitly set, use it (today's behaviour).
- Else if `apiKey` is set (dev mode), call Anthropic directly (today's behaviour).
- Else, fall back to `${apiOrigin}/api/llm/anthropic?agent=${agentId}` — where `apiOrigin` is the origin from which the `<agent-3d>` bundle was served (derive from `import.meta.url`), and `agentId` is a new constructor field.

The element ([src/element.js](../../src/element.js)) must pass `agentId` and `apiOrigin` in when it constructs the provider. Find the instantiation site and thread them through. Do **not** change the element's connect/disconnect lifecycle beyond that — prompt 03 owns the element's policy gate.

### 5. Usage dashboard — read-only view

Create `public/dashboard/usage.html`. It's a small static HTML page with an inline script that:

- Reads `?id=<agentId>` from the URL.
- Calls `GET /api/agents/:id/embed-policy` (session-auth) to get `brain.monthly_quota`.
- Calls a new `GET /api/agents/:id/usage` endpoint that returns the current month's LLM call count and a 30-day daily breakdown — **create this endpoint in `api/agents/[id]/usage.js`** with owner-only auth (`getSessionUser`) and a simple `SELECT COUNT(*) ... WHERE kind='llm' AND agent_id = ... AND created_at >= date_trunc('month', now())`. (`agent_id` may not be a column on `usage_events`; if it isn't, read the event's `meta->>'agent_id'` or add a column — see note below.)
- Renders: quota used / quota total, a simple bar, and a tiny last-30-days sparkline (text-only is fine; no chart library).

**If `usage_events` has no `agent_id` column**, either (a) add an idempotent ALTER `alter table usage_events add column if not exists agent_id uuid references agent_identities(id)` at the bottom of [api/\_lib/schema.sql](../../api/_lib/schema.sql) and extend `recordEvent` to accept it, **or** (b) store `agentId` in `meta` as `{ agent_id: agentId }` and query via `meta->>'agent_id'`. Pick (a) if the column doesn't exist; it's cleaner and lets us index.

Wire the route in [vercel.json](../../vercel.json):

```json
{ "src": "/api/agents/([^/]+)/usage", "dest": "/api/agents/[id]/usage?id=$1" },
{ "src": "/dashboard/usage",          "dest": "/public/dashboard/usage.html" },
```

## Independence fallbacks

If [api/\_lib/embed-policy.js](../../api/_lib/embed-policy.js) does not exist when you start, inline a minimal `readEmbedPolicy` (same as in prompt 03's "Independence fallbacks" section). Import-switch to the helper in a follow-up if / when prompt 02 ships.

If [api/\_lib/schema.sql](../../api/_lib/schema.sql) doesn't yet have `embed_policy`, the inlined reader must catch `column does not exist` and return `null` → the endpoint then returns 404, which is correct (we can't enforce policy → deny).

## Files you own (create / edit)

- Create: `api/llm/anthropic.js`
- Create: `api/agents/[id]/usage.js`
- Create: `public/dashboard/usage.html`
- Edit: [api/\_lib/rate-limit.js](../../api/_lib/rate-limit.js) — add presets
- Edit: [src/runtime/providers.js](../../src/runtime/providers.js) — add `proxyURL` fallback
- Edit: [src/element.js](../../src/element.js) — thread `agentId` + `apiOrigin` to provider construction **only** (do not touch the element's policy gate — that's prompt 03's territory; if both prompts edit this file, merge both edits)
- Edit: [vercel.json](../../vercel.json) — two route adds
- Edit: [api/\_lib/env.js](../../api/_lib/env.js) — add `ANTHROPIC_API_KEY` if missing
- Edit: [.env.example](../../.env.example) — document `ANTHROPIC_API_KEY`
- Edit (optional): [api/\_lib/schema.sql](../../api/_lib/schema.sql) — append `usage_events.agent_id` ALTER if you pick option (a)
- Edit (if option a): [api/\_lib/usage.js](../../api/_lib/usage.js) — accept `agentId` field and insert into the new column

## Files off-limits (other prompts edit these)

- [api/\_lib/embed-policy.js](../../api/_lib/embed-policy.js) — prompt 02 (read-only for you)
- [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) — prompt 02
- [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html) — prompt 02
- [agent-embed.html](../../agent-embed.html) — prompt 03
- [api/widgets/page.js](../../api/widgets/page.js) — prompt 03
- [api/mcp.js](../../api/mcp.js) — prompt 03
- `avatars` table schema + anything under `public/dashboard/storage*.html` — prompt 05

## Idempotency / parallel-safety notes

- The monthly quota counter lives in Upstash — there's no DB migration risk. If the bucket doesn't exist, `INCR` creates it.
- The optional `usage_events.agent_id` ALTER is idempotent (`IF NOT EXISTS`). Keep it additive.
- If prompt 03 ships first and already touches `src/element.js`, merge both edits: prompt 03 adds the policy gate in `connectedCallback`, you thread `agentId`/`apiOrigin` into the provider construction elsewhere in the file. These should touch different lines.
- The `ANTHROPIC_API_KEY` must not land in any client bundle — double-check that nothing in `src/` imports from `api/_lib/env.js` directly.

## Acceptance test

1. `node --check api/llm/anthropic.js api/agents/[id]/usage.js api/_lib/rate-limit.js src/runtime/providers.js src/element.js` passes.
2. `npx prettier --write` over edited files; commit clean.
3. `npx vite build` and `npm run build:lib` both pass.
4. `node scripts/apply-schema.mjs` (if you did option a) runs twice without error.
5. Manual — with `ANTHROPIC_API_KEY` set in `.env.local`:
    - `curl -X POST "http://localhost:3000/api/llm/anthropic?agent=<we-pay-agent-id>" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'` → 200 with an Anthropic response shape, `usage_events` row written.
    - Same call with an agent whose `brain.mode !== 'we-pay'` → 402 `payment_required`.
    - Same call 21+ times in a minute (with `rate_limit_per_min: 20`) → 429 `rate_limited`.
    - Set `monthly_quota: 2` on a test agent, make 3 calls → third returns 429 `quota_exceeded`.
    - Call with `Origin: https://evil.com` header and an allowlist that doesn't include it → 403 `embed_denied_origin`.
6. Drop the `<agent-3d>` script on a local test page (a standalone HTML file with `<script src="http://localhost:3000/agent-3d/<version>/agent-3d.js">` and `<agent-3d src="agent://...">`) — confirm the network tab shows requests going to `/api/llm/anthropic?agent=...`, **not** to `api.anthropic.com`.
7. Visit `/dashboard/usage?id=<your-agent>` in the browser (signed in) — confirm the current month's count matches what you'd expect from the manual curls above.

## Reporting

- Files created / edited with line counts.
- Whether `api/_lib/embed-policy.js` existed; if not, where you inlined the fallback.
- Whether you took option (a) or (b) for agent-id tracking in `usage_events`.
- `node --check`, prettier, vite build, build:lib outputs.
- The seven manual cases above with pass/fail and copied response bodies for the 4xx paths.
- Confirmation no client bundle imports `ANTHROPIC_API_KEY`.
- Off-limits files not touched.
- Unrelated bugs noticed.
