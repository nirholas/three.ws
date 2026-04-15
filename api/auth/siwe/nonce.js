// Issue a one-time nonce for Sign-In with Ethereum (EIP-4361).
// The client includes this nonce in the message they sign; /verify burns it.

import { sql } from '../../_lib/db.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { randomToken } from '../../_lib/crypto.js';

const NONCE_TTL_SEC = 5 * 60;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many nonce requests');

	// EIP-4361 requires ≥8 alphanumeric chars. Strip base64url's - and _.
	let nonce = '';
	while (nonce.length < 16) {
		nonce += randomToken(24).replace(/[^A-Za-z0-9]/g, '');
	}
	nonce = nonce.slice(0, 16);

	await sql`
		insert into siwe_nonces (nonce, expires_at)
		values (${nonce}, now() + ${`${NONCE_TTL_SEC} seconds`}::interval)
	`;

	return json(res, 200, { nonce, ttl: NONCE_TTL_SEC });
});
