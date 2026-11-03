// Adaptive render resolution for any three.js page.
//
// The same idea as drei's PerformanceMonitor + AdaptiveDpr and model-viewer's
// automatic scale, without a framework: watch real frame times, and when the
// page cannot hold its frame rate, drop the canvas pixel ratio one step; when
// it has clear headroom, raise it back. Quality starts at the device maximum
// and only comes down when the hardware proves it must.
//
// Pure and DOM-free so it is unit-tested directly. The render loop feeds it a
// timestamp per frame and applies whatever pixel ratio it returns.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {object} [opts]
 * @param {number} [opts.min=0.75]      lowest pixel ratio it may choose
 * @param {number} [opts.max=2]         highest pixel ratio it may choose
 * @param {number} [opts.initial]       starting ratio (defaults to max)
 * @param {number} [opts.step=0.25]     change per decision
 * @param {number} [opts.lowFps=45]     average below this steps quality down
 * @param {number} [opts.highFps=57]    average at or above this steps quality up
 * @param {number} [opts.samples=40]    frames averaged per decision
 * @param {number} [opts.cooldownMs=1500] minimum time between decisions
 * @param {number} [opts.maxFlips=4]    direction reversals before it settles for good
 * @param {number} [opts.maxDeltaMs=250] longer gaps (tab switch, GC, hitch) are ignored
 */
export function createFrameGovernor(opts = {}) {
	const min = opts.min ?? 0.75;
	const max = Math.max(min, opts.max ?? 2);
	const step = opts.step ?? 0.25;
	const lowFps = opts.lowFps ?? 45;
	const highFps = opts.highFps ?? 57;
	const window = opts.samples ?? 40;
	const cooldownMs = opts.cooldownMs ?? 1500;
	const maxFlips = opts.maxFlips ?? 4;
	const maxDeltaMs = opts.maxDeltaMs ?? 250;

	let dpr = clamp(opts.initial ?? max, min, max);
	let last = null;
	let sum = 0;
	let count = 0;
	let lastChangeAt = -Infinity;
	let lastDir = 0;
	let flips = 0;
	let settled = false;

	function clearWindow() {
		sum = 0;
		count = 0;
	}

	return {
		get pixelRatio() {
			return dpr;
		},
		/** True once it has oscillated maxFlips times and stopped adjusting. */
		get settled() {
			return settled;
		},
		/** Average fps over the current (partial) window, or null before any sample. */
		get fps() {
			return count ? 1000 / (sum / count) : null;
		},

		/**
		 * Record a frame. Returns the new pixel ratio when it changed, else null.
		 * @param {number} nowMs a monotonic timestamp (rAF time or performance.now())
		 */
		tick(nowMs) {
			if (settled) return null;
			if (last === null) {
				last = nowMs;
				return null;
			}
			const delta = nowMs - last;
			last = nowMs;
			if (!(delta > 0) || delta > maxDeltaMs) return null;
			sum += delta;
			count += 1;
			if (count < window) return null;

			const fps = 1000 / (sum / count);
			clearWindow();
			if (nowMs - lastChangeAt < cooldownMs) return null;

			const dir = fps < lowFps ? -1 : fps >= highFps ? 1 : 0;
			if (dir === 0) return null;
			const next = clamp(dpr + dir * step, min, max);
			if (next === dpr) return null;

			if (lastDir !== 0 && dir !== lastDir) flips += 1;
			lastDir = dir;
			if (flips >= maxFlips) {
				// It keeps bouncing between two ratios. Settle on the lower one so
				// the frame rate stays stable instead of oscillating forever.
				settled = true;
				const floor = Math.min(dpr, next);
				if (floor === dpr) return null;
				dpr = floor;
				return dpr;
			}
			dpr = next;
			lastChangeAt = nowMs;
			return dpr;
		},

		/** Forget the last timestamp, so the gap after a pause is not a sample. */
		pause() {
			last = null;
			clearWindow();
		},
	};
}
