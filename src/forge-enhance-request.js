// One client for POST /api/forge-enhance, shared by every Enhance button (the
// Forge page, Forge Studio, the homepage chamber and Forge Spark).
//
// The endpoint answers inside its own 10 s budget, but a request can still
// stall on the way (a dropped proxy, a frozen tab waking up), so the request is
// ended at ENHANCE_TIMEOUT_MS and the button always comes back. Every outcome
// carries the prompt the field should hold and one sentence to show: the
// user's own words whenever no usable rewrite came back.

export const ENHANCE_TIMEOUT_MS = 15_000;

export const ENHANCE_MESSAGES = {
	unavailable: 'The prompt helper is unavailable right now, so your prompt is unchanged and Generate still works.',
	discarded: 'The prompt helper did not return a usable rewrite, so your prompt is unchanged.',
	inShape: 'That prompt is already in good shape.',
	failed: 'Could not reach the prompt helper, so your prompt is unchanged.',
	rejected: 'The prompt helper could not rewrite that one, so your prompt is unchanged.',
	rewritten: 'Rewritten for sharper geometry. Edit freely, or Undo.',
};

function throttledMessage(secs) {
	return secs > 0 ? `Too many enhance requests: try again in ${secs}s.` : 'Too many enhance requests: wait a moment, then try again.';
}

/**
 * @param {string} raw the user's prompt, already trimmed
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, headers?: object, body?: object }} [opts]
 * @returns {Promise<{ kind: 'rewritten'|'unchanged'|'unavailable'|'throttled'|'failed', prompt: string,
 *   message: string, retryAfter?: number, reason?: string, provider?: string, model?: string }>}
 */
export async function requestEnhance(raw, { fetchImpl = globalThis.fetch, timeoutMs = ENHANCE_TIMEOUT_MS, headers = {}, body = {} } = {}) {
	const keep = (kind, message, extra = {}) => ({ kind, prompt: raw, message, ...extra });
	let res;
	try {
		res = await fetchImpl('/api/forge-enhance', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify({ prompt: raw, ...body }),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		// AbortSignal.timeout rejects with a TimeoutError: the helper did not
		// answer in time, which is the same state as the server saying it is down.
		if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return keep('unavailable', ENHANCE_MESSAGES.unavailable);
		return keep('failed', ENHANCE_MESSAGES.failed);
	}

	const data = await res.json().catch(() => ({}));
	const retryAfter = Number(data?.retry_after);
	const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 0;

	if (res.status === 429) return keep('throttled', throttledMessage(wait), { retryAfter: wait });
	if (res.status === 503) return keep('unavailable', ENHANCE_MESSAGES.unavailable, wait ? { retryAfter: wait } : {});
	if (!res.ok) return keep('failed', ENHANCE_MESSAGES.rejected);

	const next = typeof data?.prompt === 'string' ? data.prompt.trim() : '';
	if (data?.enhanced === false) return keep('unchanged', ENHANCE_MESSAGES.discarded, { reason: data.reason || 'not_enhanced' });
	if (!next || next.toLowerCase() === raw.toLowerCase()) return keep('unchanged', ENHANCE_MESSAGES.inShape);
	return {
		kind: 'rewritten',
		prompt: next,
		message: ENHANCE_MESSAGES.rewritten,
		provider: data.provider,
		model: data.model,
	};
}
