# Agent Task: Write "Animation System" Documentation

## Output file
`public/docs/animation-system.md`

## Target audience
3D artists and developers who want to understand how animations work in three.ws — from loading clips to the agent emotion system and how animations blend.

## Word count
2000–2500 words

## What this document must cover

### 1. Overview
three.ws's animation system has three layers:
1. **Clip playback** — standard glTF animation clips (walk, wave, idle, etc.) played by the AnimationMixer
2. **Morph target blending** — per-frame facial expression control driven by the emotion system
3. **Procedural animation** — head tilt, lean, and gaze control driven by emotion state (no clips needed)

### 2. Animation clips in glTF
glTF 2.0 supports animations natively. An animation clip is a named sequence of keyframes applied to one or more nodes (bones, meshes, cameras).

**How to name clips:**
The agent runtime uses clip names to find the right animation:
```
idle          → played when agent is waiting
wave          → played when agent waves
nod           → played when agent agrees
shrug         → played when agent is uncertain
dance         → played when agent celebrates
speak         → lip-sync animation (optional)
```

The emotion system maps emotional states to clip names via the animation slots:
```js
// animation-slots.js
{
  celebration: ['dance', 'wave', 'jump'],
  concern: ['look-worried', 'scratch-head'],
  greeting: ['wave', 'nod']
}
```

Name your clips descriptively — the LLM also uses clip names when deciding which animation to play.

### 3. Loading and playing clips

**Via viewer UI:**
- The animation panel lists all clips
- Click a clip to play/pause
- Adjust speed with the slider
- "Play All" sequences through all clips

**Via the LLM (agent runtime):**
The agent can play clips via the `play_clip` tool:
```
User: "Show me a wave"
Agent: [calls play_clip({ name: "wave", loop: false })]
```

**Programmatically:**
```js
const el = document.querySelector('agent-3d');

// Play by name
el.playClip('wave', false);  // false = don't loop

// Via the SceneController
el.agent.scene.playClipByName('idle', true);  // true = loop

// Via the viewer directly
el.viewer.playAnimation('dance');
```

**Via URL hash:**
No programmatic control needed — deep link to a state with a clip playing.
```
https://three.ws/app#model=./avatar.glb&animation=idle
```

### 4. The AnimationMixer
Under the hood, three.js `AnimationMixer` manages clip playback:
- Multiple clips can play simultaneously (blending)
- `crossFadeTo(nextClip, duration)` for smooth transitions
- Weight control per clip (0 = not playing, 1 = full weight)
- Speed control via `timeScale`

The `animation-manager.js` wraps the mixer:
- Tracks currently playing clips
- Handles "play all" sequencing
- Provides speed control UI bindings
- Emits events for clip start/end

### 5. The emotion system (agent-avatar.js)
This is the most powerful part — the agent's face and body react to what's happening, driven by a continuous emotion state.

**Emotion state:**
Six emotion floats, always summing to ≤ 1.0:
```js
{
  concern: 0.0,       // half-life ~9s
  celebration: 0.0,   // half-life ~4s
  patience: 0.0,      // half-life ~20s
  curiosity: 0.0,     // half-life ~6s
  empathy: 0.0,       // half-life ~13s
  // neutral = 1 - sum of above
}
```

**Per-frame decay:**
Every frame (60fps), each emotion decays toward zero:
```js
concern = concern * Math.pow(0.5, deltaTime / halfLife);
```

This means emotions fade naturally without needing to "turn off" — they just decay.

**Stimulus events (what triggers emotions):**
| Event | Effect |
|-------|--------|
| Agent speaks (valence > 0.3) | +celebration |
| Agent speaks (valence < -0.3) | +concern |
| Model load starts | +patience +curiosity |
| Model loads successfully | +celebration |
| Validation errors found | +concern +empathy |
| Validation clean | +celebration |
| Error message received | +concern |

Valence is the emotional positivity of speech — determined by simple keyword scoring in the runtime.

**Applying to morph targets:**
Each frame, emotion values map to morph target influences:

| Emotion | Morph targets affected |
|---------|----------------------|
| celebration | mouthSmile (positive), browInnerUp |
| concern | mouthFrown, browInnerUp (worried), eyeSquint |
| curiosity | browOuterUp, eyeSquint (focused) |
| empathy | mouthSmile (gentle), browInnerUp |
| patience | neutral expression |

The mapping is additive and weighted — multiple emotions blend smoothly.

### 6. Head procedural animation
No clips needed for head movement — it's computed per-frame from emotion state:

**Head tilt (Z-axis rotation):**
```
tilt = curiosity * 8° + empathy * 5° - concern * 3°
```
The agent tilts their head when curious (common in conversation), drops it slightly when concerned.

**Forward lean (X-axis rotation):**
```
lean = curiosity * 2° - patience * 1°
```
Slightly leans forward when engaged, back when patient/waiting.

These are small, subtle movements — combined with morph targets, they make the avatar feel alive.

### 7. Gaze control
`agent-avatar.js` controls where the agent looks:

| Look target | How it works |
|-------------|-------------|
| `"model"` | Eyes/head orient toward the center of the loaded GLB |
| `"user"` | Eyes/head orient toward the camera (makes eye contact) |
| `"camera"` | Same as user |
| Auto | Blends between model and user based on conversation state |

The LLM can change gaze via the `lookAt` tool:
```
[calls lookAt({ target: "user" })]
```

Gaze is computed using inverse kinematics on the neck and head bones if available.

### 8. One-shot gestures
The `gesture` event triggers a single-play animation:
- **wave** — plays the "wave" clip once, then returns to idle
- **nod** — brief affirmative nod
- **shrug** — brief uncertainty gesture

Programmatic trigger:
```js
el.agent.protocol.dispatch('gesture', { name: 'wave' });
```

Or via the LLM `wave` tool (built-in).

### 9. Building animations for three.ws
For 3D artists creating avatars:

**Recommended clip set:**
- `idle` — neutral idle, loops forever (required)
- `wave` — greeting wave (required for wave tool)
- `nod` — brief yes gesture
- `shrug` — brief "I don't know" gesture
- `dance` — celebration animation
- `thinking` — hand-on-chin thoughtful pose

**Technical requirements:**
- Clips at the root of the glTF AnimationClips array
- Use humanoid rig (Mixamo or VRM skeleton naming)
- Include `Head` and `Neck` bones for procedural head movement
- Include morph targets for facial expressions (listed above)
- Keep idle under 60 frames (1 second at 60fps = 1s loop)

**Mixamo workflow:**
1. Upload character to mixamo.com
2. Auto-rig → download FBX with animations
3. Import to Blender → retarget animations if needed
4. Export as glTF 2.0 (GLB) with animations

### 10. The hero animations (landing page)
The landing page uses three special animation effects:
- **hero-dragon.js** — auto-animating 3D dragon display with camera orbit
- **hero-gaze.js** — dragon tracks the mouse cursor (eye-following effect)
- **hero-pretext.js** — text wrapping/morph animation (alpha feature)

These are custom, non-agent animations — they use vanilla three.js without the agent runtime.

### 11. Downloading and compiling animations
The animation library is managed separately from the main GLBs:
```bash
# Download animation clips from the library
npm run download-animations

# Or use the quick fetch script
./scripts/quick-fetch-anims.sh

# Compile/process animations
node scripts/build-animations.mjs
```

Configuration in `scripts/animations.config.json`.

## Tone
Technical but readable by 3D artists. Diagrams in prose (describe them). The emotion system section is the heart of this doc — explain it clearly with the math included.

## Files to read for accuracy
- `/src/agent-avatar.js` (770 lines — read fully)
- `/src/viewer/animation.js`
- `/src/animation-manager.js` (250 lines)
- `/src/runtime/animation-slots.js`
- `/src/runtime/scene.js` — playClipByName
- `/src/features/hero-dragon.js`
- `/src/features/hero-gaze.js`
- `/scripts/build-animations.mjs`
- `/scripts/animations.config.json`
- `/src/idle-animation.js`
