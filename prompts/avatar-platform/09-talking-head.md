# Task: Vendor met4citizen/TalkingHead and wire it to the active VRM

## Context

Repo: `/workspaces/3D`. [met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead) (MIT) is a production-quality real-time lipsync + body-animation engine for full-body 3D avatars. It speaks Oculus visemes, supports Mixamo FBX animations, and has built-in idle behaviors.

Task 02 loads VRMs. This task makes them talk, blink, fidget, and gesture.

Depends on task 02.

## Goal

1. `src/vendor/talking-head/` contains the upstream engine, vendored with attribution.
2. A thin adapter `src/agent/talking-head.js` exposes a stable API the agent brain (task 14) can call: `speak(text)`, `setMood(emotion)`, `playGesture(name)`.
3. The adapter binds to `VIEWER.app.viewer.activeVRM` from task 02; when a new VRM loads, the engine re-attaches automatically.
4. Idle behaviors (subtle head sway, eye darts, blinks) run at all times when a VRM is loaded.

## Deliverable

1. **Vendor** — clone upstream, record SHA + MIT license in `src/vendor/talking-head/NOTICE`. Copy only the engine module(s); skip demo HTML/CSS.
2. **Dependencies** — TalkingHead expects three.js (we have it) and, for its TTS path, browser APIs. It has optional ties to ElevenLabs / Azure; **do not vendor those paths** — task 10 provides our own TTS with visemes.
3. **Adapter** `src/agent/talking-head.js`:
   - `class TalkingHead { attach(vrm): void; detach(): void; async speak(text, { visemes?, audio? }); setMood(name, strength); playGesture(name); idleOn(); idleOff(); dispose(); }`
   - If `visemes` + `audio` are supplied (from task 10), use them directly. If only `text` is supplied, emit a warning — task 10 is the expected provider.
4. **Render-loop integration** — the adapter registers a `tick(delta)` callback that the existing render loop already calls (see how [src/viewer.js](../../src/viewer.js) drives animation). Don't start a second RAF loop.
5. **Auto-attach** — observe `activeVRM` changes. When a new VRM loads (task 02 swap), detach from the old one (if any) and attach to the new. When `activeVRM` is null, idle is paused.
6. **Animation library** — optional: if upstream bundles or expects Mixamo FBX idle loops, put them in [public/animations/](../../public/animations/) with per-file license notes. Keep the set minimal (1 idle, 1 wave, 1 nod).

## Audit checklist

- [ ] Upstream license is MIT (confirm).
- [ ] `node --check` new JS files.
- [ ] Console smoke test: `await VIEWER.app.talkingHead.speak('hello world')` — the avatar mouths the syllables. Without task 10 ready, this emits the warning and does text-only animation (jaw open/close approximation).
- [ ] Loading a new VRM mid-session → idle resumes on the new avatar, old one's listeners are gone.
- [ ] Disposing the viewer (see task 19) cleanly removes all TalkingHead listeners.
- [ ] Idle does not pin CPU — FPS on a mid-range laptop with idle active stays ≥ 55 fps on a blank background.
- [ ] `prefers-reduced-motion: reduce` → idle is dampened (no sway, slow blinks only).

## Constraints

- Vendor, do not npm. TalkingHead is a single class; don't take its peripheral demo code.
- Do not depend on any TTS service in this task. Task 10 supplies audio+visemes.
- Do not couple to Ready Player Me — we use VRM (RPM avatars are GLB; TalkingHead supports both, but we commit to VRM). Strip RPM-specific code paths.
- Do not modify the engine internals beyond the minimum needed for the VRM path. Wrap changes in `// PATCH:` comments.
- Don't add audio playback here — only consume provided audio objects. Playback wiring lives in task 10.

## Verification

1. Load `sample.vrm` (task 02). Call `speak('hello world')` — warning about missing visemes, but jaw moves.
2. Idle on → avatar blinks, micro-sways. FPS stable.
3. Swap VRMs → idle re-attaches.
4. Reduced motion → idle dampened.
5. `dispose()` → no console errors, no lingering timers (use Chrome Performance → Memory to verify).

## Scope boundaries — do NOT do these

- No TTS integration. Task 10.
- No STT integration. Task 11.
- No LLM / brain wiring. Task 14.
- No mirror mode / webcam driving. Task 12.
- Do not ship animation packs beyond the minimal set.

## Reporting

- Upstream TalkingHead commit SHA vendored.
- List of upstream files copied vs skipped.
- Total bytes vendored.
- Any patches applied with one-line justifications.
- Measured fps cost of idle-on vs idle-off.
- Animations shipped + their sources + licenses.
- Any upstream bugs encountered that warrant an upstream PR.
