# api/CLAUDE.md

Scoped guidance for Vercel serverless endpoints. Read [/CLAUDE.md](../CLAUDE.md) first.

---

## Shape of every endpoint

Copy this. Don't hand-roll.

```js
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { z } from 'zod';

const bodySchema = z.object({ name: z.string().trim().min(1).max(100) });

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	// Auth: session OR bearer
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	if (bearer && !hasScope(bearer.scope, 'avatars:read'))
		return error(res, 403, 'insufficient_scope', '...');
	const userId = session?.id ?? bearer.userId;

	// Rate limit
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	if (req.method === 'POST') {
		const body = parse(bodySchema, await readJson(req));
		// ... do work
	}

	const rows =
		await sql`select id, name from avatars where owner_id = ${userId} and deleted_at is null`;
	return json(res, 200, { data: rows });
});
```

Never `res.end(JSON.stringify(...))`. Never read/verify JWTs yourself. Never interpolate user input into SQL.

---

## Helpers in [\_lib/](./_lib/)

| File                                      | Exports                                                                                                                                                                        | Use for                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [\_lib/auth.js](_lib/auth.js)             | `getSessionUser`, `authenticateBearer`, `extractBearer`, `hasScope`, `createSession`, `sessionCookie`, `destroySession`, `csrfTokenFor`, `verifyCsrfToken`, `isSameSiteOrigin` | All auth. Never roll your own.                                                                 |
| [\_lib/db.js](_lib/db.js)                 | `sql`                                                                                                                                                                          | Tagged-template Postgres via `@neondatabase/serverless`. Import; don't instantiate a new Pool. |
| [\_lib/http.js](_lib/http.js)             | `cors`, `json`, `text`, `redirect`, `error`, `wrap`, `method`, `readJson`                                                                                                      | Every response. `wrap()` catches async errors → 500.                                           |
| [\_lib/validate.js](_lib/validate.js)     | `parse`, `email`, `password`, `displayName`, `slug`, `avatarVisibility`, `avatarContentType`, `registerBody`, `loginBody`, `createAvatarBody`, `presignUploadBody`             | zod wrappers. `parse()` throws `{status:400, code:'validation_error'}`.                        |
| [\_lib/rate-limit.js](_lib/rate-limit.js) | `limits.*`, `clientIp`                                                                                                                                                         | Preset Upstash limiters.                                                                       |
| [\_lib/r2.js](_lib/r2.js)                 | `presignUpload`, `presignGet`, `headObject`, `deleteObject`, `publicUrl`                                                                                                       | R2 / S3 ops.                                                                                   |
| [\_lib/env.js](_lib/env.js)               | `env`, `env.ISSUER`, `env.MCP_RESOURCE`                                                                                                                                        | Env vars. Throws if required ones missing.                                                     |
| [\_lib/avatars.js](_lib/avatars.js)       | `stripOwnerFor`, avatar URL resolution                                                                                                                                         | Hides R2 path prefixes from unauthenticated callers.                                           |

---

## Response conventions

- **Success:** `json(res, 200|201|204, { data, ... })` — no-store cache-control set for you.
- **Error:** `error(res, status, code, message, extra?)` → `{ error: code, error_description: message, ...extra }`.
- **Status codes:** 400 validation, 401 unauth, 403 forbidden, 404 not found, 409 conflict, 413 payload too large, 415 unsupported type, 429 rate-limited, 500 internal.
- **Error codes** (OAuth-style strings): `validation_error`, `unauthorized`, `forbidden`, `insufficient_scope`, `not_found`, `conflict`, `rate_limited`, `internal`.

---

## Auth modes

| Mode               | Helper                                                                                    | When                                                             |
| ------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Session cookie     | `getSessionUser(req)`                                                                     | Browser apps in [public/](../public/) — `credentials: 'include'` |
| Bearer JWT (OAuth) | `authenticateBearer(extractBearer(req))` → `{ userId, scope, source: 'oauth', clientId }` | MCP clients, third-party apps                                    |
| Bearer API key     | `authenticateBearer(...)` → `{ userId, scope, source: 'apikey', apiKeyId }`               | Server-to-server from user scripts                               |

**Scopes:** `avatars:read`, `avatars:write`, `avatars:delete`, `profile`, `offline_access`. Check via `hasScope(bearer.scope, 'avatars:write')`.

**CSRF:** Only POST endpoints that accept HTML form submissions (OAuth consent, SIWE verify) need `csrfTokenFor` / `verifyCsrfToken`. JSON APIs rely on same-origin + session cookie. Call `destroySession(req)` before `createSession()` to defend against session fixation.

---

## Tables (Neon)

**Must-ask-first before changing any of these.**

- `users` — id, email, password_hash, display_name, plan, avatar_url, deleted_at
- `sessions` — token_hash, user_id, user_agent, ip, expires_at, revoked_at
- `api_keys` — prefix, token_hash, user_id, scope, expires_at, revoked_at
- `agent_identities` — id, user_id, name, description, avatar_id, skills, meta, wallet_address, chain_id, erc8004_agent_id, deleted_at
- `agent_actions` — agent_id, type, payload, source_skill, signature, signer_address, created_at
- `agent_memories` — agent_id, type (user/feedback/project/reference), content, tags, context, salience, expires_at
- `avatars` — owner_id, slug, name, description, storage_key, thumbnail_key, size_bytes, content_type, source, source_meta, visibility (private/unlisted/public), tags, checksum_sha256, version, deleted_at
- `oauth_clients`, `oauth_auth_codes`, `oauth_refresh_tokens` — OAuth 2.1 provider state
- `siwe_nonces` — Sign-In with Ethereum challenges
- `usage_events` — user_id, api_key_id, client_id, avatar_id, kind, tool, status, bytes, latency_ms
- `plan_quotas` — plan, max_avatars, max_bytes_per_avatar, max_total_bytes
- `user_wallets` — user_id, address, chain_id, is_primary

---

## R2 upload flow

Three-step pattern — copy from [avatars/presign.js](avatars/presign.js) and [avatars/index.js](avatars/index.js):

1. Browser `POST /api/avatars/presign` → get signed PUT URL + `storage_key`. Key format: `u/{userId}/{slug}/{timestamp}.glb` (scoped by userId — don't skip this).
2. Browser `PUT` raw bytes to the signed URL.
3. Browser `POST /api/avatars` with `storage_key` to register metadata. Endpoint verifies the object exists via `headObject(key)` and size matches — don't skip this either.

For public/unlisted avatars use `publicUrl(key)` (CDN-cached). For private, `presignGet({ key, expiresIn: 600 })`.

---

## Rate-limit presets

Use the named preset that matches the endpoint. Don't invent new ones inline.

```js
limits.authIp(ip); // 30 / 10 min  — login/register
limits.registerIp(ip); // 5 / 1 h
limits.oauthRegisterIp(ip); // 10 / 1 h     — dynamic client reg
limits.mcpUser(userId); // 1200 / 1 min
limits.mcpIp(ip); // 600 / 1 min
limits.mcpValidate(key); // 10 / 1 min
limits.mcpInspect(key); // 30 / 1 min
limits.mcpOptimize(key); // 10 / 1 min
limits.oauthToken(clientId); // 120 / 1 min
limits.upload(userId); // 60 / 1 h
```

`clientIp(req)` reads `x-vercel-forwarded-for` → `x-real-ip` → socket.

---

## MCP endpoint — [mcp.js](mcp.js)

MCP 2025-06-18 over HTTP with JSON-RPC 2.0. Tools exposed: `list_my_avatars`, `get_avatar`, `search_public_avatars`, `render_avatar`, `delete_avatar`, `validate_model`, `inspect_model`, `optimize_model`.

Response: `{ content: [{type, text/resource}], structuredContent: {...}, isError? }`. Error codes: -32600 invalid, -32601 unknown method, -32602 bad params, -32603 internal, -32000 server/rate-limited.

When adding a tool: bump rate-limit bucket if heavy, declare scope via `hasScope()`, emit to `usage_events`.

---

## OAuth provider

We _issue_ tokens (not consume). Endpoints:

- `/api/oauth/authorize` (GET consent render, POST consent submit) — PKCE S256 mandatory, no implicit/password grants
- `/api/oauth/token` — `authorization_code` + `refresh_token` grants → JWT access + opaque refresh
- `/api/oauth/register` — RFC 7591 dynamic registration, unauthenticated, IP-rate-limited, mints `mcp_*` client IDs
- `/api/oauth/introspect` — RFC 7662
- `/api/oauth/revoke` — RFC 7009
- `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/oauth-protected-resource` (RFC 9728)

Token JWT: `{ sub, client_id, scope, aud, exp, iat, jti, kid: env.JWT_KID }`.

---

## Anti-patterns (don't ship these)

- Hand-rolled JWT / bearer extraction → use `authenticateBearer()`
- Inline SQL concat → always tagged-template `sql\`... ${x} ...\``
- `res.end(JSON.stringify(...))` → `json(res, ...)`
- Instantiating a new `Pool` or `neon()` → import `sql` from [\_lib/db.js](_lib/db.js)
- Missing rate-limit on public endpoint
- Hardcoded origins → `env.ISSUER` or `env.APP_ORIGIN`
- Registering a file in `avatars` without `headObject()` size check
- Leaking `owner_id` / R2 path prefix in unauthenticated responses → use `stripOwnerFor()`
- `await` on fire-and-forget logging calls that should use `queueMicrotask()`
