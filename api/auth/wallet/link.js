// Link a wallet to an existing session-authenticated account via SIWE.

import { verifyMessage, getAddress } from 'ethers';
import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { parse } from '../../_lib/validate.js';
import { parseSiweMessage } from '../../_lib/siwe.js';

const bodySchema = z.object({
	message: z.string().min(64).max(4000),
	signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.walletLink(String(user.id));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts');

	const body = parse(bodySchema, await readJson(req));

	// 1. Parse the SIWE message.
	const fields = parseSiweMessage(body.message);
	if (!fields) return error(res, 400, 'invalid_message', 'malformed SIWE message');

	// 2. Domain + URI must match this deployment (replay protection).
	const appOrigin = env.APP_ORIGIN;
	const appHost = new URL(appOrigin).host;
	const vercelHost = process.env.VERCEL_URL || null;
	const allowedHosts = new Set([appHost, vercelHost].filter(Boolean));
	if (!allowedHosts.has(fields.domain)) {
		return error(res, 400, 'invalid_domain', `domain must be ${appHost}`);
	}
	try {
		const u = new URL(fields.uri);
		const allowedOrigins = new Set(
			[appOrigin, vercelHost ? `https://${vercelHost}` : null].filter(Boolean),
		);
		if (!allowedOrigins.has(u.origin))
			return error(res, 400, 'invalid_uri', 'uri origin mismatch');
	} catch {
		return error(res, 400, 'invalid_uri', 'uri not a valid URL');
	}

	// 3. Temporal checks.
	const now = Date.now();
	if (fields.expirationTime && Date.parse(fields.expirationTime) < now) {
		return error(res, 400, 'expired', 'message expired');
	}
	if (fields.notBefore && Date.parse(fields.notBefore) > now) {
		return error(res, 400, 'not_yet_valid', 'message not yet valid');
	}

	// 4. Nonce: must exist, be unconsumed, and not expired. Burn on success.
	const [nonceRow] = await sql`
		select nonce, expires_at, consumed_at
		from siwe_nonces
		where nonce = ${fields.nonce}
		limit 1
	`;
	if (!nonceRow) return error(res, 400, 'invalid_nonce', 'unknown nonce');
	if (nonceRow.consumed_at) return error(res, 400, 'nonce_reused', 'nonce already used');
	if (new Date(nonceRow.expires_at) < new Date()) {
		return error(res, 400, 'nonce_expired', 'nonce expired');
	}

	// 5. Verify signature recovers the claimed address.
	let recovered;
	try {
		recovered = verifyMessage(body.message, body.signature);
	} catch {
		return error(res, 401, 'invalid_signature', 'signature verification failed');
	}
	let claimed;
	try {
		claimed = getAddress(fields.address);
	} catch {
		return error(res, 400, 'invalid_address', 'address not checksummed correctly');
	}
	if (recovered.toLowerCase() !== claimed.toLowerCase()) {
		return error(res, 401, 'invalid_signature', 'signer does not match address');
	}

	// Burn the nonce (race-safe: reject if already consumed).
	const burned = await sql`
		update siwe_nonces
		set consumed_at = now(), address = ${claimed.toLowerCase()}
		where nonce = ${fields.nonce} and consumed_at is null
		returning nonce
	`;
	if (!burned[0]) return error(res, 400, 'nonce_reused', 'nonce already used');

	const addrLower = claimed.toLowerCase();
	const chainId = fields.chainId || null;

	// 6. Check if the address is already linked to any account.
	const [existing] = await sql`
		select user_id from user_wallets where address = ${addrLower} limit 1
	`;
	if (existing) {
		if (String(existing.user_id) !== String(user.id)) {
			return error(res, 409, 'wallet_taken', 'wallet already linked to another account');
		}
		// Already linked to this user — idempotent success.
		return json(res, 200, { ok: true, address: claimed, chainId });
	}

	// 7. Link the wallet to the current session user.
	await sql`
		insert into user_wallets (user_id, address, chain_id, is_primary)
		values (${user.id}, ${addrLower}, ${chainId}, false)
	`;

	return json(res, 200, { ok: true, address: claimed, chainId });
});
