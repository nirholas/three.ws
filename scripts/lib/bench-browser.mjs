// Shared Chromium launcher for the renderer benches.
// `swiftshader` (default) forces the software adapter so runs are reproducible on
// any machine. `hardware` drives the machine's real GPU through Vulkan.
//
// Hardware on a headless Linux NVIDIA host (verified on a GCE g2-standard-8 with
// an L4, driver 580 server): the deeplearning images ship the compute-only driver,
// so install `libnvidia-gl-<driver>-server` and GLVND `libegl1` first, then check
// that `vulkaninfo --summary` lists the GPU. Without --use-vulkan=native and
// --disable-vulkan-surface headless Chromium silently hands WebGPU the SwiftShader
// adapter, and the bundled headless shell lacks the Vulkan path, so the full
// `chromium` channel is required.

import { chromium } from 'playwright';

const ADAPTER_ARGS = {
	swiftshader: [
		'--enable-unsafe-webgpu',
		'--enable-features=Vulkan,WebGPU',
		'--use-angle=swiftshader',
		'--use-webgpu-adapter=swiftshader',
		'--ignore-gpu-blocklist',
	],
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
	const args = ADAPTER_ARGS[adapter];
	if (!args) {
		throw new Error(`--adapter must be "swiftshader" or "hardware", got "${adapter}"`);
	}
	return chromium.launch({
		args,
		headless: !headed,
		...(adapter === 'hardware' ? { channel: 'chromium' } : {}),
	});
}

// Reports which WebGPU and WebGL2 adapters Chromium actually picked. The probe
// runs on a page served by Playwright itself under the bench origin (WebGPU needs
// a secure context, and the bench server need not answer `/`). The first adapter
// request after launch can come back null while the GPU process starts, so it
// retries a few times before reporting the adapter as unavailable.
export async function probeAdapters(browser, base) {
	const page = await browser.newPage();
	const probeUrl = `${base.replace(/\/+$/, '')}/__adapter-probe`;
	try {
		await page.route(probeUrl, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
		await page.goto(probeUrl, { waitUntil: 'domcontentloaded' });
		return await page.evaluate(async () => {
			let webgpu = 'unavailable';
			try {
				let a = null;
				for (let attempt = 0; attempt < 4 && navigator.gpu && !a; attempt++) {
					if (attempt) await new Promise((r) => setTimeout(r, 500));
					a = await navigator.gpu.requestAdapter();
				}
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
