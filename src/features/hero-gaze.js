// Gaze follow — the hero avatar's camera-orbit tracks the user's cursor.
//
// Uses <model-viewer>'s camera-orbit attribute rather than reaching into the
// Three.js scene, so this stays compatible with the CDN-loaded custom element
// and never touches the main app viewer.
//
// When the cursor is active and near the hero, auto-rotate turns off and the
// avatar tracks. When idle or the cursor leaves the viewport, auto-rotate
// resumes so the avatar never freezes awkwardly mid-stare.

const BASE_THETA_DEG  = 20;   // Matches features.html camera-orbit default
const BASE_PHI_DEG    = 80;
const BASE_RADIUS     = '2.4m';
const THETA_RANGE_DEG = 35;   // ±35° azimuth sweep
const PHI_RANGE_DEG   = 8;    // ±8° polar sweep — subtle up/down
const IDLE_MS         = 2200; // Resume auto-rotate after this quiet
const SMOOTH          = 0.14; // Lerp factor toward the target per frame

const PREFERS_REDUCED_MOTION =
	typeof window !== 'undefined' &&
	window.matchMedia &&
	window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class HeroGaze {
	constructor(hero) {
		this.hero        = hero;
		this.modelViewer = hero.modelViewer;

		this._targetTheta  = BASE_THETA_DEG;
		this._targetPhi    = BASE_PHI_DEG;
		this._currentTheta = BASE_THETA_DEG;
		this._currentPhi   = BASE_PHI_DEG;

		this._lastMoveAt = 0;
		this._rafId      = null;
		this._tracking   = false;
		this._attached   = false;

		this._onPointerMove = this._onPointerMove.bind(this);
		this._onPointerLeave = this._onPointerLeave.bind(this);
		this._tick           = this._tick.bind(this);
	}

	attach() {
		if (this._attached || !this.modelViewer) return;
		if (PREFERS_REDUCED_MOTION) return;

		this._attached = true;
		window.addEventListener('pointermove', this._onPointerMove, { passive: true });
		window.addEventListener('pointerleave', this._onPointerLeave);
		document.addEventListener('mouseleave', this._onPointerLeave);

		this._rafId = requestAnimationFrame(this._tick);
	}

	detach() {
		if (!this._attached) return;
		this._attached = false;

		window.removeEventListener('pointermove', this._onPointerMove);
		window.removeEventListener('pointerleave', this._onPointerLeave);
		document.removeEventListener('mouseleave', this._onPointerLeave);

		if (this._rafId != null) cancelAnimationFrame(this._rafId);
		this._rafId = null;

		// Restore auto-rotate so the hero doesn't stay stuck mid-turn.
		this._setAutoRotate(true);
	}

	_onPointerMove(e) {
		const w = window.innerWidth  || 1;
		const h = window.innerHeight || 1;

		// Normalize cursor to [-1, 1] across viewport with (0,0) at center.
		const nx = (e.clientX / w) * 2 - 1;
		const ny = (e.clientY / h) * 2 - 1;

		this._targetTheta = BASE_THETA_DEG + nx * THETA_RANGE_DEG;
		// Cursor going DOWN should lift the avatar's gaze slightly (lower phi).
		this._targetPhi   = BASE_PHI_DEG   - ny * PHI_RANGE_DEG;

		this._lastMoveAt = performance.now();

		if (!this._tracking) {
			this._tracking = true;
			this._setAutoRotate(false);
		}
	}

	_onPointerLeave() {
		this._lastMoveAt = 0;
		this._targetTheta = BASE_THETA_DEG;
		this._targetPhi   = BASE_PHI_DEG;
	}

	_tick() {
		if (!this._attached) return;

		// Lerp toward the target so the gaze feels like smooth pursuit, not a snap.
		this._currentTheta += (this._targetTheta - this._currentTheta) * SMOOTH;
		this._currentPhi   += (this._targetPhi   - this._currentPhi)   * SMOOTH;

		// Only write the attribute while actively tracking; once we hand back to
		// auto-rotate, model-viewer owns camera-orbit and we must not fight it.
		if (this._tracking) {
			const orbit = `${this._currentTheta.toFixed(2)}deg ${this._currentPhi.toFixed(2)}deg ${BASE_RADIUS}`;
			this.modelViewer.setAttribute('camera-orbit', orbit);
		}

		const quietFor = performance.now() - this._lastMoveAt;
		if (this._tracking && this._lastMoveAt > 0 && quietFor > IDLE_MS) {
			this._tracking = false;
			this._setAutoRotate(true);
		}

		this._rafId = requestAnimationFrame(this._tick);
	}

	_setAutoRotate(on) {
		if (!this.modelViewer) return;
		if (on) this.modelViewer.setAttribute('auto-rotate', '');
		else    this.modelViewer.removeAttribute('auto-rotate');
	}
}
