# 28 — AgentNotifier integration: walk when notification plays

## Status
Gap — `AgentNotifier` (src/agent-notifier.js) handles `notify` protocol events by having the avatar enter frame, deliver a message, then retreat. The avatar currently uses its own animation logic for this. The walk animation should coordinate with notify events so the avatar walks during notification delivery.

## Files
`src/agent-notifier.js` — understand its animation pattern
`src/element.js` — wire walk to notify events

## What to investigate first

Read `src/agent-notifier.js`. Find where it triggers avatar movement or animation. The notifier likely calls `protocol.emit({ type: ACTION_TYPES.SPEAK, ... })` and possibly `ACTION_TYPES.GESTURE`. Determine if it fires any event that element.js can listen to for walk timing.

## What to implement

If AgentNotifier fires `notify` events that element.js already listens for (check the re-dispatch list), add walk behavior:

In the `for (const ev of [...])` listener block, if `'notify'` is not already there, add it. Then:
```js
if (ev === 'notify') {
    const duration = e.detail?.duration ?? 3000;
    if (this.getAttribute('avatar-chat') !== 'off' && !this.hasAttribute('kiosk')) {
        this._onStreamChunk(); // start walking
        // Stop after notification duration
        setTimeout(() => this._stopWalkAnimation(), duration + 500);
    }
}
```

Or subscribe directly to the `protocol` bus for `ACTION_TYPES.NOTIFY`:
```js
protocol.on(ACTION_TYPES.NOTIFY, ({ payload }) => {
    if (this.getAttribute('avatar-chat') === 'off') return;
    const duration = payload?.duration ?? 3000;
    this._onStreamChunk();
    setTimeout(() => this._stopWalkAnimation(), duration + 500);
});
```

Ensure the protocol listener is cleaned up in `_teardown()` by storing the unsubscribe function.

## Verification
Trigger a notification (via `element.notify('Hello!')` if that's the API, or via protocol.emit). The avatar should walk for the duration of the notification then return to idle.
