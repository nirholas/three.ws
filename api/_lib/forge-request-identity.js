// What makes two Forge generation requests the same request.
//
// Two caches decide "have we already made this?": the completed-result cache
// (forge-cache.js, days) and the in-flight coalescing record (forge-scale.js,
// minutes). Both used to keep their own list of the inputs that matter, and the
// lists had drifted from what the endpoint accepts: bbox, pose, derive_pbr, lods,
// view labels, part count, fill-other-sides, the sampler overrides, the aspect
// ratio and the art-director switch all change the delivered model and none of
// them was in either key, so a request that asked for a 2 m tall model could be
// answered with a cached 1 m one. One module now owns the definition, so the
// two keys cannot disagree again.
//
// The rule for every input: if changing it can change the model the caller is
// handed (or who may be handed it), it is in the identity. An input that does
// not apply on some lane is still included: that costs one extra miss and never
// a wrong hit.
//
// Backward compatibility: an input at its default contributes nothing, so a
// request that never sent options keeps the key it always had.

// The normalized form of a prompt, shared by both keys. Folds what a person never
// means as a different object: letter case, leading and trailing whitespace,
// runs of inner whitespace (spaces, tabs, newlines) and the Unicode composition
// form (a typed "e" plus an accent and a precomposed "e acute" are one letter).
// Punctuation, digits and word order are kept: "a cat, red" and "a red cat"
// are different requests.
export function normalizePrompt(prompt) {
	return String(prompt ?? '')
		.normalize('NFC')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

const DEFAULT_ASPECT = '1:1';

function normalizeAspect(value) {
	const v = typeof value === 'string' ? value.trim() : '';
	return /^\d{1,2}:\d{1,2}$/.test(v) ? v : DEFAULT_ASPECT;
}

// Stable JSON: object keys sorted at every depth, so the same sampler overrides
// sent in a different key order are one request.
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/**
 * The result-affecting inputs that the original key did not carry, as a list of
 * [name, value] pairs holding only the ones that differ from their default.
 * Empty for a request that sent none of them.
 *
 * @param {{ options?: object, aspectRatio?: unknown, director?: unknown }} input
 * @returns {Array<[string, unknown]>}
 */
export function extraIdentityInputs({ options, aspectRatio, director } = {}) {
	const opt = options || {};
	const out = [];
	if (opt.derivePbr === false) out.push(['derive_pbr', false]);
	if (opt.lods === true) out.push(['lods', true]);
	if (Array.isArray(opt.bbox)) out.push(['bbox', opt.bbox.map(Number)]);
	if (opt.pose) out.push(['pose', String(opt.pose)]);
	if (Array.isArray(opt.viewLabels)) out.push(['view_labels', opt.viewLabels]);
	if (opt.fillOtherSides === true) out.push(['fill_other_sides', true]);
	if (opt.numParts !== null && opt.numParts !== undefined) out.push(['num_parts', Number(opt.numParts)]);
	if (opt.sampler && typeof opt.sampler === 'object') out.push(['sampler', canonicalJson(opt.sampler)]);
	const aspect = normalizeAspect(aspectRatio);
	if (aspect !== DEFAULT_ASPECT) out.push(['aspect_ratio', aspect]);
	if (director === false) out.push(['director', false]);
	return out;
}

const VISIBILITIES = new Set(['public', 'unlisted', 'private']);

/**
 * Who a result may be shared with, as a key segment. A request that asked for
 * 'public' shares with every public request; any other request is private to its
 * requester, so one account's unlisted or private model is never what another
 * account's identical prompt resolves to. A platform seed job (`internal`) that
 * names no visibility is born public (forge-store.js createCreation), so it keys
 * as public too: that is how the showcase seeder warms the cache for everyone.
 *
 * @param {{ visibility?: unknown, userId?: string|null, clientKey?: string|null, internal?: boolean }} who
 * @returns {string}
 */
export function requestScope({ visibility, userId, clientKey, internal = false } = {}) {
	const v = VISIBILITIES.has(visibility) ? visibility : null;
	if (v === 'public' || (internal === true && v === null)) return 'public';
	if (userId) return `u:${userId}`;
	if (typeof clientKey === 'string' && clientKey && clientKey !== 'anon') return `c:${clientKey}`;
	return 'anon';
}
