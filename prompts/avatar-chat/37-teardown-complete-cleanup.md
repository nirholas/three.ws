# 37 — Complete teardown cleanup audit

## Status
Critical — every timer, observer, event listener, and RAF reference added by the avatar-chat feature must be cleared in `_teardown()`. A missed cleanup causes memory leaks and ghost walk animations on re-mount.

## File
`src/element.js` — `_teardown()` and constructor

## Audit checklist

Go through every property initialized in the constructor related to avatar-chat. Verify each is cleared in `_teardown()`.

| Property | Cleared? | Method |
|---|---|---|
| `_thoughtBubbleEl` | set to null after _renderShell | N/A (DOM removed on unmount) |
| `_thoughtTextEl` | same | N/A |
| `_walkStopDebounce` | ✅ `clearTimeout` in teardown | clearTimeout |
| `_walkReturnTimer` | should be removed (prompt 03) | N/A |
| `_isWalking` | ✅ set to false in teardown | direct assign |
| `_bubbleBuffer` | ❓ check | `this._bubbleBuffer = ''` |
| `_bubbleRafPending` | ❓ check | `this._bubbleRafPending = false` |
| `_streamingMsgEl` | ❓ check | `null` |
| `_streamingChatBuffer` | ❓ check | `''` |
| `_streamingChatRafPending` | ❓ check | `false` |
| `_chatAutoScroll` | ❓ check | `true` |
| `_pendingSay` | ❓ check | `null` |
| `_walkStopDebounce` | ✅ | clearTimeout |
| protocol.on listener (from prompt 28) | ❓ | store unsub fn, call in teardown |

## What to do

1. Read current `_teardown()` (around line 1640)
2. Read the constructor and list every `this._*` property
3. For every property not currently cleared in `_teardown()`, add the appropriate cleanup
4. For event listeners added to `protocol.on(...)` in `_boot()`, store the unsubscribe handle: `this._unsubNotify = protocol.on(ACTION_TYPES.NOTIFY, handler)` and call `this._unsubNotify?.()` in teardown

## Template for teardown additions

```js
// avatar-chat cleanup
clearTimeout(this._walkStopDebounce);
this._walkStopDebounce = null;
this._isWalking = false;
this._bubbleBuffer = '';
this._bubbleRafPending = false;
this._streamingMsgEl = null;
this._streamingChatBuffer = '';
this._streamingChatRafPending = false;
this._chatAutoScroll = true;
this._pendingSay = null;
this._unsubNotify?.();
this._unsubNotify = null;
this._clearThoughtBubble?.();
this._setBusy?.(false);
```

## Verification
Mount the component. Send a message mid-stream. Unmount (remove from DOM). Re-mount. No walk animation playing on fresh mount. No memory leak visible in Chrome DevTools Memory tab.
