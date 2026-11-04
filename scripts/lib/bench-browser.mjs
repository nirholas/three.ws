// Browser launch shared by the renderer benches (scripts/renderer-bench.mjs,
// scripts/viewer-renderer-bench.mjs). Two adapters:
//
//   swiftshader  software WebGL2 + WebGPU; runs anywhere, compares code paths
//   hardware     the machine's GPU through Vulkan; gives hardware numbers
//
// Linux hardware runs need the vendor Vulkan driver plus GLVND libEGL
// (`vulkaninfo --summary` must list the GPU). On a Google Cloud GPU VM from the
// deeplearning-platform-release images that means installing the
// `libnvidia-gl-<driver>-server` package and `libegl1`; the compute-only driver
// those images ship has no Vulkan ICD.

import { chromium } from 'playwright';

export const ADAPTERS = ['swiftshader', 'hardware'];

const ARGS = {
	swiftshader: [
		'--enable-unsafe-webgpu',
		'--enable-features=Vulkan,WebGPU',
		'--use-angle=swiftshader',
		'--use-webgpu-adapter=swiftshader',
		'--ignore-gpu-blocklist',
	],
	// Headless has no window surface; without --disable-vulkan-surface the GPU
	// process cannot create its Vulkan instance and WebGPU silently falls back
	// to the SwiftShader adapter.
	hardware: [
		'--enable-unsafe-webgpu',
		'--enable-features=Vulkan',
		'--use-angle=vulkan',
		'--use-vulkan=native',
		'--disable-vulkan-surface',
		'--ignore-gpu-blocklist',
	],
};

export async function launchBenchBrowser({ adapter = 'swiftshader', headed = false } = {}) {
	if (!ADAPTERS.includes(adapter)) throw new Error(`--adapter must be one of ${ADAPTERS.join(', ')}, got ${adapter}`);
	// The full Chromium build (not the headless shell) on hardware, so GPU
	// access matches a desktop browser.
	return chromium.launch({
		args: ARGS[adapter],
		headless: !headed,
		...(adapter === 'hardware' ? { channel: 'chromium' } : {}),
	});
}

// Names the adapters Chromium actually picked, so a hardware run that quietly
// landed on a software device is visible in the output.
export async function probeAdapters(browser, base) {
	const page = await browser.newPage();
	// WebGPU needs a secure origin, not about:blank. Answer a blank page on the
	// bench origin from here so the probe does not depend on what the server has.
	await page.route(`${base}/__adapter-probe`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
	await page.goto(`${base}/__adapter-probe`, { waitUntil: 'domcontentloaded' });
	const info = await page.evaluate(async () => {
		// A freshly launched headless browser can answer the first request with
		// null while its GPU process starts; ask a few times before calling it none.
		let gpu = null;
		for (let i = 0; i < 4 && navigator.gpu && !gpu; i++) {
			gpu = await navigator.gpu.requestAdapter().catch(() => null);
			if (!gpu) await new Promise((r) => setTimeout(r, 500));
		}
		const gl = document.createElement('canvas').getContext('webgl2');
		const ext = gl?.getExtension('WEBGL_debug_renderer_info');
		return {
			webgpu: gpu ? [gpu.info?.vendor, gpu.info?.architecture, gpu.info?.description].filter(Boolean).join(' ') || 'available' : 'none',
			webgl2: gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'none',
		};
	});
	await page.close();
	return info;
}
