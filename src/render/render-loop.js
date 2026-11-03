// A requestAnimationFrame loop with the behaviour every production 3D viewer
// has and most hand-rolled `function animate(){ requestAnimationFrame(animate) }`
// loops do not:
//
//  - stops drawing while the tab is hidden or the canvas is scrolled offscreen,
//    so a page with three canvases is not burning a laptop battery on two of them
//  - adapts the canvas pixel ratio to what the GPU can actually sustain
//    (see frame-governor.js), starting at full quality
//  - survives a lost WebGL context (driver reset, GPU process crash, too many
//    contexts on one page): it pauses, shows the visitor what happened, and
//    resumes on its own when the browser restores the context
//  - hands the frame callback a clamped delta, so a long pause never teleports
//    an animation

import { handleContextLoss } from './context-loss.js';
import { createFrameGovernor } from './frame-governor.js';
import { cappedPixelRatio } from './studio-look.js';

const MAX_DT = 1 / 15;

/**
 * @param {object} opts
 * @param {import('three').WebGLRenderer} opts.renderer
 * @param {(dt: number, now: number) => void} opts.frame called once per drawn frame; dt in seconds
 * @param {Element} [opts.observe] element whose visibility gates the loop (default: the canvas)
 * @param {boolean} [opts.adaptive=true] adapt the pixel ratio to measured frame rate
 * @param {number} [opts.minPixelRatio=0.75]
 * @param {number} [opts.maxPixelRatio=2]
 * @param {(ratio: number) => void} [opts.onPixelRatioChange] resize composers or render targets here
 * @param {() => void} [opts.onContextRestored] rebuild anything the page uploaded by hand
 * @param {boolean} [opts.contextNotice=true] show an overlay while the context is lost
 */
export function createRenderLoop(opts) {
	const {
		renderer,
		frame,
		adaptive = true,
		minPixelRatio = 0.75,
		maxPixelRatio = 2,
		onPixelRatioChange,
		onContextRestored,
		contextNotice = true,
	} = opts;
	const canvas = renderer.domElement;
	const observed = opts.observe ?? canvas;

	const startRatio = cappedPixelRatio(maxPixelRatio);
	const governor = adaptive
		? createFrameGovernor({ min: Math.min(minPixelRatio, startRatio), max: startRatio })
		: null;

	let rafId = null;
	let wanted = false;
	let tabVisible = typeof document === 'undefined' ? true : !document.hidden;
	let onScreen = true;
	let contextLost = false;
	let prev = null;

	const canRun = () => wanted && tabVisible && onScreen && !contextLost;

	function tick(now) {
		rafId = null;
		if (!canRun()) return;
		const dt = prev === null ? 0 : Math.min((now - prev) / 1000, MAX_DT);
		prev = now;
		if (governor) {
			const ratio = governor.tick(now);
			if (ratio !== null) {
				renderer.setPixelRatio(ratio);
				onPixelRatioChange?.(ratio);
			}
		}
		frame(dt, now);
		rafId = requestAnimationFrame(tick);
	}

	function sync() {
		if (canRun()) {
			if (rafId === null) rafId = requestAnimationFrame(tick);
		} else if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
			prev = null;
			governor?.pause();
		}
	}

	const onVisibility = () => {
		tabVisible = !document.hidden;
		if (!tabVisible) {
			prev = null;
			governor?.pause();
		}
		sync();
	};

	const io =
		typeof IntersectionObserver !== 'undefined'
			? new IntersectionObserver((entries) => {
					onScreen = entries[entries.length - 1].isIntersecting;
					if (!onScreen) {
						prev = null;
						governor?.pause();
					}
					sync();
				})
			: null;

	const contextLoss = handleContextLoss(canvas, {
		notice: contextNotice,
		onLost: () => {
			contextLost = true;
			sync();
		},
		onRestored: () => {
			contextLost = false;
			onContextRestored?.();
			sync();
		},
	});

	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
	io?.observe(observed);

	return {
		start() {
			wanted = true;
			sync();
		},
		stop() {
			wanted = false;
			sync();
		},
		get running() {
			return rafId !== null;
		},
		/** Current adaptive pixel ratio (or the fixed cap when adaptive is off). */
		get pixelRatio() {
			return governor ? governor.pixelRatio : startRatio;
		},
		dispose() {
			wanted = false;
			sync();
			contextLoss.detach();
			if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
			io?.disconnect();
		},
	};
}
