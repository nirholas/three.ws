// GET /api/enterprise/admin-consent-config
//
// What the /enterprise/admin-consent page needs to build the tenant-wide admin
// consent link: the public client id of the multitenant Entra app, the redirect
// URI Microsoft sends the administrator back to, and the delegated scopes the
// app asks for (the same SCOPES the sign-in flow requests, so the page cannot
// drift from what members are shown at sign-in). The client id is public by
// design (it is in every authorize URL); the secret is never read here.

import { cors, method, wrap, error, json, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import { entraConfig, SCOPES } from '../_lib/entra-oidc.js';

export const CONSENT_PATH = '/enterprise/admin-consent';

export function adminConsentConfig(origin = env.APP_ORIGIN) {
	const cfg = entraConfig();
	if (!cfg) return null;
	return {
		clientId: cfg.clientId,
		redirectUri: `${origin}${CONSENT_PATH}`,
		scopes: SCOPES.split(' '),
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'too many requests');

	const config = adminConsentConfig();
	if (!config) {
		return error(res, 503, 'not_configured', 'Microsoft sign-in is not configured on this deployment, so there is no app to consent to yet.');
	}
	res.setHeader('cache-control', 'public, max-age=300');
	return json(res, 200, config);
});
