// Pure rules for the desktop boot sequence and the lock screen. No DOM, no
// timers: boot.js renders what these functions decide, and the tests pin them.

/** A boot step's lifecycle. */
export const STEP_STATES = ['pending', 'running', 'ok', 'skip', 'fail'];

/**
 * Run every boot step concurrently and report each transition. A step is
 * `{ id, label, task }` where `task()` resolves to a detail string, an object
 * `{ skip: 'reason' }` to report a step that was deliberately not needed, or
 * any other value (kept as `value`; a string `detail` field on it is shown on
 * the line), and rejects on failure. Nothing here is a fake delay: a line
 * turns green the moment its real promise settles.
 *
 * @param {Array<{id:string,label:string,task:() => Promise<any>}>} steps
 * @param {(snapshot: ReturnType<typeof snapshotOf>) => void} onUpdate
 * @param {() => number} [now]
 */
export async function runBootSteps(steps, onUpdate, now = () => Date.now()) {
	const results = steps.map((s) => ({ id: s.id, label: s.label, state: 'running', detail: '', ms: 0, value: undefined }));
	const t0 = now();
	const emit = () => onUpdate?.(snapshotOf(results));
	emit();
	await Promise.all(
		steps.map(async (s, i) => {
			const r = results[i];
			try {
				const v = await s.task();
				r.ms = now() - t0;
				if (v && typeof v === 'object' && 'skip' in v) {
					r.state = 'skip';
					r.detail = String(v.skip);
				} else {
					r.state = 'ok';
					r.detail = typeof v === 'string' ? v : v && typeof v.detail === 'string' ? v.detail : '';
					r.value = v;
				}
			} catch (err) {
				r.ms = now() - t0;
				r.state = 'fail';
				r.detail = (err && err.message) || 'failed';
			}
			emit();
		}),
	);
	return snapshotOf(results);
}

/** Progress (0..1) and counts for a set of step results. */
export function snapshotOf(results) {
	const done = results.filter((r) => r.state !== 'pending' && r.state !== 'running');
	const failed = results.filter((r) => r.state === 'fail');
	return {
		steps: results,
		done: done.length,
		total: results.length,
		progress: results.length ? done.length / results.length : 1,
		failed: failed.map((r) => r.id),
		complete: done.length === results.length,
	};
}

/** Right-aligned timing column for a boot line. */
export function formatMs(ms) {
	if (!Number.isFinite(ms) || ms < 0) return '';
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/** The greeting on the lock screen. `hour` is local 0..23. */
export function greeting(hour, name, returning) {
	const h = Number.isFinite(hour) ? hour : 12;
	const part = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Working late';
	const who = (name || '').trim();
	if (who) return `${part}, ${who}.`;
	return returning ? `${part}. Welcome back.` : `${part}. Welcome to three.ws.`;
}

/**
 * Decide how the visitor enters. `world` means boot, lock, then walk to the
 * computer as an avatar; `desktop` means boot, lock, then the desktop at once.
 * Deep links and explicit view choices always win so a shared `/?app=forge`
 * link never strands someone in a 3D lobby.
 */
export function entryMode({ search = '', hash = '', prefs = {}, webgl = true, deepLink = null, mobile = false } = {}) {
	const q = new URLSearchParams(search || '');
	if (q.get('world') === '1' || hash === '#world') return webgl ? 'world' : 'desktop';
	if (q.get('world') === '0' || q.get('view') === 'desktop' || deepLink) return 'desktop';
	if (!webgl) return 'desktop';
	if (prefs.startIn === 'desktop') return 'desktop';
	// Small screens get the world too (touch joystick), unless they opted out.
	return mobile && prefs.startIn !== 'world' && prefs.startIn !== undefined ? 'desktop' : 'world';
}

/** Whether the boot screen itself should be shown. `?boot=0` skips it (tests, embeds). */
export function showBoot(search = '') {
	return new URLSearchParams(search || '').get('boot') !== '0';
}

/**
 * Lock-screen status line: what the boot found, in one sentence.
 * @param {{failed:string[], steps:Array<{id:string,state:string,detail:string}>}} snap
 */
export function bootSummary(snap, labels = {}) {
	if (!snap) return '';
	if (!snap.failed.length) return 'Every system is up.';
	const names = snap.failed.map((id) => labels[id] || id);
	return names.length === 1 ? `${names[0]} is offline. Everything else is up.` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are offline.`;
}

/**
 * A short GPU name for the Graphics line from WEBGL_debug_renderer_info, e.g.
 * "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)"
 * becomes "NVIDIA GeForce RTX 3080" and "Google, Vulkan 1.3.0 (SwiftShader
 * Device (Subzero))" becomes "SwiftShader Device".
 */
export function gpuName(raw, max = 40) {
	let s = String(raw || '').trim();
	if (!s) return 'WebGL';
	s = s.replace(/^ANGLE\s*\((.*)\)$/s, '$1');
	const parts = s.split(/,\s*/);
	let name = parts.length > 1 ? parts[1] : parts[0];
	if (name.includes(':')) name = name.split(':').pop().trim();
	const sw = name.match(/\((SwiftShader[^()]*)/i);
	if (sw) name = sw[1];
	name = name.replace(/\s+(Direct3D|OpenGL|Vulkan|Metal|D3D)\S*.*$/i, '').replace(/\s*\(.*$/, '').trim();
	if (!name) name = parts[0];
	return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}
