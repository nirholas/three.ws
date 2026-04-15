// Hero controller for /features — scaffolds submodules behind ?pretext=N flags.
//
// Respecting prefers-reduced-motion is the responsibility of any submodule that
// animates (gaze, dragon reflow). The scaffold itself is inert. The static wrap
// (flag >= 2) is a one-shot paint per resize, so it has nothing to gate.

const MOBILE_MQ = '(max-width: 768px)';
const RESIZE_DEBOUNCE_MS = 120;

export default class PretextHero {
	constructor(root, options = {}) {
		this.root        = root;
		this.content     = root?.querySelector('.hero-content')  || null;
		this.title       = root?.querySelector('.hero-title')    || null;
		this.subtitle    = root?.querySelector('.hero-subtitle') || null;
		this.avatar      = root?.querySelector('.hero-avatar')   || null;
		this.modelViewer = this.avatar?.querySelector('model-viewer') || null;

		this.flag    = String(options.flag ?? '1');
		this.pretext = null;

		this._gaze       = null;
		this._dragon     = null;
		this._overlay    = null;
		this._onResize   = null;
		this._resizeT    = null;
		this._rafToken   = 0;
		this._ctx        = null;
	}

	async init() {
		const mod = await import('@chenglou/pretext');
		this.pretext = mod;
		console.log('[pretext-hero] ready');

		const flagNum = Number.parseInt(this.flag, 10);

		if (flagNum >= 2) {
			try {
				this.enableStaticWrap();
			} catch (err) {
				console.warn('[pretext-hero] static wrap failed:', err);
			}
		}

		// Gaze follows the cursor with subtle head rotation. Dragon mode moves
		// the avatar itself, so the two don't compose — flag 4 opts out of gaze.
		if (this.flag === '3') {
			try {
				const { HeroGaze } = await import('./hero-gaze.js');
				this._gaze = new HeroGaze(this);
				this._gaze.attach();
			} catch (err) {
				console.warn('[pretext-hero] gaze unavailable:', err);
			}
		}

		if (this.flag === '4') {
			try {
				const { HeroDragon } = await import('./hero-dragon.js');
				this._dragon = new HeroDragon(this);
				this._dragon.attach();
			} catch (err) {
				console.warn('[pretext-hero] dragon unavailable:', err);
			}
		}

		return this;
	}

	enableStaticWrap() {
		if (!this.content || !this.subtitle || !this.avatar || !this.pretext) return;

		// Keep the original subtitle accessible to screen readers even when
		// visually hidden via .pretext-active; the overlay is aria-hidden.
		this.subtitle.setAttribute('aria-hidden', 'false');

		this._overlay = document.createElement('div');
		this._overlay.className = 'hero-subtitle-pretext';
		this._overlay.setAttribute('aria-hidden', 'true');
		this.content.appendChild(this._overlay);

		const paint = () => {
			try {
				this._paintStaticWrap();
			} catch (err) {
				console.warn('[pretext-hero] paint failed:', err);
				this.root.classList.remove('pretext-active');
			}
		};

		const ready = document.fonts?.ready ?? Promise.resolve();
		ready.then(paint);

		this._onResize = () => {
			if (this._resizeT) clearTimeout(this._resizeT);
			this._resizeT = setTimeout(paint, RESIZE_DEBOUNCE_MS);
		};
		window.addEventListener('resize', this._onResize);
	}

	// One-shot layout pass. Reads geometry, then paints once via rAF — no mid-frame
	// writes, so resize doesn't thrash.
	_paintStaticWrap() {
		if (!this._overlay) return;

		if (window.matchMedia(MOBILE_MQ).matches) {
			this.root.classList.remove('pretext-active');
			this._overlay.replaceChildren();
			this._overlay.style.display = 'none';
			this._ctx = null;
			return;
		}
		this._overlay.style.display = '';

		const ctx = this._computeLayoutContext();
		if (!ctx) return;
		this._ctx = ctx;

		const { circleX, circleY, circleR } = this._avatarCircle(ctx);
		const { lines, contentHeight } = this._layoutLinesAroundCircle(ctx, circleX, circleY, circleR);

		const token = ++this._rafToken;
		requestAnimationFrame(() => {
			if (token !== this._rafToken || !this._overlay) return;
			this._paintLines(ctx, lines, contentHeight);
			this.root.classList.add('pretext-active');
		});
	}

	// Reads rects + style once. Returned context is the input to
	// _layoutLinesAroundCircle, which is pure math and reusable per-frame
	// by dragon mode.
	_computeLayoutContext() {
		if (!this.content || !this.subtitle || !this.avatar || !this.pretext) return null;

		const contentRect  = this.content.getBoundingClientRect();
		const subtitleRect = this.subtitle.getBoundingClientRect();
		const avatarRect   = this.avatar.getBoundingClientRect();

		const style      = getComputedStyle(this.subtitle);
		const font       = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		const fontSize   = Number.parseFloat(style.fontSize);
		const lhRaw      = style.lineHeight;
		const lineHeight = lhRaw === 'normal' ? fontSize * 1.5 : Number.parseFloat(lhRaw);

		const overlayLeft = subtitleRect.left - contentRect.left;
		const overlayTop  = subtitleRect.top  - contentRect.top;

		// Dragon mode stretches .hero-content to full hero width, so use the
		// content box as the outer bound and let the subtitle flow wider.
		const heroRect        = this.root.getBoundingClientRect();
		const rightmostPage   = this.root.classList.contains('hero--dragon')
			? heroRect.right - 32
			: Math.max(avatarRect.right - 24, subtitleRect.right);
		const overlayWidth    = Math.max(subtitleRect.width, rightmostPage - subtitleRect.left);

		const text     = this.subtitle.textContent ?? '';
		const prepared = this.pretext.prepareWithSegments(text, font);

		const circleBaseR = (Math.min(avatarRect.width, avatarRect.height) / 2) * 0.92;

		return {
			font, lineHeight, prepared, text,
			overlayLeft, overlayTop, overlayWidth,
			subtitleRect, avatarRect, subtitleLeftPage: subtitleRect.left, subtitleTopPage: subtitleRect.top,
			circleBaseR,
			hPad: 14, maxLines: 32,
		};
	}

	_avatarCircle(ctx) {
		const r = ctx.avatarRect;
		return {
			circleX: (r.left + r.width  / 2) - ctx.subtitleLeftPage,
			circleY: (r.top  + r.height / 2) - ctx.subtitleTopPage,
			circleR: ctx.circleBaseR,
		};
	}

	_layoutLinesAroundCircle(ctx, circleX, circleY, circleR) {
		const { overlayWidth, lineHeight, hPad, prepared, maxLines } = ctx;
		const lines = [];
		let cursor = { segmentIndex: 0, graphemeIndex: 0 };
		let lineTop = 0;

		while (lines.length < maxLines) {
			const bandMid = lineTop + lineHeight / 2;
			const dy      = bandMid - circleY;
			const effR    = circleR + hPad;

			let slotWidth = overlayWidth;
			if (Math.abs(dy) < effR) {
				const dx = Math.sqrt(effR * effR - dy * dy);
				const blockedLeft = circleX - dx;
				if (blockedLeft < overlayWidth) {
					if (blockedLeft > 24) {
						slotWidth = blockedLeft;
					} else {
						lineTop += lineHeight;
						continue;
					}
				}
			}

			const line = this.pretext.layoutNextLine(prepared, cursor, slotWidth);
			if (line === null) break;

			lines.push({ y: lineTop, text: line.text });
			cursor = line.end;
			lineTop += lineHeight;
		}

		return { lines, contentHeight: lineTop };
	}

	_paintLines(ctx, lines, contentHeight) {
		if (!this._overlay) return;
		const overlay = this._overlay;
		overlay.style.left   = `${ctx.overlayLeft}px`;
		overlay.style.top    = `${ctx.overlayTop}px`;
		overlay.style.width  = `${ctx.overlayWidth}px`;
		overlay.style.height = `${Math.max(contentHeight, ctx.subtitleRect.height)}px`;

		const frag = document.createDocumentFragment();
		for (const { y, text } of lines) {
			const span = document.createElement('span');
			span.className = 'hero-subtitle-pretext-line';
			span.style.top  = `${y}px`;
			span.textContent = text;
			frag.appendChild(span);
		}
		overlay.replaceChildren(frag);
	}

	// Public for dragon mode — recompute rects after toggling .hero--dragon.
	recomputeContext() {
		this._ctx = this._computeLayoutContext();
		return this._ctx;
	}

	// Public for dragon mode — reflow using the current cached context and
	// the caller-supplied avatar circle (in overlay-local coordinates).
	// Returns the measured layout cost in ms for the auto-downgrade budget.
	paintCircle(circleX, circleY, circleR) {
		if (!this._ctx || !this._overlay) return 0;
		const t0 = performance.now();
		const { lines, contentHeight } = this._layoutLinesAroundCircle(this._ctx, circleX, circleY, circleR);
		this._paintLines(this._ctx, lines, contentHeight);
		return performance.now() - t0;
	}

	dispose() {
		if (this._onResize) {
			window.removeEventListener('resize', this._onResize);
			this._onResize = null;
		}
		if (this._resizeT) {
			clearTimeout(this._resizeT);
			this._resizeT = null;
		}
		if (this._overlay) {
			this._overlay.remove();
			this._overlay = null;
		}
		this.subtitle?.removeAttribute('aria-hidden');
		this.root?.classList.remove('pretext-active');

		if (this._gaze) {
			this._gaze.detach();
			this._gaze = null;
		}
		if (this._dragon) {
			this._dragon.detach();
			this._dragon = null;
		}
		this._ctx = null;
	}
}
