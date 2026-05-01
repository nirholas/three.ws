# 31 — Keyboard navigation and focus management

## Status
Accessibility gap — with the new chrome layout (vertical column filling the entire element), focus order and tab stops may be broken. The avatar anchor is `pointer-events: none` which is correct, but the overall tab order should be: chat messages → input → mic button.

## File
`src/element.js` — `_renderShell()`, CSS

## What to audit

### Tab order
The shadow DOM's tab order follows DOM order. Current DOM order:
1. `.stage` (canvas — no focusable children unless Three.js adds any)
2. `.poster`
3. `.loading`
4. `.drag-handle`
5. `.name-plate`
6. `.pill-btn`
7. `.pill-drag`
8. `.chrome`
   - `.chat` (not focusable but scrollable — should it be?)
   - `.avatar-anchor` (pointer-events: none, not focusable — correct)
   - `.input-row`
     - `input` (focusable)
     - `button.mic` (focusable)
9. `.tool-indicator`
10. `.alert-banner`

This order is correct. The canvas is not in the tab sequence.

### Fix: Make chat scrollable via keyboard

The `.chat` div is scrollable (`overflow-y: auto`) but not keyboard-focusable. Users who want to scroll through history can't without a mouse. Add:
```js
chat.setAttribute('tabindex', '0');
```

This lets keyboard users Tab to the chat area and use arrow keys / Page Up/Down to scroll.

### Fix: Alert banner dismiss button

The alert banner's close button must be keyboard accessible. Verify it already has `aria-label="Dismiss"` and is a real `<button>` (not a div). It should be — check and confirm.

### Fix: Focus management on message send

After the user submits a message (Enter key), focus should remain on the input. Confirm `input.focus()` is called after clearing the value:
```js
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
        const v = input.value.trim();
        input.value = '';
        this._onStreamChunk();
        this.say(v);
        input.focus(); // keep focus
    }
});
```

### Fix: Disabled input focus (prompt 16 interaction)

When `input.disabled = true` (during streaming), Tab will skip it. When re-enabled, focus won't automatically return. After `_setBusy(false)`:
```js
_setBusy(busy) {
    ...
    if (!busy && document.activeElement === document.body) {
        this._inputEl?.focus();
    }
}
```

## Verification
Tab through the page. Focus should reach the chat (scrollable), then the input, then the mic button. No tab stops land on the avatar or canvas.
