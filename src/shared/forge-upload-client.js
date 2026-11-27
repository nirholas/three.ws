// The photo upload /forge and Forge Studio share: presign at /api/forge-upload,
// then PUT the bytes straight to object storage.
//
// Every failure comes back as { ok: false, code, message, detail, retryable }:
// `message` is the short line for the photo tile, `detail` the full sentence
// pair (also announced to screen readers), and `retryable` says whether the
// tile's Retry button, which re-sends the same photo, can help. The pages keep
// the photo on a failed upload, so the person never has to find it again.
//
// Two legs, two catches on purpose. The presign leg is same-origin, so a throw
// there really is the person's connection. The PUT leg is cross-origin to the
// bucket, where a rejected credential or a missing CORS rule answers 403 with no
// Access-Control-Allow-Origin, and the browser hands back a rejected promise
// with no status to read. A throw there is the person's connection only when the
// browser itself says it is offline; otherwise it is reported as an upload that
// did not finish (one shared catch, as this had until 2026-09-08, blamed the
// person's phone for our outage).

import { forgeUploadFailure } from '../forge-errors.js';
import { isSignInRequired, UPLOAD_SIGN_IN_SHORT } from './upload-sign-in.js';
import { formatMime } from './forge-image-intake.js';

/** A photo is at most 8 MB; two minutes covers a slow 0.5 Mbit/s uplink. */
export const PUT_TIMEOUT_MS = 120_000;
const PRESIGN_TIMEOUT_MS = 30_000;

const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

function failure(status, body) {
	const f = forgeUploadFailure(status, body);
	const code = f.error?.code || null;
	// A 413 will fail the same way on every retry; nothing else the server says is
	// final except "this deployment has no storage" and a request it will never take.
	const retryable = status !== 413 && f.error?.retry !== 'never';
	return { ok: false, code, message: f.message, detail: f.detail, retryable };
}

function withTimeout(ms) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new DOMException('upload timed out', 'TimeoutError')), ms);
	return { signal: controller.signal, done: () => clearTimeout(timer), timedOut: () => controller.signal.aborted };
}

/**
 * @param {File|Blob} file  already normalized (src/shared/forge-image-normalize.js)
 * @param {{ headers?: object, onSignIn?: () => void, fetchImpl?: typeof fetch,
 *           timeoutMs?: number, isOnline?: () => boolean }} [opts]
 */
export async function uploadForgePhoto(
	file,
	{ headers = {}, onSignIn = () => {}, fetchImpl = globalThis.fetch, timeoutMs = PUT_TIMEOUT_MS, isOnline = browserOnline } = {},
) {
	let presign;
	let presignRes;
	const presignClock = withTimeout(PRESIGN_TIMEOUT_MS);
	try {
		presignRes = await fetchImpl('/api/forge-upload', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
			signal: presignClock.signal,
		});
		presign = await presignRes.json().catch(() => ({}));
	} catch {
		return presignClock.timedOut() && isOnline() ? failure(0, { error: 'upload_timeout' }) : failure(0, {});
	} finally {
		presignClock.done();
	}

	if (isSignInRequired(presignRes.status, presign)) {
		onSignIn();
		return { ok: false, code: 'sign_in', message: UPLOAD_SIGN_IN_SHORT, detail: UPLOAD_SIGN_IN_SHORT, retryable: true };
	}
	if (presignRes.status === 413) return failure(413, { error: 'payload_too_large' });
	if (!presignRes.ok || !presign.upload_url || !presign.public_url) {
		return failure(presignRes.status, presignRes.ok ? { error: 'presign_failed' } : presign);
	}

	const putClock = withTimeout(timeoutMs);
	try {
		const putRes = await fetchImpl(presign.upload_url, {
			method: 'PUT',
			headers: { 'content-type': file.type },
			body: file,
			signal: putClock.signal,
		});
		if (putRes.status === 413) return failure(413, { error: 'payload_too_large' });
		if (!putRes.ok) return failure(putRes.status, { error: 'upload_rejected' });
		return { ok: true, url: presign.public_url };
	} catch {
		if (!isOnline()) return failure(0, {});
		if (putClock.timedOut()) return failure(0, { error: 'upload_timeout' });
		return failure(0, { error: 'upload_rejected' });
	} finally {
		putClock.done();
	}
}

const IMPORT_TIMEOUT_MS = 45_000;

function nameFromLink(link, format) {
	let base = 'linked-photo';
	try {
		const last = decodeURIComponent(new URL(link).pathname.split('/').filter(Boolean).pop() || '');
		const clean = last.replace(/\.[^.]{1,8}$/, '').replace(/[^\w .()-]+/g, '').trim().slice(0, 80);
		if (clean) base = clean;
	} catch {
		/* a link that will not parse keeps the generic name */
	}
	return `${base}.${format === 'jpeg' ? 'jpg' : format || 'img'}`;
}

/**
 * Fetch a photo the person pasted as a link, through /api/forge-upload
 * { source_url } (SSRF-guarded on the server), and hand it back as a File the
 * page prepares and uploads like any dropped photo.
 */
export async function importForgeImageUrl(
	link,
	{ headers = {}, onSignIn = () => {}, fetchImpl = globalThis.fetch, isOnline = browserOnline, timeoutMs = IMPORT_TIMEOUT_MS } = {},
) {
	const clock = withTimeout(timeoutMs);
	let res;
	try {
		res = await fetchImpl('/api/forge-upload', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify({ source_url: link }),
			signal: clock.signal,
		});
	} catch {
		clock.done();
		if (clock.timedOut() && isOnline()) return failure(0, { error: 'url_unreachable' });
		return failure(0, {});
	}
	try {
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			if (isSignInRequired(res.status, body)) {
				onSignIn();
				return { ok: false, code: 'sign_in', message: UPLOAD_SIGN_IN_SHORT, detail: UPLOAD_SIGN_IN_SHORT, retryable: true };
			}
			const f = failure(res.status, body);
			// The import's refusals are our own sentences about this exact link
			// (api/_lib/forge-image-import.js); they say more than the generic map.
			const own = typeof body.message === 'string' && /^url_/.test(body.error || '') ? body.message : null;
			return { ...f, message: own || f.message, detail: own || f.detail };
		}
		const format = res.headers.get('x-image-format') || '';
		const blob = await res.blob();
		const type = formatMime(format);
		return { ok: true, file: new File([blob], nameFromLink(link, format), { type: type === 'application/octet-stream' ? '' : type }) };
	} catch {
		return clock.timedOut() ? failure(0, { error: 'url_unreachable' }) : failure(0, {});
	} finally {
		clock.done();
	}
}
