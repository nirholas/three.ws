# Task 04 — End-to-end onboarding flow

## Why this exists

Tasks 01–03 deliver the pieces. This task wires them into a single page at `/create` that takes a signed-in user from "I have no avatar" to "I have an avatar and I'm viewing it in the editor" in under 60 seconds.

## Files you own

- Create: `public/create/index.html` — the onboarding route.
- Create: `src/onboarding/flow.js` — the state machine that drives the page.
- Edit: `vercel.json` — add a rewrite `"/create" -> "/create/index.html"` if needed.
- Edit: `index.html` / nav — add a "Create agent" primary CTA that deep-links to `/create` when signed in, or to `/login?next=/create` otherwise.

Do not modify `api/avatars/*` — this task consumes existing endpoints.

## Deliverable

### Page shell (`/create`)

Full-height, centered layout. Steps render as horizontal breadcrumbs at the top:

1. **Sign in** (auto-skipped if already signed in)
2. **Take a selfie** — mounts `CameraCapture` from task 01
3. **Make your avatar** — runs the chosen pipeline (Avaturn default, RPM fallback) with a live progress bar and the preview image as it becomes available
4. **Name it** — task 05 handles the name + commit UI; this page hands off control
5. **View your agent** — on success, redirects to `/agent/:slug`

### State machine

Implemented in `src/onboarding/flow.js`. States: `'auth' | 'capture' | 'process' | 'commit' | 'done'`. Transitions guarded by the component emits. Persist intermediate state in `sessionStorage` under the key `onboarding:v1` so a reload in the middle resumes (or offers to).

### Progress UI

During `process`:
- Primary label cycles: "Analyzing your photo…" → "Building your avatar…" → "Almost ready…"
- Progress bar driven by the `progress` events from the pipeline.
- If the pipeline emits a preview image, show it at 25% opacity behind the spinner — conveys "something real is happening."

### Error UI

Each failure has a specific recovery path:
- Camera permission denied → "Upload a photo instead" button (file input, emits same Blob contract).
- Face not detected → retake + tip ("Good lighting, face the camera, no sunglasses").
- Pipeline timeout → retry button + switch-pipeline button.
- Network error → retry button.
- Quota exceeded → "We're overloaded right now. Try again in a minute" with a countdown retry.

## Constraints

- Do not introduce a frontend framework for this single page. Use the same vanilla + Vite pattern as the rest of the app.
- Never block forever. Every state has a timeout → recovery path.
- Do not autoplay sound or vibrate. No dark-pattern confetti either — let the reveal in step 5 speak for itself.
- Respect `prefers-reduced-motion`: progress bar still moves, but no pulsing / shimmering overlays.

## Acceptance test

1. `node --check src/onboarding/flow.js` passes.
2. Signed-out user clicks "Create agent" → lands on `/login?next=/create` → signs in → lands back on `/create` at the `capture` step.
3. Happy path: selfie → ~40-60s → agent page reached.
4. Pipeline fails mid-run → retry succeeds without forcing another selfie if the selfie blob was fine.
5. Refresh mid-capture → page offers "resume where you left off" or "start over"; both work.
6. Lighthouse accessibility ≥ 90 on `/create`.

## Reporting

- Timing breakdown per step from 5 real runs.
- Screenshots of the 5 states.
- Whether session persistence across reloads made the UX better or introduced bugs (be honest).
