# UI lint (lintapple)

[lintapple](https://github.com/gholtzap/lintapple) loads a running page in a browser and checks it against `ui-policy.json` at the repo root: font family and size, contrast, control size and gaps, viewport overflow, content clipping, root background, and ARIA state.

```
npm run dev                                   # app on :3000
npx lintapple http://localhost:3000/gallery --ready main
npm run lint:ui                               # same, against the home URL
npm run lint:ui:core                          # the seven core pages, one summary row each
node scripts/lint-ui-pages.mjs --base http://localhost:3017 --only /gallery,/create --json report.json
```

Exit codes: 0 pass, 1 findings, 2 the check could not finish (pages over 5000 elements, such as `/marketplace`, need a component-level target).

## Notes

- `ui-policy.json` is tuned to the shipped design: fonts Inter, Space Grotesk and JetBrains Mono, and the token type scale (9.888 to 67.776px, the `--text-*` steps in `public/tokens.css`). Add a font or size there only when it is a token; one-off values belong in `exceptions` with a reason.
- `scripts/lint-ui-pages.mjs` (`npm run lint:ui:core`) lints `/`, `/gallery`, `/create`, `/forge`, `/discover`, `/docs` and `/agents` through lintapple's library API, so the per-step budget is configurable (`--timeout`, default 120000 ms; the CLI pins 15 s). Exit codes: 0 all pass, 1 findings, 2 a page could not be checked (an error outranks findings). A page over 5000 elements is linted through a `scope` selector on its `CORE_PAGES` entry . A check torn down by a dev-server reload is retried once. Unit tests: `tests/ui-lint-pages.test.js` (exit-code aggregation and page-list integrity against `data/pages.json`).
- The first run on a cold machine is slow: lintapple resizes and re-checks every state at two viewports and two color schemes. Run it against a dev server nothing else is saving files under, because a Vite reload mid-check is the main source of exit 2.
- The home page is a windowed-desktop canvas with a plain HTML fallback behind it. Lint content pages (`/gallery`, `/create`) and pass `--ready` so the app has mounted.
- A passing run means the configured rules held. It is not a design review.

## Triage (2026-10-12)

First pass on `/gallery` and `/create` fixed the rules with signal: control gaps in the header and gallery, accessible names that dropped visible text (gallery tags and cards, create cards, the getting-started pill), icon-only buttons without a tooltip (header, footer, suggestions panel; use a `role="tooltip"` span linked by `aria-describedby`, styled by `.ui-tip`), and the root background. What remains is intentional or environmental: the skip link and visually hidden label sit off-screen on purpose, card titles and descriptions use `line-clamp`, the footer watermark bleeds by design, `Inter Fallback` fails to load only where Arial/Liberation Sans is not installed, and the walk companion's floating buttons are 22px circles (44px on coarse pointers).
