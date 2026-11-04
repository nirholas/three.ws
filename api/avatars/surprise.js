// GET/POST /api/avatars/surprise: compose a unique, rigged avatar in one call.
//
// The fastest path on the site from "landing" to "I made something": zero input,
// no sign-in, no wait screen. It composes a fresh avatar with the modular Avatar
// Composer (api/_lib/avatar-composer) and returns the GLB bytes directly. The
// browser previews it from a Blob URL and only persists on claim (the guest
// flow: guest-avatar.stage → /create-review), so this endpoint touches no DB and
// no storage: it is stateless and cache-friendly.
//
// Determinism is the trick that makes it both fun and cheap: the composer is a
// pure function of the seed, so `?seed=<x>` always returns the same avatar. A
// reroll just asks for a new random seed; a shared `?seed=` link resolves to the
// exact same character and is CDN-cacheable.
//
// Query / body params (all optional):
//   seed    reproducible seed (any string). Omitted → a fresh random one.
//   gender  'male' | 'female' bias for the identity body. Omitted → from the seed.
//   base    'parametric' (default) | 'rpm'. Parametric draws a seeded appearance
//           record (morphs, proportions, skin, garments, accessories) for the
//           Parametric base and bakes it; 'rpm' is the legacy part-mixing lane
//           across the Ready-Player-Me bases.
//   format  'glb' (default) | 'json'. json skips the bake and returns the
//           appearance record only (parametric base), which is cheap and lets a
//           client or test inspect exactly what a seed means.
//
// Response: `model/gltf-binary` bytes, with an `x-avatar-meta` header carrying
// `{ seed, name, base, descriptor, appearance? }` (exposed via CORS). The
// appearance record is present for the parametric base and is the same shape
// the avatar editor saves.

import { cors, method, error, rateLimited, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { fetchModel } from '../_lib/fetch-model.js';
import { env } from '../_lib/env.js';
import { pickDiversityProfile } from '../_lib/avaturn-seed.js';
import { composeStudioAvatar, composeParametricAvatar } from '../_lib/avatar-composer/index.js';
import { loadServerCatalog } from '../_lib/bake-garments.js';
import { randomUUID } from 'node:crypto';

export const maxDuration = 30;

// Base bodies are served from the site origin (/avatars/<id>.glb); the composer
// only ever needs 1-3 of them per avatar.
const ORIGIN = () => env.APP_ORIGIN || 'https://three.ws';

// Warm-container cache of base-body bytes: the same handful of bases back every
// composition, so fetch each at most once per instance instead of per request.
const _baseCache = new Map();
async function defaultLoadBase(id) {
	if (_baseCache.has(id)) return _baseCache.get(id);
	const { bytes } = await fetchModel(`${ORIGIN()}/avatars/${id}.glb`, { maxBytes: 40 * 1024 * 1024 });
	const u8 = new Uint8Array(bytes);
	_baseCache.set(id, u8);
	return u8;
}

// A memorable two-word name (deterministic on the seed, so a shared link and its
// avatar always carry the same name). Deliberately generic and friendly: never a
// real person, never a coin.
const NAME_ADJ = [
	'Neon', 'Velvet', 'Cobalt', 'Amber', 'Lunar', 'Crimson', 'Jade', 'Onyx',
	'Solar', 'Frost', 'Coral', 'Ivory', 'Dusk', 'Ember', 'Halo', 'Nova',
	'Quartz', 'Sable', 'Aurora', 'Cosmic', 'Electric', 'Golden', 'Midnight', 'Wild',
];
const NAME_NOUN = [
	'Fox', 'Comet', 'Rider', 'Sage', 'Drifter', 'Falcon', 'Echo', 'Voyager',
	'Maven', 'Phoenix', 'Wanderer', 'Oracle', 'Nomad', 'Pilot', 'Ranger', 'Spark',
	'Cipher', 'Vertex', 'Muse', 'Atlas', 'Rogue', 'Beacon', 'Sonata', 'Pioneer',
];
function nameFromSeed(seed) {
	let h = 0;
	const s = String(seed);
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return `${NAME_ADJ[h % NAME_ADJ.length]} ${NAME_NOUN[(h >>> 8) % NAME_NOUN.length]}`;
}

/**
 * Compose one surprise avatar. Pure aside from `loadBase` / `loadCatalog`, so
 * tests can inject a disk loader and callers get the deployed loaders by default.
 *
 * @param {{ seed?: string, gender?: 'male'|'female', base?: 'parametric'|'rpm', bake?: boolean }} [opts]
 * @param {{ loadBase?: (id: string) => Promise<Uint8Array>, loadCatalog?: () => Promise<object[]> }} [deps]
 * @returns {Promise<{ bytes: Uint8Array|null, seed: string, name: string, base: string, descriptor: object, appearance?: object }>}
 */
export async function composeSurprise({ seed, gender, base = 'parametric', bake = true } = {}, deps = {}) {
	const loadBase = deps.loadBase || defaultLoadBase;
	const s = seed && String(seed).trim() ? String(seed).trim().slice(0, 100) : randomUUID();
	const profile = pickDiversityProfile(s);
	if (gender === 'male' || gender === 'female') profile.gender = gender;
	if (base === 'rpm') {
		const { bytes, descriptor } = await composeStudioAvatar({ profile, seed: s, loadBase });
		return { bytes, seed: s, name: nameFromSeed(s), base: 'rpm', descriptor };
	}
	const { bytes, appearance, descriptor } = await composeParametricAvatar({
		profile,
		seed: s,
		loadBase,
		loadCatalog: deps.loadCatalog || loadServerCatalog,
		bake,
	});
	return { bytes, seed: s, name: nameFromSeed(s), base: appearance.base, descriptor, appearance };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.surpriseIp(ip);
	if (!rl.success) return rateLimited(res, rl, 'slow down a moment: too many avatars at once');

	const url = new URL(req.url, 'http://x');
	const seed = url.searchParams.get('seed') || undefined;
	const genderParam = url.searchParams.get('gender');
	const gender = genderParam === 'male' || genderParam === 'female' ? genderParam : undefined;

	const base = url.searchParams.get('base') === 'rpm' ? 'rpm' : 'parametric';
	const json = url.searchParams.get('format') === 'json';
	if (json && base === 'rpm') {
		return error(res, 400, 'invalid_request', 'format=json is only available for the parametric base');
	}

	let result;
	try {
		result = await composeSurprise({ seed, gender, base, bake: !json });
	} catch (err) {
		return error(res, 502, 'compose_failed', `could not compose an avatar: ${err?.message || err}`);
	}

	const meta = { seed: result.seed, name: result.name, base: result.base, descriptor: result.descriptor, appearance: result.appearance };
	if (json) {
		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');
		res.setHeader('cache-control', 'public, max-age=31536000, immutable');
		res.end(JSON.stringify(meta));
		return;
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'model/gltf-binary');
	res.setHeader('content-disposition', `inline; filename="${result.name.replace(/\s+/g, '-').toLowerCase()}.glb"`);
	// Deterministic on the seed → safe to cache hard. A reroll uses a new seed.
	res.setHeader('cache-control', 'public, max-age=31536000, immutable');
	res.setHeader('x-avatar-meta', JSON.stringify(meta));
	res.setHeader('access-control-expose-headers', 'x-avatar-meta');
	res.end(Buffer.from(result.bytes));
});
