# 06 — iframe sandbox + CSP fixes for host embeds

## Why it matters

Claude artifacts and many other host environments iframe-embed with `sandbox` attributes. Our agent must still work inside a sandboxed frame with no escalation tricks — microphone access, `localStorage`, `postMessage` to parent, and WebGL all need to degrade gracefully.

## Context

- Entry point for embed: [public/agent/embed.html](../../public/agent/embed.html).
- CSP: defined in [vercel.json](../../vercel.json) headers.
- Postmessage protocol (for host bidirectional): landing in `prompts/lobehub-embed/02-postmessage-protocol.md`.

## What to build

### Sandbox-safe boot

In the embed entry script:
1. Detect `window.top !== window.self && sandbox attribute present`.
2. If `localStorage` is blocked (DOMException on write) → fall back to `sessionStorage`.
3. If `sessionStorage` is also blocked → memory-only identity (no persistence).
4. If `getUserMedia` not granted → hide any UI that depends on it (avatar creator's selfie option).
5. If WebGL 2 unavailable → render a static poster image (use the avatar thumbnail from the manifest).

### CSP audit

Document required CSP:
```
default-src 'self' https://3dagent.vercel.app;
img-src 'self' data: blob: https:;
media-src 'self' blob:;
connect-src 'self' https://api.anthropic.com https://*.infura.io https://*.alchemyapi.io https://ipfs.io https://dweb.link https://cloudflare-ipfs.com;
script-src 'self' 'wasm-unsafe-eval';
```

Add a section to [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) listing these so host integrators know what to allowlist.

### Kiosk auto-detection

If inside an iframe AND hostname is not the main `3dagent.vercel.app` → default to `kiosk=1` behavior regardless of URL param. Allow host to override with `kiosk=0`.

## Out of scope

- Wildcard CSP relaxations.
- Post-message API (next prompt in lobehub series).
- Camera passthrough from host.

## Acceptance

1. Embed the `/agent/:id` URL in a blank `.html` file with `<iframe sandbox="allow-scripts allow-same-origin">` → renders, no console CSP errors.
2. With `sandbox="allow-scripts"` only (no same-origin) → renders in memory-only mode, no localStorage errors.
3. The agent's selfie option is hidden when `getUserMedia` is unavailable.
4. `npx vite build` passes. Manual test documented in the report.
