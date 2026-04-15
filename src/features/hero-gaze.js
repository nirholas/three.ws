// Gaze follow — the hero avatar's camera-orbit tracks the user's cursor.
//
// Uses <model-viewer>'s camera-orbit attribute rather than reaching into the
// Three.js scene, so this stays compatible with the CDN-loaded custom element
// and never touches the main app viewer.
//
// When the cursor moves over the hero, auto-rotate turns off and the avatar
// tracks the cursor (normalized relative to the avatar's bounding rect). On
// pointerleave or after an idle window, the avatar eases back to its default
// orbit and auto-rotate resumes.

// Defaults must match features.html's camera-orbit attribute.
const BASE_THETA_DEG  = 20;
const BASE_PHI_DEG    = 68;
const BASE_RADIUS     = '3.4m';
const THETA_RANGE_DEG = 15;   // ±15° azimuth — subtle but legible
const PHI_RANGE_DEG   = 8;    // ±8° polar
const IDLE_MS         = 1200; // Resume auto-rotate after this quiet
const SMOOTH          = 0.12; // Lerp alpha toward target per frame (~60fps)
const SETTLE_EPSILON  = 0.05; // Degrees — below this we consider the return complete

function prefersReducedMotion() {
	return typeof window !== 'undefined'
		&& window.matchMedia
		&& window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function hasHover() {
	return typeof window !== 'undefined'
		&& window.matchMedia
		&& window.matchMedia('(hover: hover)').matches;
}

export class HeroGaze {
	constructor(hero) {
		this.hero        = hero;
		this.root        = hero.root;
		this.avatar      = hero.avatar;
		this.modelViewer = hero.modelViewer;

		this._targetTheta  = BASE_THETA_DEG;
		this._targetPhi    = BASE_PHI_DEG;
		this._currentTheta = BASE_THETA_DEG;
		this._currentPhi   = BASE_PHI_DEG;

		this._avatarRect = null;
		this._lastMoveAt = 0;
		this._rafId      = null;
		this._tracking   = false;
		this._attached   = false;

		this._onPointerMove  = this._onPointerMove.bind(this);
		this._onPointerLeave = this._onPointerLeave.bind(this);
		this._onResize       = this._onResize.bind(this);
		this._tick           = this._tick.bind(this);
	}

	attach() {
		if (this._attached) return;
		if (!this.modelViewer || !this.root || !this.avatar) return;

		// Skip entirely on reduced-motion and on no-hover (touch) devices.
		if (prefersReducedMotion()) return;
		if (!hasHover()) return;

		this._attached = true;
		this._refreshRect();

		this.root.addEventListener('pointermove',  this._onPointerMove,  { passive: true });
		this.root.addEventListener('pointerleave', this._onPointerLeave);
		window.addEventListener('resize', this._onResize, { passive: true });
		window.addEventListener('scroll', this._onResize, { passive: true });

		this._rafId = requestAnimationFrame(this._tick);
	}

	detach() {
		if (!this._attached) return;
		this._attached = false;

		this.root.removeEventListener('pointermove',  this._onPointerMove);
		this.root.removeEventListener('pointerleave', this._onPointerLeave);
		window.removeEventListener('resize', this._onResize);
		window.removeEventListener('scroll', this._onResize);

		if (this._rafId != null) cancelAnimationFrame(this._rafId);
		this._rafId = null;

		// Hand control back to model-viewer so the hero doesn't freeze mid-turn.
		this._setAutoRotate(true);
	}

	_refreshRect() {
		this._avatarRect = this.avatar.getBoundingClientRect();
	}

	_onResize() {
		// rAF-coalesce rect reads; scroll/resize fire often.
		if (this._rectPending) return;
		this._rectPending = true;
		requestAnimationFrame(() => {
			this._rectPending = false;
			this._refreshRect();
		});
	}

	_onPointerMove(e) {
		// The rAF tick consumes these target values; the event handler itself
		// does no DOM writes and no orbit math beyond the normalization.
		const rect = this._avatarRect;
		if (!rect || rect.width === 0 || rect.height === 0) return;

		const cx = rect.left + rect.width  / 2;
		const cy = rect.top  + rect.height / 2;

		// Normalize to [-1, 1] relative to avatar's own half-extents so the
		// signal is strongest as the cursor approaches the avatar and clamps
		// at the edges of the hero.
		let nx = (e.clientX - cx) / (rect.width  / 2);
		let ny = (e.clientY - cy) / (rect.height / 2);
		if (nx < -1) nx = -1; else if (nx > 1) nx = 1;
		if (ny < -1) ny = -1; else if (ny > 1) ny = 1;

		this._targetTheta = BASE_THETA_DEG + nx * THETA_RANGE_DEG;
		// Cursor moving down (ny > 0) should tilt the avatar's gaze down too,
		// which in model-viewer's polar convention means increasing phi.
		this._targetPhi   = BASE_PHI_DEG   + ny * PHI_RANGE_DEG;

		this._lastMoveAt = performance.now();

		if (!this._tracking) {
			this._tracking = true;
			this._setAutoRotate(false);
		}
	}

	_onPointerLeave() {
		// Ease back to base; the tick loop will flip auto-rotate back on once
		// we've settled near the default orbit.
		this._targetTheta = BASE_THETA_DEG;
		this._targetPhi   = BASE_PHI_DEG;
		this._lastMoveAt  = 0;
	}

	_tick() {
		if (!this._attached) return;

		this._currentTheta += (this._targetTheta - this._currentTheta) * SMOOTH;
		this._currentPhi   += (this._targetPhi   - this._currentPhi)   * SMOOTH;

		if (this._tracking) {
			const orbit = `${this._currentTheta.toFixed(2)}deg ${this._currentPhi.toFixed(2)}deg ${BASE_RADIUS}`;
			this.modelViewer.setAttribute('camera-orbit', orbit);
		}

		const now = performance.now();
		const idleFor = this._lastMoveAt > 0 ? now - this._lastMoveAt : 0;
		const settled =
			Math.abs(this._currentTheta - BASE_THETA_DEG) < SETTLE_EPSILON &&
			Math.abs(this._currentPhi   - BASE_PHI_DEG)   < SETTLE_EPSILON;

		// Resume auto-rotate either after a quiet window (cursor still over the
		// hero but idle) or after pointerleave once the avatar has eased home.
		const shouldResume = this._lastMoveAt === 0
			? settled           // pointerleave: wait for ease-back to complete
			: idleFor > IDLE_MS; // idle: cursor still in hero but stopped
		if (this._tracking && shouldResume) {
			this._tracking = false;
			if (this._lastMoveAt === 0 && settled) {
				// Snap to the canonical orbit so auto-rotate picks up cleanly.
				this.modelViewer.setAttribute('camera-orbit', `${BASE_THETA_DEG}deg ${BASE_PHI_DEG}deg ${BASE_RADIUS}`);
				this._currentTheta = BASE_THETA_DEG;
				this._currentPhi   = BASE_PHI_DEG;
			}
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
