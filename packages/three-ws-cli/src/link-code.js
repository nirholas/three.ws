// Link codes (api/auth/link-codes/[action].js): the person mints a short code
// on three.ws/dashboard/account, types it into this terminal, and confirms
// the pending claim on the site. The CLI claims the code, polls with its
// claim secret until the decision lands, and receives a freshly minted API
// key scoped to what the owner confirmed. `expired` and `rejected` end the
// flow; a reject turns the claim secret into an unknown claim on the next
// poll, which the CLI reports the same way.

import os from 'node:os';
import { request, requestJson, ApiError, VERSION } from './http.js';

export const CODE_PATTERN = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-?[BCDFGHJKLMNPQRSTVWXZ]{4}$/i;

/** Normalize what a person typed: upper-case, dash in the middle, no spaces. */
export function normalizeCode(raw) {
	const compact = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
	if (compact.length !== 8) return null;
	const code = `${compact.slice(0, 4)}-${compact.slice(4)}`;
	return CODE_PATTERN.test(code) ? code : null;
}

export async function claimLinkCode({ origin, code, clientName = `three-ws CLI ${VERSION}` }) {
	const normalized = normalizeCode(code);
	if (!normalized) throw new ApiError('that does not look like a link code (eight letters, like BCDF-GHJK). Generate one at https://three.ws/dashboard/account.', { code: 'invalid_code' });
	return requestJson(`${origin}/api/auth/link-codes/claim`, {
		method: 'POST',
		json: {
			code: normalized,
			device_kind: 'cli',
			device: { name: os.hostname(), platform: `${os.platform()} ${os.release()}`, client: clientName },
		},
	});
}

export async function pollLinkCode({ origin, claim, signal, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
	const interval = Math.max(1000, Number(claim.poll_every_ms) || 2000);
	const deadline = claim.expires_at ? new Date(claim.expires_at).getTime() : Date.now() + 600_000;
	const url = `${origin}/api/auth/link-codes/poll?id=${encodeURIComponent(claim.id)}&secret=${encodeURIComponent(claim.claim_secret)}`;
	while (Date.now() < deadline + interval) {
		if (signal?.aborted) throw new ApiError('link cancelled');
		await sleep(interval);
		const res = await request(url);
		const data = await res.json().catch(() => ({}));
		if (res.status === 404) throw new ApiError('the link request was rejected on the site, or the code expired. Generate a new code and run the command again.', { code: 'rejected', status: 404 });
		if (!res.ok) throw new ApiError(`${res.status} ${data.error || ''}: ${data.message || 'unexpected response'}`, { status: res.status, code: data.error });
		switch (data.status) {
			case 'claimed':
				continue;
			case 'confirmed':
				return data;
			case 'rejected':
				throw new ApiError('the link request was rejected on the site.', { code: 'rejected' });
			case 'expired':
				throw new ApiError('the code expired before it was confirmed. Generate a new one and run the command again.', { code: 'expired' });
			case 'consumed':
				throw new ApiError('this link was already consumed by another client. Generate a new code.', { code: 'consumed' });
			default:
				throw new ApiError(`unexpected link status ${data.status || '(none)'}`, { code: 'unexpected_status' });
		}
	}
	throw new ApiError('the code expired before it was confirmed. Generate a new one and run the command again.', { code: 'expired' });
}

/** Full flow: claim, wait for the owner to confirm on the site, return an `apikey` auth record. */
export async function linkCodeLogin({ origin, code, onClaimed = () => {} }) {
	const claim = await claimLinkCode({ origin, code });
	onClaimed(claim);
	const confirmed = await pollLinkCode({ origin, claim });
	const credential = confirmed.credential || {};
	if (credential.kind !== 'api_key' || !credential.secret) {
		throw new ApiError(`the site confirmed the link with a ${credential.kind || 'missing'} credential, which this CLI cannot store. Mint the code for a CLI device.`, { code: 'wrong_credential' });
	}
	return {
		auth: { type: 'apikey', key: credential.secret, prefix: credential.secret.slice(0, 12), key_id: credential.id || null, scope: Array.isArray(claim.scopes) ? claim.scopes.join(' ') : claim.scopes || null },
		device_id: confirmed.device_id || null,
	};
}
