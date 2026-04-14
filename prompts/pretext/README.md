# Pretext hero experiments

Self-contained prompt files for wiring [@chenglou/pretext](https://github.com/chenglou/pretext) — a 15KB DOM-free text measurement & layout engine — into the `/features` hero so the copy flows around the 3D avatar ([public/avatars/cz.glb](../../public/avatars/cz.glb)).

Reference reading before starting any task:

- Library: https://github.com/chenglou/pretext
- Demos: https://chenglou.me/pretext/ (Dragon, Editorial Engine, Variable Typographic ASCII)
- Community: https://github.com/qtakmalay/PreTextExperiments
- npm: `@chenglou/pretext`

Each task touches [features.html](../../features.html) and [features.css](../../features.css); [01](./01-install-and-scaffold.md) also adds the dep and a tiny module under [src/features/](../../src/features/).

## Recommended execution order

1. [01-install-and-scaffold.md](./01-install-and-scaffold.md) — **delegate-ready.** Install dep, add a `hero-pretext.js` module behind a feature flag. Unblocks 02–04.
2. [02-hero-text-wrap.md](./02-hero-text-wrap.md) — **delegate-ready.** Static circle exclusion around avatar. The baseline "text parts around the avatar" effect. Depends on 01.
3. [03-gaze-follow.md](./03-gaze-follow.md) — **delegate-ready.** Avatar head tracks cursor via `model-viewer`'s `camera-orbit`. Independent of Pretext reflow; safe to ship alongside 02.
4. [04-dragon-mode.md](./04-dragon-mode.md) — **opt-in showcase.** Cursor-chasing avatar with per-frame text reflow. High visual payoff, medium gimmick risk — ship behind a query-string flag, not on by default. Depends on 01, 02.

## Rules that apply to all tasks

- Pretext's exclusion/obstacle API is not fully documented in the README — **read `node_modules/@chenglou/pretext/` source and the demos page before implementing.** If the needed API doesn't exist, fall back to manually splitting the text into two columns that flank the avatar and report this in your summary.
- No changes to [src/viewer.js](../../src/viewer.js) or [src/app.js](../../src/app.js) — all work is scoped to `features.*` and a new `src/features/` folder.
- Respect `prefers-reduced-motion` — cursor-follow and per-frame reflow must pause when the user has reduced motion enabled.
- The feature must gracefully degrade: if Pretext fails to load, the current two-column hero must still render correctly.
- `node --check` each new JS file. Run `npx vite build` and note whether it breaks. The pre-existing `@avaturn/sdk` resolution error in [src/avatar-creator.js](../../src/avatar-creator.js) is unrelated and should be ignored.
- No new docs files beyond what each task explicitly requires.
- If you discover an unrelated bug, note it in the reporting section. Do not fix it in the same change.
