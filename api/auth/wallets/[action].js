// Wallet endpoints — dispatched by req.query.action.
//   GET    /api/auth/wallets                → handleListWallets   (action undefined)
//   POST   /api/auth/wallets                → handleLinkWallet    (action undefined)
//   POST   /api/auth/wallets/nonce          → handleNonce         (action === 'nonce')
//   DELETE /api/auth/wallets/<address>      → handleUnlinkWallet  (action === <address>)
//
// Dispatcher convention: undefined action → index (GET/POST), the literal
// "nonce" → nonce issuance, and anything else is treated as an address for
// DELETE. _link-nonces.js remains a separate helper (underscore-prefixed,
// not file-routed by Vercel).

import { verifyMessage, getAddress } from 'ethers';
import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { parse } from '../../_lib/validate.js';
import { parseSiweMessage } from '../../_lib/siwe.js';
import { env } from '../../_lib/env.js';
import { issueNonce, consumeNonce, NONCE_TTL_SEC } from './_link-nonces.js';

const linkBody = z.object({
	message: z.string().min(64).max(4000),
	signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

const nonceBody = z.object({
	address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	chainId: z.number().int().positive(),
});

export default wrap(async (req, res) => {
	const action = req.query?.action;

	// /api/auth/wallets — list (GET) or link (POST)
	if (action === undefined || action === '' || action === null) {
		return handleIndex(req, res);
	}

	// /api/auth/wallets/nonce — issue link nonce
	if (action === 'nonce') {
		return handleNonce(req, res);
	}

	// /api/auth/wallets/<address> — unlink wallet (action carries the address)
	return handleUnlinkWallet(req, res, action);
});

// ── Index: list (GET) and link (POST) ──────────────────────────────────────
// Link new wallets to authenticated user + list existing wallets.

async function handleIndex(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') {
		return handleListWallets(session.id, res);
	} else if (req.method === 'POST') {
		return handleLinkWallet(session.id, req, res);
	} else if (!method(req, res, ['GET', 'POST'])) return;
}

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

// ── Nonce ──────────────────────────────────────────────────────────────────
// Issue a nonce + EIP-4361 (SIWE) message for wallet linking.
// Caller must already be authenticated; the resulting message ties the wallet
// signature to the active session's user.

async function handleNonce(req, res) {
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
}

// ── Unlink ─────────────────────────────────────────────────────────────────
// Unlink a wallet from authenticated user.
// Refuse if it's the only wallet AND user has no email+password.

async function handleUnlinkWallet(req, res, address) {
	if (cors(req, res, { methods: 'DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['DELETE'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	if (!address) return error(res, 400, 'missing_address', 'address required');

	const addrLower = address.toLowerCase();

	// 1. Check that this wallet belongs to the user.
	const [wallet] = await sql`
		select id from user_wallets
		where user_id = ${session.id} and address = ${addrLower}
		limit 1
	`;
	if (!wallet) return error(res, 404, 'not_found', 'wallet not found');

	// 2. Check if this is the only wallet.
	const [count] = await sql`
		select count(*) as n from user_wallets
		where user_id = ${session.id}
	`;
	const walletCount = count.n;

	if (walletCount === 1) {
		// 3. If only wallet, check if user has password-based auth.
		const [user] = await sql`
			select password_hash from users where id = ${session.id} limit 1
		`;
		if (!user.password_hash) {
			return error(
				res,
				400,
				'cannot_remove_last_wallet',
				'cannot remove the last wallet if account has no password',
			);
		}
	}

	// 4. Delete the wallet.
	await sql`delete from user_wallets where user_id = ${session.id} and address = ${addrLower}`;

	return json(res, 200, { removed: true });
}
