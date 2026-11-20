// Every failure the starter can hit, mapped to a message that says what went
// wrong and the one thing that fixes it. The page renders `title`, `message`
// and `fix` as they are; nothing upstream is shown raw except a bounded
// excerpt of an unrecognised xAI error.

export class AppError extends Error {
	constructor(code, { title, message, fix = null, status = 500, retryable = false, retryAfterSeconds = null, link = null } = {}) {
		super(message);
		this.name = 'AppError';
		this.code = code;
		this.title = title;
		this.fix = fix;
		this.status = status;
		this.retryable = retryable;
		this.retryAfterSeconds = retryAfterSeconds;
		this.link = link;
	}

	toJSON() {
		return {
			code: this.code,
			title: this.title,
			message: this.message,
			fix: this.fix,
			retryable: this.retryable,
			retryAfterSeconds: this.retryAfterSeconds,
			link: this.link,
		};
	}
}

const XAI_CONSOLE = 'https://console.x.ai';
const XAI_STATUS = 'https://status.x.ai';
const THREE_WS_KEYS = 'https://three.ws/dashboard/api-keys';

function excerpt(text, max = 240) {
	const s = String(text || '').replace(/\s+/g, ' ').trim();
	return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/** The message and code inside an xAI error body, whichever of its shapes it uses. */
export function readXaiErrorBody(bodyText) {
	try {
		const body = JSON.parse(bodyText);
		if (body && typeof body.error === 'object' && body.error) return { code: String(body.error.code || body.error.type || ''), message: String(body.error.message || '') };
		if (body && typeof body === 'object') return { code: String(body.code || ''), message: String(body.error || body.message || '') };
	} catch {
		return { code: '', message: excerpt(bodyText) };
	}
	return { code: '', message: '' };
}

function retryAfter(headers) {
	const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
	const n = Number.parseInt(raw ?? '', 10);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

// xAI calls the three.ws MCP server itself. When three.ws refuses the key,
// xAI reports that inside its own error, so the message names MCP.
function isMcpAuthFailure(message) {
	return /\bmcp\b|three-ws|three\.ws/i.test(message) && /401|unauthori[sz]ed|invalid access token|forbidden/i.test(message);
}

export function threeWsBadKey() {
	return new AppError('three_ws_bad_key', {
		title: 'three.ws rejected the API key',
		message: 'THREE_WS_API_KEY is set, but three.ws did not accept it. It may have been revoked or copied with a missing character.',
		fix: 'Create a new key at three.ws/dashboard/api-keys, replace THREE_WS_API_KEY in .env, and restart the server.',
		status: 502,
		link: THREE_WS_KEYS,
	});
}

/** An xAI HTTP failure (non-2xx before the stream starts). */
export function mapXaiError(status, bodyText, headers) {
	const { code, message } = readXaiErrorBody(bodyText);
	if (isMcpAuthFailure(message)) return threeWsBadKey();
	if (status === 401 || (status === 400 && /incorrect api key|invalid api key/i.test(message))) {
		return new AppError(status === 401 ? 'xai_unauthorized' : 'xai_bad_key', {
			title: 'xAI did not accept the API key',
			message: status === 401 ? 'xAI answered 401: the request reached it without a valid API key.' : 'xAI answered that the API key is incorrect.',
			fix: 'Create a key at console.x.ai, set XAI_API_KEY in .env, and restart the server.',
			status: 502,
			link: XAI_CONSOLE,
		});
	}
	if (status === 403) {
		return new AppError('xai_forbidden', {
			title: 'xAI refused this request',
			message: `xAI answered 403${message ? `: ${excerpt(message)}` : ''}. The key's team may lack access to the model or have no credits left.`,
			fix: 'Check the team\'s billing and model access at console.x.ai, or set XAI_MODEL to a model the team can use.',
			status: 502,
			link: XAI_CONSOLE,
		});
	}
	if (status === 404 || /model.*(not found|does not exist)/i.test(message)) {
		return new AppError('xai_model', {
			title: 'xAI does not know that model',
			message: `xAI could not find the model${message ? `: ${excerpt(message)}` : '.'}`,
			fix: 'Set XAI_MODEL in .env to a model listed at docs.x.ai/developers/models, then restart.',
			status: 502,
			link: 'https://docs.x.ai/developers/models',
		});
	}
	if (status === 429) {
		const wait = retryAfter(headers);
		return new AppError('xai_rate_limited', {
			title: 'xAI rate limit reached',
			message: `xAI answered 429: this key has sent too many requests or tokens for now${wait ? ` (retry in ${wait}s)` : ''}.`,
			fix: 'Wait a minute and send again. Limits per model are listed on the key\'s team page at console.x.ai.',
			status: 429,
			retryable: true,
			retryAfterSeconds: wait,
			link: XAI_CONSOLE,
		});
	}
	if (status >= 500) {
		return new AppError('xai_unavailable', {
			title: 'xAI is having trouble',
			message: `xAI answered ${status}. This is on xAI's side, not in your setup.`,
			fix: 'Check status.x.ai and send again in a moment.',
			status: 502,
			retryable: true,
			link: XAI_STATUS,
		});
	}
	return new AppError('xai_bad_request', {
		title: 'xAI rejected the request',
		message: `xAI answered ${status}${code ? ` (${code})` : ''}${message ? `: ${excerpt(message)}` : '.'}`,
		fix: 'If you changed XAI_MODEL or XAI_REASONING_EFFORT, check them against docs.x.ai. Otherwise send again.',
		status: 502,
		retryable: true,
		link: 'https://docs.x.ai/developers/debugging',
	});
}

/** A network failure reaching xAI (DNS, TLS, reset). */
export function xaiUnreachable(cause) {
	return new AppError('xai_unreachable', {
		title: 'Could not reach xAI',
		message: `The server could not connect to api.x.ai${cause?.message ? ` (${excerpt(cause.message, 120)})` : ''}.`,
		fix: 'Check this machine\'s internet connection and status.x.ai, then send again.',
		status: 502,
		retryable: true,
		link: XAI_STATUS,
	});
}

/** A stream that started and then reported failure (response.failed or an error event). */
export function xaiStreamFailed(error) {
	const message = String(error?.message || error?.error || '');
	if (isMcpAuthFailure(message)) return threeWsBadKey();
	const code = String(error?.code || '');
	if (/rate|429/i.test(code)) return mapXaiError(429, JSON.stringify({ code, error: message }), null);
	return new AppError('xai_stream_failed', {
		title: 'Grok stopped partway through',
		message: `xAI reported a failure while answering${message ? `: ${excerpt(message)}` : '.'}`,
		fix: 'Send the message again. If it keeps happening, check status.x.ai.',
		status: 502,
		retryable: true,
		link: XAI_STATUS,
	});
}

/** A three.ws tool result that blocks the turn, as an AppError. Null for results that do not. */
export function mapToolProblem(result) {
	if (!result) return null;
	if (result.kind === 'sign_in_required') {
		return new AppError('three_ws_sign_in', {
			title: 'three.ws needs a signed-in account',
			message: 'three.ws answered sign_in_required: making a model needs a three.ws account, and the request did not carry one.',
			fix: 'Create a free account and an API key at three.ws/dashboard/api-keys, set THREE_WS_API_KEY in .env, and restart the server.',
			status: 401,
			link: result.apiKeysUrl || THREE_WS_KEYS,
		});
	}
	if (result.kind === 'bad_key') return threeWsBadKey();
	if (result.kind === 'failed' && ['forge_free', 'refine_model', 'check_job', 'get_job'].includes(result.tool)) {
		return renderFailed(result.message, result.retryable);
	}
	return null;
}

export function renderFailed(message, retryable = false) {
	return new AppError('render_failed', {
		title: 'The render did not finish',
		message: excerpt(message || 'three.ws could not finish this model.', 400),
		fix: retryable ? 'The job may still be fine. Send "check on it" to look again.' : 'Send the request again, or describe the object a little differently.',
		status: 502,
		retryable: true,
	});
}

export function renderTimeout(minutes, viewerUrl) {
	return new AppError('render_timeout', {
		title: 'The render is taking longer than usual',
		message: `three.ws is still working on the model after ${minutes} minutes. It keeps running on three.ws.`,
		fix: viewerUrl ? 'Open the viewer link: it shows the model the moment it is ready. Or send "check on it" later.' : 'Send "check on it" in a few minutes to collect it.',
		status: 504,
		retryable: true,
		link: viewerUrl || null,
	});
}

export function badInput(message) {
	return new AppError('bad_input', { title: 'That message could not be sent', message, fix: 'Shorten or rephrase it and send again.', status: 400 });
}

export function rateLimited(retryAfterSeconds) {
	return new AppError('rate_limited', {
		title: 'Slow down a little',
		message: `This starter allows a few messages per minute from each address, so one visitor cannot spend the owner's credits.`,
		fix: `Send again in ${retryAfterSeconds}s. The owner can raise RATE_LIMIT_PER_MINUTE.`,
		status: 429,
		retryable: true,
		retryAfterSeconds,
	});
}

export function setupRequired(missing) {
	return new AppError('setup_required', {
		title: 'Setup needed',
		message: `Missing ${missing.map((m) => m.name).join(' and ')}.`,
		fix: 'Add the keys to .env and restart the server.',
		status: 503,
	});
}

/** Anything thrown that is not already an AppError. */
export function toAppError(err) {
	if (err instanceof AppError) return err;
	return new AppError('internal', {
		title: 'Something went wrong on the server',
		message: excerpt(err?.message || String(err), 200),
		fix: 'Send again. If it repeats, the server log has the full error.',
		status: 500,
		retryable: true,
	});
}
