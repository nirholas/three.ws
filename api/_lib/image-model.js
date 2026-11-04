// The one place the Gemini image model id is resolved for every Vertex image
// lane (forge reference images, the text-to-image ladder, the MCP edit lane,
// and the lane health probe), so a model retirement is a one-line change here
// instead of a hunt across three modules that drift apart.
//
// `gemini-2.5-flash-image` was marked deprecated by Google with a Gemini API
// shutdown of 2026-10-02. Its successor is the primary; the retired id stays
// as a one-step fallback that is tried ONLY when Vertex answers that the
// primary model does not exist (404 / "model not found"), which is the shape a
// project without access to the new model, or a region that has not rolled it
// out yet, returns. Every other failure (429, 403 billing hold, 5xx, a safety
// block) is a real answer from a model that exists and must not be retried on
// a different model: a 429 on the fallback would only double the rate-limit
// pressure, and a 403 hold denies both ids alike.
//
// VERTEX_IMAGEN_MODEL (and VERTEX_IMAGEN_EDIT_MODEL for the edit lane) still
// override the primary without a code change.

export const IMAGE_MODEL_PRIMARY = 'gemini-3.1-flash-image';
export const IMAGE_MODEL_FALLBACK = 'gemini-2.5-flash-image';

function readEnv(name) {
	if (typeof process !== 'undefined' && process.env?.[name]) return String(process.env[name]).trim();
	return '';
}

/**
 * Ordered model ids to try for one image call: the configured (or default)
 * primary, then the fallback, deduplicated. An `imagen-*` override is a legacy
 * `:predict` model with no Gemini fallback, so it is returned alone.
 * @param {string} [envName]
 * @returns {string[]}
 */
export function imageModelChain(envName = 'VERTEX_IMAGEN_MODEL') {
	const primary = readEnv(envName) || IMAGE_MODEL_PRIMARY;
	if (/^imagen/i.test(primary)) return [primary];
	return primary === IMAGE_MODEL_FALLBACK ? [primary] : [primary, IMAGE_MODEL_FALLBACK];
}

/** The id a single-model caller (a probe, a log line) should name. */
export function resolveImageModel(envName = 'VERTEX_IMAGEN_MODEL') {
	return imageModelChain(envName)[0];
}

/**
 * True when a Vertex failure means "this model id is not served here", the
 * only failure that may fall through to the next id in the chain.
 * @param {number} status HTTP status
 * @param {string} [message] error body or message
 */
export function isModelNotFound(status, message = '') {
	if (Number(status) === 404) return true;
	return /\bmodel\b[^.]{0,80}\b(not found|does not exist|is not supported|was not found)\b|\bpublisher model\b[^.]{0,80}\bnot found\b/i.test(
		String(message || ''),
	) && Number(status) === 400;
}
