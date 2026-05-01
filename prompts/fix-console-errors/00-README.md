# Fix Console Errors at https://three.ws/chat

These prompts address the errors observed in the browser console at `https://three.ws/chat`. Each file is a self-contained task you can hand to an engineer or coding agent.

## Priority order

1. [01-agent-3d-boot-race.md](01-agent-3d-boot-race.md) — `<agent-3d>` web component crashes during boot (highest impact: blocks embed).
2. [02-agent-3d-unknown-memory-mode-remote.md](02-agent-3d-unknown-memory-mode-remote.md) — `Unknown memory mode: remote` thrown by loader.
3. [03-agent-3d-embed-policy-404.md](03-agent-3d-embed-policy-404.md) — `/api/agents/:id/embed-policy` returns 404.
4. [04-skills-api-500-and-object-category.md](04-skills-api-500-and-object-category.md) — `/api/skills` 500s; client sends `category=[object Object]`.
5. [05-sync-three-ws-dns.md](05-sync-three-ws-dns.md) — `sync.three.ws` DNS does not resolve and unhandled rejection.
6. [06-plugin-manifests-404.md](06-plugin-manifests-404.md) — Plugin registry references missing manifest JSONs.
7. [07-auth-me-401-handling.md](07-auth-me-401-handling.md) — `/api/auth/me` 401 logged loudly for anonymous users.
8. [08-localhost-probes.md](08-localhost-probes.md) — Probes to `localhost:8081` and `localhost:11434` (Ollama) noisy when not running.
9. [09-chat-proxy-402-429.md](09-chat-proxy-402-429.md) — `/api/chat/proxy` 402 (payment) and 429 (rate-limit) surfaced as opaque failures.
10. [10-ses-and-autofocus-warnings.md](10-ses-and-autofocus-warnings.md) — SES lockdown line + duplicate `autofocus` warning (cosmetic).
