# 50 — Final integration smoke test

## Status
Final gate — run this end-to-end after all other prompts are complete. This is the go/no-go check before merging to main.

## Prerequisites
- All prompts 01–49 completed and verified
- Dev server running (`npm run dev`)
- Test page accessible at `http://localhost:3001/test-avatar-chat.html`

---

## Smoke test sequence

### Test A — Full conversation flow
1. Open test page
2. Open DevTools console, run: `document.querySelector('agent-3d').addEventListener('brain:stream', e => console.count('chunk'))`
3. Type "Explain quantum entanglement in 3 sentences" → Enter
4. **Expected**:
   - Input disables immediately with "Thinking…"
   - Avatar starts walking within 100ms of Enter key
   - Thought bubble appears with dots, then switches to streaming text
   - Chat message body fills with live text (blinking cursor)
   - Console shows 20+ `chunk` count events
   - Message finalizes in chat, bubble disappears, avatar returns to idle
   - Input re-enables
5. Confirm zero console errors

### Test B — Tool call flow
1. Type "What's trending on pump.fun right now?" → Enter
2. **Expected**:
   - Avatar walks while tool executes
   - Bubble shows "Searching pump.fun…"
   - After tool result, LLM continues streaming with avatar walking
   - Response lands in chat with token card below it
   - Avatar returns to idle

### Test C — avatar-chat="off" toggle
1. Click "Toggle avatar-chat='off'"
2. **Expected**:
   - Layout switches to bottom-bar (horizontal, not vertical column)
   - Send a message
   - Avatar does NOT walk
   - Thought bubble does NOT appear
3. Click toggle again
4. **Expected**: Layout returns to vertical column. Next message triggers walk and bubble.

### Test D — Reduced motion
1. DevTools → Rendering → prefers-reduced-motion: reduce
2. Send a message
3. **Expected**: Thought bubble appears but dots don't bounce. Avatar stays in idle (no walk).
4. Turn off reduced motion emulation.

### Test E — Rapid send
1. Type "hi" → Enter (don't wait for response)
2. Type "how are you" → Enter immediately
3. Type "tell me a joke" → Enter immediately
4. **Expected**: First message processes. Third message queues. Second is dropped. No console errors. After first completes, third processes.

### Test F — Teardown mid-stream
1. Start a long message ("Write a 500 word essay...")
2. Immediately after bubble appears, run in console: `document.querySelector('agent-3d').remove()`
3. **Expected**: No "Cannot read properties of null" errors. No stuck walk animations (element is removed so this is moot, but no unhandled rejections).

### Test G — Background modes
1. Add `background="dark"` → verify white bubble
2. Add `background="light"` → verify dark bubble
3. Remove background attr → verify bubble still visible

### Test H — Floating mode
1. Change `mode="inline"` to `mode="floating"` in console or test page
2. Send a message
3. **Expected**: Floating card with rounded corners. Drag handle at top. Chat, avatar window, input all properly padded. Walk and bubble work inside floating card.

---

## Sign-off criteria
All 8 tests pass with zero console errors and zero visual regressions.

**Go / No-go**: _______________________

**Tested by**: _______________________  **Date**: _______________________
