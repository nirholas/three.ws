# 48 — Chat message rendering: basic markdown in responses

## Status
Enhancement — LLM responses often contain markdown (bold, lists, code). The current `_renderMessage()` sets `textContent` which renders markdown as raw symbols. Production chat UIs render at least basic markdown.

## File
`src/element.js` — `_renderMessage()` and `_appendStreamChunkToChat()`

## What to implement

A minimal, safe inline markdown renderer — no external library, no XSS risk:

```js
_renderMarkdown(text) {
    // Bold: **text** → <strong>text</strong>
    // Italic: *text* → <em>text</em>
    // Code: `text` → <code>text</code>
    // Line breaks: \n → <br>
    // Escape HTML first to prevent XSS
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return escaped
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}
```

Use `innerHTML` with the sanitized output instead of `textContent`:
```js
// In _renderMessage():
msg.querySelector('.body').innerHTML = this._renderMarkdown(content);
```

**For streaming (prompt 15):** The streaming placeholder should use `textContent` (not innerHTML) during streaming to avoid partial-tag injection, then switch to innerHTML with markdown rendering when the final message arrives:
```js
// In brain:message handler, when replacing placeholder:
this._streamingMsgEl?.closest('.msg')?.remove();
// _renderMessage will use innerHTML+markdown for the final message
```

## CSS additions

```css
.msg .body code {
    font-family: monospace;
    background: rgba(255,255,255,0.08);
    padding: 1px 4px;
    border-radius: 4px;
    font-size: 12px;
}
.msg .body strong { font-weight: 700; }
.msg .body em { font-style: italic; opacity: 0.9; }
```

## Security note

The `_renderMarkdown()` function HTML-escapes first, then applies regex substitutions on the escaped string. This is safe — no user-controlled HTML can sneak through because `<` and `>` are escaped before any pattern matching.

## Verification
Ask the agent to use markdown: "Respond with **bold** text and `code` and a list." The chat should render the formatting correctly, not show raw asterisks.
