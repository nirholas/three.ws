# CLAUDE.md — packages/server (@xspace/server)

Admin panel and WebSocket API server for xspace-agent. Provides a web dashboard for real-time agent control, monitoring, and selector management.

## Commands

```bash
npm run build   # tsc → dist/
npm run dev     # tsc --watch
npm run start   # node dist/index.js
npm run clean   # rm -rf dist
```

## Architecture

Only 4 source files — intentionally thin. The server is a coordination layer over `xspace-agent` (core SDK).

```
src/
├── index.ts              Express + Socket.IO server, routes, socket namespace, graceful shutdown
└── middleware/
    ├── auth.ts           API key auth (Express + Socket.IO), timing-safe comparison
    ├── validation.ts     Zod schemas for socket events (SpaceUrlSchema, event schemas)
    └── rate-limit.ts     In-memory per-IP rate limiter with auto-cleanup
```

## REST Endpoints

**Unauthenticated:**
- `GET /health` — Load balancer health check (uptime, timestamp, agent status)
- `GET /metrics` — Prometheus format
- `GET /metrics/json` — JSON format

**Static (served from `packages/server/public/`):**
- `GET /` → `public/index.html` (hub page)
- `GET /admin` → `public/admin.html`

> ⚠️ **Railway production serves from this `public/` directory, NOT the root `public/`.** Any HTML changes intended for production must be applied here. The root `public/` is only used by the legacy dev server (`npm run dev`).

**Authenticated (requires ADMIN_API_KEY):**
- `GET /config` — AI provider and agent status
- `GET /state` — Current state snapshot (last 50 messages)
- `POST /admin/selectors/:name` — Override CSS selector for browser automation
- `GET /admin/selectors/health` — Validate all selectors against live page
- `GET /admin/selectors/failures` — Selector failure report
- `GET /admin/providers` — Provider status, costs, session duration
- `GET /admin/providers/costs` — Cost tracking (optional `?since` filter)
- `GET /admin/providers/health` — Provider health check results

## Socket.IO Namespace: `/space`

**Client → Server (validated + rate-limited at 30 events/10s):**
- `xspace:start { spaceUrl }` — Create agent and join Space
- `xspace:stop` — Stop agent
- `xspace:join { spaceUrl }` — Join additional Space
- `xspace:leave` — Leave Space
- `xspace:2fa { code }` — Submit 2FA code
- `xspace:status` — Get current status
- `orchestrator:force-speak { botId }` — Force agent to speak

**Server → Client:**
- `xSpacesStatus` — Agent status changes
- `state:change` — FSM transitions
- `textComplete` — Transcription/response messages
- `audio:level`, `audio:webrtc-stats` — Audio telemetry
- `turn:decision` — Turn-taking decisions
- `provider:status`, `provider:cost` — Provider monitoring
- `selectors:health` — Selector validation
- `log` — Structured log forwarding

## Auth

Three accepted methods (any one works):
1. `X-API-Key` header
2. `Authorization: Bearer <key>` header
3. `?apiKey=<key>` query parameter

Socket.IO: `socket.handshake.auth.apiKey` or `x-api-key` header.

Uses `crypto.timingSafeEqual` to prevent timing attacks.

## Key Patterns

- **Single state object**: `agent`, `status`, `messages` (last 100), `spaceUrl`, `startedAt`, `totalCost`
- **Event forwarding**: Agent events → Socket.IO broadcasts to all connected dashboards
- **Graceful shutdown**: SIGTERM/SIGINT → stop rate limiter → destroy agent → close server → 10s force exit
- **Security**: Helmet CSP, CORS, rate limiting, secret redaction in errors


