# 17 — Auto-scroll chat to bottom during live streaming

## Status
Gap — when prompt 15 (live streaming message) is implemented, the streaming text grows the `.msg.streaming` div but `scrollTop` is only updated inside an RAF. At high text volumes or when the user has manually scrolled up, the chat may not follow.

## File
`src/element.js` — `_appendStreamChunkToChat()`

## What to do

Implement "smart scroll" — only auto-scroll if the user hasn't manually scrolled up to read history.

```js
_appendStreamChunkToChat(chunk) {
    if (!this._chatEl || !chunk) return;
    
    // Track whether user has scrolled away from the bottom
    if (!this._streamingMsgEl) {
        this._chatEl.querySelector('.suggest-row')?.remove();
        const msg = document.createElement('div');
        msg.className = 'msg streaming';
        msg.innerHTML = '<div class="role"></div><div class="body"></div>';
        msg.querySelector('.role').textContent = 'assistant';
        this._chatEl.appendChild(msg);
        this._streamingMsgEl = msg.querySelector('.body');
        this._chatAutoScroll = true; // reset on new message
    }

    // Detect manual scroll-up (more than 40px from bottom = user is reading history)
    const el = this._chatEl;
    this._chatAutoScroll = (el.scrollHeight - el.scrollTop - el.clientHeight) < 40;

    this._streamingChatBuffer = (this._streamingChatBuffer || '') + chunk;
    if (!this._streamingChatRafPending) {
        this._streamingChatRafPending = true;
        requestAnimationFrame(() => {
            this._streamingChatRafPending = false;
            if (!this._streamingMsgEl) return;
            this._streamingMsgEl.textContent = this._streamingChatBuffer;
            if (this._chatAutoScroll) {
                this._chatEl.scrollTop = this._chatEl.scrollHeight;
            }
        });
    }
}
```

Also add `this._chatAutoScroll = true` to the constructor and teardown.

## Verification
Start a long response. Manually scroll up mid-stream — the chat should stop auto-scrolling. Scroll back to the bottom — it should resume following.
