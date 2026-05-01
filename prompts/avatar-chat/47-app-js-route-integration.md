# 47 — app.js: verify avatar-chat attribute passes through hash params

## Status
Verification — `src/app.js` handles URL hash routing and sets attributes on `<agent-3d>`. If `avatar-chat` should be configurable via URL (e.g. `#avatar-chat=off` for embed use cases), it needs to be parsed there.

## File
`src/app.js`

## What to check

Open `src/app.js`. Find where hash params are parsed (look for `#model`, `#widget`, `#agent`, `#kiosk`, etc.) and where they're applied to the element.

Determine: does the app currently support `#avatar-chat=off` as a hash param? If not, decide whether to add it.

## Recommendation

**Add it** — it's a one-liner and makes the embed use case dramatically better. An iframe embed that wants a clean avatar-in-chat experience can pass `#avatar-chat=off` without modifying the element's HTML.

In the hash parsing section:
```js
if (params.has('avatar-chat') && params.get('avatar-chat') === 'off') {
    el.setAttribute('avatar-chat', 'off');
}
```

Or using the same pattern as `kiosk`:
```js
const avatarChatOff = params.has('avatar-chat') && params.get('avatar-chat') === 'off';
if (avatarChatOff) el.setAttribute('avatar-chat', 'off');
```

## Also add to EMBED_SPEC.md (connect with prompt 26)

In the URL hash params section of EMBED_SPEC.md, add:

| Hash param | Effect |
|---|---|
| `#avatar-chat=off` | Disables the inline avatar layout and walk animation |

## Verification
Navigate to `http://localhost:3001/#avatar-chat=off`. The element should render with the original bottom-bar layout.
