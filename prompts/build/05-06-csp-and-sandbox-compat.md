# 05-06 — Host embed: CSP and sandbox compatibility

**Branch:** `feat/host-csp-sandbox`
**Stack layer:** 5 (Host embed)
**Depends on:** 05-01

## Why it matters

Strict hosts apply Content-Security-Policy and `<iframe sandbox>` restrictions. If our embed uses `eval`, inline event handlers, dynamic `Function()`, or `wasm-unsafe-eval` without declaring it, hosts silently block the load. We need a clean CSP profile and the docs to declare what hosts must permit.

## Read these first

| File | Why |
|:---|:---|
| [src/element.js](../../src/element.js) | Mount point — verify no inline event handlers added at runtime. |
| [vite.config.js](../../vite.config.js) | Build config — can disable `eval`-like outputs. |
| [public/agent/embed.html](../../public/agent/embed.html) | The embed page — must work under strict CSP. |
| [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) | Spec to extend. |

## Build this

1. Audit the production bundle for forbidden patterns:
   - `eval(`, `new Function(`, `Function('return`
   - inline `<script>` without nonce
   - inline `on*` handlers
   - `javascript:` URLs
   Use a one-shot grep against `dist/` after `npm run build`. Document in the PR.
2. If three.js / dat.gui pull in any of the above, gate them behind a build flag (`TARGET=embed`) or replace the offender. Document any unavoidable exception in the spec.
3. Add a recommended host CSP block to [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md):
   ```
   frame-src 'self' https://3dagent.vercel.app https://3d.irish;
   script-src 'self' https://3dagent.vercel.app;
   img-src 'self' https://3dagent.vercel.app data: blob:;
   connect-src 'self' https://3dagent.vercel.app https://*.r2.cloudflarestorage.com;
   ```
4. Add a recommended `iframe sandbox` block:
   ```
   sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
   ```
   Document the failure mode if `allow-same-origin` is omitted (no cookies, must use 05-01 shim).
5. Set `Permissions-Policy` headers on `/agent/:id/embed` to restrict cameras/mics unless the agent declares them in its manifest.

## Out of scope

- Do not switch bundlers to address one CSP violation. Patch the offender or build-flag it.
- Do not add nonce injection — most hosts don't pass the nonce through.

## Acceptance

- [ ] Production bundle has no `eval` / `new Function` matches.
- [ ] Embed loads under strict CSP in a test page (paste `Content-Security-Policy` meta tag into a scratch HTML).
- [ ] Spec lists exact host CSP + sandbox recommendations.
- [ ] Permissions-Policy header set correctly.

## Test plan

1. `npm run build`. Run grep for forbidden patterns in `dist/` — expect zero hits.
2. Build a scratch page with the strict CSP meta tag and our embed snippet. Verify load.
3. Build a scratch page with `<iframe sandbox="allow-scripts">` (no `allow-same-origin`) — confirm 05-01 shim catches and the agent loads via absolute URLs.
4. Curl `/agent/<id>/embed` and confirm `Permissions-Policy` header.
