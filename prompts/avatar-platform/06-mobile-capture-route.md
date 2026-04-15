# Task: Mobile capture route and desktop QR handoff

## Context

Repo: `/workspaces/3D`. Task 04 built desktop webcam capture. Task 05 built the session bridge. This task stitches them for the **phone-scan-QR-to-capture** flow: the desktop shows a QR; the phone opens it; phone captures three photos; they stream back to the desktop; the desktop proceeds.

Depends on tasks 04 and 05.

## Goal

1. A new page `m.html` (plus its entry module) is the landing for `/m/:sessionId` URLs — a mobile-first photo capture UI that uses the `MediaDevices` rear-facing `user` camera.
2. The desktop has a module that renders a QR code for a session URL and listens on the SSE stream for captured photos.
3. The end-to-end flow works: desktop scan-with-phone → three photos on phone → blobs arrive on desktop → resolves identical shape to task 04 (`{ left, center, right }`).
4. Works offline on the phone side after the initial HTML load (enable via the existing [vite-plugin-pwa](../../package.json#L60) config — scope the cache to `m.html` and its assets).

## Deliverable

1. **Mobile route entry** `m.html` at the repo root + [vite.config.mjs](../../vite.config.mjs) tweak to register it as an additional input. Page content:
   - Detects `window.location.pathname` → extracts `sessionId`.
   - Loads `src/capture/mobile-capture.js`.
   - Renders full-screen camera preview + capture UI optimized for portrait phone form factor.
2. **New module** `src/capture/mobile-capture.js`:
   - `init(sessionId)` — attaches to the session via `attachSession()` from task 05.
   - Three-shot capture flow (left, center, right), mirrored from desktop task 04 but redesigned for touch + portrait + single-hand use.
   - On each capture, POST the blob to `/api/session/:id/events` with `type: 'photo'`, `step: 'left'|'center'|'right'`.
   - After the third capture, POST `type: 'done'` and show "Photos sent — check your desktop".
   - Front-camera only (`facingMode: 'user'`).
   - Fallback: if `getUserMedia` fails, show a file-picker accepting three images with `capture="user"` hint.
3. **Desktop QR handoff module** `src/capture/qr-handoff.js`:
   - `async open(container): Promise<{ left, center, right }>` — same return shape as `PhotoCapture` from task 04.
   - Creates a session via `createSession()`, renders the `sessionUrl` as a QR code (use the `qrcode` npm package — add it, it's ~7 KB gzipped).
   - Shows a waiting state with spinner + "Scan to continue on your phone".
   - Subscribes to the SSE stream; collects three `photo` events, resolves when `done` arrives.
   - Has a "Use webcam instead" button that disposes the QR flow and opens `PhotoCapture` from task 04.
4. **Styling** — `capture-mobile-*` prefix for the mobile-only CSS. Keep the mobile route CSS in a separate stylesheet loaded only by `m.html` to avoid bloat on the main app.
5. **PWA config** — update `vite-plugin-pwa` options so `m.html` and its module chunk are precached. The main app's existing PWA behavior must not regress.

## Audit checklist

- [ ] Visiting `/m/<valid-session-id>` on a phone opens the camera and shows the left/center/right walkthrough.
- [ ] Visiting `/m/<expired-or-unknown>` shows a friendly "session expired or not found" page with a link to the main app.
- [ ] QR on desktop renders correctly and is large enough to scan at arm's length (≥ 240px on a 1080p display).
- [ ] Three photos taken on phone → three blobs appear on desktop → resolution matches `{ left, center, right }` shape.
- [ ] Kill the phone mid-capture → desktop shows "session abandoned" after the 10-min expiry (task 05's TTL).
- [ ] "Use webcam instead" fallback resolves with the same shape.
- [ ] The desktop flow works on localhost with HTTPS via `vite --https` or an HTTPS tunnel (document how — `mkcert`, `cloudflared`, or Vite's self-signed mode).
- [ ] `npx vite build` produces the extra `m.html` entry.

## Constraints

- Mobile page must be independently cacheable — offline reload must still render the capture UI. Network only needed for `/api/session/...`.
- Do not share CSS bundles between `m.html` and the main app — mobile bundle stays lean.
- Keep the total JS for the mobile route under 50 KB gzipped (excluding images). MediaPipe is NOT loaded here — this page only captures. Server does the heavy lifting in tasks 07/08.
- Do not require login.
- `qrcode` dependency is the only new npm add.

## Verification

1. Dev server with HTTPS (required for `getUserMedia` on mobile).
2. Desktop: open QR flow → phone scans → captures → desktop resolves.
3. Open `/m/<random-invalid-id>` → graceful error page, no JS crash.
4. Test on at least one real Android + one iOS device. Document which and any quirks.
5. Airplane-mode test: load `m.html` once on the phone, toggle airplane mode, reload → PWA renders the UI shell. Turn airplane off → a retry button recovers the session if still valid.
6. Lighthouse score on `m.html` → Performance ≥ 90 on mobile emulation.

## Scope boundaries — do NOT do these

- Do not generate the avatar. Just move blobs across the bridge.
- Do not persist captured photos beyond the session TTL (already enforced by task 05).
- Do not implement end-to-end encryption between phone and desktop — noted as future work.
- Do not add user accounts or cross-device linking beyond this session pairing.
- Do not change the main app shell.

## Reporting

- Real devices tested + OS/browser versions.
- Measured session-creation → blob-arrival latency over WiFi and 4G.
- The `qrcode` package version and its gzipped size impact on the desktop bundle.
- Any iOS `getUserMedia` quirks (playsinline, autoplay, permission persistence).
- Screenshots or a short screencap of the full desktop-phone-desktop flow.
