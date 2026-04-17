import { Quaternion, Vector3, MathUtils } from 'three';

const DEG2RAD = Math.PI / 180;

// Bone name candidates in priority order
const SPINE_NAMES = ['Spine1', 'Spine2', 'Spine', 'mixamorigSpine1', 'mixamorigSpine', 'spine_01', 'spine_02', 'spine'];
const HEAD_NAMES = ['Head', 'mixamorigHead', 'head'];
const L_SHOULDER_NAMES = ['LeftShoulder', 'mixamorigLeftShoulder', 'left_shoulder', 'ShoulderL'];
const R_SHOULDER_NAMES = ['RightShoulder', 'mixamorigRightShoulder', 'right_shoulder', 'ShoulderR'];

const BLINK_MORPH_NAMES = ['eyesClosed', 'blink', 'Blink', 'Fcl_EYE_Close', 'eyeBlinkLeft', 'Eye_Blink'];

function findBone(root, names) {
	for (const name of names) {
		let found = null;
		root.traverse(obj => {
			if (!found && obj.isBone && obj.name === name) found = obj;
		});
		if (found) return found;
	}
	return null;
}

function findBlinkMesh(root) {
	let result = null;
	root.traverse(obj => {
		if (result) return;
		if (!obj.morphTargetDictionary) return;
		for (const name of BLINK_MORPH_NAMES) {
			if (name in obj.morphTargetDictionary) {
				result = { mesh: obj, index: obj.morphTargetDictionary[name] };
				return;
			}
		}
	});
	return result;
}

export class IdleAnimation {
	/**
	 * @param {{ root: import('three').Object3D, bones?: object|null, intensity?: number }} opts
	 */
	constructor({ root, bones = null, intensity = 1.0 }) {
		this._root = root;
		this._intensity = Math.max(0, Math.min(1, intensity));
		this._active = false;
		this._noop = false;
		this._clock = null;
		this._elapsedPrev = 0;

		// Reusable temporaries — zero alloc in update()
		this._tmpQ = new Quaternion();
		this._tmpV = new Vector3();
		this._tmpQ2 = new Quaternion();

		// Saved original transforms (restored on stop)
		this._origSpineRot = new Quaternion();
		this._origSpineScale = new Vector3();
		this._origHeadRot = new Quaternion();

		// Head glance state machine
		this._glancePhase = 'idle'; // idle | turn | hold | return
		this._glanceTimer = 0;
		this._glanceDuration = 0;
		this._glanceTargetYaw = 0; // radians
		this._glanceCurrentYaw = 0;
		this._glanceStartYaw = 0;
		this._glanceNextDelay = this._randGlanceDelay();

		// Blink state machine
		this._blinkPhase = 'wait'; // wait | closing | closed | opening
		this._blinkTimer = 0;
		this._blinkNextDelay = this._randBlinkDelay();
		this._blinkMorphCurrent = 0;

		// Resolve bones
		if (bones) {
			this._spine = bones.spine || null;
			this._head = bones.head || null;
			this._lShoulder = bones.leftShoulder || null;
			this._rShoulder = bones.rightShoulder || null;
		} else {
			this._spine = findBone(root, SPINE_NAMES);
			this._head = findBone(root, HEAD_NAMES);
			this._lShoulder = findBone(root, L_SHOULDER_NAMES);
			this._rShoulder = findBone(root, R_SHOULDER_NAMES);
		}

		this._blinkTarget = findBlinkMesh(root);

		if (!this._spine) {
			console.warn('[IdleAnimation] No spine bone found — becoming a no-op.');
			this._noop = true;
		}

		// Honor reduced-motion preference
		if (typeof window !== 'undefined' &&
			window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			this._noop = true;
		}
	}

	/**
	 * @param {{ getElapsedTime: () => number }} clock  THREE.Clock or equivalent
	 */
	start(clock) {
		if (this._noop || this._active) return;
		this._clock = clock;
		this._elapsedPrev = clock.getElapsedTime();
		this._active = true;

		// Save originals
		if (this._spine) {
			this._origSpineRot.copy(this._spine.quaternion);
			this._origSpineScale.copy(this._spine.scale);
		}
		if (this._head) {
			this._origHeadRot.copy(this._head.quaternion);
		}
	}

	stop() {
		if (!this._active) return;
		this._active = false;

		// Restore original transforms
		if (this._spine) {
			this._spine.quaternion.copy(this._origSpineRot);
			this._spine.scale.copy(this._origSpineScale);
		}
		if (this._head) {
			this._head.quaternion.copy(this._origHeadRot);
		}

		// Restore blink morph
		if (this._blinkTarget) {
			this._blinkTarget.mesh.morphTargetInfluences[this._blinkTarget.index] = 0;
		}

		this._glancePhase = 'idle';
		this._glanceCurrentYaw = 0;
		this._blinkPhase = 'wait';
		this._blinkMorphCurrent = 0;
	}

	/**
	 * Manual tick — call from your render loop.
	 * @param {number} deltaSeconds
	 */
	update(deltaSeconds) {
		if (!this._active || this._noop) return;
		const dt = Math.min(deltaSeconds, 0.1); // clamp runaway dt
		const t = this._clock.getElapsedTime();
		const intensity = this._intensity;

		// ── Breathing: spine Y-scale ±1% at 0.25 Hz ─────────────────────────
		if (this._spine) {
			const breathPhase = Math.sin(t * 2 * Math.PI * 0.25); // 0.25 Hz
			const breathScale = 1.0 + breathPhase * 0.01 * intensity;
			this._spine.scale.set(
				this._origSpineScale.x,
				this._origSpineScale.y * breathScale,
				this._origSpineScale.z,
			);

			// ── Micro-sway: ±0.5° rotation on spine at 0.08 Hz ──────────────
			const swayPhase = Math.sin(t * 2 * Math.PI * 0.08);
			const swayRad = swayPhase * 0.5 * DEG2RAD * intensity;
			// Apply sway as local Z-rotation delta on top of original
			this._tmpQ.setFromAxisAngle(this._tmpV.set(0, 0, 1), swayRad);
			this._spine.quaternion.copy(this._origSpineRot).multiply(this._tmpQ);
		}

		// ── Head glance state machine ─────────────────────────────────────────
		if (this._head) {
			this._glanceTimer += dt;

			switch (this._glancePhase) {
				case 'idle':
					if (this._glanceTimer >= this._glanceNextDelay) {
						this._glancePhase = 'turn';
						this._glanceTimer = 0;
						this._glanceDuration = 0.5; // 500ms turn
						this._glanceStartYaw = this._glanceCurrentYaw;
						// ±8° random direction
						this._glanceTargetYaw = (Math.random() < 0.5 ? 1 : -1) *
							(4 + Math.random() * 4) * DEG2RAD * intensity;
					}
					break;
				case 'turn': {
					const progress = Math.min(this._glanceTimer / this._glanceDuration, 1);
					this._glanceCurrentYaw = MathUtils.lerp(
						this._glanceStartYaw,
						this._glanceTargetYaw,
						_easeInOut(progress),
					);
					if (progress >= 1) {
						this._glancePhase = 'hold';
						this._glanceTimer = 0;
					}
					break;
				}
				case 'hold':
					if (this._glanceTimer >= 0.2) { // 200ms hold
						this._glancePhase = 'return';
						this._glanceTimer = 0;
						this._glanceDuration = 0.8; // 800ms return
						this._glanceStartYaw = this._glanceCurrentYaw;
						this._glanceTargetYaw = 0;
					}
					break;
				case 'return': {
					const progress = Math.min(this._glanceTimer / this._glanceDuration, 1);
					this._glanceCurrentYaw = MathUtils.lerp(
						this._glanceStartYaw,
						0,
						_easeInOut(progress),
					);
					if (progress >= 1) {
						this._glanceCurrentYaw = 0;
						this._glancePhase = 'idle';
						this._glanceTimer = 0;
						this._glanceNextDelay = this._randGlanceDelay();
					}
					break;
				}
			}

			this._tmpQ.setFromAxisAngle(this._tmpV.set(0, 1, 0), this._glanceCurrentYaw);
			this._head.quaternion.copy(this._origHeadRot).multiply(this._tmpQ);
		}

		// ── Blink state machine ───────────────────────────────────────────────
		if (this._blinkTarget) {
			this._blinkTimer += dt;
			const { mesh, index } = this._blinkTarget;

			switch (this._blinkPhase) {
				case 'wait':
					if (this._blinkTimer >= this._blinkNextDelay) {
						this._blinkPhase = 'closing';
						this._blinkTimer = 0;
					}
					break;
				case 'closing': {
					const progress = Math.min(this._blinkTimer / 0.06, 1); // 60ms close
					this._blinkMorphCurrent = progress;
					mesh.morphTargetInfluences[index] = this._blinkMorphCurrent * intensity;
					if (progress >= 1) {
						this._blinkPhase = 'closed';
						this._blinkTimer = 0;
					}
					break;
				}
				case 'closed':
					if (this._blinkTimer >= 0.06) { // 60ms closed → total ~120ms
						this._blinkPhase = 'opening';
						this._blinkTimer = 0;
					}
					break;
				case 'opening': {
					const progress = Math.min(this._blinkTimer / 0.06, 1);
					this._blinkMorphCurrent = 1 - progress;
					mesh.morphTargetInfluences[index] = this._blinkMorphCurrent * intensity;
					if (progress >= 1) {
						this._blinkMorphCurrent = 0;
						mesh.morphTargetInfluences[index] = 0;
						this._blinkPhase = 'wait';
						this._blinkTimer = 0;
						this._blinkNextDelay = this._randBlinkDelay();
					}
					break;
				}
			}
		}
	}

	_randGlanceDelay() {
		return 4 + Math.random() * 5; // 4–9s
	}

	_randBlinkDelay() {
		return 3 + Math.random() * 4; // 3–7s
	}
}

function _easeInOut(t) {
	return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
