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
	let notice = null;

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

	function showNotice() {
		if (!contextNotice || notice || !canvas.parentElement) return;
		notice = document.createElement('div');
		notice.setAttribute('role', 'status');
		notice.textContent = 'The graphics driver reset. The 3D view will come back on its own in a moment.';
		Object.assign(notice.style, {
			position: 'absolute',
			left: '50%',
			top: '50%',
			transform: 'translate(-50%, -50%)',
			maxWidth: '22rem',
			padding: '0.75rem 1rem',
			borderRadius: '10px',
			background: 'rgba(12, 12, 14, 0.86)',
			color: '#f2f2f2',
			font: '500 13px/1.45 system-ui, sans-serif',
			textAlign: 'center',
			zIndex: '5',
			pointerEvents: 'none',
		});
		const host = canvas.parentElement;
		if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
		host.appendChild(notice);
	}

	function hideNotice() {
		notice?.remove();
		notice = null;
	}

	const onLost = (e) => {
		// preventDefault is what tells the browser we can restore; without it
		// the context is gone for good.
		e.preventDefault();
		contextLost = true;
		showNotice();
		sync();
	};
	const onRestored = () => {
		contextLost = false;
		hideNotice();
		onContextRestored?.();
		sync();
	};

	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
	io?.observe(observed);
	canvas.addEventListener('webglcontextlost', onLost);
	canvas.addEventListener('webglcontextrestored', onRestored);

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
			hideNotice();
			if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
			io?.disconnect();
			canvas.removeEventListener('webglcontextlost', onLost);
			canvas.removeEventListener('webglcontextrestored', onRestored);
		},
	};
}
