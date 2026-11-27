// material-restyle-client.js: the Forge Materials panel's AI restyle call
// (POST /api/material-studio?action=restyle), with copy for every way it ends.
//
// The preset looks run in the browser and cannot fail on the network. AI
// restyle is the one path that can, so this module guarantees two things:
//   - every failure gets our own sentence, never the server's `message` (a
//     handler can put a provider's raw error there), and every failure that
//     the presets can route around says so (`offerPresets`),
//   - the request is bounded: it is aborted after RESTYLE_TIMEOUT_MS and ends
//     in a `timeout` error, so the panel never spins forever.

import { INSTRUCTION_MAX, INSTRUCTION_MIN, checkInstruction } from './restyle-instruction.js';

/** The server's author chain gives up at 20 s; allow it that plus upload time. */
export const RESTYLE_TIMEOUT_MS = 30_000;

const ENDPOINT = '/api/material-studio?action=restyle';
const PRESETS_HINT = 'The preset looks above apply instantly on this device and need no model.';

function restyleError(code, message, extra = {}) {
	const e = new Error(message);
	e.code = code;
	e.offerPresets = Boolean(extra.offerPresets);
	e.action = extra.action || 'retry';
	e.retryAfter = extra.retryAfter ?? null;
	return e;
}

const INSTRUCTION_COPY = Object.freeze({
	missing_instruction: 'Describe the look you want, for example "polished white marble".',
	instruction_too_short: `Use at least ${INSTRUCTION_MIN} characters to describe the look.`,
	instruction_too_long: `Keep the description under ${INSTRUCTION_MAX} characters.`,
});

function waitPhrase(secs) {
	return secs >= 90 ? `about ${Math.ceil(secs / 60)} min` : `about ${secs} s`;
}

/** Our copy for a failed response. The server's `message` is never read. */
export function describeRestyleFailure(status, body, headers) {
	const code = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : '';
	if (status === 401 || code === 'sign_in_required') {
		return restyleError('sign_in_required', `Sign in to use AI restyle. ${PRESETS_HINT}`, { action: 'sign_in', offerPresets: true });
	}
	if (status === 429) {
		const fromBody = Number(body?.retry_after);
		const fromHeader = Number(headers?.get?.('retry-after'));
		const secs = Math.ceil(fromBody > 0 ? fromBody : fromHeader > 0 ? fromHeader : 60);
		return restyleError(
			'rate_limited',
			`You have used the AI restyles available for now. Try again in ${waitPhrase(secs)}. ${PRESETS_HINT}`,
			{ action: 'wait', retryAfter: secs, offerPresets: true },
		);
	}
	if (code === 'no_materials') {
		return restyleError(
			'no_materials',
			'This model has no materials for AI restyle to edit. A preset look adds one, so try one of those.',
			{ action: 'presets', offerPresets: true },
		);
	}
	if (code === 'bad_model_output') {
		return restyleError(
			'bad_model_output',
			'The AI answered with a material we could not use. Reword the description and try again, or pick a preset look.',
			{ offerPresets: true },
		);
	}
	if (Object.hasOwn(INSTRUCTION_COPY, code)) return restyleError(code, INSTRUCTION_COPY[code], { action: 'edit_input' });
	if (code === 'invalid_url' || code === 'missing_url' || code === 'missing_glb_url' || code === 'source_too_large') {
		return restyleError(
			code,
			code === 'source_too_large'
				? `This model is too large for AI restyle. ${PRESETS_HINT}`
				: `AI restyle cannot read this model from where it is stored. ${PRESETS_HINT}`,
			{ action: 'presets', offerPresets: true },
		);
	}
	if (code === 'fetch_failed' || code === 'source_http' || code === 'empty_source' || code === 'not_glb') {
		return restyleError(code, `AI restyle could not download this model. Try again in a moment. ${PRESETS_HINT}`, { offerPresets: true });
	}
	if (status >= 500 || code === 'no_provider' || code === 'unconfigured') {
		return restyleError(
			code || 'server_error',
			`AI restyle cannot reach a language model right now, so nothing was changed. Try again in a minute. ${PRESETS_HINT}`,
			{ offerPresets: true },
		);
	}
	return restyleError(
		code || 'restyle_failed',
		`AI restyle did not finish (${code || 'error'} ${status}). Try again, or pick a preset look.`,
		{ offerPresets: true },
	);
}

/**
 * @param {{ glbUrl: string, instruction: string, headers?: object, timeoutMs?: number,
 *   signal?: AbortSignal, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ glbUrl: string, name: string, notes: string }>}
 */
export async function requestServerRestyle({ glbUrl, instruction, headers = {}, timeoutMs = RESTYLE_TIMEOUT_MS, signal, fetchImpl } = {}) {
	const checked = checkInstruction(instruction);
	if (!checked.ok) throw restyleError(checked.code, checked.message, { action: 'edit_input' });
	if (typeof glbUrl !== 'string' || !/^https:\/\//i.test(glbUrl)) {
		throw restyleError(
			'local_source',
			'AI restyle works on a saved model, and this one only exists in this tab. Pick a preset look, or go back to the original first.',
			{ action: 'presets', offerPresets: true },
		);
	}

	const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
	const ctrl = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		ctrl.abort();
	}, timeoutMs);
	const onCallerAbort = () => ctrl.abort();
	if (signal) {
		if (signal.aborted) ctrl.abort();
		else signal.addEventListener('abort', onCallerAbort, { once: true });
	}

	let res;
	let body;
	try {
		res = await doFetch(ENDPOINT, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify({ glb_url: glbUrl, instruction: checked.text }),
			signal: ctrl.signal,
		});
		body = await res.json().catch(() => ({}));
	} catch (err) {
		if (timedOut) {
			throw restyleError(
				'timeout',
				`AI restyle took longer than ${Math.round(timeoutMs / 1000)} s, so we stopped waiting and nothing was changed. Try again. ${PRESETS_HINT}`,
				{ offerPresets: true },
			);
		}
		if (ctrl.signal.aborted || err?.name === 'AbortError') throw restyleError('aborted', 'AI restyle was cancelled.');
		throw restyleError('network', 'Could not reach three.ws. Check your connection and try again.');
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener?.('abort', onCallerAbort);
	}

	if (!res.ok) throw describeRestyleFailure(res.status, body, res.headers);
	const url = typeof body?.glbUrl === 'string' ? body.glbUrl : '';
	if (!/^https:\/\//i.test(url)) {
		throw restyleError('bad_response', 'AI restyle answered without a model. Try again, or pick a preset look.', { offerPresets: true });
	}
	const factors = body.factors && typeof body.factors === 'object' ? body.factors : {};
	return {
		glbUrl: url,
		name: typeof factors.name === 'string' ? factors.name.slice(0, 80) : '',
		notes: typeof factors.notes === 'string' ? factors.notes.slice(0, 200) : '',
	};
}
