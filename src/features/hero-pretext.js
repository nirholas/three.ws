// Hero controller for /features — scaffolds submodules behind ?pretext=N flags.
//
// Respecting prefers-reduced-motion is the responsibility of any submodule that
// animates (gaze, dragon reflow). The scaffold itself is inert.

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

		this._gaze = null;
	}

	async init() {
		const mod = await import('@chenglou/pretext');
		this.pretext = mod;
		console.log('[pretext-hero] ready');

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

	dispose() {
		if (this._gaze) {
			this._gaze.detach();
			this._gaze = null;
		}
	}
}
