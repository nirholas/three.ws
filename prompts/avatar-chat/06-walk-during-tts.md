# 06 — Walk during TTS voice playback

## Status
Gap — when voice mode is on and the TTS speaks the reply aloud, the avatar stands still. It should walk while speaking.

## Files
`src/element.js` — `voice:speech-start` / `voice:speech-end` handlers

## What to do

The runtime already dispatches `voice:speech-start` and `voice:speech-end` events, and element.js already re-dispatches them to the host. Add walk behavior to those handlers.

In the `for (const ev of [...])` listener block in element.js:

```js
if (ev === 'voice:speech-start') {
    this._onStreamChunk(); // start walking
}
if (ev === 'voice:speech-end') {
    this._stopWalkAnimation(); // return to idle
}
```

This works because `_onStreamChunk()` already handles the debounce — if the avatar is already walking from a stream, the TTS start just resets the debounce timer keeping it walking.

### Thought bubble during TTS

Optionally, show the text being spoken in the thought bubble during TTS:

```js
if (ev === 'voice:speech-start') {
    this._onStreamChunk();
    if (this._thoughtBubbleEl && this.getAttribute('avatar-chat') !== 'off') {
        const text = e.detail?.text || '';
        this._streamToBubble(''); // activate bubble in streaming mode
        this._thoughtBubbleEl.dataset.streaming = 'true';
        this._thoughtBubbleEl.dataset.active = 'true';
        if (this._thoughtTextEl) this._thoughtTextEl.textContent = text.slice(0, 80);
    }
}
if (ev === 'voice:speech-end') {
    this._stopWalkAnimation();
    this._clearThoughtBubble();
}
```

## Verification
Set `voice="browser"` on the element. Send a message. Avatar should walk while TTS speaks and return to idle when TTS ends.
