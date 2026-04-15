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
		this._overlay    = null;
		this._onResize   = null;
		this._resizeT    = null;
		this._rafToken   = 0;
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

		// Flag-gated submodules. 2 and 4 are reserved for text-wrap + dragon mode.
		if (this.flag === '3' || this.flag === '4') {
			try {
				const { HeroGaze } = await import('./hero-gaze.js');
				this._gaze = new HeroGaze(this);
				this._gaze.attach();
			} catch (err) {
				console.warn('[pretext-hero] gaze unavailable:', err);
			}
		}

		return this;
	}

	enableStaticWrap() {
		if (!this.content || !this.subtitle || !this.avatar || !this.pretext) return;

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

		// Mobile: single-column layout, avatar stacks above text. A wrap around
		// a circle that sits above the text would just mean empty short lines
		// for no visual payoff. Fall back to plain subtitle.
		if (window.matchMedia(MOBILE_MQ).matches) {
			this.root.classList.remove('pretext-active');
			this._overlay.replaceChildren();
			this._overlay.style.display = 'none';
			return;
		}
		this._overlay.style.display = '';

		// ── Read phase ───────────────────────────────────────────────────────
		const contentRect  = this.content.getBoundingClientRect();
		const subtitleRect = this.subtitle.getBoundingClientRect();
		// The avatar element's rect is what we want — the <model-viewer> canvas
		// includes transparent padding, so its rect would overstate the visual
		// silhouette.
		const avatarRect   = this.avatar.getBoundingClientRect();

		const style      = getComputedStyle(this.subtitle);
		const font       = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		const fontSize   = Number.parseFloat(style.fontSize);
		const lhRaw      = style.lineHeight;
		const lineHeight = lhRaw === 'normal' ? fontSize * 1.5 : Number.parseFloat(lhRaw);

		// Overlay lives inside .hero-content (position: relative). Local origin
		// is the content box's top-left.
		const overlayLeft = subtitleRect.left - contentRect.left;
		const overlayTop  = subtitleRect.top  - contentRect.top;

		// Extend the layout column past the subtitle's natural right edge,
		// into the gutter and up to just shy of the avatar's right edge, so
		// text visibly flows around the avatar circle. Keep a small breathing
		// margin so the rightmost line doesn't kiss the avatar rect edge.
		const overlayRightPage = Math.max(avatarRect.right - 24, subtitleRect.right);
		const overlayWidth     = Math.max(subtitleRect.width, overlayRightPage - subtitleRect.left);

		// Avatar bounding circle, projected into overlay-local coords.
		const circleX = (avatarRect.left + avatarRect.width  / 2) - subtitleRect.left;
		const circleY = (avatarRect.top  + avatarRect.height / 2) - subtitleRect.top;
		// Slight inset so the wrap hugs the visible silhouette rather than the
		// invisible square of the container.
		const circleR = (Math.min(avatarRect.width, avatarRect.height) / 2) * 0.92;
		const hPad    = 14;

		const text = this.subtitle.textContent ?? '';
		const prepared = this.pretext.prepareWithSegments(text, font);

		const lines = [];
		let cursor = { segmentIndex: 0, graphemeIndex: 0 };
		let lineTop = 0;
		const maxLines = 32;

		while (lines.length < maxLines) {
			// Sample the circle at the line's vertical midpoint. A per-band
			// min/max sweep would hug tighter, but for a single circle the
			// midpoint sample is visually indistinguishable and half the work.
			const bandMid = lineTop + lineHeight / 2;
			const dy      = bandMid - circleY;
			const effR    = circleR + hPad;

			let slotWidth = overlayWidth;
			if (Math.abs(dy) < effR) {
				const dx = Math.sqrt(effR * effR - dy * dy);
				const blockedLeft = circleX - dx;
				// Take the left slot only — the subtitle flows L→R and the
				// avatar sits to its right, so right-of-circle slivers would
				// read as disconnected floating phrases. Left-only is the
				// readable choice.
				if (blockedLeft < overlayWidth) {
					if (blockedLeft > 24) {
						slotWidth = blockedLeft;
					} else {
						// Circle fully covers the left side of this band —
						// skip this row vertically, let text resume below.
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

		// ── Write phase ─────────────────────────────────────────────────────
		const token = ++this._rafToken;
		requestAnimationFrame(() => {
			if (token !== this._rafToken || !this._overlay) return;

			const overlay = this._overlay;
			overlay.style.left   = `${overlayLeft}px`;
			overlay.style.top    = `${overlayTop}px`;
			overlay.style.width  = `${overlayWidth}px`;
			overlay.style.height = `${Math.max(lineTop, subtitleRect.height)}px`;

			const frag = document.createDocumentFragment();
			for (const { y, text } of lines) {
				const span = document.createElement('span');
				span.className = 'hero-subtitle-pretext-line';
				span.style.top  = `${y}px`;
				span.textContent = text;
				frag.appendChild(span);
			}
			overlay.replaceChildren(frag);

			this.root.classList.add('pretext-active');
		});
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
		this.root?.classList.remove('pretext-active');

		if (this._gaze) {
			this._gaze.detach();
			this._gaze = null;
		}
	}
}
