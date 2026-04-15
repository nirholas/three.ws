# 02-03 — Generation progress UI

## Why it matters

RPM (or any third-party image-to-avatar provider) takes 30–90 seconds. A silent spinner kills the magic — users abandon. We need honest, on-brand progress feedback so the wait feels intentional.

## Context

- Selfie capture UI: `public/dashboard/selfie.html` (built in `02-01`).
- Generation endpoint: `/api/avatars/from-selfie` (built in `02-02`). Currently blocks until done.
- Optional: extend endpoint to support SSE if the provider exposes progress events. If not, use client-side synthetic progress.

## What to build

### Option A (preferred) — real progress via SSE

If the RPM provider exposes progress events (or if a task-id + polling pattern is easier), refactor `api/avatars/from-selfie.js` to:

- Return 202 + `{ job_id }` immediately on POST.
- Expose `GET /api/avatars/from-selfie/:job_id` as an SSE stream emitting:
  ```
  event: progress
  data: { "pct": 42, "stage": "generating" }

  event: complete
  data: { "avatar": { ... } }

  event: error
  data: { "error": "generation_failed", "message": "..." }
  ```
- Jobs are tracked in a new `selfie_jobs` table: `id uuid, user_id uuid, status text, pct int, avatar_id uuid, error text, created_at, updated_at`.
- Store job state in Upstash Redis for hot reads; persist terminal state to `selfie_jobs`.

### Option B (fallback) — synthetic progress

If the provider has no progress API and adding a job table is too much work, keep the endpoint synchronous and do client-side synthetic progress:

- On POST start, animate a progress bar from 0→85% over ~45s with gentle easing (not linear — slow at 70%+).
- On response: jump to 100%.
- On error: replace the bar with the error message.

Pick exactly one option. Document which in the PR.

### UI behavior (applies to both options)

On `/dashboard/selfie` after "Use this photo":

- Full-width progress element with percent and a rotating stage label: *"Sending your photo"* → *"Building your avatar"* → *"Finishing touches"*.
- Show a preview of the submitted selfie (blurred, low opacity) behind the progress.
- After success, smooth transition (opacity fade ~300ms) into the avatar preview + "Go to dashboard" button.
- On error, specific messages for: rate_limited, provider_not_configured, generation_failed. Each has a recover button.

### Cancel

- A "Cancel" button that aborts the fetch (`AbortController`) and returns to the capture step.
- If using option A, also POST to `DELETE /api/avatars/from-selfie/:job_id` to signal provider cancellation (best-effort; don't block UI on it).

## Out of scope

- Background generation that persists across page navigation. If the user leaves the page, the job is abandoned from their perspective (but may still complete server-side under option A).
- Multiple concurrent jobs per user.
- Notifications when generation completes while on another page.

## Acceptance

1. Submit a selfie → progress UI appears with moving percent and changing stage labels.
2. On success → preview of the generated avatar + navigate to dashboard.
3. On provider failure → clear error message + retry button.
4. Cancel button aborts the request within 500ms.
5. No zombie spinners if the user navigates away and returns (page state is reset).
6. `prefers-reduced-motion: reduce` makes the progress bar non-animated (just numeric updates).
