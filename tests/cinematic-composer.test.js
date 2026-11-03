import { describe, it, expect, vi } from 'vitest';

// Capture what CinematicPipeline asks of its EffectComposer. The passes and
// effects stay real; only the composer (the part that needs a live WebGL
// context) is replaced with a recorder.
const created = [];
vi.mock('postprocessing', async (importOriginal) => {
	const real = await importOriginal();
	class RecordingComposer {
		constructor(renderer, options) {
			created.push({ renderer, options });
			this.passes = [];
		}
		addPass(p) { this.passes.push(p); }
		setSize() {}
		render() {}
		dispose() {}
	}
	return { ...real, EffectComposer: RecordingComposer };
});

const { CinematicPipeline } = await import('../src/viewer/cinematic.js');
const { Scene, PerspectiveCamera } = await import('three');

function fakeRenderer(maxSamples) {
	return { capabilities: { maxSamples }, getPixelRatio: () => 1 };
}

function build(renderer, extra = {}) {
	created.length = 0;
	new CinematicPipeline(renderer, new Scene(), new PerspectiveCamera(), { width: 640, height: 480, ...extra });
	return created[0].options ?? {};
}

describe('CinematicPipeline composer', () => {
	it('keeps edges antialiased: the composer target is multisampled', () => {
		// Rendering through a composer bypasses the canvas's own MSAA, so without
		// multisampling every opaque-background embed draws stair-stepped edges.
		expect(build(fakeRenderer(8)).multisampling).toBe(4);
	});

	it('never asks for more samples than the GPU supports', () => {
		expect(build(fakeRenderer(2)).multisampling).toBe(2);
		expect(build(fakeRenderer(0)).multisampling).toBe(0);
	});

	it('uses fewer samples on low-power devices', () => {
		expect(build(fakeRenderer(8), { lowPower: true }).multisampling).toBe(2);
	});
});
