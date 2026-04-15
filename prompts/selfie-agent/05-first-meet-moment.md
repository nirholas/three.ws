# Task: First-meet moment — "There you are" scene + wave + share CTA

## Context

Repo: `/workspaces/3D`. After prompt 04, the user lands at `/create#step=meet`. Their agent exists, the GLB is registered, the slug is reserved. This is the one-time payoff — the first time they see *themselves* in 3D, greeting them.

The [Empathy Layer](../../src/agent-avatar.js) already blends `celebration` + `curiosity` on `skill-done` with positive sentiment. The existing `greet` skill in [src/agent-skills.js](../../src/agent-skills.js) fires a wave gesture plus a "speak" event. Animation manager in [src/animation-manager.js](../../src/animation-manager.js) has a `waving` clip when the animation pack is installed.

## Goal

`/create#step=meet` opens a full-viewport stage: the agent's own GLB, centered, lit warmly. The camera orbits 30° then settles. The avatar waves and "speaks" a short greeting via the protocol bus (so the Empathy Layer reacts). A subtle confetti burst on first paint. Below: three CTAs — **Chat with your agent** → `/agent/:id` in chat mode, **Embed on your site** → opens the embed modal, **Share** → `navigator.share` or clipboard copy of the public URL.

## Deliverable

1. **Module — `src/features/create-meet.js`**
   - Export `mountCreateMeet(root)` → `{ destroy }`.
   - Load the user's agent + avatar via `GET /api/agents/me`.
   - Instantiate a minimal viewer (reuse [src/viewer.js](../../src/viewer.js)) in kiosk-like mode (no controls, controlled camera).
   - Run a scripted camera orbit for ~1.5 s, settle.
   - `protocol.emit({ type: ACTION_TYPES.SPEAK, payload: { text: `Hi, I'm ${agent.name}.`, sentiment: 0.7 } })` then `protocol.emit({ type: ACTION_TYPES.GESTURE, payload: { name: 'waving', duration: 2500 } })` (animation-manager handles the clip if installed; graceful degrade if not).

2. **Confetti**
   - Tiny inline confetti — plain DOM / CSS animation. No library. ~30 particles, 1.5 s total. One-shot. Respects `prefers-reduced-motion`: drop the confetti if reduced motion is set.

3. **CTAs**
   - **Chat** — `location.assign('/agent/' + agent.id)`.
   - **Embed** — open a small inline modal with the embed snippet (reuse [public/agent/embed.html](../../public/agent/embed.html) pattern) from `prompts/embed/` work if available; otherwise show a simple `<iframe>` snippet with the agent id.
   - **Share** — `navigator.share({ title, url })` if available; else copy URL to clipboard and show a "Copied!" tick.

4. **Analytics breadcrumb**
   - `protocol.emit({ type: ACTION_TYPES.REMEMBER, payload: { type: 'project', content: 'First-meet moment shown on ' + new Date().toISOString().slice(0,10) }, agentId: agent.id })`.

## Audit checklist

- Works fully offline after the initial GLB is cached (fallback greeting speaks via `text` even without voice).
- `prefers-reduced-motion` honored (no confetti, no orbit).
- No modals / toasts block the view — overlay UI is bottom-anchored and small.
- The Empathy Layer gets a real valence input so celebration actually visible in the face.
- Skipping this step (navigating directly to `/agent/:id` after claim) still works; `#step=meet` is an enhancement, not a gate.

## Constraints

- No new runtime dependencies (especially no confetti library).
- No TTS here — text-only speak event. Voice is a separate layer.
- Do not re-register the avatar or change the slug.
- Do not add a tutorial overlay.

## Verification

1. `node --check` all new / edited files.
2. `npx vite build` — expect success.
3. Manual:
   - Walk through prompts 01 → 04 → 05 end-to-end.
   - Confirm the avatar waves, the head tilts slightly (empathy+curiosity), the mouth shape changes briefly (celebration blend).
   - With `prefers-reduced-motion`, no confetti, no orbit.
   - Clicking each CTA behaves as described.

## Scope boundaries — do NOT do these

- Do not add TTS / audio.
- Do not open the Nich chat automatically — user chooses via the CTA.
- Do not add more animations beyond the wave.
- Do not build a multi-step tutorial.

## Reporting

- Files created / edited.
- Which clips were available on test device; which were missing (graceful-degrade notes).
- `npx vite build` output.
