// Pure helpers for the three.ws PowerPoint add-in task pane
// (pages/office-powerpoint.html). No DOM, no Office.js, no storage: the pane
// (taskpane.js) and the sign-in callback (auth-callback.js) wire these to the
// browser, and tests/office-powerpoint-core.test.js runs them under Node.

export const SCOPE = 'profile offline_access avatars:read';
const REFRESH_MARGIN_MS = 90_000;
const CHUNK = 0x8000;

/** RFC 4648 section 5 base64url without padding. */
export function base64url(bytes) {
	return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Standard base64 of a byte array, in chunks so a 40 MB deck never overflows the call stack. */
export function bytesToBase64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/**
 * A PKCE verifier and its S256 challenge (RFC 7636). `crypto` is the Web
 * Crypto object (window.crypto in the pane). `verifierBytes` is for tests.
 */
export async function createPkce(crypto, verifierBytes) {
	const raw = verifierBytes || crypto.getRandomValues(new Uint8Array(32));
	const verifier = base64url(raw);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** A random URL-safe token for the OAuth `state`. */
export function randomState(crypto) {
	return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Discovery documents name the canonical production URLs; the pane always
 * talks to the origin it was served from, so take the path and rebase it.
 */
export function endpointOn(origin, discovered) {
	const url = new URL(discovered, origin);
	return `${origin}${url.pathname}`;
}

export function authorizeUrl(endpoint, { clientId, redirectUri, scope, state, challenge, resource }) {
	const url = new URL(endpoint);
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		scope,
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		resource,
	}).toString();
	return url.toString();
}

/** The sign-in callback URL read into `{ code }` or `{ error: sentence }`. */
export function readAuthCallback(href, expectedState) {
	const params = new URL(href).searchParams;
	if (params.get('state') !== expectedState) {
		return { error: 'The sign-in response did not match this request. Sign in again.' };
	}
	const err = params.get('error');
	if (err === 'access_denied') return { error: 'You cancelled the sign-in. Nothing was shared.' };
	if (err) return { error: `three.ws could not finish the sign-in (${err}). Try again.` };
	const code = params.get('code');
	if (!code) return { error: 'No sign-in code came back. Sign in again.' };
	return { code };
}

/**
 * Drop the sign-in code and state from the address bar, so a refresh never
 * replays a spent code. Office.js, loaded outside an Office client, sets
 * `history.replaceState` to null on the instance; the prototype method is
 * untouched, so that is the one called.
 */
export function clearAuthQuery(win) {
	const history = win.history;
	if (!history) return;
	const replace =
		typeof history.replaceState === 'function'
			? history.replaceState
			: Object.getPrototypeOf(history)?.replaceState;
	if (typeof replace === 'function') replace.call(history, null, '', win.location.pathname);
}

export function needsRefresh(auth, now = Date.now()) {
	return !auth?.expires_at || auth.expires_at - now < REFRESH_MARGIN_MS;
}

function waitWords(seconds) {
	if (seconds < 90) return `${seconds} seconds`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 90) return `${minutes} minutes`;
	return `${Math.round(minutes / 60)} hours`;
}

/**
 * One forge_free JSON-RPC response (or a poll frame) read into what the pane
 * shows: a finished model, a job to keep polling, or an error sentence.
 */
export function readGeneration(rpc) {
	if (rpc?.error) {
		const retryAfter = Number(rpc.error.data?.retry_after) || null;
		if (rpc.error.data?.reason === 'rate_limited' && retryAfter) {
			return {
				status: 'error',
				retryAfter,
				message: `The free generator is at its limit. Try again in ${waitWords(retryAfter)}, or insert one of your saved models.`,
			};
		}
		return { status: 'error', message: rpc.error.message || 'The generator did not answer. Try again.' };
	}
	const sc = rpc?.result?.structuredContent || {};
	if (rpc?.result?.isError || sc.error) {
		const text = sc.message || rpc?.result?.content?.[0]?.text || 'The model could not be generated. Try again.';
		return { status: 'error', message: text, ...(sc.retryAfter ? { retryAfter: Number(sc.retryAfter) } : {}) };
	}
	if (sc.status === 'pending' && sc.pollUrl) {
		return {
			status: 'pending',
			jobId: sc.jobId || sc.job_id,
			pollUrl: sc.pollUrl,
			progress: typeof sc.progress === 'number' ? sc.progress : null,
			etaSeconds: sc.eta_seconds ?? null,
		};
	}
	if (sc.glbUrl) return { status: 'done', glbUrl: sc.glbUrl, prompt: sc.prompt || '', viewerUrl: sc.viewerUrl || '' };
	return { status: 'error', message: 'The generator answered without a model. Try again.' };
}

/** One /api/gpt-forge poll frame read the same way. */
export function readPollFrame(frame) {
	if (frame?.status === 'done' && frame.glb_url) return { status: 'done', glbUrl: frame.glb_url };
	if (frame?.status === 'failed') {
		// A failed job carries its sentence in `error`; an API error carries a code there and the sentence in `message`.
		return { status: 'error', message: frame.message || frame.error || 'The model could not be generated. Try again.' };
	}
	if (frame?.error) return { status: 'error', message: frame.message || frame.error_description || 'The model could not be generated. Try again.' };
	return {
		status: 'pending',
		progress: typeof frame?.progress === 'number' ? frame.progress : null,
		etaSeconds: frame?.eta_remaining_seconds ?? frame?.eta_seconds ?? null,
	};
}

/** The deck URL for a stored creation (`{ id }`) or a fresh free-lane model (`{ src, title }`). */
export function exportUrl(origin, source) {
	const params = source.id ? new URLSearchParams({ id: source.id }) : new URLSearchParams({ src: source.src, title: source.title || '' });
	return `${origin}/api/forge/export-pptx?${params}`;
}
