// The models /dissolve ships on its shelf. Every url is a real GLB served from
// /public, and tests/dissolve-shelf.test.js keeps it that way.

export const SHELF = [
	{ id: 'agent', label: 'Agent', url: '/avatars/default.glb' },
	{ id: 'xbot', label: 'X Bot', url: '/avatars/xbot.glb' },
	{ id: 'mannequin', label: 'Mannequin', url: '/avatars/mannequin.glb' },
	{ id: 'michelle', label: 'Michelle', url: '/avatars/michelle.glb' },
	{ id: 'realistic-female', label: 'Realistic F', url: '/avatars/realistic-female.glb' },
	{ id: 'realistic-male', label: 'Realistic M', url: '/avatars/realistic-male.glb' },
	{ id: 'cesium-man', label: 'Cesium Man', url: '/avatars/cesium-man.glb' },
	{ id: 'fox', label: 'Fox', url: '/avatars/fox.glb' },
	{ id: 'brainstem', label: 'Brainstem', url: '/avatars/brainstem.glb' },
	{ id: 'studio', label: 'Studio', url: '/avatars/studio.glb' },
];

export const PRESETS = {
	storm: { label: 'Storm', spring: 16, damp: 5.2, turb: 0.35, arc: 0.6, stagger: 0.7, size: 1, bright: 0.55, bloom: 0.9 },
	ember: { label: 'Ember', spring: 4, damp: 2.4, turb: 1.1, arc: 0.9, stagger: 0.9, size: 1.2, bright: 0.5, bloom: 1.2 },
	crystal: { label: 'Crystal', spring: 34, damp: 9, turb: 0.04, arc: 0.15, stagger: 0.35, size: 0.7, bright: 0.7, bloom: 0.6 },
	ink: { label: 'Ink', spring: 2.2, damp: 3.2, turb: 0.7, arc: 1.2, stagger: 1, size: 1.7, bright: 0.35, bloom: 1 },
};

export const QUALITY = {
	lite: { label: 'Lite', side: 256 },
	standard: { label: 'Standard', side: 512 },
	ultra: { label: 'Ultra', side: 1024 },
};

/** Resolve a `?a=` / `?b=` value to a shelf entry, or null. */
export function shelfEntry(id) {
	return SHELF.find((s) => s.id === id) || null;
}

/** Only https (or same-origin) GLB links are loadable; everything else is refused up front. */
export function parseModelUrl(raw, origin = 'https://three.ws') {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
	// Absolute https or a root-relative path. A bare word would otherwise
	// resolve against our own origin and look valid.
	if (!/^(https:\/\/|\/(?!\/))/.test(raw)) return null;
	let url;
	try {
		url = new URL(raw, origin);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.origin !== origin) return null;
	return url.href;
}

/** Share-link state, validated: unknown values fall back instead of throwing. */
export function readState(search) {
	const q = new URLSearchParams(search);
	const pick = (key, allowed, fallback) => (allowed.includes(q.get(key)) ? q.get(key) : fallback);
	const model = (key, fallback) => {
		const v = q.get(key);
		if (!v) return fallback;
		if (shelfEntry(v)) return v;
		return parseModelUrl(v) ? v : fallback;
	};
	return {
		a: model('a', 'agent'),
		b: model('b', 'fox'),
		preset: pick('p', Object.keys(PRESETS), 'storm'),
		quality: pick('q', Object.keys(QUALITY), null),
	};
}

export function writeState({ a, b, preset, quality }, base = '') {
	const q = new URLSearchParams();
	q.set('a', a);
	q.set('b', b);
	q.set('p', preset);
	if (quality) q.set('q', quality);
	return `${base}?${q.toString()}`;
}
