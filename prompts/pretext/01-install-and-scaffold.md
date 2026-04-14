# Task: Install Pretext and scaffold the hero module

## Context

Repo: `/workspaces/3D`. The `/features` route is a static page: [features.html](../../features.html) + [features.css](../../features.css). It currently renders a two-column hero — text left, a `<model-viewer>` avatar right ([features.html:36-68](../../features.html#L36-L68)).

We want to enhance the hero with [@chenglou/pretext](https://github.com/chenglou/pretext) — a DOM-free text measurement engine — so the subtitle can wrap around the avatar (task 02), the avatar can track the cursor (task 03), and optionally chase it with reflow per frame (task 04).

This task lays the groundwork: install the library, scaffold a module, wire it up behind a feature flag, prove it loads.

## Goal

After this task, loading `/features?pretext=1` should:

1. Initialize a `PretextHero` controller that has a handle on the hero DOM (title, subtitle, avatar container).
2. Log `[pretext-hero] ready` once with the Pretext API in scope.
3. Do nothing visible yet — no reflow, no cursor tracking. Those land in subsequent tasks.

Without the flag, the page must render exactly as it does today.

## Deliverable

1. **Install the dep** — `npm install @chenglou/pretext`. Update [package.json](../../package.json) and [package-lock.json](../../package-lock.json). No other deps.
2. **New file** `src/features/hero-pretext.js` — exports a default class `PretextHero` with:
   - `constructor(root)` — `root` is the `.hero` element. Caches references to `.hero-content`, `.hero-title`, `.hero-subtitle`, `.hero-avatar`.
   - `async init()` — dynamic-imports `@chenglou/pretext`, stores the API on `this.pretext`, logs `[pretext-hero] ready`, returns `this`.
   - `dispose()` — no-op for now; reserved for later tasks.
3. **Modify [features.html](../../features.html)** — at the bottom of `<body>`, add a small bootstrap `<script type="module">` that:
   - Parses `new URLSearchParams(location.search).get('pretext')`.
   - If the flag is `'1'` (or `'2'`, `'3'`, `'4'` — room for later tasks to enable themselves), dynamic-imports `/src/features/hero-pretext.js` and calls `new PretextHero(document.querySelector('.hero')).init()`.
   - Wraps the whole thing in `try/catch` so a failure leaves the page in its current state.
4. **Do NOT** modify [features.css](../../features.css) in this task.

## Audit checklist

- [ ] `npm install @chenglou/pretext` succeeds; lockfile updated.
- [ ] `package.json` lists `@chenglou/pretext` under `dependencies` (not devDependencies).
- [ ] `src/features/hero-pretext.js` is an ES module, default export, no top-level side effects.
- [ ] Dynamic import of `@chenglou/pretext` uses the bare specifier — Vite resolves it.
- [ ] The `?pretext=1` bootstrap runs only when the flag is present; default visitors see no change.
- [ ] If `PretextHero.init()` throws, the failure is caught and the page keeps working.
- [ ] `prefers-reduced-motion` is not relevant yet but should be acknowledged in a short comment at the top of `hero-pretext.js` so subsequent tasks don't forget.

## Constraints

- No CSS changes. No changes to [src/viewer.js](../../src/viewer.js), [src/app.js](../../src/app.js), or anything outside `features.*` and `src/features/`.
- No TypeScript. Match the existing JS style in [src/](../../src/).
- Do NOT implement text wrap, cursor tracking, or reflow in this task. Scaffolding only.
- No `README.md` or other docs files.

## Verification

1. `node --check src/features/hero-pretext.js` — parses.
2. `npx vite build` — completes. Note if it doesn't.
3. Run the dev server, open `/features` — page renders exactly as before. No console log.
4. Open `/features?pretext=1` — page renders identically, but console shows `[pretext-hero] ready` once and `window.__pretextHero` (optional, useful for debugging) holds the instance.
5. Force a failure (temporarily rename the dep import) — page still renders; error is caught and logged.

## Scope boundaries — do NOT do these

- Do not call any Pretext layout APIs yet.
- Do not attach mouse or scroll listeners.
- Do not add a `<canvas>` or SVG overlay.
- Do not change the avatar's `model-viewer` attributes.
- Do not touch [style.css](../../style.css).

## Reporting

- Confirm the install + lockfile diff is minimal.
- Report the Pretext API shape as seen via `console.log(Object.keys(mod))` inside `init()` — subsequent tasks need this.
- Note the library version installed.
- Note any Vite build warnings.
