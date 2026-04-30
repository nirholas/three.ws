# Task: Add idle animation system to keep agents alive when not speaking

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

**What exists:**

- `src/agent-avatar.js` — The Empathy Layer. Drives emotion blends and morph targets per-frame. Has a `_tickEmotion()` method hooked into the viewer's `_afterAnimateHooks`. At the bottom of the file there is `BEGIN:IDLE_LOOP_IMPORT` / `END:IDLE_LOOP_IMPORT` markers — this suggests an `IdleAnimation` module was planned.

- `src/idle-animation.js` — **Check if this file exists.** The import `import { IdleAnimation } from './idle-animation.js'` is in `agent-avatar.js`. If the file doesn't exist, it's a broken import.

- `src/runtime/scene.js` — `SceneController` with `playClipByName(name, opts)`. Can trigger named animation clips on the avatar.

- `src/runtime/animation-slots.js` — Animation slot resolution (`resolveSlot`, `DEFAULT_ANIMATION_MAP`). Maps logical names to actual clip names.

- `src/agent-protocol.js` — Event bus. Protocol events include `gesture`, `speak`, `think`, `skill-done`.

**The problem:** When an agent is not speaking or performing a skill, it stands completely still — frozen like a statue. This looks unnatural and breaks immersion. A living agent should breathe, shift weight, glance around, blink, or make small movements.

**The goal:** Implement the `IdleAnimation` system that keeps the agent visually alive during idle periods, and pauses gracefully when the agent starts speaking or performing a gesture.

---

## Design

### IdleAnimation class

Create or complete `src/idle-animation.js`:

```js
export class IdleAnimation {
  constructor({ scene, protocol, avatar }) {
    this._scene = scene;          // SceneController
    this._protocol = protocol;   // AgentProtocol bus
    this._avatar = avatar;        // AgentAvatar reference
    this._active = false;
    this._currentIdle = null;
    this._idleTimer = null;
    
    // Listen for events that interrupt idle
    protocol.on('speak', () => this._pause());
    protocol.on('gesture', () => this._pause());
    protocol.on('skill-done', () => this._scheduleResume());
    protocol.on('speak-end', () => this._scheduleResume());
  }
  
  start() {
    this._active = true;
    this._scheduleNext();
  }
  
  stop() {
    this._active = false;
    clearTimeout(this._idleTimer);
  }
}
```

### Idle behaviors

Cycle through a set of idle behaviors at random intervals (8–15 seconds between each):

1. **Breathing** — Subtle chest/shoulder rise-and-fall. If the avatar has a `breathing` clip, play it on loop. Otherwise, drive `spine.position.y` with a sine wave (amplitude 0.002, frequency 0.3Hz) using the `_afterAnimateHooks` system.

2. **Weight shift** — Play a `idle` or `idle_shift` animation clip if available (from `DEFAULT_ANIMATION_MAP`). Fall back to a subtle hip sway via bone transform.

3. **Head look-around** — Emit `look-at { target: 'camera' }` then after 3s `look-at { target: 'model' }`. Uses existing look-at logic in `agent-avatar.js`.

4. **Blink** — Drive `eyeBlinkLeft` and `eyeBlinkRight` morph targets: quick ramp to 1.0 over 80ms, hold 40ms, ramp back to 0 over 80ms. Repeat 1–2 times. Schedule every 3–6 seconds independently of other idles.

5. **Subtle emotion drift** — If curiosity < 0.1 and the agent has been idle for > 30s, emit `emote { trigger: 'curiosity', weight: 0.15 }`. This gives a slight "looking around, interested" expression.

### Clip availability detection

Not all avatars have the same animation clips. Before trying to play a clip, check if it exists:

```js
_hasClip(name) {
  return this._scene.viewer?.mixer?._actions?.some(
    a => a._clip.name.toLowerCase().includes(name.toLowerCase())
  );
}
```

If a clip doesn't exist, fall back to the morph-target-only approach.

### Interruption and resume

- `_pause()`: Cancel the current idle timer, stop any playing idle clip (with a fast 0.3s fade-out).
- `_scheduleResume()`: After a 2s delay (let the speech/gesture finish), call `_scheduleNext()`.

---

## Files to create/edit

**Create (if doesn't exist):**
- `src/idle-animation.js` — `IdleAnimation` class

**Edit:**
- `src/agent-avatar.js` — instantiate `IdleAnimation` and call `start()` after the avatar is initialized. The `BEGIN:IDLE_LOOP_IMPORT` / `END:IDLE_LOOP_IMPORT` markers show where this should happen.

**Do not touch:**
- `src/agent-protocol.js` event vocabulary
- `src/runtime/scene.js` SceneController
- `src/viewer.js`

---

## Acceptance criteria

1. Load any GLB avatar in the viewer with an agent attached. Wait 10 seconds — the avatar makes at least one subtle idle movement (blink, look-around, or head sway).
2. Send a message to the agent. The idle animation pauses while the agent responds.
3. After the agent finishes responding, idle animations resume within 3 seconds.
4. If the avatar has no animation clips (a static GLB), the idle system runs without errors — morphs and bone transforms only.
5. `npx vite build` passes. `node --check src/idle-animation.js` passes.

## Constraints

- ESM only. Tabs, 4-wide. Match existing style in `src/`.
- No new npm dependencies — use Three.js APIs already available.
- Idle animations must not fight with the emotion blend system in `agent-avatar.js`. Idle drives bones/clips; emotion drives morph targets. They operate on different systems and don't conflict.
- `IdleAnimation` must clean up all timers and event listeners in `stop()` to prevent memory leaks when the element is unmounted.
- Blink rate: 1 blink every 3–6 seconds (humans blink ~15x/min — don't make it creepy by blinking too fast).
