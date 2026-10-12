# UI lint (lintapple)

[lintapple](https://github.com/gholtzap/lintapple) loads a running page in a browser and checks it against `ui-policy.json` at the repo root: font family and size, contrast, control size and gaps, viewport overflow, content clipping, root background, and ARIA state.

```
npm run dev                                   # app on :3000
npx lintapple http://localhost:3000/gallery --ready main
npm run lint:ui                               # same, against the home URL
```

Exit codes: 0 pass, 1 findings, 2 the check could not finish (pages over 5000 elements, such as `/marketplace`, need a component-level target).

## Notes

- The policy ships with Apple system fonts and a 12 to 64px type scale. three.ws uses Inter, Space Grotesk and JetBrains Mono and a denser scale, so the font and size rules are noisy until the policy is tuned to our design tokens. The rules that carry signal today are `viewport-bounds`, `content-clipping`, `control-gap`, `root-background` and `control-state`.
- The home page is a windowed-desktop canvas with a plain HTML fallback behind it. Lint content pages (`/gallery`, `/create`) and pass `--ready` so the app has mounted.
- A passing run means the configured rules held. It is not a design review.

## Triage (2026-10-12)

First pass on `/gallery` and `/create` fixed the rules with signal: control gaps in the header and gallery, accessible names that dropped visible text (gallery tags and cards, create cards, the getting-started pill), icon-only buttons without a tooltip (header, footer, suggestions panel; use a `role="tooltip"` span linked by `aria-describedby`, styled by `.ui-tip`), and the root background. What remains is intentional or environmental: the skip link and visually hidden label sit off-screen on purpose, card titles and descriptions use `line-clamp`, the footer watermark bleeds by design, `Inter Fallback` fails to load only where Arial/Liberation Sans is not installed, and the walk companion's floating buttons are 22px circles (44px on coarse pointers).
