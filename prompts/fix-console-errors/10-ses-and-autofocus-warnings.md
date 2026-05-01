# Quiet SES lockdown and autofocus warnings

## Symptom

```
lockdown-install.js:1 SES Removing unpermitted intrinsics
chat#:1 Autofocus processing was blocked because a document already has a focused element.
```

## Cause

Both are **warnings, not errors**. They are documented here so a future engineer doesn't chase them as bugs.

- `SES Removing unpermitted intrinsics` — emitted by Hardened JavaScript / Lockdown, almost always injected by a wallet browser extension (MetaMask, Rabby, Phantom, etc.). It tightens the realm at page load. Not from this app's code; cannot be silenced from the page.
- `Autofocus processing was blocked` — Chrome refuses to honor a second `autofocus` attribute when another element already holds focus. Cosmetic.

## Task

### SES warning

1. Confirm by loading `https://three.ws/chat` in a clean profile with no wallet extensions — the warning should disappear.
2. No code change. Document it in the team's "known harmless console output" note so it isn't re-investigated.

### Autofocus warning

1. Find the offending element (search for `autofocus` in the chat page templates / components).
2. Decide which input should actually receive focus on load. Remove `autofocus` from the others.
3. If multiple inputs legitimately need focus depending on state, drive focus imperatively in `useEffect` / `connectedCallback` based on the active state, instead of declaring `autofocus` on all of them.

## Acceptance

- No `Autofocus processing was blocked` warning on chat page load.
- The SES line is acknowledged as extension-induced and documented; not treated as a regression.
