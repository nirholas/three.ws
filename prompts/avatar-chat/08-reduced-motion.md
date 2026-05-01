# 08 — Respect prefers-reduced-motion for walk animation and bubble

## Status
Accessibility gap — users with vestibular disorders or motion sensitivity who set `prefers-reduced-motion: reduce` in their OS should not see the avatar walking or the thought bubble bouncing.

## Files
`src/element.js` — `_onStreamChunk()`, `BASE_STYLE`

## CSS changes

Add to `BASE_STYLE`:
```css
@media (prefers-reduced-motion: reduce) {
    .thought-bubble .dot { animation: none; opacity: 0.6; }
    @keyframes thought-dot { to {} }
}
```

This stills the bouncing dots while keeping the bubble visible.

## JS changes

In `_onStreamChunk()`, check the media query before starting the walk animation:

```js
_onStreamChunk() {
    if (!this._scene || this.getAttribute('avatar-chat') === 'off') return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!this._isWalking && !prefersReduced) {
        this._isWalking = true;
        this._scene.playClipByName('walk', { loop: true, fade_ms: 300 });
    }
    clearTimeout(this._walkStopDebounce);
    this._walkStopDebounce = setTimeout(() => this._stopWalkAnimation(), 600);
}
```

The thought bubble still appears (it's informational) but doesn't animate. The avatar stays in idle pose instead of walking.

## Verification
In Chrome DevTools → Rendering panel, check "Emulate CSS media feature prefers-reduced-motion: reduce". Send a message. Bubble should appear with static dots. Avatar should not walk.
