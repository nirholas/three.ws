// Issue a nonce + EIP-4361 (SIWE) message for wallet linking.
// Caller must already be authenticated; the resulting message ties the wallet
// signature to the active session's user.

import { z } from 'zod';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { parse } from '../../_lib/validate.js';
import { env } from '../../_lib/env.js';
import { issueNonce, NONCE_TTL_SEC } from './_link-nonces.js';

const nonceBody = z.object({
	address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	chainId: z.number().int().positive(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const { address, chainId } = parse(nonceBody, await readJson(req));

	const nonce = issueNonce(session.id);

	const appOrigin = env.APP_ORIGIN;
	const domain = new URL(appOrigin).host;
	const issuedAt = new Date().toISOString();
	const expirationTime = new Date(Date.now() + NONCE_TTL_SEC * 1000).toISOString();

	const message = [
		`${domain} wants you to sign in with your Ethereum account:`,
		address,
		``,
		`Link this wallet to three.ws account ${session.email}`,
		``,
		`URI: ${appOrigin}`,
		`Version: 1`,
		`Chain ID: ${chainId}`,
		`Nonce: ${nonce}`,
		`Issued At: ${issuedAt}`,
		`Expiration Time: ${expirationTime}`,
	].join('\n');

	return json(res, 200, { nonce, message, ttl: NONCE_TTL_SEC });
});
