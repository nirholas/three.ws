# 50 — Production readiness: final gate checklist

## Status
Final — run this after all other prompts are complete. This is the shipping gate.

---

## Prompts completion status

| # | Prompt | Done? |
|---|---|---|
| 01 | Fix thought bubble DOM (.text span) | ☐ |
| 02 | Fix brain:thinking event order | ☐ |
| 03 | Remove stale _walkReturnTimer refs | ☐ |
| 04 | Preload walk + idle clips on boot | ☐ |
| 05 | Walk during tool calls | ☐ |
| 06 | Walk during TTS | ☐ |
| 07 | Walk on user send | ☐ |
| 08 | Reduced motion support | ☐ |
| 09 | Tool call label in bubble | ☐ |
| 10 | Bubble CSS custom properties | ☐ |
| 11 | Bubble light background adaptation | ☐ |
| 12 | Bubble enter/exit animation | ☐ |
| 13 | Bubble head tracking in 3D | ☐ |
| 14 | Bubble RAF batching | ☐ |
| 15 | Live streaming text in chat | ☐ |
| 16 | Input state during streaming | ☐ |
| 17 | Chat auto-scroll during streaming | ☐ |
| 18 | Floating mode layout | ☐ |
| 19 | Mobile pill mode | ☐ |
| 20 | Camera framing for inline mode | ☐ |
| 21 | Stream abort / error handling | ☐ |
| 22 | Concurrent request guard | ☐ |
| 23 | Proxy SSE passthrough | ☐ |
| 24 | Kiosk mode disable | ☐ |
| 25 | ACTION_TYPES: brain:stream | ☐ |
| 26 | EMBED_SPEC docs | ☐ |
| 27 | JS API: enableAvatarChat/disable | ☐ |
| 28 | Notifier walk integration | ☐ |
| 29 | Animation preload strategy | ☐ |
| 30 | aria-live regions | ☐ |
| 31 | Keyboard navigation | ☐ |
| 32 | Walk animation review | ☐ |
| 33 | Bubble tail direction | ☐ |
| 34 | LiveKit voice walk | ☐ |
| 35 | Crossfade timing tuning | ☐ |
| 36 | Bubble truncation and readability | ☐ |
| 37 | Teardown complete cleanup | ☐ |
| 38 | NullProvider graceful degradation | ☐ |
| 39 | data-reactive walk | ☐ |
| 40 | lib.js export update | ☐ |
| 41 | Section/fullscreen modes | ☐ |
| 42 | Test page created | ☐ |
| 43 | Manual QA checklist passed | ☐ |
| 44 | src/CLAUDE.md updated | ☐ |
| 45 | Lint and format | ☐ |
| 46 | JSDoc annotations | ☐ |
| 47 | app.js hash param | ☐ |
| 48 | Markdown rendering in chat | ☐ |
| 49 | vite.config.js verified | ☐ |

---

## Hard requirements (must be ✅ before shipping)

- [ ] 01 — bubble DOM fix (streaming text invisible without this)
- [ ] 15 — live streaming in chat (core UX)
- [ ] 16 — input disabled during streaming (prevents "runtime busy" errors)
- [ ] 21 — stream abort on teardown (prevents memory leaks)
- [ ] 23 — proxy SSE passthrough (streaming broken without this)
- [ ] 37 — teardown cleanup (memory leaks)
- [ ] 43 — QA checklist passed
- [ ] 45 — lint clean

## Nice-to-have (ship without if needed)

- 13 — head tracking (fixed position is acceptable)
- 32 — walk animation review (strafe may be fine)
- 48 — markdown rendering (plain text is acceptable)

## Deploy command

```bash
npm run build
# Verify dist/ output
# Deploy to production environment
```
