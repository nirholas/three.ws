// Link new wallets to authenticated user + list existing wallets.

import { verifyMessage, getAddress } from 'ethers';
import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { parse } from '../../_lib/validate.js';
import { parseSiweMessage } from '../../_lib/siwe.js';
import { env } from '../../_lib/env.js';
import { consumeNonce } from './_link-nonces.js';

const linkBody = z.object({
	message: z.string().min(64).max(4000),
	signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') {
		return handleListWallets(session.id, res);
	} else if (req.method === 'POST') {
		return handleLinkWallet(session.id, req, res);
	} else if (!method(req, res, ['GET', 'POST'])) return;
});

async function handleListWallets(userId, res) {
	const rows = await sql`
		select address, chain_id, created_at, is_primary
		from user_wallets
		where user_id = ${userId}
		order by created_at asc
	`;

	return json(res, 200, {
		wallets: rows.map((w) => ({
			address: w.address,
			chain_id: w.chain_id,
			created_at: w.created_at,
			is_primary: w.is_primary,
		})),
	});
}

async function handleLinkWallet(userId, req, res) {
	const body = parse(linkBody, await readJson(req));

	// 1. Parse SIWE message.
	const fields = parseSiweMessage(body.message);
	if (!fields) return error(res, 400, 'invalid_message', 'malformed SIWE message');

	// 2. Domain + URI must match this deployment.
	const appOrigin = env.APP_ORIGIN;
	const appHost = new URL(appOrigin).host;
	const vercelHost = process.env.VERCEL_URL || null;
	const isLocalDev =
		process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_ENV !== 'preview';
	const allowedHosts = new Set([appHost, vercelHost].filter(Boolean));
	const domainOk =
		allowedHosts.has(fields.domain) || (isLocalDev && /^localhost(:\d+)?$/.test(fields.domain));
	if (!domainOk) return error(res, 400, 'invalid_domain', `domain must be ${appHost}`);
	try {
		const u = new URL(fields.uri);
		const allowedOrigins = new Set(
			[appOrigin, vercelHost ? `https://${vercelHost}` : null].filter(Boolean),
		);
		const originOk =
			allowedOrigins.has(u.origin) ||
			(isLocalDev && /^https?:\/\/localhost(:\d+)?$/.test(u.origin));
		if (!originOk) return error(res, 400, 'invalid_uri', 'uri origin mismatch');
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

	// 4. Verify nonce was issued to this user and burn it.
	const nonceData = consumeNonce(fields.nonce, userId);
	if (!nonceData) {
		return error(res, 400, 'invalid_nonce', 'unknown, expired, or invalid nonce');
	}

	// 5. Verify signature recovers the address claimed in the message.
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

	const addrLower = claimed.toLowerCase();
	const chainId = fields.chainId || null;

	// 6. Check if this address is already linked to this user (idempotent).
	const existing = await sql`
		select id from user_wallets
		where user_id = ${userId} and address = ${addrLower}
	`;
	if (existing.length > 0) {
		return json(res, 200, { wallet: { address: claimed, chain_id: chainId } });
	}

	// 7. Check if this address is already linked to a different user.
	const conflict = await sql`
		select user_id from user_wallets
		where address = ${addrLower}
	`;
	if (conflict.length > 0) {
		return error(
			res,
			409,
			'address_in_use',
			'this address is already linked to another account',
		);
	}

	// 8. Insert the new wallet.
	await sql`
		insert into user_wallets (user_id, address, chain_id, is_primary)
		values (${userId}, ${addrLower}, ${chainId}, false)
	`;

	return json(res, 201, { wallet: { address: claimed, chain_id: chainId } });
}
