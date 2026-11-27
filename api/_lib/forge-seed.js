// One seed contract for every Forge entry point, and the per-engine ranges a
// seed is folded into on its way out.
//
// The API accepts a seed as an unsigned 32-bit integer: a JSON number or a
// string of decimal digits, from 0 to 4294967295. That is the widest range
// every engine Forge can reach will take after folding, and it is the range the
// Forge page mints from (crypto.getRandomValues on a Uint32Array). Anything else
// that is present is rejected with a message that names the range, never
// clamped: clamping mapped every seed above the max onto 4294967295, so two
// different seeds silently produced the same model and the same cache entry.
//
// The canonical seed is what the response echoes, what the cache key holds and
// what the page shows. An engine with a narrower range receives a fixed fold of
// it (seed mod (max + 1)), so replaying a seed always reproduces the same
// provider value. Two canonical seeds can fold to the same provider value; that
// never merges their cache entries, because the cache keys on the canonical seed.
//
// Accepted range per consumer, from the provider's schema or its validation
// error (re-check when a provider changes):
//   - Pollinations (keyless image rung): 0..2147483647. Answers 400 above it
//     (live validation error, 2026-11-26). Folded in api/_mcp3d/text-to-image.js.
//   - Hugging Face Space tencent/Hunyuan3D-2 (and 2.1): seed slider 0..1e7
//     (gradio_app.py MAX_SEED = 1e7), and randomize_seed defaults on. Folded,
//     with randomize_seed off, in api/_providers/huggingface.js.
//   - NVIDIA NIM microsoft/trellis (trellis_nvcf): 0..4294967295
//     (minimum 0, exclusiveMaximum 4294967296), but 0 means "random seed".
//     api/_providers/nvidia.js sends 4294967295 for a canonical 0.
//   - fal-ai/flux/schnell and wavespeed flux-schnell via the HF router: integer,
//     no max documented (wavespeed treats -1 as random). Sent as is.
//   - The AI Runner image gateway (api/_providers/livepeer.js) and Replicate
//     flux-schnell: integer, no max documented; both seed a torch.Generator,
//     which takes up to 2^64 - 1.
//   - NVIDIA FLUX.1-dev NIM, Vertex Imagen, Vertex Gemini image: no seed input,
//     nothing is sent.
//   - Self-hosted GPU workers (api/_providers/gcp.js): TRELLIS, TRELLIS.2,
//     Pixal3D, AniGen, PartCrafter, HoloPart and Hunyuan3D call
//     torch.manual_seed / accelerate set_seed (numpy needs < 2^32), and Modly
//     validates 0..2^32-1 (workers/modly/request_policy.py). The canonical seed
//     is sent as is. TripoSG (sketch) has no seed input.

export const SEED_MIN = 0;
export const SEED_MAX = 4_294_967_295;
export const SEED_RANGE_MESSAGE = `seed must be a whole number from ${SEED_MIN} to ${SEED_MAX}.`;

// Narrower engine ranges (inclusive max). See the table above.
export const POLLINATIONS_SEED_MAX = 2_147_483_647;
export const HUNYUAN_SPACE_SEED_MAX = 10_000_000;

const DIGITS = /^\d+$/;

/**
 * Parse a caller-supplied seed.
 *
 * Absent (undefined, null or an empty/blank string) is not an error and returns
 * `{ seed: null }`. A present value is either a canonical uint32 seed or an
 * `error` string that names the accepted range.
 *
 * @param {unknown} raw
 * @returns {{ seed: number | null, error?: string }}
 */
export function parseSeed(raw) {
	if (raw === undefined || raw === null) return { seed: null };
	let n;
	if (typeof raw === 'number') {
		n = raw;
	} else if (typeof raw === 'string') {
		const s = raw.trim();
		if (!s) return { seed: null };
		if (!DIGITS.test(s)) return { seed: null, error: SEED_RANGE_MESSAGE };
		// Leading zeros are harmless; a 400-digit string stays out of range.
		n = s.length > 10 ? Infinity : Number(s);
	} else {
		return { seed: null, error: SEED_RANGE_MESSAGE };
	}
	if (!Number.isInteger(n) || n < SEED_MIN || n > SEED_MAX) {
		return { seed: null, error: SEED_RANGE_MESSAGE };
	}
	return { seed: n };
}

/**
 * Fold a canonical seed into an engine's inclusive [0, max] range. The mapping
 * is fixed, so the same canonical seed always yields the same engine seed.
 *
 * @param {number} seed  canonical seed (non-negative integer)
 * @param {number} max   the engine's largest accepted seed
 * @returns {number}
 */
export function foldSeed(seed, max) {
	return seed % (max + 1);
}
