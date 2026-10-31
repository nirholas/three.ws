// Post-processing for /play: N8AO ambient occlusion, selective bloom and ACES
// tone mapping, on pmndrs/postprocessing (already a dependency).
//
// The base renderer draws straight to the canvas, which leaves the world flat:
// nothing grounds the props, and emissive things (the Witchlight aura, lamps,
// the pumpkin cap) have no glow. This composer adds contact shadowing and bloom
// without touching the scene graph.
//
// Cost control is the whole design. The composer is built lazily (the chunk is
// only fetched on the 'high' perf tier), runs only while the tier is high, power
// saver is off and the context is alive, and falls back to the plain renderer the
// instant any of those flip or anything throws. A failed import or a GPU that
// rejects the passes leaves /play exactly as it was.

import { HalfFloatType, Vector2 } from 'three';

export class PlayPostFx {
	/**
	 * @param {import('three').WebGLRenderer} renderer
	 * @param {import('three').Scene} scene
	 * @param {import('three').PerspectiveCamera} camera
	 */
	constructor(renderer, scene, camera) {
		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.composer = null;
		this.ao = null;
		this.renderPass = null;
		this.active = false;
		this._wanted = false;
		this._loading = null;
		this._failed = false;
	}

	/** Turn the effect chain on or off. Safe to call every frame-tier change. */
	setEnabled(on) {
		this._wanted = !!on && !this._failed;
		if (!this._wanted) { this.active = false; return; }
		if (this.composer) { this.active = true; return; }
		if (!this._loading) this._loading = this._build();
	}

	async _build() {
		try {
			const [pp, { N8AOPostPass }] = await Promise.all([import('postprocessing'), import('n8ao')]);
			const { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode } = pp;
			const size = this.renderer.getSize(new Vector2());
			const composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
			const renderPass = new RenderPass(this.scene, this.camera);
			const ao = new N8AOPostPass(this.scene, this.camera, size.x, size.y);
			ao.configuration.aoRadius = 2.2;
			ao.configuration.distanceFalloff = 1.0;
			ao.configuration.intensity = 2.4;
			ao.configuration.color.set(0x05010a);
			ao.setQualityMode('Medium');
			const bloom = new BloomEffect({ intensity: 0.7, luminanceThreshold: 0.85, luminanceSmoothing: 0.2, mipmapBlur: true });
			const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
			composer.addPass(renderPass);
			composer.addPass(ao);
			composer.addPass(new EffectPass(this.camera, bloom, tone));
			this.composer = composer;
			this.ao = ao;
			this.renderPass = renderPass;
			this.active = this._wanted;
		} catch (err) {
			this._failed = true;
			this.active = false;
			console.warn('[play] post-processing unavailable, using the plain renderer:', err?.message || err);
		} finally {
			this._loading = null;
		}
	}

	resize(w, h) {
		if (!this.composer) return;
		try { this.composer.setSize(w, h, false); } catch { /* next frame retries */ }
	}

	/**
	 * Draw one frame. Returns true when the composer drew it; false means the
	 * caller should render plainly (disabled, still loading, or just failed).
	 */
	render(dt) {
		if (!this.active || !this.composer) return false;
		try {
			this.renderPass.camera = this.camera;
			this.ao.camera = this.camera;
			this.composer.render(dt);
			return true;
		} catch (err) {
			this._failed = true;
			this.active = false;
			console.warn('[play] post-processing failed mid-frame, falling back:', err?.message || err);
			return false;
		}
	}

	dispose() {
		this.active = false;
		try { this.composer?.dispose(); } catch { /* already gone */ }
		this.composer = this.ao = this.renderPass = null;
	}
}
