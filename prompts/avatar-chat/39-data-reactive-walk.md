# 39 — data-reactive: walk when live data events push updates

## Status
Gap — `data-reactive.js` lets skills wire live SSE/WebSocket sources to the protocol bus. When data arrives and the avatar speaks or emotes, the user should see the avatar walk as part of the data delivery experience.

## Files
`src/runtime/data-reactive.js` — understand what protocol events it emits
`src/element.js` — walk wiring

## Background

Read `src/runtime/data-reactive.js`. The `startDataReactive()` function watches a stream source and calls `protocol.emit()` with events matched by `{ match, emit }` bindings. It typically emits `speak`, `emote`, or `notify` events.

## What to do

If data-reactive emits `speak` events on the protocol bus, the avatar's empathy layer already picks up the emotion. But walk is not triggered.

**Option A**: Subscribe to `ACTION_TYPES.SPEAK` on the protocol bus in element.js for walk:
```js
// In _boot(), after the protocol bus is set up:
this._unsubSpeak = protocol.on(ACTION_TYPES.SPEAK, () => {
    if (this.getAttribute('avatar-chat') !== 'off' && !this.hasAttribute('kiosk')) {
        this._onStreamChunk();
    }
});
```

Store in `this._unsubSpeak` and unsubscribe in `_teardown()`.

This means ANY `speak` event (from skills, data-reactive, runtime) triggers the walk. This is the right behavior — the avatar should walk whenever it's "saying" something.

**Option B**: Handle it in the `notify` path (prompt 28) — only if data-reactive routes through `notify`. Check the data-reactive code.

## Verification
Wire a data-reactive source that fires `speak` events (or set up a test that calls `protocol.emit({ type: 'speak', payload: { text: 'price update' } })`). Avatar should briefly walk when the event fires.
