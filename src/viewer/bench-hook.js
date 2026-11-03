// scripts/viewer-renderer-bench.mjs hook, installed only when the page URL has
// `?bench`. It reads the live Viewer on whichever backend it got (WebGL2 or
// WebGPU) and measures it the same way on both:
//
//   capture(w, h)          scene pass rendered into a render target, read back
//                          as top-down RGBA (materials, lights, environment)
//   renderMs(w, h, n)      mean ms per scene pass into that target
//   postMs(n)              mean ms per full frame through the cinematic chain
//                          (EffectComposer on WebGL, TSL RenderPipeline on WebGPU)
//
// Everything is drained with a pixel readback before the clock stops, so the
// numbers include GPU time, not just command submission. Headless software
// WebGPU cannot present to a canvas, which is why parity reads a target.

import { WebGLRenderTarget } from 'three';

export function exposeViewerBench(viewer) {
	const gpu = () => viewer.backend === 'webgpu';
	const makeTarget = async (w, h) => {
		if (!gpu()) return new WebGLRenderTarget(w, h);
		return new (await import('three/webgpu')).RenderTarget(w, h);
	};
	const readback = async (rt, w, h) => {
		const renderer = viewer.renderer;
		if (gpu()) {
			const raw = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
			const stride = Math.ceil((w * 4) / 256) * 256;
			const out = new Uint8Array(w * h * 4);
			for (let y = 0; y < h; y++) out.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
			return out;
		}
		const raw = new Uint8Array(w * h * 4);
		renderer.readRenderTargetPixels(rt, 0, 0, w, h, raw);
		const out = new Uint8Array(w * h * 4);
		for (let y = 0; y < h; y++) out.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
		return out;
	};
	const scenePass = async (rt, frames) => {
		const renderer = viewer.renderer;
		const camera = viewer.activeCamera;
		const prev = renderer.getRenderTarget();
		const aspect = camera.aspect;
		camera.aspect = rt.width / rt.height;
		camera.updateProjectionMatrix();
		renderer.setRenderTarget(rt);
		for (let i = 0; i < frames; i++) renderer.render(viewer.scene, camera);
		renderer.setRenderTarget(prev);
		camera.aspect = aspect;
		camera.updateProjectionMatrix();
	};
	const drain = async () => {
		const rt = await makeTarget(1, 1);
		await scenePass(rt, 1);
		await readback(rt, 1, 1);
		rt.dispose();
	};

	window.__viewerBench = {
		get backend() {
			return viewer.backend;
		},
		get loaded() {
			return !!viewer.content;
		},
		async capture(w, h) {
			const rt = await makeTarget(w, h);
			await scenePass(rt, 1);
			const px = Array.from(await readback(rt, w, h));
			rt.dispose();
			return px;
		},
		async renderMs(w, h, frames) {
			const rt = await makeTarget(w, h);
			await scenePass(rt, 1); // warm-up: pipelines and shader compile
			await readback(rt, w, h);
			const t0 = performance.now();
			await scenePass(rt, frames);
			await readback(rt, w, h);
			const ms = (performance.now() - t0) / frames;
			rt.dispose();
			return ms;
		},
		async postMs(frames) {
			viewer._cinematic.render(0); // warm-up: builds and compiles the chain
			await drain();
			const t0 = performance.now();
			for (let i = 0; i < frames; i++) viewer._cinematic.render(0);
			await drain();
			return (performance.now() - t0) / frames;
		},
	};
}
