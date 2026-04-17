# Task: Cursor-chasing avatar with per-frame text reflow ("Dragon Mode")

## Context

Repo: `/workspaces/3D`. This is the showpiece task — the avatar detaches from its grid column and roams the hero section chasing the cursor, while the hero subtitle (and optionally the proof list) **reflows around the avatar's silhouette every frame** using [@chenglou/pretext](https://chenglou.me/pretext/). Inspired directly by the Pretext Dragon demo and [qtakmalay/PreTextExperiments](https://github.com/qtakmalay/PreTextExperiments).

Prereqs: [01](./01-install-and-scaffold.md) (install + scaffold), [02](./02-hero-text-wrap.md) (static wrap — same overlay rendering path is reused).

Gimmick risk is real. This mode ships behind an explicit flag and is **not** on by default. Treat it as a playground / marketing moment, not default UX.

## Goal

With `?pretext=4`, the hero behaves as follows:

- The `<model-viewer>` avatar becomes position: absolute inside `.hero`, free to move.
- It eases toward the cursor with physics (damped spring), staying within the hero's bounds.
- Pretext re-lays the subtitle on every animation frame with the avatar's current bounding circle as the exclusion zone. Text parts around the avatar like water as it moves.
- When the cursor leaves the hero, the avatar eases back to its "home" position on the right side; `auto-rotate` resumes; subtitle settles into the static wrap from task 02.

All other flags (`?pretext=1`, `=2`, `=3`) behave as before.

## Deliverable

1. **Extend [src/features/hero-pretext.js](../../src/features/hero-pretext.js)**:
    - `enableDragonMode()` method, activated when the flag is `>= 4`.
    - Records the avatar's "home" rect on init.
    - Adds `.hero--dragon` class to the hero, which in CSS lets the avatar use `position: absolute; inset: auto; transform: translate3d(x, y, 0);`.
    - `pointermove` (rAF-coalesced) sets a target (x, y) in hero-local coordinates, clamped so the avatar stays fully within `.hero`.
    - Integrator runs on `requestAnimationFrame`:
        - Damped spring toward target: `stiffness ≈ 120`, `damping ≈ 20`, `mass ≈ 1`. Tune for a "trailing fish" feel.
        - Applies translation via `transform` on `.hero-avatar` (never left/top).
        - Reads the avatar's new center, computes bounding circle, calls Pretext to re-lay the subtitle, paints via the same `.hero-subtitle-pretext` overlay from task 02.
    - `pointerleave` on `.hero`: target becomes home position; integrator continues until `|velocity|` and `|home - position|` are both below thresholds; then the class is removed and task 02's static layout takes over.
    - `prefers-reduced-motion: reduce` → fully disabled; falls back to task 02 behavior.
    - Touch devices (`matchMedia('(hover: none)')`) → disabled; falls back to task 02.
2. **CSS additions in [features.css](../../features.css)** under `/* ── Dragon mode ─── */`:
    - `.hero--dragon .hero-avatar { position: absolute; top: 0; left: 0; will-change: transform; }`
    - `.hero--dragon .hero-content` retains its width — text column no longer shares the grid with the avatar; set `grid-column: 1 / -1` so the subtitle has full-hero width to reflow in.
    - Disable `.hero-avatar-ring`/`pulse`/`tag` during dragon mode if they interfere with the feel (acceptable to hide them for this mode).
    - Ensure z-index: the avatar stays above the text overlay but below `.hero-bg` glows? Decide and document. Default recommendation: avatar above text (parting-water metaphor).
3. **Performance budget**:
    - Frame budget for Pretext relayout: ≤4ms on a mid-range laptop (measure with `performance.now()`).
    - If the measured cost exceeds 8ms over a 30-frame rolling window, **automatically downgrade** — disable per-frame reflow, keep cursor chase, fall back to task 02's static wrap. Log a single `[pretext-hero] dragon downgraded` warning. This guard is mandatory.

## Audit checklist

- [ ] Avatar follows cursor with trailing inertia; never snaps instantly.
- [ ] Avatar never leaves `.hero` bounds regardless of cursor position.
- [ ] Subtitle stays readable — never fully occluded. If the avatar covers >50% of a line, that line is skipped from layout (don't render half-lines behind the avatar).
- [ ] Only one rAF loop drives both the spring and the relayout — no dueling loops.
- [ ] Pretext is called at most once per frame.
- [ ] Auto-downgrade triggers correctly when forced (temporarily add a `busy-wait` to simulate slowness and confirm the warning fires and the page stops reflowing).
- [ ] `pointerleave` → avatar returns home smoothly within ~800ms.
- [ ] `prefers-reduced-motion: reduce` and touch devices fully disable the mode.
- [ ] `visibilitychange → hidden` pauses the rAF loop; resumes on `visible`.
- [ ] Title, chip, CTAs, proof-list, and background layers are untouched.

## Constraints

- No new deps.
- Scoped to `features.*` and `src/features/`. No changes to [src/viewer.js](../../src/viewer.js) or any other file.
- Must reuse task 02's overlay `.hero-subtitle-pretext` — do not create a parallel rendering path.
- Must not fight with `<model-viewer>`'s `auto-rotate` / `camera-controls` — disable `auto-rotate` while dragon mode is active; re-enable on exit.
- No `will-change: transform` permanently on the avatar — only while dragon mode is active.

## Verification

1. `node --check` on the modified JS.
2. `npx vite build` completes.
3. `/features?pretext=4`:
    - Slow circle → avatar trails smoothly; subtitle parts.
    - Fast flick → avatar lags realistically; no stutter; subtitle keeps up.
    - Cursor out → eased return home; static wrap resumes.
4. DevTools Performance, 10s recording of a circular mouse motion:
    - p95 frame time < 16ms.
    - Long tasks < 50ms.
    - Paste the Pretext relayout cost (mean/p95) into the reporting section.
5. Force the downgrade — set the threshold very low temporarily, confirm the warning fires and reflow stops but the chase continues.
6. `prefers-reduced-motion: reduce` → falls back to task 02 exactly.
7. Mobile emulation → falls back to task 02.

## Scope boundaries — do NOT do these

- Do not project the actual GLB 3D silhouette for exclusion. A bounding circle (plus optional head/body ellipses) is enough. If you want to go further, open a separate task.
- Do not add click/drag behavior — this is cursor-follow only.
- Do not add particle trails, blur, or post-processing.
- Do not change the avatar model, its materials, or its lighting.
- Do not ship this mode as the default — it must require an opt-in flag.

## Reporting

- Spring constants used and why.
- Mean and p95 Pretext relayout cost across a 10s recording.
- Whether the auto-downgrade fired during normal use (it shouldn't).
- One-paragraph subjective review — did it feel magical or annoying? Any readability issues?
- A recommendation on whether to promote this from opt-in to a dedicated `/playground` route.
- Any z-index / layering decisions and the reasoning.
