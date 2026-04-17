// Link new wallets to authenticated user + list existing wallets.

import { verifyMessage, getAddress } from 'ethers';
import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { parse } from '../../_lib/validate.js';
import { consumeNonce } from './_link-nonces.js';

const linkBody = z.object({
	address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
	message: z.string().min(64).max(4000),
	signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
	nonce: z.string().min(8).max(32),
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

	// 1. Verify nonce exists and is not expired.
	const nonceData = consumeNonce(body.nonce, userId);
	if (!nonceData) {
		return error(res, 400, 'invalid_nonce', 'unknown, expired, or invalid nonce');
	}

	// 2. Verify signature recovers the claimed address.
	let recovered;
	try {
		recovered = verifyMessage(body.message, body.signature);
	} catch {
		return error(res, 401, 'invalid_signature', 'signature verification failed');
	}

	let claimed;
	try {
		claimed = getAddress(body.address);
	} catch {
		return error(res, 400, 'invalid_address', 'address not checksummed correctly');
	}

	if (recovered.toLowerCase() !== claimed.toLowerCase()) {
		return error(res, 401, 'invalid_signature', 'signer does not match address');
	}

	const addrLower = claimed.toLowerCase();

	// 3. Check if this address is already linked to this user (idempotent).
	const existing = await sql`
		select id from user_wallets
		where user_id = ${userId} and address = ${addrLower}
	`;
	if (existing.length > 0) {
		return json(res, 200, { wallet: { address: claimed, chain_id: null } });
	}

	// 4. Check if this address is already linked to a different user.
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

	// 5. Insert the new wallet.
	await sql`
		insert into user_wallets (user_id, address, chain_id, is_primary)
		values (${userId}, ${addrLower}, null, false)
	`;

	return json(res, 201, { wallet: { address: claimed, chain_id: null } });
}
