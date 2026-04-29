/**
 * Agent Avatar — Performer + Empathy Layer
 * -----------------------------------------
 * This is the thing that makes agents real.
 *
 * It listens to the AgentProtocol bus and drives the Three.js avatar:
 *   - speaks with lip sync hints
 *   - plays named gestures and animations
 *   - looks toward models/objects
 *
 * The Empathy Layer (novel):
 *   Every action emitted to the protocol is read for emotional valence.
 *   The avatar maintains a *continuous weighted blend* of emotional states —
 *   never snapping between moods, always drifting. Morph targets and head
 *   orientation are updated every animation frame.
 *
 *   Nobody has done this before in a three.ws system:
 *   you can feel 40% concerned + 30% curious + 30% neutral simultaneously,
 *   and the avatar's face reflects all three at once — exactly as humans do.
 */

import { ACTION_TYPES } from './agent-protocol.js';
import { Vector3, Box3, MathUtils } from 'three';
import { resolveSlot, DEFAULT_ANIMATION_MAP } from './runtime/animation-slots.js';
// BEGIN:IDLE_LOOP_IMPORT
import { IdleAnimation } from './idle-animation.js';
// END:IDLE_LOOP_IMPORT

const DEG2RAD = Math.PI / 180;

// Emotion decay rates (units per second — larger = fades faster)
const DECAY = {
	concern: 0.08, // half-life ~12s — lingers, builds empathy
	celebration: 0.18, // half-life ~6s  — bright but brief
	patience: 0.035, // half-life ~20s — sustained waiting state
	curiosity: 0.12, // half-life ~8s  — alert, engaged
	empathy: 0.055, // half-life ~13s — slow to fade, like real empathy
};

// Vocabulary scored for emotional valence
// Keys map to emotion buckets; values are keyword lists
const VOCAB = {
	concern: [
		'error',
		'failed',
		'fail',
		'invalid',
		'missing',
		'broken',
		'issue',
		'warning',
		'problem',
		'wrong',
		'crash',
		'undefined',
		'null',
		'corrupt',
	],
	celebration: [
		'success',
		'complete',
		'valid',
		'clean',
		'done',
		'great',
		'loaded',
		'ready',
		'perfect',
		'excellent',
		'nice',
		'good',
		'worked',
		'saved',
	],
	patience: [
		'analyzing',
		'checking',
		'loading',
		'processing',
		'thinking',
		'please wait',
		'just a moment',
		'scanning',
		'computing',
		'fetching',
	],
	curiosity: [
		'interesting',
		'wonder',
		'what if',
		'explore',
		'curious',
		'new',
		'never seen',
		'unusual',
		'rare',
		'unique',
		'unexpected',
	],
	empathy: [
		'sorry',
		'understand',
		'difficult',
		'frustrating',
		'try again',
		'my mistake',
		'apologies',
		'hard',
		'oops',
		'unfortunately',
	],
};

export class AgentAvatar {
	/**
	 * @param {import('./viewer.js').Viewer}                   viewer
	 * @param {import('./agent-protocol.js').AgentProtocol}    protocol
	 * @param {import('./agent-identity.js').AgentIdentity}    identity
	 */
	constructor(viewer, protocol, identity) {
		this.viewer = viewer;
		this.protocol = protocol;
		this.identity = identity;

		// Emotional state — continuous weighted blend, updated every frame
		this._emotion = {
			neutral: 1.0,
			concern: 0.0,
			celebration: 0.0,
			patience: 0.0,
			curiosity: 0.0,
			empathy: 0.0,
		};

		// Head look-at state
		this._lookTarget = null; // Vector3 | null
		this._currentTilt = 0; // radians
		this._targetTilt = 0; // radians
		this._currentLean = 0; // slight forward lean
		this._targetLean = 0;
		this._currentYaw = 0; // horizontal gaze (follow mode)

		// Follow mode state
		this._mouseGaze = { x: 0, y: 0 }; // normalised -1..1
		this._keystrokePitch = 0; // look-down impulse (radians, decays)
		this._keystrokeYaw = 0; // lateral drift impulse (radians, decays)

		// One-shot gesture tracking
		this._oneShotAction = null;
		this._oneShotDuration = 0;
		this._oneShotTimer = 0;
		this._isPlayingOneShot = false;

		// Animation slot override map (from meta.edits.animations)
		this._animationMap = {};
		this._warnedSlots = new Set();

		// Streak tracking for empathy injection
		this._errorStreak = 0;
		this._firstEncounter = true;

		// Morph target current values (lerped each frame)
		this._morphCurrent = {};
		this._morphTarget = {};
		// Cached list of meshes with morph targets — rebuilt on attach() to avoid per-frame traversal
		this._morphMeshes = null;

		// Listeners stored so we can detach later
		this._listeners = [];

		this._tickBound = this._tickEmotion.bind(this);
		this._onMouseMove = this._handleMouseMove.bind(this);
		this._onKeyFollowDown = this._handleKeyPress.bind(this);
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	/** Call after viewer.setContent() loads the avatar model */
	attach() {
		// Reset emotion to neutral so re-attaching a previously emotional avatar starts clean
		this._emotion = { neutral: 1.0, concern: 0, celebration: 0, patience: 0, curiosity: 0, empathy: 0 };

		// Build the morph mesh cache once instead of traversing every frame
		this._buildMorphCache();

		// Hook into the viewer's per-frame loop
		if (!this.viewer._afterAnimateHooks) this.viewer._afterAnimateHooks = [];
		this.viewer._afterAnimateHooks.push(this._tickBound);

		// Follow mode input listeners
		this.viewer.el.addEventListener('mousemove', this._onMouseMove);
		window.addEventListener('keydown', this._onKeyFollowDown);

		// Subscribe to protocol events
		this._sub(ACTION_TYPES.SPEAK, this._onSpeak.bind(this));
		this._sub(ACTION_TYPES.GESTURE, this._onGesture.bind(this));
		this._sub(ACTION_TYPES.EMOTE, this._onEmote.bind(this));
		this._sub(ACTION_TYPES.LOOK_AT, this._onLookAt.bind(this));
		this._sub(ACTION_TYPES.PERFORM_SKILL, this._onSkillStart.bind(this));
		this._sub(ACTION_TYPES.SKILL_DONE, this._onSkillDone.bind(this));
		this._sub(ACTION_TYPES.SKILL_ERROR, this._onSkillError.bind(this));
		this._sub(ACTION_TYPES.LOAD_START, this._onLoadStart.bind(this));
		this._sub(ACTION_TYPES.LOAD_END, this._onLoadEnd.bind(this));
		this._sub(ACTION_TYPES.VALIDATE, this._onValidate.bind(this));

		// First-encounter curiosity burst
		if (this._firstEncounter) {
			this._firstEncounter = false;
			setTimeout(() => {
				this._injectStimulus('curiosity', 0.9);
				this._injectStimulus('celebration', 0.4);
			}, 600);
		}

		// BEGIN:IDLE_LOOP_INIT
		this._idle?.dispose();
		this._idle = new IdleAnimation({
			getRoot: () => this.viewer.content,
			protocol: this.protocol,
			seed: this.identity?.id ?? 'default',
			getMorphCurrent: () => this._morphCurrent,
		});
		// END:IDLE_LOOP_INIT
	}

	/** Remove all hooks and listeners */
	detach() {
		if (this.viewer._afterAnimateHooks) {
			const idx = this.viewer._afterAnimateHooks.indexOf(this._tickBound);
			if (idx !== -1) this.viewer._afterAnimateHooks.splice(idx, 1);
		}
		this.viewer.el.removeEventListener('mousemove', this._onMouseMove);
		window.removeEventListener('keydown', this._onKeyFollowDown);
		for (const [type, handler] of this._listeners) {
			this.protocol.off(type, handler);
		}
		this._listeners = [];
		// BEGIN:IDLE_LOOP_DISPOSE
		this._idle?.dispose();
		this._idle = null;
		// END:IDLE_LOOP_DISPOSE
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/** Play a named gesture animation */
	playGesture(name) {
		this._triggerOneShot(name);
	}

	/**
	 * Set the agent's animation slot override map (from meta.edits.animations).
	 * @param {Object|null} map — { slotName: clipName, … }
	 */
	setAnimationMap(map) {
		this._animationMap = map || {};
	}

	/** Resolve a slot name to the actual clip name via agent's override map. */
	_resolveSlot(slot) {
		return resolveSlot(slot, this._animationMap);
	}

	/**
	 * Play a gesture by slot name, routing through the external animation manager.
	 * Falls back to embedded clip search (_triggerOneShot) if the clip isn't in the library.
	 * Warns once per missing clip name.
	 * @param {string} slot — e.g. 'celebrate', 'think'
	 * @param {number} [duration]
	 */
	_playSlot(slot, duration = 1.5) {
		const clipName = this._resolveSlot(slot);
		this._isPlayingOneShot = true;
		this._oneShotAction = slot;
		this._oneShotDuration = duration;
		this._oneShotTimer = 0;

		const am = this.viewer?.animationManager;
		if (am) {
			if (am.isLoaded(clipName)) {
				this._playAmClip(am, clipName, duration);
				return;
			}
			// Lazy-load from manifest definition
			const def = am.getAnimationDefs().find((d) => d.name === clipName);
			if (def) {
				const prev = am.currentName;
				am.loadAnimation(clipName, def.url, { loop: false, clipName: def.clipName }).then(
					() => {
						this._playAmClip(am, clipName, duration, prev);
					},
				);
				return;
			}
			// Clip not in library — warn once, try default slot fallback
			if (!this._warnedSlots.has(clipName)) {
				console.warn(
					`[AgentAvatar] slot "${slot}" → "${clipName}" not in animation library`,
				);
				this._warnedSlots.add(clipName);
			}
			const fallback = DEFAULT_ANIMATION_MAP[slot];
			if (fallback && fallback !== clipName && am.isLoaded(fallback)) {
				this._playAmClip(am, fallback, duration);
				return;
			}
		}

		// Final fallback: embedded clip search
		this._triggerOneShot(clipName, duration);
	}

	_playAmClip(am, clipName, duration, prevName) {
		const prev = prevName ?? am.currentName;
		am.play(clipName);
		if (prev && am.isLoaded(prev)) {
			setTimeout(() => am.crossfadeTo(prev, 0.4), duration * 1000);
		}
	}

	/** Set a world-space point for the avatar to look toward */
	setLookTarget(worldPos) {
		this._lookTarget = worldPos ? worldPos.clone() : null;
	}

	/** Get current emotion blend (read-only snapshot) */
	get emotionState() {
		return { ...this._emotion };
	}

	// ── Protocol Handlers ─────────────────────────────────────────────────────

	_onSpeak(action) {
		const text = action.payload?.text || '';
		const { valence, arousal } = this._analyzeSentiment(text);

		// Positive speech → celebration boost; negative → concern
		if (valence > 0.3) this._injectStimulus('celebration', valence * 0.7);
		else if (valence < -0.2) this._injectStimulus('concern', Math.abs(valence) * 0.8);

		// High-arousal text (questions, exclamations) → curiosity
		if (arousal > 0.5) this._injectStimulus('curiosity', arousal * 0.5);

		// Trigger mouth/talk animation hint
		const duration = Math.max(1.5, text.split(' ').length * 0.3);
		this._triggerOneShot('talk', duration);
	}

	_onGesture(action) {
		const name = action.payload?.name || 'nod';
		this._triggerOneShot(name, action.payload?.duration || 1.5);
	}

	_onEmote(action) {
		const trigger = action.payload?.trigger;
		const weight = action.payload?.weight || 0.7;
		if (trigger && this._emotion.hasOwnProperty(trigger)) {
			this._injectStimulus(trigger, weight);
		}
	}

	_onLookAt(action) {
		const target = action.payload?.target;
		if (target === 'model' && this.viewer?.content) {
			// Look at the bounding box center of the loaded model
			const box = new Box3();
			const center = new Vector3();
			box.setFromObject(this.viewer.content).getCenter(center);
			this._lookTarget = center;
		} else if (target === 'user') {
			this._lookTarget = null; // look at camera
		}
		this._injectStimulus('curiosity', 0.3);
	}

	_onSkillStart(action) {
		const hint = action.payload?.animationHint;
		if (hint) this._triggerOneShot(hint, 1.0);
		this._injectStimulus('patience', 0.4);
	}

	_onSkillDone(action) {
		const result = action.payload?.result;
		if (result?.sentiment !== undefined) {
			if (result.sentiment > 0.3) this._injectStimulus('celebration', result.sentiment * 0.8);
			else if (result.sentiment < -0.2)
				this._injectStimulus('concern', Math.abs(result.sentiment) * 0.7);
		} else {
			this._injectStimulus('celebration', 0.4);
		}
		this._errorStreak = 0;
	}

	_onSkillError(_action) {
		this._errorStreak++;
		const empathyWeight = Math.min(this._errorStreak * 0.25, 0.9);
		this._injectStimulus('concern', 0.7);
		this._injectStimulus('empathy', empathyWeight);
	}

	_onLoadStart(_action) {
		this._injectStimulus('patience', 0.6);
		this._injectStimulus('curiosity', 0.3);
		this._playSlot('think', 2.0);
	}

	_onLoadEnd(action) {
		if (action.payload?.error) {
			this._injectStimulus('concern', 0.8);
		} else {
			this._injectStimulus('celebration', 0.7);
			this._injectStimulus('curiosity', 0.5);
			this._playSlot('nod', 1.0);
		}
	}

	_onValidate(action) {
		const errors = action.payload?.errors || 0;
		const warnings = action.payload?.warnings || 0;
		if (errors > 0) {
			this._injectStimulus('concern', Math.min(0.4 + errors * 0.1, 0.95));
			this._errorStreak++;
		} else if (warnings > 0) {
			this._injectStimulus('concern', 0.3);
		} else {
			this._injectStimulus('celebration', 0.85);
			this._playSlot('celebrate', 1.5);
		}
	}

	// ── Empathy Layer — The Novel Part ────────────────────────────────────────

	/**
	 * Inject a stimulus into the emotion state.
	 * Uses additive blending — stimuli accumulate, then decay.
	 * @param {string} emotion — one of the DECAY keys
	 * @param {number} weight  — 0..1
	 */
	_injectStimulus(emotion, weight) {
		if (!(emotion in this._emotion)) return;
		this._emotion[emotion] = Math.min(1.0, this._emotion[emotion] + weight);
		// Neutral inversely reflects total arousal
		this._normaliseNeutral();
	}

	_normaliseNeutral() {
		const sum = Object.keys(DECAY).reduce((acc, k) => acc + this._emotion[k], 0);
		this._emotion.neutral = Math.max(0, 1 - sum);
	}

	/**
	 * Per-frame emotion decay + avatar rendering.
	 * Called by viewer._afterAnimateHooks every animation frame.
	 * @param {number} dt — delta time in seconds
	 */
	_tickEmotion(dt) {
		// Stage 1: Decay all non-neutral emotions
		for (const [key, rate] of Object.entries(DECAY)) {
			this._emotion[key] = Math.max(0, this._emotion[key] - rate * dt);
		}
		this._normaliseNeutral();

		// Stage 2: One-shot gesture timer
		if (this._isPlayingOneShot) {
			this._oneShotTimer += dt;
			if (this._oneShotTimer >= this._oneShotDuration) {
				this._isPlayingOneShot = false;
				this._oneShotTimer = 0;
			}
		}

		// Stage 3: Emotion-threshold gesture triggers (routed through slot map)
		if (!this._isPlayingOneShot) {
			const w = this._emotion;
			if (w.celebration > 0.6) {
				this._playSlot('celebrate', 2.0);
			} else if (w.concern > 0.6) {
				this._playSlot('concern', 2.0);
			} else if (w.curiosity > 0.6) {
				this._playSlot('think', 1.5);
			}
		}

		// Stage 4: Apply emotion to avatar
		this._applyEmotionToAvatar(dt);

		// BEGIN:IDLE_LOOP_TICK
		this._idle?.update(dt);
		// END:IDLE_LOOP_TICK
	}

	/**
	 * Render the current emotional state onto the avatar mesh.
	 * Gracefully no-ops if morph targets or head bone don't exist.
	 */
	_applyEmotionToAvatar(dt) {
		const w = this._emotion;

		// ── Morph target targets ──────────────────────────────────────────
		// The Empathy Layer blends ALL emotions simultaneously —
		// not a discrete switch, a continuous weighted blend.
		this._setMorphTarget('mouthSmile', w.celebration * 0.85);
		this._setMorphTarget(
			'mouthOpen',
			w.celebration * 0.2 +
				(this._isPlayingOneShot && this._oneShotAction === 'talk' ? 0.4 : 0),
		);
		this._setMorphTarget('mouthFrown', w.concern * 0.55);
		this._setMorphTarget('browInnerUp', (w.concern + w.empathy * 0.5) * 0.6);
		this._setMorphTarget('browOuterUpLeft', w.curiosity * 0.7);
		this._setMorphTarget('browOuterUpRight', w.curiosity * 0.5);
		this._setMorphTarget('eyeSquintLeft', w.empathy * 0.4);
		this._setMorphTarget('eyeSquintRight', w.empathy * 0.4);
		this._setMorphTarget('eyesClosed', w.patience * 0.15); // slight, not full
		this._setMorphTarget('cheekPuff', w.celebration * 0.2);
		this._setMorphTarget('noseSneerLeft', w.concern * 0.15);
		this._setMorphTarget('noseSneerRight', w.concern * 0.15);

		// ── Lerp morph influences to targets ─────────────────────────────
		const lerpSpeed = dt * 4.0; // smooth interpolation, not snapping
		this._lerpMorphTargets(lerpSpeed);

		// ── Head tilt (curiosity + empathy both tilt the head) ────────────
		this._targetTilt = (w.curiosity * 12 + w.empathy * 9 + w.concern * 4) * DEG2RAD;
		this._currentTilt = _lerp(this._currentTilt, this._targetTilt, dt * 3.0);

		// ── Forward lean (curiosity leans in, patience leans back) ────────
		this._targetLean = w.curiosity * 0.03 - w.patience * 0.02;
		const _followMode = this.viewer.state?.followMode;
		if (_followMode === 'mouse') {
			// Mouse Y: -1 = top of canvas (look up), +1 = bottom (look down)
			this._targetLean += this._mouseGaze.y * (12 * DEG2RAD);
		} else if (_followMode === 'keystrokes') {
			this._targetLean += this._keystrokePitch;
			this._keystrokePitch = Math.max(0, this._keystrokePitch - dt * 0.9);
			this._keystrokeYaw = _lerp(this._keystrokeYaw, 0, dt * 0.6);
		} else {
			// Decay any residual follow-mode values if mode was switched off
			this._keystrokePitch = 0;
			this._keystrokeYaw = _lerp(this._keystrokeYaw, 0, dt * 2.0);
			this._mouseGaze.x = _lerp(this._mouseGaze.x, 0, dt * 2.0);
			this._mouseGaze.y = _lerp(this._mouseGaze.y, 0, dt * 2.0);
		}
		this._currentLean = _lerp(this._currentLean, this._targetLean, dt * 2.0);

		this._applyHeadTransform();
	}

	// ── Morph Target Helpers ─────────────────────────────────────────────────

	/**
	 * Set the *target* influence for a named morph target.
	 * Actual mesh influence is lerped in _lerpMorphTargets().
	 */
	_setMorphTarget(name, targetWeight) {
		this._morphTarget[name] = Math.max(0, Math.min(1, targetWeight));
		if (!(name in this._morphCurrent)) this._morphCurrent[name] = 0;
	}

	/** Collect all meshes with morph targets once per content load. */
	_buildMorphCache() {
		this._morphMeshes = [];
		if (!this.viewer?.content) return;
		this.viewer.content.traverse((node) => {
			if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
				this._morphMeshes.push(node);
			}
		});
	}

	/** Lerp all tracked morph target influences toward their targets */
	_lerpMorphTargets(speed) {
		if (!this._morphMeshes?.length) return;
		for (const node of this._morphMeshes) {
			for (const [name, target] of Object.entries(this._morphTarget)) {
				const idx = node.morphTargetDictionary[name];
				if (idx === undefined) continue;
				const current = node.morphTargetInfluences[idx] || 0;
				const next = _lerp(current, target, speed);
				node.morphTargetInfluences[idx] = next;
				this._morphCurrent[name] = next;
			}
		}
	}

	// ── Head Transform ────────────────────────────────────────────────────────

	// Safety clamps — keep the head within believable neck range.
	// (Input signals are already bounded by design, but belt-and-braces.)
	static HEAD_MAX_YAW = 45 * DEG2RAD;
	static HEAD_MAX_TILT = 25 * DEG2RAD;
	static HEAD_MAX_LEAN = 25 * DEG2RAD;

	_applyHeadTransform() {
		if (!this.viewer?.content) return;

		// Resolve exactly one head bone (or fall back to neck) and snapshot its
		// rest rotation. Any substring match over the whole skeleton would pick
		// up Head + Neck + HeadTop_End simultaneously, and writing the same
		// local rotation to all three stacks hierarchically → owl-style 360.
		if (this._headBoneFor !== this.viewer.content) {
			this._headBoneFor = this.viewer.content;
			this._headBone = this._findHeadBone();
			if (this._headBone) {
				this._headRestRotation = {
					x: this._headBone.rotation.x,
					y: this._headBone.rotation.y,
					z: this._headBone.rotation.z,
				};
			}
		}
		if (!this._headBone) return;

		// Compute yaw target from follow mode
		const followMode = this.viewer.state?.followMode;
		let targetYaw = 0;
		if (followMode === 'mouse') {
			targetYaw = this._mouseGaze.x * (25 * DEG2RAD);
		} else if (followMode === 'keystrokes') {
			targetYaw = this._keystrokeYaw;
		}
		this._currentYaw = _lerp(this._currentYaw, targetYaw, 0.08);

		const yaw = MathUtils.clamp(
			this._currentYaw,
			-AgentAvatar.HEAD_MAX_YAW,
			AgentAvatar.HEAD_MAX_YAW,
		);
		const tilt = MathUtils.clamp(
			this._currentTilt,
			-AgentAvatar.HEAD_MAX_TILT,
			AgentAvatar.HEAD_MAX_TILT,
		);
		const lean = MathUtils.clamp(
			this._currentLean,
			-AgentAvatar.HEAD_MAX_LEAN,
			AgentAvatar.HEAD_MAX_LEAN,
		);

		// Apply pre-smoothed values directly — _currentTilt/Lean/Yaw are already
		// dt-lerped above, so a second lerp on the live bone value would fight the
		// animation mixer and cause visible head bobbing.
		const r = this._headRestRotation;
		const b = this._headBone;
		b.rotation.z = r.z + tilt;
		b.rotation.x = r.x + lean;
		b.rotation.y = r.y + yaw;
	}

	/**
	 * Find the single head bone (or neck fallback). Canonicalises common
	 * naming conventions: `Head`, `mixamorigHead`, `Armature:Head`, `rig_Head`,
	 * `CC_Base_Head`. Returns null if neither exists.
	 */
	_findHeadBone() {
		let head = null,
			neck = null;
		this.viewer.content.traverse((node) => {
			if (!node.isBone) return;
			const canon = node.name
				.replace(/^mixamorig/i, '')
				.replace(/^.*[:_]/, '')
				.toLowerCase();
			if (!head && canon === 'head') head = node;
			else if (!neck && canon === 'neck') neck = node;
		});
		return head || neck || null;
	}

	// ── Follow Mode Handlers ──────────────────────────────────────────────────

	_handleMouseMove(e) {
		const rect = this.viewer.el.getBoundingClientRect();
		this._mouseGaze.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		this._mouseGaze.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
	}

	_handleKeyPress(e) {
		if (this.viewer.state?.followMode !== 'keystrokes') return;
		if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape'].includes(e.key))
			return;

		// Look down toward keyboard
		this._keystrokePitch = 0.18;

		// Lateral drift based on rough key column: left side → look left, right side → look right
		const leftKeys = 'qweasdzxc123`~!@#';
		const rightKeys = 'yuiophjklnm7890-=';
		const k = e.key.toLowerCase();
		if (leftKeys.includes(k)) this._keystrokeYaw = -0.12;
		else if (rightKeys.includes(k)) this._keystrokeYaw = 0.12;

		this._injectStimulus('curiosity', 0.07);
	}

	// ── Gesture / One-shot Animations ────────────────────────────────────────

	/**
	 * Trigger a one-shot animation clip if it exists on the model.
	 * Falls back gracefully if the clip doesn't exist.
	 * @param {string} clipName
	 * @param {number} [duration]
	 */
	_triggerOneShot(clipName, duration = 1.5) {
		this._isPlayingOneShot = true;
		this._oneShotAction = clipName;
		this._oneShotDuration = duration;
		this._oneShotTimer = 0;

		if (!this.viewer?.mixer || !this.viewer?.clips?.length) return;

		// Look for a clip matching the name (case-insensitive partial match)
		const clip = this.viewer.clips.find((c) =>
			c.name.toLowerCase().includes(clipName.toLowerCase()),
		);
		if (!clip) return;

		const action = this.viewer.mixer.clipAction(clip);
		action.reset();
		action.setLoop(2200, 1); // THREE.LoopOnce = 2200
		action.clampWhenFinished = true;
		action.play();
	}

	// ── Sentiment Analysis ────────────────────────────────────────────────────

	/**
	 * Lightweight keyword-based sentiment scoring — runs in browser with no external API.
	 * Returns { valence: -1..1, arousal: 0..1 }
	 */
	_analyzeSentiment(text) {
		const lower = text.toLowerCase();
		const wordSet = new Set(lower.split(/\s+/));
		const total = Math.max(wordSet.size, 1);

		let valence = 0;
		let arousal = 0;

		// Score each emotion bucket — single words use Set for O(1); phrases fall back to includes
		for (const [emotion, keywords] of Object.entries(VOCAB)) {
			let hits = 0;
			for (const kw of keywords) {
				if (kw.includes(' ') ? lower.includes(kw) : wordSet.has(kw)) hits++;
			}
			if (!hits) continue;
			const score = Math.min((hits / total) * 3.0, 1.0);

			if (emotion === 'celebration') valence += score * 0.8;
			if (emotion === 'concern') valence -= score * 0.7;
			if (emotion === 'empathy') valence -= score * 0.3; // empathy feels slightly negative (recognition of pain)
			if (emotion === 'curiosity') arousal += score * 0.9;
			if (emotion === 'patience') arousal += score * 0.3;
		}

		// Punctuation arousal (exclamation = high arousal, question = moderate)
		const exclamations = (text.match(/!/g) || []).length;
		const questions = (text.match(/\?/g) || []).length;
		arousal += Math.min(exclamations * 0.2 + questions * 0.1, 0.5);

		return {
			valence: Math.max(-1, Math.min(1, valence)),
			arousal: Math.max(0, Math.min(1, arousal)),
		};
	}

	// ── Utility ───────────────────────────────────────────────────────────────

	_sub(type, handler) {
		this.protocol.on(type, handler);
		this._listeners.push([type, handler]);
	}

}

function _lerp(a, b, t) {
	return a + (b - a) * Math.min(1, Math.max(0, t));
}
