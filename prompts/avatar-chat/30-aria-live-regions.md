# 30 — Accessible aria-live regions for thought bubble and streaming chat

## Status
Accessibility gap — screen reader users get no feedback while the avatar is "thinking" or streaming. The thought bubble is aria-hidden effectively (no live region). Chat messages appear silently.

## File
`src/element.js` — `_renderShell()`

## What to do

### Thought bubble

The thought bubble element already has `aria-live="polite"` (added in the initial implementation). Verify this is present. If the DOM change is `textContent` of `.thought-bubble .text`, aria-live should announce it.

However, a better pattern for a loading indicator is `role="status"` with `aria-live="polite"` and `aria-label`:
```js
thoughtBubble.setAttribute('role', 'status');
thoughtBubble.setAttribute('aria-live', 'polite');
thoughtBubble.setAttribute('aria-label', 'Agent is thinking');
```

When streaming starts, update the label:
```js
// In _streamToBubble:
this._thoughtBubbleEl.setAttribute('aria-label', 'Agent is responding');
```

When cleared:
```js
// In _clearThoughtBubble:
this._thoughtBubbleEl.setAttribute('aria-label', '');
```

### Chat messages

The chat div should be a live region so new messages are announced:
```js
chat.setAttribute('aria-live', 'polite');
chat.setAttribute('aria-label', 'Conversation');
chat.setAttribute('role', 'log');
```

`role="log"` implies `aria-live="polite"` and is semantically correct for chat. New `.msg` divs appended to it will be read aloud by screen readers.

### Input accessibility

The input should have a clear label:
```js
input.setAttribute('aria-label', 'Message to agent');
```

The mic button already has `title="Push to talk"` but needs `aria-label`:
```js
micBtn.setAttribute('aria-label', 'Push to talk');
```

## Verification
Enable VoiceOver (Mac) or NVDA (Windows). Send a message. VoiceOver should announce "Agent is responding" when the bubble appears, and read out new chat messages as they arrive.
