// GET /api/animations/library — the full Mixamo-sourced motion library.
//
// The bulk library (2,800+ clips baked by scripts/mixamo-all.mjs, growing as the
// generative text→motion seeding lands) is far too large for the deploy bundle
// (~3 GB of clip JSON), so the baked clips live on the R2 CDN and this endpoint
// proxies the library manifest object with an edge cache. Each manifest entry
// carries an absolute CDN `url` the browser fetches directly (R2 CORS allows GET
// from web origins — scripts/set-r2-cors.mjs).
//
// Returns { clips: [], total: 0 } until the library has been uploaded, so
// consumers (the /animations gallery, embed viewer, pose studio deep-links)
// feature-detect by emptiness rather than special-casing errors.
//
// Pagination (opt-in, backward compatible): the manifest is a stable ordered
// array, so a caller can page it with ?limit= (1..1000) and ?offset= to keep any
// single response bounded as the catalog grows past thousands of clips. With no
// ?limit the full array is returned exactly as before, so existing consumers
// (the older gallery build) are unchanged. Paged responses add `offset` +
// `next_offset` (null on the last page); `total` is always the full catalog size
// regardless of paging.
//
// Facets: ?facets=1 returns the catalog's size and its per-category counts and
// no clips at all. The /animations gallery needs exact totals for its hero line
// and its filter chips, and deriving them client-side means holding the whole
// catalog in the browser, which is the reason the gallery downloaded every page
// on load. The classifier that produces a category is shared with the gallery
// (src/animation-categories.js), so a count here and a chip there can never
// disagree.
//
// Name lookup: ?name=<clip> (repeatable, or comma-separated) returns only the
// entries with those exact names. Paging cannot serve that caller, because a
// deep-link resolves ONE clip by name and has no idea which page holds it, so
// its only alternative is the whole manifest. That is what the pose deep-link
// (src/animation-library.js) and the embed viewer (src/avatar-embed.js) used to
// do, and at 1.1 MB per lookup for a single 3 KB entry it is the response that
// grows worst as the catalog does. Names are capped at MAX_NAMES per request so
// the lookup stays bounded too; unknown names are simply absent from `clips`.
//
// TWO MANIFESTS, ONE CATALOG. The Mixamo bake and the generative text-to-motion
// seeder each own their own manifest object and never write the other's:
//
//   animations/library/manifest.json            scripts/mixamo-all.mjs
//   animations/library/generated/manifest.json  scripts/gcp/seed-motion.mjs
//
// They are kept apart because each publisher REBUILDS its manifest from the set
// it staged. Sharing one object would mean whichever ran last silently deleted
// the other's clips from the library, and the deletion would look exactly like a
// successful publish. Reading both here costs one extra cached object fetch and
// makes that class of accident impossible.
//
// Order is curated-then-generated and never interleaved, so every offset a
// caller already holds keeps pointing at the same clip when the generated set
// grows.

import { cors, json, method, wrap } from '../_lib/http.js';
import { getPublicObjectBuffer } from '../_lib/r2.js';
import { GALLERY_CATEGORIES, galleryCategoryOf } from '../../src/animation-categories.js';

const MANIFEST_KEY = 'animations/library/manifest.json';
const GENERATED_MANIFEST_KEY = 'animations/library/generated/manifest.json';
const MAX_PAGE = 1000;
// Ceiling on ?name= entries per request. A deep-link resolves one clip and an
// avatar with a full animation set resolves a handful, so this is generous for
// every real caller while keeping the response bounded.
const MAX_NAMES = 50;

/**
 * Parse ?name= into a deduped, bounded list of exact clip names. Accepts the
 * param repeated (?name=a&name=b) and comma-separated (?name=a,b), because both
 * spellings are natural to write and neither is ambiguous: a clip name never
 * contains a comma.
 *
 * @param {URLSearchParams} params
 * @returns {string[]}
 */
function parseNames(params) {
	const seen = new Set();
	for (const raw of params.getAll('name')) {
		for (const part of String(raw).split(',')) {
			const name = part.trim();
			if (name) seen.add(name);
			if (seen.size >= MAX_NAMES) return [...seen];
		}
	}
	return [...seen];
}

/**
 * Read one manifest object. A missing object is the expected state for the
 * generated catalog before its first publish (and for the whole library before
 * launch), so it degrades to an empty list; anything else is logged and also
 * degrades, because a partial library beats a 5xx on a browse page.
 *
 * @param {string} key
 * @returns {Promise<{ clips: any[], generatedAt: string | null }>}
 */
async function readManifest(key) {
	try {
		const buf = await getPublicObjectBuffer(key);
		const parsed = JSON.parse(buf.toString('utf8'));
		const clips = Array.isArray(parsed)
			? parsed
			: Array.isArray(parsed.clips)
				? parsed.clips
				: [];
		return { clips, generatedAt: parsed.generated_at || null };
	} catch (err) {
		const code = err?.$metadata?.httpStatusCode;
		if (err?.name !== 'NoSuchKey' && code !== 404) {
			console.error('[animations/library]', key, err?.message || err);
		}
		return { clips: [], generatedAt: null };
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const [curated, generated] = await Promise.all([
		readManifest(MANIFEST_KEY),
		readManifest(GENERATED_MANIFEST_KEY),
	]);
	// A name collision would give the pose deep-link two clips to resolve, so
	// the curated catalog wins and the duplicate is dropped rather than served
	// twice. The seeder namespaces its clips `gen-`, so this never fires in
	// practice; it exists so a hand-published clip cannot shadow a preset.
	const curatedNames = new Set(curated.clips.map((c) => c?.name));
	const clips = curated.clips.concat(
		generated.clips.filter((c) => c?.name && !curatedNames.has(c.name)),
	);
	const generatedAt = curated.generatedAt;

	const total = clips.length;
	res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');

	const url = new URL(req.url, 'http://x');

	if (url.searchParams.get('facets') === '1') {
		const counts = new Map(GALLERY_CATEGORIES.map((c) => [c.key, 0]));
		for (const clip of clips) {
			const key = galleryCategoryOf(clip?.name || '', clip?.label || '');
			counts.set(key, (counts.get(key) || 0) + 1);
		}
		return json(res, 200, {
			total,
			categories: [...counts].map(([key, count]) => ({ key, count })),
			generated_at: generatedAt,
		});
	}

	const names = parseNames(url.searchParams);
	if (names.length) {
		const wanted = new Set(names);
		const matched = clips.filter((c) => c?.name && wanted.has(c.name));
		return json(res, 200, { clips: matched, total, generated_at: generatedAt });
	}

	const rawLimit = url.searchParams.get('limit');
	if (rawLimit == null) {
		// Legacy full-catalog response — unchanged contract.
		return json(res, 200, { clips, total, generated_at: generatedAt });
	}

	const limit = Math.min(Math.max(Number(rawLimit) || 0, 1), MAX_PAGE);
	const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
	const page = clips.slice(offset, offset + limit);
	const nextOffset = offset + limit < total ? offset + limit : null;
	return json(res, 200, {
		clips: page,
		total,
		offset,
		next_offset: nextOffset,
		generated_at: generatedAt,
	});
});
