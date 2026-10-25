// Caller-supplied tuning for POST /api/avatars/reconstruct. The body accepts a
// free-form `params` record, but the GPU workers read keys such as tier, path,
// steps and file locations from the job params, and those are the platform's to
// set (provider.params), never the caller's. Only the keys below survive, each
// coerced to a clamped number; everything else is dropped.

const ALLOWED = Object.freeze({
	target_polycount: { min: 1_000, max: 500_000 },
	seed: { min: 0, max: 2_147_483_647 },
});

/**
 * @param {unknown} raw  the request's `params` value
 * @returns {Record<string, number>}
 */
export function pickReconstructParams(raw) {
	const out = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [key, { min, max }] of Object.entries(ALLOWED)) {
		if (!Object.hasOwn(raw, key)) continue;
		const n = Number(raw[key]);
		if (!Number.isFinite(n)) continue;
		out[key] = Math.min(max, Math.max(min, Math.round(n)));
	}
	return out;
}
