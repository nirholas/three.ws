---
description: "Use when editing the @xspace/server admin panel — Express routes, Socket.IO events, auth middleware, rate limiting, selector management."
applyTo: "packages/server/**"
---
# Server Package (packages/server/)

Published as `@xspace/server`. See `packages/server/CLAUDE.md` for full API reference.

## Architecture

Only 4 source files — intentionally thin coordination layer over `xspace-agent` core SDK.

```
src/
├── index.ts                  Express + Socket.IO server, routes, graceful shutdown
└── middleware/
    ├── auth.ts               API key auth (timing-safe), 3 methods: header/bearer/query
    ├── validation.ts         Zod schemas for socket events
    └── rate-limit.ts         In-memory per-IP rate limiter
```

## Patterns

- **Auth**: Uses `crypto.timingSafeEqual` — never compare API keys with `===`
- **Validation**: All Socket.IO events validated with Zod schemas before processing
- **Rate limiting**: 30 events/10s per client, in-memory with auto-cleanup
- **Socket.IO namespace**: `/space` — all agent control events live here

## Rules

- New REST endpoints need Zod validation and auth middleware
- Socket events must be validated and rate-limited
- Never expose internal errors to clients
- Static files served from `public/` directory


