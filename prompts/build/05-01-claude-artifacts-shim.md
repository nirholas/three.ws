# 05-01 — Host embed: Claude.ai Artifacts shim

**Branch:** `feat/host-claude-artifacts`
**Stack layer:** 5 (Host embed)
**Depends on:** 04-03 (embed reliability)
**Blocks:** demo of "your agent inside Claude"

## Why it matters

Claude.ai Artifacts run user-pasted HTML inside a sandboxed iframe (`sandbox="allow-scripts"` only — no `allow-same-origin`). Today our embed assumes same-origin to call `/api/agents/:id`. If a user pastes our snippet into an Artifact, it silently fails. This shim makes `<agent-3d>` boot in an opaque-origin context by routing all backend reads through a public, CORS-enabled, no-cookie endpoint.

## Read these first

| File | Why |
|:---|:---|
| [src/element.js](../../src/element.js) | The `<agent-3d>` web component. Detect Artifact context here. |
| [src/manifest.js](../../src/manifest.js) | Manifest loader — currently uses same-origin fetch. |
| [api/agents/[id].js](../../api/agents/[id].js) | Public read shape; verify CORS + cache headers. |
| [public/agent/embed.html](../../public/agent/embed.html) | Iframe target — must work in nested sandbox. |
| [vercel.json](../../vercel.json) | Add CORS headers to the public read routes. |

## Build this

1. In [src/element.js](../../src/element.js), detect opaque origin: `try { document.cookie } catch { isArtifact = true }` (Artifacts throw `SecurityError`). Also set when `window.location.origin === 'null'`.
2. When `isArtifact`, force absolute URL for every backend call: `https://3dagent.vercel.app/api/...` (read host from `data-host` attribute on the script tag, fall back to `3dagent.vercel.app`).
3. Add CORS headers to public-read endpoints: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, OPTIONS`, no credentials. Apply to: `/api/agents/:id`, `/api/widgets/:id`, `/api/avatars/public`, `/api/agents/:id/embed-policy`. Reuse the helper in [api/_lib/http.js](../../api/_lib/http.js) — add `corsPublic(res)`.
4. Reject any `credentials: 'include'` fetch when `isArtifact` (cookies are useless in sandbox; sending them just confuses CORS).
5. Add a `data-host` attribute to the canonical embed snippet generator at [embed.html](../../embed.html).

## Out of scope

- Do not add a write path for Artifacts (no auth = no writes).
- Do not modify the SIWE flow.
- Do not bundle a polyfill for `BroadcastChannel` or `localStorage` — gracefully degrade.
- Do not add an MCP-style proxy.

## Acceptance

- [ ] Pasting our embed snippet into a Claude Artifact renders the avatar with no console errors.
- [ ] Network tab shows absolute-URL fetches with `Origin: null` and successful 200s.
- [ ] Same snippet still works on a normal page (non-sandbox).
- [ ] `npm run build` passes.

## Test plan

1. `npm run dev`. Open the dashboard, generate an embed snippet for any public agent.
2. Copy snippet. Open Claude.ai → New Artifact → paste as HTML.
3. Verify: avatar loads, no errors, can orbit on touch.
4. Repeat in a normal `<iframe>` on a scratch HTML page — same behavior.
