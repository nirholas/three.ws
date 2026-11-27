// Safety rails for a user's own provider key (Meshy, Tripo, Rodin, Stability,
// Replicate) on the Forge bring-your-own-key lanes.
//
// A key a user brings is a credential that costs its owner money. Four things
// are enforced here so every surface that reaches a provider (POST /api/forge,
// /api/gpt-forge, the 3D Studio MCP tools, regen) gets them the same way:
//
//   1. SHAPE. A key that cannot be a real key (spaces, a pasted line break, a
//      cookie, the wrong vendor's prefix) is refused before any billed call, with
//      a message that never repeats the key. Also what stops a CR/LF header
//      injection from ever reaching the HTTP client.
//   2. SCRUBBING. A provider can echo a rejected key in its error text, and an
//      HTTP client can put request headers in a network error. guardProvider
//      wraps a provider so every error and every `error` field it hands back has
//      the key removed before it can reach a log line, an analytics event, a
//      stored job row or a response.
//   3. CLASSIFICATION. Invalid key, out of credits, throttled, provider down and
//      content refused each get a distinct code and a message that says what to
//      do next. The provider adapters set the code; byokFailureResponse and
//      byokPollFailure turn it into the wire shape.
//   4. NO SILENT SWAP. The helpers here carry no fallback to a platform lane. A
//      refused or failed BYOK request is reported as such (see forge.js, which
//      does not hand a BYOK failure to a platform-paid engine).

// Mirrors BYOK_PROVIDERS in provider-keys.js (a test pins the two together).
// Kept as its own table so this module has no import of the env or the
// database and can be loaded by the provider adapters themselves.
export const KEY_SHAPES = Object.freeze({
	tripo: { label: 'Tripo', prefix: 'tsk_' },
	meshy: { label: 'Meshy', prefix: 'msy_' },
	rodin: { label: 'Rodin', prefix: '' },
	stability: { label: 'Stability', prefix: 'sk-' },
	replicate: { label: 'Replicate', prefix: 'r8_' },
});

const KEY_MIN = 12;
const KEY_MAX = 512;
const PRINTABLE_NO_SPACE = /^[\x21-\x7e]+$/;

/**
 * Why a key cannot be a real key for this provider, or null when it can. The
 * returned message never contains the key.
 *
 * @param {string} provider
 * @param {unknown} key
 * @returns {{ reason: 'empty'|'too_short'|'too_long'|'whitespace'|'characters'|'prefix', message: string } | null}
 */
export function keyShapeProblem(provider, key) {
	const shape = KEY_SHAPES[provider];
	if (!shape) return null;
	const label = shape.label;
	if (typeof key !== 'string' || !key) {
		return { reason: 'empty', message: `Paste your ${label} API key.` };
	}
	if (/\s/.test(key)) {
		return {
			reason: 'whitespace',
			message: `That ${label} key contains a space or a line break. Paste only the key itself.`,
		};
	}
	if (key.length > KEY_MAX) {
		return { reason: 'too_long', message: `That is too long to be a ${label} key. Paste only the key itself.` };
	}
	if (!PRINTABLE_NO_SPACE.test(key)) {
		return {
			reason: 'characters',
			message: `That ${label} key has characters a key never contains. Copy it again from your ${label} dashboard.`,
		};
	}
	if (shape.prefix && !key.startsWith(shape.prefix)) {
		return {
			reason: 'prefix',
			message: `A ${label} key starts with ${shape.prefix}. Copy it again from your ${label} dashboard.`,
		};
	}
	if (key.length < KEY_MIN) {
		return { reason: 'too_short', message: `That is too short to be a ${label} key. Copy the whole key.` };
	}
	return null;
}

/** The 401 body for a key that failed the shape check. */
export function rejectedKeyBody(label, rejected) {
	return {
		error: 'invalid_key',
		reason: rejected?.reason || 'malformed',
		message: rejected?.message || `${label || 'The provider'} key looks malformed. Copy it again from your dashboard.`,
	};
}

// ── scrubbing ────────────────────────────────────────────────────────────────

const REDACTED = '[redacted]';
// Credential-shaped tokens a provider might echo that are not the exact key we
// hold (a truncated echo, a sibling key, the Authorization header value).
const SHAPED_TOKENS = [
	/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,
	/\b(?:tsk|msy|r8)_[A-Za-z0-9_-]{6,}/g,
	/\bsk-[A-Za-z0-9_-]{10,}/g,
	/(["']?authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
	/(["']?x-forge-provider-key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
];

function escapeRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove a key (and anything shaped like a credential) from text.
 * @param {unknown} text
 * @param {string | null | undefined} key
 */
export function scrubSecret(text, key) {
	if (typeof text !== 'string' || !text) return text;
	let out = text;
	if (typeof key === 'string' && key.length >= 4) {
		const forms = new Set([key, encodeURIComponent(key), Buffer.from(key).toString('base64')]);
		for (const form of forms) out = out.replace(new RegExp(escapeRegExp(form), 'g'), REDACTED);
	}
	for (const re of SHAPED_TOKENS) {
		out = out.replace(re, (m, lead) => (typeof lead === 'string' ? `${lead}${REDACTED}` : REDACTED));
	}
	return out;
}

function scrubErrorInPlace(err, key, depth = 0) {
	if (!err || typeof err !== 'object' || depth > 3) return err;
	for (const field of ['message', 'stack', 'body', 'providerDetail', 'url', 'detail']) {
		let current;
		try {
			current = err[field];
		} catch {
			continue;
		}
		if (typeof current !== 'string') continue;
		const next = scrubSecret(current, key);
		if (next === current) continue;
		try {
			Object.defineProperty(err, field, { value: next, writable: true, configurable: true, enumerable: field !== 'message' && field !== 'stack' });
		} catch {
			/* a frozen error keeps its text; the message was already scrubbed at construction */
		}
	}
	if (err.cause && typeof err.cause === 'object') scrubErrorInPlace(err.cause, key, depth + 1);
	return err;
}

function scrubResult(value, key) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	if (typeof value.error === 'string') return { ...value, error: scrubSecret(value.error, key) };
	return value;
}

/**
 * Wrap a provider adapter so nothing it throws or returns can carry the key.
 * Every function property is wrapped; plain values pass through untouched.
 *
 * @template T
 * @param {T} provider
 * @param {string} key
 * @returns {T}
 */
export function guardProvider(provider, key) {
	const guarded = {};
	for (const [name, value] of Object.entries(provider)) {
		if (typeof value !== 'function') {
			guarded[name] = value;
			continue;
		}
		guarded[name] = async (...args) => {
			let out;
			try {
				out = await value(...args);
			} catch (err) {
				throw scrubErrorInPlace(err, key);
			}
			return scrubResult(out, key);
		};
	}
	return guarded;
}

// ── classification ───────────────────────────────────────────────────────────

const CONTENT_REFUSED_RE =
	/content[\s_-]*(?:policy|moderation|safety|filter)|moderation|nsfw|flagged|safety (?:system|filter|check)/i;
const OUT_OF_CREDITS_RE = /insufficient (?:credit|balance|fund)|out of credit|not enough credit|no (?:remaining )?credit|balance is too low|top up/i;

/**
 * Classify a failure text a provider returned for a finished task.
 * @param {unknown} text
 * @returns {'content_refused' | 'insufficient_credits' | null}
 */
export function classifyFailureText(text) {
	const s = typeof text === 'string' ? text : text == null ? '' : JSON.stringify(text);
	if (!s) return null;
	if (CONTENT_REFUSED_RE.test(s)) return 'content_refused';
	if (OUT_OF_CREDITS_RE.test(s)) return 'insufficient_credits';
	return null;
}

/** True when a provider's error body says the request was refused on content grounds. */
export function bodyRefusesContent(data) {
	if (!data || typeof data !== 'object') return false;
	const parts = [data.name, data.code, data.message, data.error, data.error_message, data.suggestion];
	if (Array.isArray(data.errors)) parts.push(...data.errors);
	return CONTENT_REFUSED_RE.test(parts.filter((p) => typeof p === 'string').join(' '));
}

/** A provider adapter error for a content refusal. */
export function contentRefusedError(label, providerStatus) {
	return Object.assign(new Error(`${label} refused this request on content grounds.`), {
		code: 'content_refused',
		status: 422,
		providerStatus,
	});
}

/**
 * The response for a failed BYOK submit, by class. Returns null for a failure
 * this module does not classify (the caller keeps its own handling).
 *
 * @param {any} err
 * @param {string} label  the provider's display name
 * @returns {{ status: number, body: object, retryAfter?: number } | null}
 */
export function byokFailureResponse(err, label) {
	const name = label || 'The provider';
	// An adapter that did not classify the failure still tells us by status.
	const code =
		err?.code ||
		(err?.providerStatus === 429 ? 'rate_limited' : err?.providerStatus >= 500 ? 'provider_error' : undefined);
	// A `queued` throttle is our own rate gate pacing the request, not the user's
	// provider key being throttled; its own copy and path stay in the caller.
	if (code === 'rate_limited' && err?.queued) return null;
	switch (code) {
		case 'invalid_key':
			return {
				status: 401,
				body: {
					error: 'invalid_key',
					message: `${name} rejected your API key. Check that it is current and not revoked, then try again.`,
				},
			};
		case 'insufficient_credits':
			return {
				status: 402,
				body: {
					error: 'insufficient_credits',
					message: `Your ${name} account is out of credits. Top it up with ${name}, then try again.`,
				},
			};
		case 'rate_limited': {
			const retryAfter = typeof err.retryAfter === 'number' && err.retryAfter > 0 ? Math.ceil(err.retryAfter) : 20;
			return {
				status: 429,
				retryAfter,
				body: {
					error: 'rate_limited',
					queued: false,
					message: `${name} is rate limiting your key. Wait about ${retryAfter} seconds and try again.`,
					retry_after: retryAfter,
				},
			};
		}
		case 'content_refused':
			return {
				status: 422,
				body: {
					error: 'content_refused',
					message: `${name} refused this request on content grounds. Reword the prompt or use a different image.`,
				},
			};
		case 'provider_unreachable':
		case 'provider_error':
			return {
				status: 503,
				retryAfter: 30,
				body: {
					error: 'provider_unavailable',
					message: `${name} is not responding right now, so nothing was started. Your key is fine. Try again shortly, or pick a different engine.`,
					retry_after: 30,
				},
			};
		default:
			return null;
	}
}

const POLL_MESSAGES = {
	invalid_key: (n) => `${n} rejected your API key while this model was running. Check the key and generate again.`,
	insufficient_credits: (n) => `Your ${n} account ran out of credits before this model finished. Top it up with ${n}, then generate again.`,
	content_refused: (n) => `${n} refused this request on content grounds. Reword the prompt or use a different image.`,
};

/**
 * What a user is told when a BYOK job fails after it started. The platform's
 * generic "temporarily unavailable" copy would be wrong here (the account that
 * ran out of credits or rejected the key is the user's own), so a classified
 * failure names the provider and the fix, and an unclassified one relays the
 * provider's own scrubbed reason.
 *
 * @param {{ error?: string, errorCode?: string }} result
 * @param {string} label
 * @param {string | null} key
 * @returns {{ error: string, error_code: string }}
 */
export function byokPollFailure(result, label, key) {
	const name = label || 'The provider';
	const code = result?.errorCode || classifyFailureText(result?.error) || 'task_failed';
	if (POLL_MESSAGES[code]) return { error: POLL_MESSAGES[code](name), error_code: code };
	const reason = scrubSecret(String(result?.error || ''), key).replace(/\s+/g, ' ').trim().slice(0, 200);
	return {
		error: reason ? `${name} could not finish this model: ${reason}` : `${name} could not finish this model. Try again.`,
		error_code: 'task_failed',
	};
}
