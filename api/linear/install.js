// GET /api/linear/install: Add to Linear.
//
// The agent's models are owned by the three.ws account that installs it, so an
// install starts signed in: a signed-out visitor is sent to sign in and comes
// straight back here. The OAuth state names the account and carries a nonce
// that is also set as an HttpOnly cookie (api/_lib/linear-installs.js), and
// Linear's consent screen is asked for actor=app with the agent scopes. Linear
// returns to /api/linear/oauth.

import { redirect, method, wrap } from '../_lib/http.js';
import { getSessionUser } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { linearConfigured, linearAuthorizeUrl, newInstallNonce, installCookie } from '../_lib/linear-installs.js';

const PAGE = '/integrations/linear';

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!linearConfigured()) return redirect(res, `${PAGE}?install=not_configured`);
	const user = await getSessionUser(req, res).catch(() => null);
	if (!user) return redirect(res, `/login?next=${encodeURIComponent('/api/linear/install')}`);
	const rl = await limits.linearInstallWrite(user.id);
	if (!rl.success) return redirect(res, `${PAGE}?install=rate_limited`);
	const nonce = newInstallNonce();
	res.setHeader('set-cookie', installCookie(nonce));
	res.setHeader('cache-control', 'no-store');
	return redirect(res, linearAuthorizeUrl({ userId: user.id, nonce }));
});
