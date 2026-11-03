// Path-traced stills. Renders the viewer's current pose, camera, lights and
// environment with three-gpu-pathtracer (physically based global illumination:
// real soft shadows, colour bleeding, multi-bounce reflections) and returns a
// PNG. The path tracer is a ~300 KB module, so it is imported only when a still
// is requested; the live viewer never pays for it.
//
// The live render loop is suspended while the path tracer owns the canvas and
// resumes afterwards with the scene exactly as it was.

import {
	CubeCamera,
	DataTexture,
	EquirectangularReflectionMapping,
	FloatType,
	HalfFloatType,
	LinearFilter,
	LinearSRGBColorSpace,
	Mesh,
	OrthographicCamera,
	PlaneGeometry,
	RGBAFormat,
	Scene,
	ShaderMaterial,
	WebGLCubeRenderTarget,
	WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

export const PHOTOREAL_DEFAULTS = Object.freeze({ samples: 128, bounces: 5 });

/** Clamp caller options to values the path tracer can honour. */
export function resolvePhotorealOptions({ samples, bounces } = {}) {
	const n = (v, fallback, min, max) => {
		const x = Math.round(Number(v));
		return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
	};
	return {
		samples: n(samples, PHOTOREAL_DEFAULTS.samples, 1, 4096),
		bounces: n(bounces, PHOTOREAL_DEFAULTS.bounces, 1, 16),
	};
}

const EQUIRECT_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
// Inverse of three's equirectUv(): longitude on x, latitude on y.
const EQUIRECT_FRAG = /* glsl */ `
#define PI 3.141592653589793
uniform samplerCube cube;
varying vec2 vUv;
void main() {
	float lon = (vUv.x - 0.5) * 2.0 * PI;
	float lat = (vUv.y - 0.5) * PI;
	vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
	gl_FragColor = vec4(textureCube(cube, dir).rgb, 1.0);
}
`;

// The path tracer importance-samples an equirectangular map on the CPU, so the
// studio room the live viewer uses (a PMREM cube) is re-captured as a float
// equirect with its pixels read back.
function bakeRoomEquirect(renderer, width = 1024) {
	const height = width / 2;
	const room = new RoomEnvironment();
	const cubeTarget = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
	const cubeCamera = new CubeCamera(0.1, 100, cubeTarget);
	const flatTarget = new WebGLRenderTarget(width, height, { type: FloatType, format: RGBAFormat });
	const material = new ShaderMaterial({
		uniforms: { cube: { value: cubeTarget.texture } },
		vertexShader: EQUIRECT_VERT,
		fragmentShader: EQUIRECT_FRAG,
		depthTest: false,
		depthWrite: false,
	});
	const quad = new Mesh(new PlaneGeometry(2, 2), material);
	const quadScene = new Scene();
	quadScene.add(quad);
	const prevTarget = renderer.getRenderTarget();
	try {
		cubeCamera.update(renderer, room);
		renderer.setRenderTarget(flatTarget);
		renderer.render(quadScene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
		const data = new Float32Array(width * height * 4);
		renderer.readRenderTargetPixels(flatTarget, 0, 0, width, height, data);
		const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
		tex.mapping = EquirectangularReflectionMapping;
		tex.colorSpace = LinearSRGBColorSpace;
		tex.minFilter = tex.magFilter = LinearFilter;
		tex.needsUpdate = true;
		return tex;
	} finally {
		renderer.setRenderTarget(prevTarget);
		cubeTarget.dispose();
		flatTarget.dispose();
		material.dispose();
		quad.geometry.dispose();
		room.dispose();
	}
}

function loadExrEquirect(path) {
	return new Promise((resolve, reject) => {
		new EXRLoader().load(
			path,
			(tex) => {
				tex.mapping = EquirectangularReflectionMapping;
				resolve(tex);
			},
			undefined,
			reject,
		);
	});
}

/** The equirect that matches what the live viewer is lit by, or null for none. */
async function environmentEquirect(viewer, entry) {
	if (!entry || entry.id === '') return null;
	if (entry.id === 'neutral') return bakeRoomEquirect(viewer.renderer);
	return loadExrEquirect(entry.path);
}

function nextFrame() {
	return new Promise((resolve) => requestAnimationFrame(resolve));
}

function snapshot(canvas) {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas produced no image data'))), 'image/png');
	});
}

/**
 * Path-trace the viewer's current frame into a PNG.
 *
 * @param {import('../viewer.js').Viewer} viewer
 * @param {{ samples?: number, bounces?: number, onProgress?: (p: { samples: number, total: number }) => void, signal?: AbortSignal, environment?: { id: string, path?: string } }} [opts]
 * @returns {Promise<Blob>}
 */
export async function renderPhotoreal(viewer, opts = {}) {
	const { samples, bounces } = resolvePhotorealOptions(opts);
	const { onProgress, signal, environment } = opts;
	if (viewer._suspended) throw new Error('A photoreal render is already running on this viewer');
	if (viewer._contextLost) throw new Error('The graphics context is unavailable; try again in a moment');

	const { WebGLPathTracer } = await import('three-gpu-pathtracer');
	const { renderer, scene } = viewer;
	const camera = viewer.activeCamera;

	viewer._suspended = true;
	viewer._updateRenderLoop();

	const saved = {
		environment: scene.environment,
		background: scene.background,
		catcherVisible: viewer.shadowCatcher?.visible,
		controlsEnabled: viewer.controls?.enabled,
	};
	// The tracer accumulates against one fixed camera; an orbit mid-render would
	// leave the samples and the camera out of step.
	if (viewer.controls) viewer.controls.enabled = false;
	let equirect = null;
	let tracer = null;
	try {
		equirect = await environmentEquirect(viewer, environment);
		scene.environment = equirect;
		// The studio backdrop is the PMREM of the same room; show its equirect
		// twin. Solid colours and transparency carry over unchanged.
		if (saved.background && saved.background === saved.environment) scene.background = equirect;
		// ShadowMaterial is a raster trick; the path tracer has no equivalent and
		// would draw the catcher as an opaque plane. Real bounce light does the
		// grounding instead.
		if (viewer.shadowCatcher) viewer.shadowCatcher.visible = false;
		scene.updateMatrixWorld(true);

		tracer = new WebGLPathTracer(renderer);
		tracer.bounces = bounces;
		tracer.tiles.set(1, 1);
		tracer.renderDelay = 0;
		tracer.fadeDuration = 0;
		tracer.minSamples = 0;
		tracer.dynamicLowRes = false;
		tracer.filterGlossyFactor = 0.5;
		tracer.setScene(scene, camera);

		while (tracer.samples < samples) {
			if (signal?.aborted) throw signal.reason ?? new DOMException('Photoreal render cancelled', 'AbortError');
			if (viewer._contextLost || viewer._disposed) throw new Error('The 3D view was reset during the render');
			tracer.renderSample();
			onProgress?.({ samples: Math.min(samples, Math.floor(tracer.samples)), total: samples });
			if (tracer.samples < samples) await nextFrame();
		}
		// toBlob captures the drawing buffer synchronously, before the browser
		// composites and clears it, so no preserveDrawingBuffer is needed.
		return await snapshot(renderer.domElement);
	} finally {
		tracer?.dispose();
		scene.environment = saved.environment;
		scene.background = saved.background;
		if (viewer.shadowCatcher && saved.catcherVisible !== undefined) viewer.shadowCatcher.visible = saved.catcherVisible;
		equirect?.dispose();
		if (viewer.controls && saved.controlsEnabled !== undefined) viewer.controls.enabled = saved.controlsEnabled;
		viewer._suspended = false;
		if (!viewer._disposed) {
			viewer._updateRenderLoop();
			viewer.invalidate();
		}
	}
}
