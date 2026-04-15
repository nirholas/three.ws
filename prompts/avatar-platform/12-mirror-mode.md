# Task: Mirror mode — webcam drives the avatar's face and upper body

## Context

Repo: `/workspaces/3D`. With VRM loaded (task 02) and TalkingHead attached (task 09), we can add a **mirror mode** where the user's webcam feeds [yeemachine/kalidokit](https://github.com/yeemachine/kalidokit) (MIT). Kalidokit converts MediaPipe landmarks into VRM bone rotations + blendshapes, making the avatar copy the user's face and upper-body movements in real time.

Avaturn does not offer this. It's a headline differentiator for our platform.

Depends on tasks 02, 09.

## Goal

1. A `?mirror=1` flag (or UI toggle) enables mirror mode.
2. Webcam feeds MediaPipe; Kalidokit produces VRM rotations; the active VRM tracks the user.
3. When mirror mode is on, TalkingHead's idle is paused (otherwise they fight).
4. Graceful exit: toggle off → TalkingHead idle resumes; webcam released.
5. Performance target: 30 fps mirror tracking on a 2019-era laptop.

## Deliverable

1. **Vendor Kalidokit** — MIT. Copy into `src/vendor/kalidokit/` with NOTICE. Kalidokit is tiny; no npm needed.
2. **MediaPipe integration** — reuse `src/capture/face-landmarks.js` from task 07 where possible. Add a `src/capture/pose-landmarks.js` for upper-body tracking (MediaPipe Pose Landmarker).
3. **Module** `src/agent/mirror.js`:
   - `class MirrorMode { constructor(vrm, videoEl); async start(); stop(); dispose(); }`
   - Starts webcam, feeds MediaPipe Face + Pose landmarker on every video frame (throttled to 30fps).
   - Passes landmarks to Kalidokit; applies outputs to:
     - Head bone rotation (yaw/pitch/roll).
     - Upper-body bones (neck, chest, shoulders).
     - Arm bones (hands optional; gate behind a sub-flag — hand tracking doubles CPU).
     - Face blendshapes (mouth, eyes, brows) — routed into VRM expression manager.
4. **UI** — a small toolbar button "Mirror me" that opens a permission prompt + tiny PIP video preview so the user can see what the camera sees.
5. **Integration with TalkingHead** (task 09) — when `MirrorMode.start()` runs, call `talkingHead.idleOff()`. On stop, `idleOn()`. If the brain (task 14) calls `speak()` while mirroring, the jaw/mouth is driven by visemes (TTS) AND the user's mouth-open expression is attenuated — document the blend strategy you pick.
6. **Performance** — render every Nth frame, not every RAF. Target: 30 landmark detections/sec, 60 render fps. Use `requestVideoFrameCallback` if available.

## Audit checklist

- [ ] `npm start` + `?mirror=1` → mirror mode active; avatar copies your head/face in real time.
- [ ] Toggle off → webcam indicator disappears; idle resumes.
- [ ] FPS ≥ 30 landmark-detection on a mid-range laptop with a face in view.
- [ ] No sudden pops / jitter on partial occlusion (hand in front of face) — Kalidokit's smoothing is tuned appropriately.
- [ ] Closing the tab kills the camera track (no "camera in use" indicator lingering).
- [ ] Blendshape output uses VRM expression names (`aa`, `blink`, `happy`...) not MediaPipe's 52-blendshape names — map them.
- [ ] `prefers-reduced-motion: reduce` → mirror mode still works (it's a direct user action), but any additional jitter-smoothing animations are skipped.
- [ ] `node --check` new files.

## Constraints

- No cloud vision APIs.
- No new npm deps (MediaPipe is loaded via CDN per task 07; Kalidokit is vendored).
- Do not send webcam frames to any server.
- Do not record video.
- Do not enable mirror mode by default — it's user-activated.
- Hands tracking is optional (sub-flag); don't enable by default — too expensive on lower-end devices.

## Verification

1. Mirror mode with face-only → smooth head tracking, blendshapes firing correctly.
2. Mirror mode with upper-body pose → shoulder shrug, arm raise → avatar mirrors.
3. Mirror mode + TalkingHead speaking → lipsync wins on the mouth; blendshape blending looks natural (not doubled).
4. Disconnect webcam (unplug USB) → mirror mode fails gracefully with an error toast.
5. Performance profile: 60s of mirror mode → no memory growth after GC.

## Scope boundaries — do NOT do these

- No full-body mocap (task 13 is the heavier option).
- No gesture → action binding (e.g., wave → send a hello). Recognition is task 15 territory.
- No teleconferencing / multi-user mirror.
- No recording / replay.
- Do not auto-crop or beauty-filter the webcam preview.

## Reporting

- Kalidokit commit SHA vendored.
- Measured landmark-detection fps + render fps on your dev machine.
- The blend strategy for conflicting TTS-mouth vs mirror-mouth (attenuate mirror when TTS is active, or override, or average — you pick and justify).
- Known jitter scenarios (low light, partial occlusion, fast motion) and whether they need Kalidokit constants tuned.
- Whether hand tracking is ship-ready or should stay behind a sub-flag.
