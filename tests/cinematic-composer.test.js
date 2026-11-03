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
		addPass(p, index) {
			if (index === undefined) this.passes.push(p);
			else this.passes.splice(index, 0, p);
		}
		setSize() {}
		render() {}
		dispose() {}
	}
	return { ...real, EffectComposer: RecordingComposer };
});

// N8AO needs a live WebGL context to build its targets; record what the
// pipeline configures instead.
const aoPasses = [];
vi.mock('n8ao', () => {
	class N8AOPostPass {
		constructor(scene, camera, width, height) {
			Object.assign(this, { scene, camera, width, height });
			this.enabled = true;
			this.configuration = { aoRadius: 5, distanceFalloff: 1, intensity: 5, halfRes: false };
			aoPasses.push(this);
		}
		setQualityMode(mode) {
			this.quality = mode;
		}
	}
	return { N8AOPostPass };
});

const { CinematicPipeline } = await import('../src/viewer/cinematic.js');
const { Scene, PerspectiveCamera } = await import('three');

function fakeRenderer(maxSamples) {
	return {
		capabilities: { maxSamples },
		getPixelRatio: () => 1,
		getSize: (v) => v.set(640, 480),
	};
}

const settle = () => new Promise((r) => setTimeout(r, 0));

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

describe('CinematicPipeline ambient occlusion', () => {
	function pipeline(preset, extra = {}) {
		aoPasses.length = 0;
		const onUpdate = vi.fn();
		const fx = new CinematicPipeline(fakeRenderer(4), new Scene(), new PerspectiveCamera(), {
			width: 640,
			height: 480,
			preset,
			onUpdate,
			...extra,
		});
		return { fx, onUpdate };
	}

	it('never loads AO for the default Studio look', async () => {
		const { fx } = pipeline('Studio');
		await settle();
		expect(aoPasses).toHaveLength(0);
		expect(fx.composer.passes).not.toContainEqual(expect.objectContaining({ configuration: expect.anything() }));
	});

	it('loads N8AO on demand and slots it straight after the scene render', async () => {
		const { fx, onUpdate } = pipeline('Cinematic');
		fx.setContentSize(2);
		await fx._aoLoad;
		const [ao] = aoPasses;
		expect(fx.composer.passes[1]).toBe(ao);
		expect(ao.enabled).toBe(true);
		expect(ao.quality).toBe('Medium');
		expect(ao.configuration.aoRadius).toBeCloseTo(fx.params.ssaoRadius * 2);
		expect(onUpdate).toHaveBeenCalledTimes(1);
	});

	it('scales the AO radius with the model so small and large models shade alike', async () => {
		const { fx } = pipeline('Portrait');
		await fx._aoLoad;
		fx.setContentSize(0.2);
		const small = aoPasses[0].configuration.aoRadius;
		fx.setContentSize(20);
		expect(aoPasses[0].configuration.aoRadius / small).toBeCloseTo(100);
	});

	it('turns AO off without reloading when switching back to Studio', async () => {
		const { fx } = pipeline('Cinematic');
		await fx._aoLoad;
		fx.applyPreset('Studio');
		expect(aoPasses[0].enabled).toBe(false);
		fx.applyPreset('Portrait');
		await settle();
		expect(aoPasses).toHaveLength(1);
		expect(aoPasses[0].enabled).toBe(true);
	});

	it('follows the active camera', async () => {
		const { fx } = pipeline('Cinematic');
		await fx._aoLoad;
		const cam = new PerspectiveCamera();
		fx.setCamera(cam);
		expect(aoPasses[0].camera).toBe(cam);
	});

	it('uses the cheaper AO path on low-power devices', async () => {
		const { fx } = pipeline('Cinematic', { lowPower: true });
		await fx._aoLoad;
		expect(aoPasses[0].quality).toBe('Low');
		expect(aoPasses[0].configuration.halfRes).toBe(true);
	});

	it('does not attach AO to a pipeline disposed mid-load', async () => {
		const { fx } = pipeline('Cinematic');
		const load = fx._aoLoad;
		fx.dispose();
		await load;
		expect(aoPasses).toHaveLength(0);
	});
});
