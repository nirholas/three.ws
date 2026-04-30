// Consolidated wallet link/unlink endpoints.

import { verifyMessage, getAddress } from 'ethers';
import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { parse } from '../../_lib/validate.js';
import { parseSiweMessage } from '../../_lib/siwe.js';

// ── link ──────────────────────────────────────────────────────────────────────

const linkSchema = z.object({ message: z.string().min(64).max(4000), signature: z.string().regex(/^0x[a-fA-F0-9]+$/) });

async function handleLink(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.walletLink(String(user.id));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts');

	const body = parse(linkSchema, await readJson(req));
	const fields = parseSiweMessage(body.message);
	if (!fields) return error(res, 400, 'invalid_message', 'malformed SIWE message');

	const appOrigin = env.APP_ORIGIN;
	const appHost = new URL(appOrigin).host;
	const vercelHost = process.env.VERCEL_URL || null;
	const allowedHosts = new Set([appHost, vercelHost].filter(Boolean));
	if (!allowedHosts.has(fields.domain)) return error(res, 400, 'invalid_domain', `domain must be ${appHost}`);

	try {
		const u = new URL(fields.uri);
		const allowedOrigins = new Set([appOrigin, vercelHost ? `https://${vercelHost}` : null].filter(Boolean));
		if (!allowedOrigins.has(u.origin)) return error(res, 400, 'invalid_uri', 'uri origin mismatch');
	} catch { return error(res, 400, 'invalid_uri', 'uri not a valid URL'); }

	const now = Date.now();
	if (fields.expirationTime && Date.parse(fields.expirationTime) < now) return error(res, 400, 'expired', 'message expired');
	if (fields.notBefore && Date.parse(fields.notBefore) > now) return error(res, 400, 'not_yet_valid', 'message not yet valid');

	const [nonceRow] = await sql`select nonce, expires_at, consumed_at from siwe_nonces where nonce = ${fields.nonce} limit 1`;
	if (!nonceRow) return error(res, 400, 'invalid_nonce', 'unknown nonce');
	if (nonceRow.consumed_at) return error(res, 400, 'nonce_reused', 'nonce already used');
	if (new Date(nonceRow.expires_at) < new Date()) return error(res, 400, 'nonce_expired', 'nonce expired');

	let recovered;
	try { recovered = verifyMessage(body.message, body.signature); } catch { return error(res, 401, 'invalid_signature', 'signature verification failed'); }
	let claimed;
	try { claimed = getAddress(fields.address); } catch { return error(res, 400, 'invalid_address', 'address not checksummed correctly'); }
	if (recovered.toLowerCase() !== claimed.toLowerCase()) return error(res, 401, 'invalid_signature', 'signer does not match address');

	const burned = await sql`update siwe_nonces set consumed_at = now(), address = ${claimed.toLowerCase()} where nonce = ${fields.nonce} and consumed_at is null returning nonce`;
	if (!burned[0]) return error(res, 400, 'nonce_reused', 'nonce already used');

	const addrLower = claimed.toLowerCase();
	const [existing] = await sql`select user_id from user_wallets where address = ${addrLower} limit 1`;
	if (existing) {
		if (String(existing.user_id) !== String(user.id)) return error(res, 409, 'wallet_taken', 'wallet already linked to another account');
		return json(res, 200, { ok: true, address: claimed, chainId: fields.chainId || null });
	}

	await sql`insert into user_wallets (user_id, address, chain_id, is_primary) values (${user.id}, ${addrLower}, ${fields.chainId || null}, false)`;
	return json(res, 200, { ok: true, address: claimed, chainId: fields.chainId || null });
}

// ── unlink ────────────────────────────────────────────────────────────────────

const unlinkSchema = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });

async function handleUnlink(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts');

	const body = parse(unlinkSchema, await readJson(req));
	const addrLower = body.address.toLowerCase();

	const [walletRow] = await sql`select address, is_primary from user_wallets where user_id = ${user.id} and address = ${addrLower} limit 1`;
	if (!walletRow) return error(res, 404, 'not_found', 'wallet not linked to your account');

	const [userRow] = await sql`select password_hash from users where id = ${user.id} limit 1`;
	if (!userRow?.password_hash) {
		const [{ count }] = await sql`select count(*)::int as count from user_wallets where user_id = ${user.id}`;
		if (count <= 1) return error(res, 409, 'last_auth_method', 'cannot remove your only authentication method');
	}

	if (walletRow.is_primary) {
		await sql`update user_wallets set is_primary = true where user_id = ${user.id} and address != ${addrLower} and address = (select address from user_wallets where user_id = ${user.id} and address != ${addrLower} order by last_used_at desc nulls last limit 1)`;
	}

	await sql`delete from user_wallets where user_id = ${user.id} and address = ${addrLower}`;
	return json(res, 200, { ok: true });
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = { link: handleLink, unlink: handleUnlink };

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown wallet action: ${action}`);
	return fn(req, res);
});
