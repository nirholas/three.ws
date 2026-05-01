# 43 — Manual test checklist

## Status
Required — use this checklist to sign off that all avatar-chat features work end-to-end before shipping.

## Setup
Open `http://localhost:3001/test-avatar-chat.html` (from prompt 42). Use an agent with `brain="claude-opus-4-6"` and a humanoid GLB model.

---

## Core functionality

- [ ] **Thought bubble appears** — Send a message. Bubble shows above avatar head before first response word.
- [ ] **Bubble shows streaming text** — Words appear in the bubble as they stream, not just dots.
- [ ] **Bubble dots mode** — During the pre-stream thinking pause (before first token), three animated dots show.
- [ ] **Bubble clears** — When the full message lands in chat, bubble fades out.
- [ ] **Avatar walks on stream** — Avatar plays walk animation while tokens are arriving.
- [ ] **Walk stops on stream end** — Avatar returns to idle within 600ms of last token.
- [ ] **Walk starts immediately** — Pressing Enter triggers walk before the first token (prompt 07).

---

## Tool calls

- [ ] **Walk during tool call** — Send a pump.fun query. Avatar walks while the tool runs (prompt 05).
- [ ] **Bubble shows tool label** — "Searching pump.fun…" appears in bubble during tool (prompt 09).
- [ ] **Walk continues into next LLM turn** — After tool result, avatar keeps walking while the LLM generates the final response.

---

## Layout

- [ ] **Inline mode** — Chat at top, avatar window in middle, input at bottom. Avatar visible through center.
- [ ] **avatar-chat="off" toggle** — Toggle button switches to original bottom-bar layout. Walk and bubble stop.
- [ ] **Re-enable** — Removing `avatar-chat="off"` restores the column layout.
- [ ] **Floating mode** — `mode="floating"`: rounded card, drag handle doesn't overlap chat.
- [ ] **Section/fullscreen** — `mode="fullscreen"`: input stays at bottom, chat max-height is reduced, no awkward stretching on wide screens.

---

## Edge cases

- [ ] **Rapid messages** — Submit 3 messages quickly. Only one executes at a time. No console errors. (prompt 22)
- [ ] **Navigate away mid-stream** — Remove element from DOM during streaming. No stuck walk, no console errors. (prompt 21)
- [ ] **Long response** — 200+ word response. Walk stays active throughout. Bubble cycles through sentences. Chat auto-scrolls.
- [ ] **Short response** — 5-word response. Walk starts, bubble flashes, both end cleanly within 1 second.
- [ ] **Empty response** — Edge case where LLM returns empty text. No crash.

---

## Accessibility

- [ ] **Reduced motion** — DevTools → Rendering → prefers-reduced-motion: reduce. Bubble dots stop bouncing. Avatar does not walk.
- [ ] **Screen reader** — VoiceOver announces "Agent is responding" when bubble appears. Chat messages are read aloud.
- [ ] **Keyboard only** — Tab reaches input. Enter submits. Tab reaches mic button. No mouse required.

---

## Performance

- [ ] **No layout thrashing** — Chrome DevTools Performance panel during a 100-word response. Bubble DOM writes ≤ 60/sec.
- [ ] **Walk clip preloaded** — Network panel shows `walk.json` loaded at page boot, not on first message.

---

## Background variants

- [ ] **Dark background** — Bubble is white with dark text.
- [ ] **Light background** — Bubble is dark with light text (prompt 11).
- [ ] **Transparent background** — Bubble visible against whatever is behind the element.

---

## Sign-off
All items checked: _______________________  Date: _______________________
