// POST /scim/oauth/token: the OAuth 2.0 token endpoint for team SCIM
// provisioning (RFC 6749 section 4.4, client credentials grant).
//
// Microsoft Entra provisioning ("OAuth2 Client Credentials Grant" in the
// enterprise app's Provisioning blade) posts grant_type=client_credentials with
// the client id and secret, either in the form body or as HTTP Basic, and sends
// the access token it receives as the bearer on every /scim/v2 call until it
// expires. Credentials are created by the team owner in team settings
// (POST /api/teams/:id/enterprise/scim-clients); data layer and lifetimes:
// api/_lib/team-enterprise.js.
//
// Errors follow RFC 6749 section 5.2: invalid_client answers 401 with a Basic
// challenge, a malformed request answers 400. Failed authentications share the
// SCIM endpoint's per-IP failure budget.

import { wrap, readBody, json, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { issueScimAccessToken } from '../_lib/team-enterprise.js';

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };

function oauthError(res, status, code, description, headers = {}) {
	return json(res, status, { error: code, error_description: description }, { ...NO_STORE, ...headers });
}

/** RFC 6749 2.3.1: Basic credentials are form-urlencoded before base64. */
function basicCredentials(header) {
	const m = String(header || '').match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
	if (!m) return null;
	const decoded = Buffer.from(m[1], 'base64').toString('utf8');
	const colon = decoded.indexOf(':');
	if (colon < 0) return null;
	try {
		return {
			clientId: decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' ')),
			clientSecret: decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' ')),
		};
	} catch {
		return null;
	}
}

export default wrap(async (req, res) => {
	if (req.method !== 'POST') {
		return oauthError(res, 405, 'invalid_request', 'the token endpoint accepts POST only', { allow: 'POST' });
	}
	const ct = String(req.headers['content-type'] || '');
	if (!ct.includes('application/x-www-form-urlencoded')) {
		return oauthError(res, 400, 'invalid_request', 'send the token request as application/x-www-form-urlencoded');
	}
	const params = new URLSearchParams((await readBody(req, 8_192)).toString('utf8'));
	const grant = params.get('grant_type');
	if (!grant) return oauthError(res, 400, 'invalid_request', 'grant_type is required');
	if (grant !== 'client_credentials') {
		return oauthError(res, 400, 'unsupported_grant_type', 'only grant_type=client_credentials is supported');
	}

	const basic = basicCredentials(req.headers.authorization);
	const bodyId = params.get('client_id');
	const bodySecret = params.get('client_secret');
	if (basic && (bodySecret || (bodyId && bodyId !== basic.clientId))) {
		return oauthError(res, 400, 'invalid_request', 'send the client credentials either as HTTP Basic or in the body, not both');
	}
	const creds = basic || (bodyId && bodySecret ? { clientId: bodyId, clientSecret: bodySecret } : null);
	if (!creds) return oauthError(res, 400, 'invalid_request', 'client_id and client_secret are required');

	const issued = await issueScimAccessToken(creds);
	if (!issued) {
		const rl = await limits.scimAuthFail(clientIp(req));
		if (!rl.success) return rateLimited(res, rl, 'too many failed SCIM authentications');
		return oauthError(res, 401, 'invalid_client', 'the client id or secret is wrong, revoked or expired, or the team no longer holds its Microsoft tenant claim', {
			'www-authenticate': 'Basic realm="three.ws SCIM"',
		});
	}
	return json(res, 200, { access_token: issued.accessToken, token_type: 'Bearer', expires_in: issued.expiresIn }, NO_STORE);
});
