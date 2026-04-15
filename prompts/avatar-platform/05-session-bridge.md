# Task: Session bridge — ephemeral channel for desktop↔mobile handoff

## Context

Repo: `/workspaces/3D`. To replicate Avaturn's QR-to-phone flow (desktop opens QR → phone captures photos → result appears back on desktop), we need a short-lived relay that pairs two clients by a session ID without requiring a user account.

This task ships the **transport only** — a backend endpoint (or serverless function) plus a browser client. The phone UI is task 06, desktop QR UI is task 06. The capture flow is task 04. This task is the pipe between them.

## Goal

After this task:

1. A desktop client can `createSession()` and receive a short `sessionId` + a `sessionUrl` pointing at the mobile route.
2. The desktop subscribes to the session and receives events pushed from the mobile side (photos, status).
3. The mobile client can `attachSession(sessionId)` and post events.
4. Sessions auto-expire after 10 minutes.
5. All session data is ephemeral: no persistence to a DB, no logging of image contents.

## Deliverable

1. **Backend choice** — decide between:
   - A. **Vercel Edge Function + Upstash Redis** (matches existing [vercel.json](../../vercel.json) hint in [package.json:41](../../package.json#L41)). Document the env vars needed.
   - B. **Standalone Node/Bun server** under `server/session/` with in-memory map + SSE.
   - Default to A if the project already deploys to Vercel; else B. **Document the decision** in the reporting section.
2. **Endpoints** (names are fixed regardless of backend choice):
   - `POST /api/session/new` → `{ sessionId, sessionUrl, expiresAt }`. `sessionUrl` is `https://<host>/m/<sessionId>`.
   - `GET /api/session/:id/stream` — Server-Sent Events stream pushing `{ type, data }` events to the subscriber (desktop).
   - `POST /api/session/:id/events` — mobile posts `{ type, data }` events (JSON body, multipart for images).
   - `GET /api/session/:id` → metadata only (`{ status, lastEventAt }`), no event payloads.
3. **Client module** `src/capture/session-client.js`:
   - `async createSession() -> { sessionId, sessionUrl, stream }` — `stream` is an `AsyncIterable<Event>`.
   - `async attachSession(sessionId) -> { post(type, data) }`.
   - Auto-reconnects SSE on drop (with backoff).
4. **Security**:
   - Session IDs are 128-bit random, URL-safe base64 (~22 chars).
   - Rate-limit: max 5 `/api/session/new` per IP per minute; max 20 events per session; max 10 MB total payload per session.
   - No CORS wildcard — allow the deployed origin + `localhost`.
   - Images never written to disk; streamed through memory and discarded after dispatch.
5. **Expiry** — sessions self-destruct after 10 min from `createdAt`, or 2 min after `terminated` event, whichever comes first.
6. **Observability** — a minimal counter log line per session (`[session] new <id>`, `[session] end <id> reason=<expiry|done|error>`). **Never** log event payloads.

## Audit checklist

- [ ] Session IDs are unguessable (128 bits of entropy).
- [ ] Expired sessions return 410 Gone; unknown IDs return 404.
- [ ] SSE stream closes cleanly on `terminated`.
- [ ] Rate limits are enforced and return 429 with `Retry-After`.
- [ ] No image data in logs (grep a full-flow log for common bytes / base64 fragments).
- [ ] Disabling Upstash env vars makes the backend fail loudly at startup (A only), not silently.
- [ ] CORS policy blocks other origins.
- [ ] `node --check` the new JS files.
- [ ] Dev server + endpoints work locally without Upstash (A: document a `LOCAL_DEV=1` fallback to in-memory; B: no fallback needed).

## Constraints

- No auth / user accounts. This is intentionally an ephemeral pairing channel.
- No DB of images; payloads live in memory or Redis with TTL only.
- No WebRTC — the blobs need a server-mediated path so the desktop doesn't need to be reachable.
- No WebSockets unless SSE is genuinely insufficient (it isn't here — one-way stream desktop←mobile plus REST mobile→desktop).
- Do not ship this behind the existing Avaturn flow — it's independent infrastructure.
- Do not add tracing/APM SDKs.

## Verification

1. `npm run dev` (and any backend start command for option B).
2. `curl -X POST http://localhost:3000/api/session/new` → returns session triple.
3. Open `curl -N http://localhost:3000/api/session/<id>/stream` in one terminal; `curl -X POST .../events -d '{"type":"hello","data":{}}'` in another — event appears on the SSE stream.
4. Post 11 events in rapid succession → 11th returns 429.
5. Wait 10 min → session returns 410.
6. Post 11 MB → rejected.
7. Two concurrent sessions stay isolated (no cross-delivery).

## Scope boundaries — do NOT do these

- No QR rendering (task 06).
- No photo capture (tasks 04, 06).
- No avatar generation (tasks 07, 08).
- No admin UI to list sessions.
- No session resumption after browser refresh on the desktop — keep it simple; desktop reload = new session.

## Reporting

- Backend choice (A or B) with one sentence on why.
- Env vars required to deploy.
- Measured median and p95 latency for a 2 MB image event (mobile post → desktop SSE receipt) on local dev.
- Any unavoidable pitfalls with SSE through Vercel's edge runtime (if applicable).
- Recommended monitoring dashboard once this ships (descriptive only, don't implement).
