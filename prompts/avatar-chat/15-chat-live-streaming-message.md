# 15 — Live streaming text in chat message body

## Status
Enhancement — currently the chat shows the complete assistant message only after streaming finishes. The thought bubble shows the in-progress text. For a production-quality experience, the chat should also stream text live into a message placeholder — like ChatGPT or Claude.ai — so the user can read ahead while the bubble runs.

## File
`src/element.js` — `brain:stream` handler, `brain:message` handler, `_renderMessage()`

## What to do

### On first chunk: create a placeholder message in chat

In the `brain:stream` handler, before calling `_streamToBubble`, check if a streaming placeholder exists. If not, create one:

```js
if (ev === 'brain:stream') {
    const chunk = e.detail?.chunk ?? '';
    if (this._thoughtBubbleEl && this.getAttribute('avatar-chat') !== 'off') {
        this._streamToBubble(chunk);
    }
    this._appendStreamChunkToChat(chunk);
    this._onStreamChunk();
}
```

Add the method:
```js
_appendStreamChunkToChat(chunk) {
    if (!this._chatEl || !chunk) return;
    if (!this._streamingMsgEl) {
        // Create the streaming placeholder
        this._chatEl.querySelector('.suggest-row')?.remove();
        const msg = document.createElement('div');
        msg.className = 'msg streaming';
        msg.innerHTML = '<div class="role"></div><div class="body"></div>';
        msg.querySelector('.role').textContent = 'assistant';
        this._chatEl.appendChild(msg);
        this._streamingMsgEl = msg.querySelector('.body');
    }
    this._streamingChatBuffer = (this._streamingChatBuffer || '') + chunk;
    if (!this._streamingChatRafPending) {
        this._streamingChatRafPending = true;
        requestAnimationFrame(() => {
            this._streamingChatRafPending = false;
            if (this._streamingMsgEl) {
                this._streamingMsgEl.textContent = this._streamingChatBuffer;
                this._chatEl.scrollTop = this._chatEl.scrollHeight;
            }
        });
    }
}
```

### On brain:message (assistant, final): replace placeholder with real message

In the `brain:message` handler, when the final assistant message arrives, remove the streaming placeholder before calling `_renderMessage`:

```js
if (ev === 'brain:message') {
    ...
    if (detail.role === 'assistant') {
        // Remove the streaming placeholder — _renderMessage will add the final message
        this._streamingMsgEl?.closest('.msg')?.remove();
        this._streamingMsgEl = null;
        this._streamingChatBuffer = '';
        this._streamingChatRafPending = false;
        this._clearThoughtBubble();
    }
    if (this._chatEl) this._renderMessage(detail);
}
```

### CSS — streaming cursor

Add to `BASE_STYLE`:
```css
.msg.streaming .body::after {
    content: '▋';
    opacity: 1;
    animation: blink-cursor 0.7s step-end infinite;
    margin-left: 2px;
}
@keyframes blink-cursor {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
}
```

### Constructor additions
```js
this._streamingMsgEl = null;
this._streamingChatBuffer = '';
this._streamingChatRafPending = false;
```

### Teardown additions
```js
this._streamingMsgEl = null;
this._streamingChatBuffer = '';
this._streamingChatRafPending = false;
```

## Verification
Send a message. Text should appear live in the chat with a blinking cursor. When the full message arrives, the cursor disappears and the message is finalized.
