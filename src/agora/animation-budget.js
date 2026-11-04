// Which /agora citizens run their AnimationMixer this frame.
//
// 200 skinned citizens each paying for a mixer update, a bone matrix rebuild and
// a bone texture upload every frame was the whole cost of the fleet stall
// (docs/agora/tasks/12-fleet-render-performance.md). Locomotion stays cheap and
// runs for everyone, so positions stay honest. Only the pose is budgeted:
//
//   full  the citizens whose mixer advances this frame (at most `cap`)
//   low   everyone else gets one catch-up update every LOW_RATE_EVERY frames
//         (the caller passes the accumulated dt), so a citizen who walks back
//         into view carries a pose that never froze for long
//
// Pure: no three.js, no DOM, so the rules unit-test without a renderer.

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const MAX_ANIMATED = coarse ? 16 : 40;
export const LOW_RATE_EVERY = 8;

// A citizen already animated keeps its slot unless a rival is clearly nearer.
// The distance is scaled by this factor for the incumbent, which is the
// hysteresis that stops two similar citizens swapping slots every frame.
const INCUMBENT_BONUS = 0.8;
// Ranking tiers. Lower is better; each tier dwarfs any possible distance.
const TIER_STEP = 1e7;

/**
 * @param {object} p
 * @param {Array<{id:string,x:number,z:number,onScreen:boolean,busy:boolean,walking:boolean}>} p.items
 * @param {{x:number,y:number,z:number}} p.camera
 * @param {number} [p.cap] hard cap on full-rate mixers
 * @param {number} p.frame frame counter, drives the low-rate rotation
 * @param {Set<string>} [p.prev] the previous frame's `full` set (hysteresis)
 * @param {boolean} [p.reducedMotion] reduced motion keeps its no-mixer behaviour
 * @returns {{ full: Set<string>, low: Set<string> }}
 */
export function selectAnimated({ items, camera, cap = MAX_ANIMATED, frame, prev = new Set(), reducedMotion = false }) {
	const full = new Set();
	const low = new Set();
	if (reducedMotion || !items.length) return { full, low };

	const ranked = items.map((it, index) => {
		const dx = it.x - camera.x;
		const dz = it.z - camera.z;
		const dist = Math.hypot(dx, camera.y, dz);
		const tier = (it.onScreen ? 0 : 2) + (it.busy || it.walking ? 0 : 1);
		const score = tier * TIER_STEP + dist * (prev.has(it.id) ? INCUMBENT_BONUS : 1);
		return { id: it.id, index, score };
	});
	ranked.sort((a, b) => a.score - b.score || a.index - b.index);

	for (let i = 0; i < ranked.length; i++) {
		const r = ranked[i];
		if (i < cap) full.add(r.id);
		else if ((frame + r.index) % LOW_RATE_EVERY === 0) low.add(r.id);
	}
	return { full, low };
}
