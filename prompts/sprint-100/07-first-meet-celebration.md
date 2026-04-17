# 07 — First-meet celebration module

## Why

The moment an avatar is generated, the user should feel something. A brief wave, a confetti burst, a "share" CTA. Raises perceived quality massively for near-zero cost.

## Parallel-safety

Self-contained module. No app wiring.

## Files you own

- Create: `src/first-meet.js`
- Create: `src/first-meet.css`

## Deliverable

```js
export async function playFirstMeet({ viewer, agent, onShare, onContinue })
// viewer: the SceneController / AgentAvatar instance (duck-typed — it has .playClip(name) OR .mixer and .animations).
// agent:  { id, name, slug } — used for share URL + greeting text.
// onShare:    () => void — invoked when user clicks "share"
// onContinue: () => void — invoked when user clicks "go to agent home"
//
// Plays a ~3s sequence:
//   t=0.0 — fade black → scene (if from dark background; else no-op)
//   t=0.2 — avatar waves (prefer clip 'Wave'; fallback: a scripted head tilt + hand raise via bone names 'mixamorigRightHand' or 'RightHand')
//   t=0.6 — "Hello, I'm {name}." subtitle fades in
//   t=1.4 — confetti burst (CSS-only; no canvas library)
//   t=2.2 — buttons "Share" and "Continue" fade in
//   t=  ∞ — resolves when user clicks a button
```

Confetti: 40–60 absolutely-positioned `<span>` elements, randomized hue/size/rotation, CSS `@keyframes` falling + fading, `pointer-events: none`. Cleans up after 2s.

If the avatar has no Wave clip and no rig bone names match, skip the wave gracefully — don't throw.

## CSS

`src/first-meet.css`, scoped under `.first-meet-root`. All keyframes prefixed `fm-` to avoid collisions.

## Constraints

- No canvas libs, no tween libs. Pure CSS + `requestAnimationFrame` if needed.
- `prefers-reduced-motion: reduce` → skip confetti, keep the subtitle + buttons, no wave scripting, no fade.

## Acceptance

- `node --check src/first-meet.js` passes.
- `npm run build` clean.
- In a scratch page with a dummy viewer mock, the sequence runs and resolves on button click.

## Report

- What clip names / bone names you probed and in what order.
- What the sequence looks like if no Wave and no matching bones (screenshot/description).
