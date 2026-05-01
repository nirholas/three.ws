# 03 — Remove stale `_walkReturnTimer` and `_startWalkAnimation` references

## Status
Bug — `_startWalkAnimation()` and `_walkReturnTimer` were replaced by `_onStreamChunk()` / `_walkStopDebounce` but stale references remain in the file causing confusion and potential double-cleanup.

## File
`src/element.js`

## What to audit and remove

Search for every occurrence of:
- `_startWalkAnimation` — should be zero. If any exist, remove the call site and the method definition.
- `_walkReturnTimer` — should be zero. Remove from constructor init, teardown cleanup, and any clearTimeout calls.

The replacement pattern is:
- Old: `this._startWalkAnimation(text)` called in `brain:message` handler
- New: `this._onStreamChunk()` called in `brain:stream` handler (already wired)

Also verify `_teardown()` only clears `this._walkStopDebounce`, not `_walkReturnTimer`.

## Verification
`grep -n "_walkReturnTimer\|_startWalkAnimation" src/element.js` returns zero results.
