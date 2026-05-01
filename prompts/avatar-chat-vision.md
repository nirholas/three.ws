# Avatar-in-Chat Vision — Implementation Prompts

Three self-contained prompts to be executed in order. Each builds on the previous.

---

## Prompt 1 — Add token streaming to the LLM provider and runtime

**Goal:** The provider currently does a blocking `await res.json()` and returns the full response at once. Change it to stream tokens via SSE so the runtime can emit each chunk as it arrives.

**File:** `src/runtime/providers.js` — `AnthropicProvider.complete()`
**File:** `src/runtime/index.js` — `_loop()`

### What to change in providers.js

Replace the `complete()` method in `AnthropicProvider` with a streaming version:

1. Add `stream: true` to the fetch body.
2. Read the response as an SSE stream (`response.body.getReader()`).
3. Parse `data:` lines, decode JSON events. Anthropic streaming event types you care about:
   - `content_block_delta` with `delta.type === 'text_delta'` → accumulate `delta.text` into `out.text`
   - `content_block_delta` with `delta.type === 'thinking_delta'` → accumulate into `out.thinking`
   - `content_block_start` with `block.type === 'tool_use'` → start buffering a tool call `{ id, name, input: '' }`
   - `content_block_delta` with `delta.type === 'input_json_delta'` → append `delta.partial_json` to the current tool call's input string
   - `content_block_stop` → finalize the current tool call (parse the input JSON string)
   - `message_stop` → stream is done
4. Add an optional `onChunk(text: string)` callback parameter to `complete({ ..., onChunk })`. Call it with each `text_delta` chunk as it arrives.
5. Return the same normalized shape `{ text, toolCalls, thinking, stopReason }` as before — the method signature doesn't change for callers.

Keep `NullProvider.complete()` unchanged.

### What to change in runtime/index.js

In `_loop()`, where `this.provider.complete(...)` is called, pass an `onChunk` callback:

```js
const response = await this.provider.complete({
  system: this.systemPrompt,
  messages: this.messages,
  tools: this.tools,
  onChunk: (chunk) => {
    this.dispatchEvent(new CustomEvent('brain:stream', { detail: { chunk } }));
  },
});
```

Also: fire `brain:thinking` with `{ thinking: true }` at the start of `_loop()` iteration, and `{ thinking: false }` once `response` resolves (before the tool dispatch block). This replaces the existing post-hoc thinking event which only fires when `response.thinking` has content.

```js
// At start of each iteration:
this.dispatchEvent(new CustomEvent('brain:thinking', { detail: { thinking: true } }));

// After provider.complete() resolves:
this.dispatchEvent(new CustomEvent('brain:thinking', { detail: { thinking: false } }));
```

Add `'brain:stream'` to the re-dispatch list in `element.js` (the `for (const ev of [...])` loop around line 1127).

**Verification:** After this change, typing a message in the UI should cause `brain:stream` events to fire rapidly in the browser console (`window.VIEWER.agent_protocol` won't have them — listen on the Runtime instance directly or add a console.log temporarily).

---

## Prompt 2 — Stream tokens into the thought bubble above the avatar

**Goal:** While the LLM is generating, the thought bubble above the avatar's head should display the tokens as they arrive — like a comic-book speech bubble showing the character's words forming in real time. When the full message lands in the chat, the bubble clears.

**Files:** `src/element.js`

### CSS changes

Update `.thought-bubble` in `BASE_STYLE`:

- Remove the fixed `white-space: nowrap` — replace with `max-width: min(280px, 60%)` and `white-space: normal` so longer text wraps.
- Add `min-width: 80px; min-height: 28px;` so the bubble has a stable minimum size.
- Keep the existing transition and box-shadow.

Add a `.thought-bubble .text` child rule:
```css
.thought-bubble .text {
  font: 13px/1.4 var(--agent-chat-font);
  color: #1a1a2e;
  display: none;
}
.thought-bubble[data-streaming="true"] .text { display: block; }
.thought-bubble[data-streaming="true"] .dot { display: none; }
```

So: dots show when `data-active="true"` (thinking / waiting), text shows when `data-streaming="true"` (tokens arriving).

### DOM changes in `_renderShell`

Change the thought bubble innerHTML from three dots to:
```js
thoughtBubble.innerHTML =
  '<span class="text"></span>' +
  '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
```

Store a reference to the text span: `this._thoughtTextEl = thoughtBubble.querySelector('.text');`

### Event wiring in the `brain:*` listener block

**On `brain:stream`:**
```js
if (ev === 'brain:stream') {
  if (this._thoughtBubbleEl && this.getAttribute('avatar-chat') !== 'off') {
    const chunk = e.detail?.chunk ?? '';
    this._streamToBubble(chunk);
  }
}
```

Add `'brain:stream'` to the `for (const ev of [...])` array.

**On `brain:thinking` when `thinking: false`** (stream finished):
- Clear the bubble text and switch it back to dots-only mode.

### New method `_streamToBubble(chunk)`

```js
_streamToBubble(chunk) {
  if (!this._thoughtBubbleEl || !this._thoughtTextEl) return;
  this._thoughtBubbleEl.dataset.active = 'true';
  this._thoughtBubbleEl.dataset.streaming = 'true';
  this._thoughtTextEl.textContent += chunk;
  // Keep only the last ~120 chars so the bubble doesn't grow forever
  const t = this._thoughtTextEl.textContent;
  if (t.length > 120) {
    this._thoughtTextEl.textContent = '…' + t.slice(-110);
  }
}

_clearThoughtBubble() {
  if (!this._thoughtBubbleEl) return;
  this._thoughtBubbleEl.dataset.active = 'false';
  this._thoughtBubbleEl.dataset.streaming = 'false';
  if (this._thoughtTextEl) this._thoughtTextEl.textContent = '';
}
```

Call `_clearThoughtBubble()` when `brain:thinking` fires with `thinking: false`, and also when `brain:message` fires with `role: 'assistant'` (the full message has landed — bubble can go away).

**Verification:** Prompt the agent. The thought bubble should appear, fill with streaming words, then disappear when the final message appears in the chat.

---

## Prompt 3 — Walk animation synchronized to streaming, not a fixed timer

**Goal:** The avatar walks while tokens are actively arriving (chat is scrolling upward). It stops as soon as streaming ends. This replaces the current fixed-duration timer approach.

**Files:** `src/element.js`

### Replace `_startWalkAnimation` with stream-aware version

Remove the current `_startWalkAnimation(text)` method and its call site in `brain:message`.

Instead, control walk state from two events:

**When `brain:stream` fires** (tokens arriving → walk):
```js
if (ev === 'brain:stream') {
  // ... bubble update (from Prompt 2) ...
  this._onStreamChunk();
}
```

**When `brain:thinking` fires with `thinking: false`** (stream done → return to idle):
```js
this._stopWalkAnimation();
```

### New methods

```js
_onStreamChunk() {
  if (!this._scene || this.getAttribute('avatar-chat') === 'off') return;
  if (!this._isWalking) {
    this._isWalking = true;
    this._scene.playClipByName('walk', { loop: true, fade_ms: 300 });
  }
  // Reset a short debounce — if chunks stop arriving for 600ms, stop walking
  clearTimeout(this._walkStopDebounce);
  this._walkStopDebounce = setTimeout(() => this._stopWalkAnimation(), 600);
}

_stopWalkAnimation() {
  if (!this._isWalking) return;
  this._isWalking = false;
  clearTimeout(this._walkStopDebounce);
  this._scene?.playClipByName('idle', { loop: true, fade_ms: 500 });
}
```

Add `this._isWalking = false` and `this._walkStopDebounce = null` to the constructor.

In `_teardown()`, add `clearTimeout(this._walkStopDebounce)` alongside the existing `clearTimeout(this._walkReturnTimer)`. Remove `_walkReturnTimer` cleanup since that method is gone.

### Chat scroll synchronization (bonus — makes it feel physical)

In `_renderMessage()`, after appending the message and scrolling:
```js
// Nudge the walk animation each time a new message causes a scroll
if (this._isWalking) {
  // already walking — the scroll is visually consistent, nothing extra needed
} else if (this.getAttribute('avatar-chat') !== 'off') {
  // A message arrived outside of streaming (e.g. tool result card) — brief walk
  this._onStreamChunk();
}
```

**Verification:** 
1. Send a message. Avatar starts walking immediately when the first token arrives.
2. Streaming ends. Avatar smoothly crossfades back to idle within 600ms of the last token.
3. No walk occurs if `avatar-chat="off"`.
