// Issue a nonce for wallet linking (authenticated user only).
// Different from login nonce: caller is already authenticated.

import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { issueNonce, NONCE_TTL_SEC } from './_link-nonces.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const nonce = issueNonce(session.id);

	// Generate SIWE-like message for signing.
	const message = [
		`three.ws wants you to sign in with your Ethereum account:`,
		`Address to link (will be filled by wallet):`,
		``,
		`Link this wallet to three.ws account ${session.email}`,
		``,
		`URI: ${process.env.APP_ORIGIN || 'https://three.ws/'}`,
		`Version: 1`,
		`Chain ID: (will be set by wallet)`,
		`Nonce: ${nonce}`,
		`Issued At: ${new Date().toISOString()}`,
		`Expiration Time: ${new Date(Date.now() + NONCE_TTL_SEC * 1000).toISOString()}`,
	].join('\n');

	return json(res, 200, { nonce, message, ttl: NONCE_TTL_SEC });
});
