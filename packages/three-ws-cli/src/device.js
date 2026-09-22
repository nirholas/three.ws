// The device link (api/cli/[action].js): the CLI shows a short code and a URL,
// the person approves it at /cli/authorize in any browser (another machine is
// fine), and the CLI polls until a freshly minted API key comes back. RFC 8628
// poll semantics: authorization_pending keeps waiting, slow_down backs off by
// five seconds, access_denied and expired_token end the flow.

import os from 'node:os';
import { request, requestJson, ApiError, VERSION } from './http.js';
import { openBrowser } from './browser.js';

export async function startLink({ origin, scope, clientName = `three-ws CLI ${VERSION}` }) {
	return requestJson(`${origin}/api/cli/link`, {
		method: 'POST',
		json: { client_name: clientName, hostname: os.hostname(), scope },
	});
}

export async function pollLink({ origin, link, signal, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
	let interval = (Number(link.interval) || 3) * 1000;
	const deadline = Date.now() + (Number(link.expires_in) || 600) * 1000;
	while (Date.now() < deadline) {
		if (signal?.aborted) throw new ApiError('sign-in cancelled');
		await sleep(interval);
		const res = await request(`${origin}/api/cli/token`, { method: 'POST', json: { device_code: link.device_code } });
		const data = await res.json().catch(() => ({}));
		if (res.ok) return data;
		switch (data.error) {
			case 'authorization_pending':
				continue;
			case 'slow_down':
				interval += 5000;
				continue;
			case 'access_denied':
				throw new ApiError('the sign-in was denied in the browser', { code: 'access_denied' });
			case 'expired_token':
				throw new ApiError('the code expired before it was approved. Run the command again.', { code: 'expired_token' });
			default:
				throw new ApiError(`${res.status} ${data.error || ''}: ${data.error_description || 'unexpected response'}`, { status: res.status, code: data.error });
		}
	}
	throw new ApiError('the code expired before it was approved. Run the command again.', { code: 'expired_token' });
}

/** Full flow: start, show, open, poll. Returns an `apikey` auth record. */
export async function deviceLogin({ origin, scope, env, onCode = () => {} }) {
	const link = await startLink({ origin, scope });
	const opened = await openBrowser(link.verification_uri_complete, { env: env?.vars || process.env });
	onCode(link, opened);
	const granted = await pollLink({ origin, link });
	return {
		auth: { type: 'apikey', key: granted.access_token, prefix: granted.key?.prefix || null, key_id: granted.key?.id || null, scope: granted.scope },
		account: { email: granted.account?.email || null },
	};
}
