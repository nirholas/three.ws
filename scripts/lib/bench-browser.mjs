// Shared Chromium launcher for the renderer benches.
// `swiftshader` (default) forces the software adapter so runs are reproducible on
// any machine. `hardware` drives the machine's real GPU: it needs a GPU-capable
// host (Vulkan drivers on Linux) and runs headed or with the new headless mode.

import { chromium } from 'playwright';

const SWIFTSHADER_ARGS = [
	'--enable-unsafe-webgpu',
	'--enable-features=Vulkan,WebGPU',
	'--use-angle=swiftshader',
	'--use-webgpu-adapter=swiftshader',
	'--ignore-gpu-blocklist',
];

const HARDWARE_ARGS = [
	'--enable-unsafe-webgpu',
	'--enable-features=Vulkan,WebGPU',
	'--use-angle=vulkan',
	'--ignore-gpu-blocklist',
	'--enable-gpu-rasterization',
];

export async function launchBenchBrowser({ adapter = 'swiftshader', headed = false } = {}) {
	if (adapter !== 'swiftshader' && adapter !== 'hardware') {
		throw new Error(`--adapter must be "swiftshader" or "hardware", got "${adapter}"`);
	}
	const args = adapter === 'hardware' ? HARDWARE_ARGS : SWIFTSHADER_ARGS;
	return chromium.launch({ args, headless: !headed });
}

// Reports which WebGPU and WebGL2 adapters Chromium actually picked.
export async function probeAdapters(browser, base) {
	const page = await browser.newPage();
	try {
		await page.goto(base, { waitUntil: 'domcontentloaded' });
		return await page.evaluate(async () => {
			let webgpu = 'unavailable';
			try {
				const a = navigator.gpu && (await navigator.gpu.requestAdapter());
				if (a) {
					const i = a.info || (a.requestAdapterInfo && (await a.requestAdapterInfo())) || {};
					webgpu = [i.vendor, i.architecture, i.description].filter(Boolean).join(' ') || 'unknown';
				}
			} catch (e) {
				webgpu = `error: ${e.message}`;
			}
			let webgl2 = 'unavailable';
			try {
				const gl = document.createElement('canvas').getContext('webgl2');
				if (gl) {
					const ext = gl.getExtension('WEBGL_debug_renderer_info');
					webgl2 = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
				}
			} catch (e) {
				webgl2 = `error: ${e.message}`;
			}
			return { webgpu, webgl2 };
		});
	} finally {
		await page.close();
	}
}
