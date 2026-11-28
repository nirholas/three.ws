// GET /api/linear/oauth: Linear's OAuth redirect for the three.ws agent.
//
// Verify the signed state and that this browser holds its nonce, trade the code
// for the workspace's token pair, look up the workspace and the app's user in
// it, store the install with both tokens sealed, and return to
// /integrations/linear, which explains the outcome (?installed=1 or
// ?install=<status>).

import { redirect, method, wrap } from '../_lib/http.js';
import { readCookie } from '../_lib/acquisition.js';
import {
	linearConfigured,
	verifyInstallState,
	installNonceMatches,
	installCookie,
	exchangeLinearCode,
	saveLinearInstall,
	INSTALL_COOKIE,
} from '../_lib/linear-installs.js';

const PAGE = '/integrations/linear';
const URL_KEY = /^[a-z0-9-]{1,64}$/i;

function outcome(res, status) {
	res.setHeader('cache-control', 'no-store');
	return redirect(res, `${PAGE}?install=${status}`);
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	const q = new URL(req.url, 'http://x').searchParams;
	if (!linearConfigured()) return outcome(res, 'not_configured');
	const verified = verifyInstallState(q.get('state'));
	if (!installNonceMatches(verified, readCookie(req.headers.cookie, INSTALL_COOKIE))) return outcome(res, 'expired');
	res.setHeader('set-cookie', installCookie('', { clear: true }));
	if (q.get('error')) return outcome(res, 'cancelled');
	const code = q.get('code');
	if (!code || code.length > 512) return outcome(res, 'failed');
	let install;
	try {
		install = await exchangeLinearCode(code);
		await saveLinearInstall(install, verified.userId);
	} catch (err) {
		console.warn('[linear] oauth exchange failed', err?.code || err?.message);
		return outcome(res, 'failed');
	}
	const back = new URLSearchParams({ installed: '1' });
	if (install.organizationKey && URL_KEY.test(install.organizationKey)) back.set('workspace', install.organizationKey);
	res.setHeader('cache-control', 'no-store');
	return redirect(res, `${PAGE}?${back.toString()}`);
});
