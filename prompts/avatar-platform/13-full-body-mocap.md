# Task: Full-body mocap (optional, flag-gated)

## Context

Repo: `/workspaces/3D`. Task 12 does upper-body mirror via Kalidokit. This task goes further: full-body pose tracking (legs, stance, gait) driven by [ButzYung/SystemAnimatorOnline](https://github.com/ButzYung/SystemAnimatorOnline) (XR Animator) or a comparable pose-to-VRM retargeter.

This is opt-in only. It demands GPU, a full-body camera framing, and more CPU than mirror mode. It's a "studio mode" feature, not default.

Depends on task 12.

## Goal

1. `?fullbody=1` flag enables full-body tracking.
2. User's full skeleton drives the VRM avatar from waist-up or waist-down, depending on camera framing.
3. Performance target: 20+ fps pose + 60 fps render on an entry GPU (per the XR Animator README benchmark).
4. Falls back automatically to upper-body (task 12) if pose detection confidence is low (user is too close to the camera or legs aren't in frame).

## Deliverable

1. **Evaluate XR Animator** — it's a web-based app; check if its core (MediaPipe Pose + retargeting math) can be extracted as a module. If it can't be cleanly vendored, use [BlazeWild/Real-Time-Motion-Transfer](https://github.com/BlazeWild/Real-Time-Motion-Transfer-to-a-3D-Avatar) as a simpler reference.
2. **Vendor the chosen upstream** — copy minimal pose-retargeting code into `src/vendor/fullbody-mocap/`. NOTICE file with license + SHA.
3. **Module** `src/agent/fullbody-mirror.js` extending `MirrorMode` from task 12:
   - `class FullBodyMirror extends MirrorMode { ... }`
   - Adds leg bone retargeting: hip, knee, ankle rotations.
   - Detects "low confidence / legs out of frame" → gracefully degrades to upper-body mode.
4. **IK sanity** — legs are IK-sensitive (a wrong hip rotation makes the avatar fall over). Use Kalidokit's or the upstream's stabilization; document any filters/dampeners tuned.
5. **UI** — the "Mirror me" toolbar button from task 12 gains a sub-option "Full body (experimental)".
6. **Camera framing coach** — show a subtle silhouette overlay on the webcam preview guiding the user to step back and include their full body.

## Audit checklist

- [ ] `?fullbody=1` → full-body tracking engages.
- [ ] User step back, full body visible → legs track; user step close, legs cut off → auto-downgrades to upper-body.
- [ ] No "sinking into the floor" drift over 60s of standing.
- [ ] 20+ fps pose on a GTX 1650-class GPU (or document a higher minimum bar).
- [ ] `node --check` new files.
- [ ] Hip offset correction: the avatar's root stays planted; user's in-frame motion doesn't cause avatar teleporting across the scene.
- [ ] Disable on mobile (too expensive + framing impractical); the flag is a no-op on mobile user agents.

## Constraints

- Flag-gated experimental feature; never default-on.
- No cloud vision.
- No new npm deps.
- Must coexist with TalkingHead (task 09) — body poses don't fight with TalkingHead's gesture animations; when both want the same bone, user-driven poses win.
- Keep bundle impact off the main path — lazy-load the full-body module only when the flag is set.

## Verification

1. Full-body in view → avatar tracks full body.
2. Sit down in view → avatar sits (or at least stance compresses realistically).
3. Step out of frame entirely → avatar holds last pose for 2s, then resumes idle.
4. Performance profile: 60s of full-body mirror → no frame drops below 30 fps.
5. Coexistence: trigger a TalkingHead wave gesture while mirroring → user's pose wins on conflicting bones; wave only applies to bones the user isn't actively driving.

## Scope boundaries — do NOT do these

- No physics simulation (ragdoll, collisions).
- No motion-capture recording/export.
- No VR headset support (separate IK topology).
- No foot-IK correction for uneven ground.
- Do not build UI to switch between mirror modes mid-session — on/off toggle only.

## Reporting

- Upstream project chosen + rationale (XR Animator vs simpler alternative).
- Leg-stability filters / damping tuned, with before/after quality notes.
- Performance on your test hardware (with model and spec).
- Minimum recommended hardware and how we communicate that in task 20's onboarding.
- Known failure modes (fast running, jumping, turning 180°, occluded limbs).
- Whether this ships ship-ready or should stay behind an "experimental" label.
