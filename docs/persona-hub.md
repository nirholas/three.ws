# Persona Hub

Persona Hub is three.ws's cross-app sign-in: a user creates and stores their three.ws avatar once, then any site that embeds the `<three-ws-signin>` widget can ask the user to share that avatar in a single click. The user's three.ws session never leaves three.ws; the tenant receives only a short-lived JWT bearing the avatar URL.

This is the architectural answer to "what Ready Player Me's Hub was, before it was acquired" — same pattern (one avatar, hundreds of sites), redesigned around three.ws's auth stack.

---

## How it works

```
   tenant site                three.ws (popup)               three.ws backend
        │                            │                              │
   1.   ├── <three-ws-signin> ───────┤                              │
        │     button clicked         │                              │
        │                            │                              │
   2.   ├── window.open() ──────────►│ /persona/authorize.html      │
        │                            │  (consent screen)            │
        │                            │                              │
   3.   │                            │ GET /api/auth/persona/me ───►│
        │                            │  ◄────────── user + avatars  │
        │                            │                              │
   4.   │                            │ user picks avatar, clicks    │
        │                            │ "Authorize"                  │
        │                            │                              │
   5.   │                            │ POST /api/auth/persona/issue►│
        │                            │  body { tenant_origin,       │
        │                            │         avatar_id }          │
        │                            │  ◄──── { token, avatar }     │
        │                            │                              │
   6.   │◄── postMessage ────────────┤  closes popup                │
        │  { token, avatar }         │                              │
        │                            │                              │
   7.   ├── (optional) verify        │                              │
        │   GET /api/auth/persona/verify?token=…&audience=…  ──────►│
        │   ◄────────────── { sub, avatar, exp }                    │
```

The cookie carrying the user's three.ws session is `__Host-sid` — locked to the exact host. The popup runs on three.ws so the consent screen can read it; the tenant never sees it. Cross-site avatar sharing happens entirely via the postMessage-delivered JWT.

---

## Embedding the widget

```html
<script src="https://three.ws/persona/widget.js" defer></script>

<three-ws-signin
    client-origin="https://coolgame.three.ws"
    label="Sign in with three.ws">
</three-ws-signin>
```

Listen for the result:

```js
const el = document.querySelector('three-ws-signin');
el.addEventListener('three-ws:authorized', (e) => {
  const { token, avatar, expires_in } = e.detail;
  // avatar: { id, url, thumbnail_url, name }
  // token: 24h JWT — verify server-side before trusting
});
el.addEventListener('three-ws:cancelled', () => {
  // user closed the popup or hit Cancel
});
```

### Programmatic API

If you don't want a custom element, use the promise wrapper:

```js
const result = await window.ThreeWsPersona.signIn({
  clientOrigin: 'https://coolgame.three.ws',
});
// result.token, result.avatar
```

---

## Allowed tenant origins

`/api/auth/persona/issue` accepts these origins for `tenant_origin`:

- `https://three.ws`
- `https://<anything>.three.ws`
- `http://localhost[:port]` and `http://127.0.0.1[:port]` (dev only)

Other origins return `400 invalid_request`. This is the chokepoint that prevents arbitrary sites from minting tokens claiming any user's three.ws avatar. Add subdomains by updating `validateTenantOrigin()` in [api/auth/persona/[action].js](../api/auth/persona/%5Baction%5D.js).

---

## Verifying tokens server-side

Tenants verify the token from their backend:

```js
const res = await fetch(
  `https://three.ws/api/auth/persona/verify?token=${encodeURIComponent(token)}&audience=${encodeURIComponent('https://coolgame.three.ws')}`,
);
const claims = await res.json();
if (!res.ok) throw new Error(claims.error_description);

// claims.sub        — three.ws user id (stable across sessions)
// claims.aud        — must match the tenant origin you embedded with
// claims.avatar     — { id, url, thumbnail_url, name }
// claims.scope      — "persona:read avatar:read"
// claims.exp        — Unix timestamp
```

### Two signing modes

| Mode | Algorithm | When | Verification |
|---|---|---|---|
| **ES256** (preferred) | EC P-256 asymmetric | `PERSONA_JWKS_PRIVATE_KEY_PEM` env var set | Offline via [JWKS endpoint](https://three.ws/.well-known/jwks.json), or `/verify` |
| **HS256** (fallback) | HMAC-SHA256 with `JWT_SECRET` | No persona keypair configured | Must hit `/verify` — secret can't be published |

Generate an ES256 keypair with:

```bash
node scripts/generate-persona-key.mjs
```

then paste the output into Vercel env. The verify endpoint accepts both algorithms during rotation so tokens minted before key install keep working until they expire.

### Offline verification (ES256 only)

```js
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://three.ws/.well-known/jwks.json'));

const { payload } = await jwtVerify(token, JWKS, {
  issuer: 'https://three.ws',
  audience: 'https://coolgame.three.ws',
  algorithms: ['ES256'],
});
// payload.sub, payload.avatar, etc.
```

---

## Endpoint reference

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/auth/persona/me` | three.ws session | Lists the user's avatars for the consent UI. |
| `POST /api/auth/persona/issue` | three.ws session | Mints a 24h persona JWT for `{ tenant_origin, avatar_id }`. |
| `GET /api/auth/persona/verify?token=&audience=` | none | Verifies a token's signature, issuer, audience, expiry. |

JWT claims:

| Claim | Value |
|---|---|
| `iss` | `https://three.ws` |
| `sub` | three.ws user id |
| `aud` | tenant origin (validated against the issued audience) |
| `scope` | `persona:read avatar:read` |
| `token_use` | `persona` |
| `avatar` | `{ id, url, thumbnail_url, name }` |
| `iat` / `exp` | issued at / expires at (24h TTL) |
| `jti` | unique token id |

---

## Threat model notes

- **Origin spoofing.** The popup posts back only to the `tenant_origin` it was opened with. The browser enforces this via the second argument to `postMessage`, so a malicious script on another tab cannot receive the token.
- **Replay between tenants.** Each token's `aud` is bound to the issuing tenant. `verify` requires the caller to supply the audience — if a token issued for `coolgame.three.ws` is replayed against `evilgame.three.ws`, verification fails.
- **State CSRF.** The widget generates a per-popup `state` nonce; the popup echoes it back in the postMessage payload. The widget rejects messages whose `state` doesn't match.
- **Token theft via XSS on tenant.** A compromised tenant could leak tokens, but the blast radius is limited to that user's avatar URL (already publicly fetchable in most flows) plus their three.ws user id. No write scopes are granted by a persona token.
