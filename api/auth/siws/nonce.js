// Issue a one-time nonce for Sign-In with Solana (CAIP-122 / SIP-0).
// Mirrors /api/auth/siwe/nonce.js — same burn-on-verify replay protection.

import { sql } from '../../_lib/db.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { randomToken, hmacSha256 } from '../../_lib/crypto.js';
import { env } from '../../_lib/env.js';

const NONCE_TTL_SEC = 5 * 60;
const CSRF_COOKIE = '__Host-csrf-siws';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many nonce requests');

	// 22 alphanumeric chars ≈ 131 bits of entropy.
	let nonce = '';
	while (nonce.length < 22) {
		nonce += randomToken(24).replace(/[^A-Za-z0-9]/g, '');
	}
	nonce = nonce.slice(0, 22);

	await sql`
		insert into siws_nonces (nonce, expires_at)
		values (${nonce}, now() + ${`${NONCE_TTL_SEC} seconds`}::interval)
	`;

	const csrfRaw = randomToken(32);
	const csrf = await hmacSha256(env.JWT_SECRET, `csrf-siws:${csrfRaw}`);
	res.setHeader(
		'set-cookie',
		`${CSRF_COOKIE}=${csrfRaw}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${NONCE_TTL_SEC}`,
	);

	const issuedAt = new Date().toISOString();
	const expiresAt = new Date(Date.now() + NONCE_TTL_SEC * 1000).toISOString();

	return json(res, 200, { nonce, issuedAt, expiresAt, csrf, ttl: NONCE_TTL_SEC });
});
