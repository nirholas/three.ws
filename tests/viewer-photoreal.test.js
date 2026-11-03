import { describe, it, expect, vi, beforeEach } from 'vitest';

// The path tracer needs a live WebGL context, so it is replaced with a recorder
// that accumulates one sample per renderSample(). Everything renderPhotoreal
// does around it (suspending the live loop, swapping scene state, restoring it)
// runs for real.
const tracers = [];
// The viewer under test, so the fake tracer can record its state per sample.
let activeViewer = null;
vi.mock('three-gpu-pathtracer', () => {
	class WebGLPathTracer {
		constructor(renderer) {
			this.renderer = renderer;
			this.samples = 0;
			this.tiles = { set: vi.fn() };
			this.disposed = false;
			this.seen = [];
			tracers.push(this);
		}
		setScene(scene, camera) {
			this.scene = scene;
			this.camera = camera;
		}
		renderSample() {
			this.seen.push({ suspended: activeViewer?._suspended, controls: activeViewer?.controls.enabled });
			this.samples += 1;
		}
		dispose() {
			this.disposed = true;
		}
	}
	return { WebGLPathTracer };
});

globalThis.requestAnimationFrame ??= (cb) => setTimeout(cb, 0);

const { renderPhotoreal, resolvePhotorealOptions, PHOTOREAL_DEFAULTS } = await import('../src/viewer/photoreal.js');
const { Scene, PerspectiveCamera, Color } = await import('three');

function fakeViewer() {
	const scene = new Scene();
	const envTexture = { name: 'pmrem' };
	scene.environment = envTexture;
	scene.background = new Color(0x202020);
	const viewer = {
		scene,
		activeCamera: new PerspectiveCamera(),
		renderer: {
			domElement: { toBlob: (cb, type) => cb(new Blob(['png'], { type })) },
		},
		shadowCatcher: { visible: true },
		controls: { enabled: true },
		_suspended: false,
		_contextLost: false,
		_disposed: false,
		_updateRenderLoop: vi.fn(),
		invalidate: vi.fn(),
	};
	activeViewer = viewer;
	return { viewer, envTexture };
}

beforeEach(() => {
	tracers.length = 0;
});

describe('resolvePhotorealOptions', () => {
	it('fills defaults when nothing is given', () => {
		expect(resolvePhotorealOptions()).toEqual({ ...PHOTOREAL_DEFAULTS });
	});

	it('clamps to what the tracer can honour and rounds fractions', () => {
		expect(resolvePhotorealOptions({ samples: 0, bounces: 99 })).toEqual({ samples: 1, bounces: 16 });
		expect(resolvePhotorealOptions({ samples: 1e9, bounces: 0 })).toEqual({ samples: 4096, bounces: 1 });
		expect(resolvePhotorealOptions({ samples: 63.6, bounces: '3' })).toEqual({ samples: 64, bounces: 3 });
	});

	it('ignores non-numeric input instead of rendering zero samples', () => {
		expect(resolvePhotorealOptions({ samples: 'lots', bounces: NaN })).toEqual({ ...PHOTOREAL_DEFAULTS });
	});
});

describe('renderPhotoreal', () => {
	it('suspends the live view while tracing and restores everything after', async () => {
		const { viewer, envTexture } = fakeViewer();
		const background = viewer.scene.background;
		const progress = [];

		const blob = await renderPhotoreal(viewer, {
			samples: 3,
			environment: { id: '' },
			onProgress: (p) => progress.push(p.samples),
		});

		expect(blob.type).toBe('image/png');
		const [tracer] = tracers;
		expect(tracer.samples).toBe(3);
		expect(tracer.seen.every((s) => s.suspended === true && s.controls === false)).toBe(true);
		expect(tracer.scene).toBe(viewer.scene);
		expect(tracer.camera).toBe(viewer.activeCamera);
		expect(tracer.disposed).toBe(true);
		expect(progress).toEqual([1, 2, 3]);

		expect(viewer._suspended).toBe(false);
		expect(viewer.controls.enabled).toBe(true);
		expect(viewer.shadowCatcher.visible).toBe(true);
		expect(viewer.scene.environment).toBe(envTexture);
		expect(viewer.scene.background).toBe(background);
		expect(viewer._updateRenderLoop).toHaveBeenCalledTimes(2);
		expect(viewer.invalidate).toHaveBeenCalled();
	});

	it('hides the raster-only shadow catcher from the tracer', async () => {
		const { viewer } = fakeViewer();
		let catcherDuringTrace;
		await renderPhotoreal(viewer, {
			samples: 1,
			environment: { id: '' },
			onProgress: () => (catcherDuringTrace = viewer.shadowCatcher.visible),
		});
		expect(catcherDuringTrace).toBe(false);
		expect(viewer.shadowCatcher.visible).toBe(true);
	});

	it('cancels on abort and still hands the live view back', async () => {
		const { viewer, envTexture } = fakeViewer();
		const controller = new AbortController();
		const run = renderPhotoreal(viewer, {
			samples: 500,
			environment: { id: '' },
			signal: controller.signal,
			onProgress: (p) => p.samples === 2 && controller.abort(),
		});
		await expect(run).rejects.toMatchObject({ name: 'AbortError' });
		expect(tracers[0].samples).toBe(2);
		expect(tracers[0].disposed).toBe(true);
		expect(viewer._suspended).toBe(false);
		expect(viewer.controls.enabled).toBe(true);
		expect(viewer.scene.environment).toBe(envTexture);
	});

	it('refuses to start a second render on the same viewer', async () => {
		const { viewer } = fakeViewer();
		viewer._suspended = true;
		await expect(renderPhotoreal(viewer, { environment: { id: '' } })).rejects.toThrow(/already running/);
		expect(tracers).toHaveLength(0);
	});

	it('refuses while the graphics context is lost', async () => {
		const { viewer } = fakeViewer();
		viewer._contextLost = true;
		await expect(renderPhotoreal(viewer, { environment: { id: '' } })).rejects.toThrow(/graphics context/);
		expect(viewer._suspended).toBe(false);
	});

	it('stops cleanly when the context is lost mid-render', async () => {
		const { viewer } = fakeViewer();
		const run = renderPhotoreal(viewer, {
			samples: 50,
			environment: { id: '' },
			onProgress: (p) => p.samples === 1 && (viewer._contextLost = true),
		});
		await expect(run).rejects.toThrow(/reset during the render/);
		expect(viewer._suspended).toBe(false);
		expect(tracers[0].disposed).toBe(true);
	});
});
