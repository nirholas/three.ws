---
slug: drive-open-head-unit-carplay-lane
title: Drive lane D, the agent beside a projected CarPlay or Android Auto session on an open head unit
tier: GATED
score: 12
area: drive
sources: docs/carplay.md#Lane D: the open head unit (designed, not built), docs/carplay.md#7. Licensing, docs/carplay.md#5. Build plan
---

## Why this matters

Apple gives a conversational CarPlay app no drawing surface, so the agent as the face of the car is only legal on an open head unit: `node-carplay` plus a Carlinkit CPC200 dongle renders a real CarPlay or Android Auto session inside a browser surface we own, on a Raspberry Pi or any Linux box, with the 3D agent standing beside the projected phone screen at full size. `docs/carplay.md` scopes it as "Lane D, designed, not built" because it needs hardware to build against. Everything up to the dongle can be built and tested with the dongle stubbed at the USB boundary only.

## Current state (measured by the reviewer on 2026-11-03)

- `/drive` exists (`pages/drive.html`, `src/drive/*`, `tests/drive-surface.test.js`) and is the agent half; it already accepts a surface preset (`src/drive/surface.js`).
- No `node-carplay` dependency, no head-unit app, no docs for the lane beyond `docs/carplay.md` section "Lane D".
- License posture is settled: `node-carplay` is MIT; GPL projects (OpenAuto, aasdk) are excluded. Fixes made to `node-carplay` go upstream.

## Step 0: re-derive the current state

```
grep -rn -i "node-carplay\|carlinkit\|cpc200" --include=*.json --include=*.js --include=*.md . 2>/dev/null | grep -v node_modules | head
ls src/drive pages/drive.html
npm view node-carplay version license repository.url 2>&1 | head -5
lsusb 2>/dev/null | head
```

## Tasks

1. Create `apps/head-unit/` (check `ls apps` and `STRUCTURE.md` for the right home) with a README, a pinned `node-carplay` dependency (verify the LICENSE file before adopting), and a minimal Electron-free web shell: a Node service that owns the USB dongle and streams the decoded video and audio to a local page, plus a page that lays the projected screen beside the `/drive` agent (embed `/drive?surface=headunit` or a new preset).
2. Add a `headunit` preset to `src/drive/surface.js` (larger glyphs, 3D stage ON because this lane has a real display) with unit tests first in `tests/drive-surface.test.js`.
3. Isolate the dongle behind one interface (`open()`, `onVideo`, `onAudio`, `sendTouch`, `close`) so the whole app can run in a "no dongle" mode that shows an honest "Connect a CarPlay dongle" empty state with the exact USB vendor/product ids the CPC200 enumerates as. No fake video source: the empty state is the real behavior without hardware.
4. Test the service's connection state machine (disconnected, probing, connected, error with retry) with the dongle interface driven by a recorded-protocol fixture captured from `node-carplay`'s own test data, not invented bytes.
5. Write `apps/head-unit/README.md` and the Pi setup runbook (udev rule for the dongle, kiosk Chromium launch, auto-start unit file), and update `docs/carplay.md` lane D and the build-plan phase 7 row.
6. Everything that needs the physical dongle goes into one short "first connection" checklist for the owner; do not claim it verified.

## Definition of done

- [ ] `npx vitest run tests/drive-surface.test.js` and the head-unit service tests pass.
- [ ] Starting the head-unit app with no dongle attached serves the page and shows the designed "Connect a CarPlay dongle" state, with zero console errors, checked in a real browser.
- [ ] `npm ls node-carplay` shows the pinned MIT dependency and its LICENSE was read and quoted in the README.
- [ ] `docs/carplay.md` states exactly what is verified (no dongle ever touched) and what the owner must check.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No dongle on this machine | Build and test everything against the dongle interface and the recorded-protocol fixture; the hardware checklist is the deliverable for that last step. |
| `node-carplay` API differs from what the doc assumes | Read its source and README, adapt the interface adapter, and note the delta in the README. |

## Gates

The only gate is hardware: a Carlinkit CPC200 dongle and a Pi or Linux box, which only the owner can supply. This is why the order is GATED; the agent-doable work above is complete without it.
