# 43 — Manual QA checklist

## Status
Required — run this checklist end-to-end before marking the feature production-ready. Each item must pass.

---

## Layout

- [ ] Chrome shows: chat at top, transparent avatar window in middle, input at bottom
- [ ] Chat has no content → `.chat:empty { display: none }` hides it, avatar takes full window
- [ ] Chat has content → chat takes up to 38% of height, avatar window shrinks proportionally
- [ ] Input pill is at the bottom, full width
- [ ] `avatar-chat="off"` → original bottom-bar layout (chat left, input right)
- [ ] `avatar-chat="off"` → avatar anchor and thought bubble not visible
- [ ] `mode="floating"` → layout works, drag handle doesn't overlap chat
- [ ] `mode="fullscreen"` → layout works
- [ ] Mobile 375px viewport with floating mode → pill collapses, expands to bottom-sheet with correct layout

---

## Thought Bubble

- [ ] Sending a message → bubble appears with animated dots within 200ms
- [ ] First streaming token arrives → bubble switches to text mode, dots hidden
- [ ] Text streams → bubble shows current phrase (not growing unboundedly)
- [ ] Long response → bubble clears at sentence boundaries, shows fresh phrases
- [ ] Response complete → bubble fades out within 300ms of last token
- [ ] Tool call running → bubble shows tool label ("Searching pump.fun…") in text mode
- [ ] Bubble tail points downward toward avatar
- [ ] Light background (`background="light"`) → bubble is dark with light text
- [ ] `avatar-chat="off"` → bubble never appears
- [ ] `prefers-reduced-motion: reduce` → dots don't animate (static)

---

## Walk Animation

- [ ] User presses Enter → avatar starts walking immediately
- [ ] First streaming token arrives → avatar walks (if not already)
- [ ] Streaming stops → avatar returns to idle within 1 second
- [ ] Tool call executes → avatar walks during tool execution
- [ ] TTS speaks → avatar walks during speech
- [ ] Voice state = "speaking" (LiveKit) → avatar walks
- [ ] Voice state = "idle" (LiveKit) → avatar returns to idle
- [ ] `avatar-chat="off"` → avatar never walks (stays in idle or empathy-layer animations)
- [ ] `prefers-reduced-motion: reduce` → avatar does NOT walk
- [ ] Kiosk mode → avatar does NOT walk

---

## Chat

- [ ] User message appears immediately when submitted
- [ ] Streaming text appears live in chat with blinking cursor (prompt 15)
- [ ] Final message replaces streaming placeholder (no duplicate)
- [ ] Chat auto-scrolls during streaming
- [ ] Manually scroll up mid-stream → auto-scroll pauses
- [ ] Scroll back to bottom → auto-scroll resumes
- [ ] Tool result cards render correctly

---

## Input State

- [ ] During streaming → input is disabled, placeholder shows "Thinking…"
- [ ] After response → input re-enabled, placeholder shows "Say something…"
- [ ] Rapid submissions → queued correctly (latest wins)
- [ ] Network error mid-stream → input re-enables, walk stops, bubble clears

---

## Accessibility

- [ ] Tab order: chat → input → mic button (no focus on avatar/canvas)
- [ ] Screen reader announces "Agent is responding" when bubble appears
- [ ] Screen reader reads new chat messages as they arrive

---

## Performance

- [ ] 60fps during streaming (check Chrome Performance panel)
- [ ] Bubble DOM writes batched to RAF (no per-token layout)
- [ ] Walk animation crossfades smoothly (no snap)
- [ ] `walk.json` and `idle.json` preloaded before first message

---

## Cleanup

- [ ] Mount → unmount → re-mount: no ghost walk, no stuck bubble
- [ ] Navigate away mid-stream: no console errors
