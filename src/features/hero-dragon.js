// Dragon mode — the hero avatar chases the cursor while the subtitle reflows
// around its silhouette every frame. Inspired by the chenglou/pretext dragon
// demo. Opt-in via ?pretext=4 only; gimmick risk is real.
//
// Layering:
// - Avatar is translated via transform (.hero-avatar). .hero--dragon absolutely
//   positions it within .hero; a home transform returns it to grid baseline.
// - Text reflows via PretextHero.paintCircle(cx, cy, r), called once per frame.
// - One rAF drives both the spring integrator and the reflow.
//
// Auto-downgrade: if mean reflow cost over a 30-frame window exceeds
// COST_BUDGET_MS, disable per-frame relayout and keep the chase running.

const STIFFNESS      = 120;
const DAMPING        = 20;
const MASS           = 1;
const RETURN_EPS_POS = 0.5;   // px
const RETURN_EPS_VEL = 5;     // px/s
const COST_BUDGET_MS = 8;
const COST_WINDOW    = 30;
const HERO_INSET     = 16;    // px — keep avatar fully inside hero

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

export class HeroDragon {
	constructor(hero) {
		this.hero        = hero;
		this.root        = hero.root;
		this.avatar      = hero.avatar;
		this.modelViewer = hero.modelViewer;

		this._targetX = 0;
		this._targetY = 0;
		this._x  = 0;
		this._y  = 0;
		this._vx = 0;
		this._vy = 0;

		this._homeRect  = null;
		this._heroRect  = null;
		this._lastTs    = 0;
		this._rafId     = null;
		this._attached  = false;
		this._returning = false;

		this._costSamples = [];
		this._downgraded  = false;

		this._onPointerMove  = this._onPointerMove.bind(this);
		this._onPointerLeave = this._onPointerLeave.bind(this);
		this._onResize       = this._onResize.bind(this);
		this._onVisibility   = this._onVisibility.bind(this);
		this._tick           = this._tick.bind(this);
	}

	attach() {
		if (this._attached) return;
		if (!this.avatar || !this.root || !this.hero?.pretext) return;
		if (prefersReducedMotion()) return;
		if (!hasHover()) return;

		this._attached = true;

		this.root.classList.add('hero--dragon');
		this._setAutoRotate(false);

		// Wait a frame for the CSS to resettle (grid column changes), then
		// measure rects and recompute pretext layout context.
		requestAnimationFrame(() => {
			if (!this._attached) return;
			this._measureRects();
			this.hero.recomputeContext?.();
			this._paint();

			this.root.addEventListener('pointermove',  this._onPointerMove,  { passive: true });
			this.root.addEventListener('pointerleave', this._onPointerLeave);
			window.addEventListener('resize', this._onResize, { passive: true });
			window.addEventListener('scroll', this._onResize, { passive: true });
			document.addEventListener('visibilitychange', this._onVisibility);

			this._lastTs = performance.now();
			this._rafId  = requestAnimationFrame(this._tick);
		});
	}

	detach() {
		if (!this._attached) return;
		this._attached = false;

		this.root.removeEventListener('pointermove',  this._onPointerMove);
		this.root.removeEventListener('pointerleave', this._onPointerLeave);
		window.removeEventListener('resize', this._onResize);
		window.removeEventListener('scroll', this._onResize);
		document.removeEventListener('visibilitychange', this._onVisibility);

		if (this._rafId != null) cancelAnimationFrame(this._rafId);
		this._rafId = null;

		this.root.classList.remove('hero--dragon');
		if (this.avatar) {
			this.avatar.style.transform  = '';
			this.avatar.style.willChange = '';
		}
		this._setAutoRotate(true);

		// Static wrap resumes once the class is gone — bounce through pretext's
		// own repaint path so the overlay matches the non-dragon layout.
		this.hero.recomputeContext?.();
		const c = this._homeCircle();
		if (c) this.hero.paintCircle?.(c.x, c.y, c.r);
	}

	_measureRects() {
		this._heroRect = this.root.getBoundingClientRect();
		this._homeRect = this.avatar.getBoundingClientRect();
		this.avatar.style.willChange = 'transform';
	}

	_homeCircle() {
		const ctx = this.hero._ctx;
		if (!ctx) return null;
		// Home center in overlay-local coords, mirroring _avatarCircle()
		// but using the avatar's home rect.
		const r = this._homeRect ?? ctx.avatarRect;
		return {
			x: (r.left + r.width  / 2) - ctx.subtitleLeftPage,
			y: (r.top  + r.height / 2) - ctx.subtitleTopPage,
			r: ctx.circleBaseR,
		};
	}

	_onResize() {
		if (this._resizePending) return;
		this._resizePending = true;
		requestAnimationFrame(() => {
			this._resizePending = false;
			this._measureRects();
			this.hero.recomputeContext?.();
		});
	}

	_onVisibility() {
		if (document.hidden) {
			if (this._rafId != null) cancelAnimationFrame(this._rafId);
			this._rafId = null;
		} else if (this._attached && this._rafId == null) {
			this._lastTs = performance.now();
			this._rafId  = requestAnimationFrame(this._tick);
		}
	}

	_onPointerMove(e) {
		const home = this._homeRect;
		const hero = this._heroRect;
		if (!home || !hero) return;

		const homeCx = home.left + home.width  / 2;
		const homeCy = home.top  + home.height / 2;

		// Clamp so the avatar rect stays within the hero rect (minus inset).
		const halfW = home.width  / 2;
		const halfH = home.height / 2;
		const minCx = hero.left   + halfW + HERO_INSET;
		const maxCx = hero.right  - halfW - HERO_INSET;
		const minCy = hero.top    + halfH + HERO_INSET;
		const maxCy = hero.bottom - halfH - HERO_INSET;

		const cx = Math.min(maxCx, Math.max(minCx, e.clientX));
		const cy = Math.min(maxCy, Math.max(minCy, e.clientY));

		this._targetX = cx - homeCx;
		this._targetY = cy - homeCy;
		this._returning = false;
	}

	_onPointerLeave() {
		this._targetX = 0;
		this._targetY = 0;
		this._returning = true;
	}

	_tick(ts) {
		if (!this._attached) return;

		const dtRaw = (ts - this._lastTs) / 1000;
		this._lastTs = ts;
		// Cap dt to avoid spring explosions after a tab-switch pause.
		const dt = Math.min(dtRaw, 1 / 30);

		// Semi-implicit Euler spring integrator.
		const ax = (STIFFNESS * (this._targetX - this._x) - DAMPING * this._vx) / MASS;
		const ay = (STIFFNESS * (this._targetY - this._y) - DAMPING * this._vy) / MASS;
		this._vx += ax * dt;
		this._vy += ay * dt;
		this._x  += this._vx * dt;
		this._y  += this._vy * dt;

		this.avatar.style.transform = `translate3d(${this._x.toFixed(2)}px, ${this._y.toFixed(2)}px, 0)`;

		this._paint();

		// Once fully settled at home after a pointerleave, detach cleanly so
		// the static wrap and auto-rotate resume.
		if (this._returning) {
			const settled =
				Math.abs(this._x)  < RETURN_EPS_POS &&
				Math.abs(this._y)  < RETURN_EPS_POS &&
				Math.abs(this._vx) < RETURN_EPS_VEL &&
				Math.abs(this._vy) < RETURN_EPS_VEL;
			if (settled) {
				this.detach();
				return;
			}
		}

		this._rafId = requestAnimationFrame(this._tick);
	}

	_paint() {
		if (this._downgraded) return;
		const ctx = this.hero._ctx;
		if (!ctx) return;

		const home = this._homeRect;
		if (!home) return;

		const homeCxPage = home.left + home.width  / 2;
		const homeCyPage = home.top  + home.height / 2;
		const cx = (homeCxPage + this._x) - ctx.subtitleLeftPage;
		const cy = (homeCyPage + this._y) - ctx.subtitleTopPage;

		const cost = this.hero.paintCircle?.(cx, cy, ctx.circleBaseR) ?? 0;

		this._costSamples.push(cost);
		if (this._costSamples.length > COST_WINDOW) this._costSamples.shift();
		if (this._costSamples.length === COST_WINDOW) {
			let sum = 0;
			for (const c of this._costSamples) sum += c;
			if (sum / COST_WINDOW > COST_BUDGET_MS) {
				this._downgraded = true;
				console.warn('[pretext-hero] dragon downgraded — reflow cost exceeded budget');
			}
		}
	}

	_setAutoRotate(on) {
		if (!this.modelViewer) return;
		if (on) this.modelViewer.setAttribute('auto-rotate', '');
		else    this.modelViewer.removeAttribute('auto-rotate');
	}
}
