# 34 — LiveKit realtime voice: walk during live voice session

## Status
Gap — when `voice="livekit"` is set, the avatar speaks via LiveKit's realtime audio rather than the browser TTS. The LiveKit voice client dispatches `voiceStateChange` events (see element.js around line 518). Walk should be active during the "speaking" voice state.

## File
`src/element.js` — `voiceStateChange` event listener

## Current code
```js
this.addEventListener('voiceStateChange', (e) => {
    if (!this._micEl) return;
    const { state } = e.detail;
    this._micEl.dataset.voiceState = state;
    ...
});
```

## What to add

```js
this.addEventListener('voiceStateChange', (e) => {
    if (!this._micEl) return;
    const { state } = e.detail;
    this._micEl.dataset.voiceState = state;
    this._micEl.title = state === 'idle' || !state
        ? 'Push to talk'
        : 'Voice active — click to stop';

    // Avatar walk during active voice states
    if (this.getAttribute('avatar-chat') !== 'off' && !this.hasAttribute('kiosk')) {
        if (state === 'speaking' || state === 'thinking') {
            this._onStreamChunk();
        } else if (state === 'idle') {
            this._stopWalkAnimation();
        }
    }
});
```

`state` values: `'idle'`, `'listening'`, `'thinking'`, `'speaking'` — based on what VoiceClient dispatches.

Also show thought bubble during LiveKit speaking:
```js
if (state === 'speaking' && this._thoughtBubbleEl && this.getAttribute('avatar-chat') !== 'off') {
    this._thoughtBubbleEl.dataset.active = 'true';
    // dots mode (no text — we don't have the text yet in realtime)
    this._thoughtBubbleEl.dataset.streaming = 'false';
}
if (state === 'idle') {
    this._clearThoughtBubble();
}
```

## Verification
Connect with LiveKit voice. The avatar should walk while the AI speaks and return to idle when quiet.
