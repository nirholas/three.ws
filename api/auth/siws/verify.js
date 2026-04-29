// Verify a Sign-In with Solana (CAIP-122 / SIP-0) message + ed25519 signature.
// On success: create or link a user, issue a browser session cookie.
// Mirrors /api/auth/siwe/verify.js — same session/user logic, different sig check.

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { createSession, sessionCookie, destroySession } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { parse } from '../../_lib/validate.js';
import { hmacSha256, constantTimeEquals } from '../../_lib/crypto.js';
import { parseSiwsMessage, verifySiwsSignature } from '../../_lib/siws.js';
import { sendWelcomeEmail } from '../../_lib/email.js';

const verifyBody = z.object({
	message: z.string().min(32).max(4000),
	// base58 (Phantom) or base64 (other wallets) encoded 64-byte ed25519 signature
	signature: z.string().min(1).max(256),
});

const CSRF_COOKIE = '__Host-csrf-siws';
const ALLOWED_CHAIN_IDS = new Set(['mainnet', 'devnet', 'testnet']);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// CSRF check.
	const csrfHeader = req.headers['x-csrf-token'];
	if (!csrfHeader) return error(res, 403, 'invalid_request', 'CSRF check failed');

	const cookie = req.headers.cookie || '';
	const csrfMatch = cookie.match(/(?:^|;\s*)__Host-csrf-siws=([^;]+)/);
	const csrfCookie = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;
	if (!csrfCookie) return error(res, 403, 'invalid_request', 'CSRF check failed');

	const expectedCsrf = await hmacSha256(env.JWT_SECRET, `csrf-siws:${csrfCookie}`);
	if (!constantTimeEquals(expectedCsrf, String(csrfHeader))) {
		return error(res, 403, 'invalid_request', 'CSRF check failed');
	}

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts');

	const body = parse(verifyBody, await readJson(req));

	// 1. Parse SIWS message.
	const fields = parseSiwsMessage(body.message);
	if (!fields) return error(res, 400, 'invalid_message', 'malformed SIWS message');

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

	// 3. Chain ID must be a known Solana network.
	if (fields.chainId && !ALLOWED_CHAIN_IDS.has(fields.chainId)) {
		return error(res, 400, 'invalid_chain', 'unknown Solana chain ID');
	}

	// 4. Temporal checks.
	const now = Date.now();
	if (fields.expirationTime && Date.parse(fields.expirationTime) < now) {
		return error(res, 400, 'expired', 'message expired');
	}
	if (fields.notBefore && Date.parse(fields.notBefore) > now) {
		return error(res, 400, 'not_yet_valid', 'message not yet valid');
	}

	// 5. Nonce must exist, be unconsumed, and not expired.
	const [nonceRow] = await sql`
		select nonce, expires_at, consumed_at
		from siws_nonces
		where nonce = ${fields.nonce}
		limit 1
	`;
	if (!nonceRow) return error(res, 400, 'invalid_nonce', 'unknown nonce');
	if (nonceRow.consumed_at) return error(res, 400, 'nonce_reused', 'nonce already used');
	if (new Date(nonceRow.expires_at) < new Date()) {
		return error(res, 400, 'nonce_expired', 'nonce expired');
	}

	// 6. Verify ed25519 signature.
	let valid;
	try {
		valid = verifySiwsSignature(body.message, body.signature, fields.address);
	} catch {
		return error(res, 401, 'invalid_signature', 'signature verification failed');
	}
	if (!valid) return error(res, 401, 'invalid_signature', 'signer does not match address');

	// Burn the nonce (race-safe via consumed_at guard).
	const burned = await sql`
		update siws_nonces
		set consumed_at = now(), address = ${fields.address}
		where nonce = ${fields.nonce} and consumed_at is null
		returning nonce
	`;
	if (!burned[0]) return error(res, 400, 'nonce_reused', 'nonce already used');

	// 7. Find or create user. Solana address is stored as-is (base58, no lowercasing needed).
	const addr = fields.address;

	let [wallet] = await sql`
		select user_id from user_wallets where address = ${addr} limit 1
	`;
	let userId;

	if (wallet) {
		userId = wallet.user_id;
		await sql`
			update user_wallets
			set last_used_at = now()
			where address = ${addr}
		`;
	} else {
		const placeholderEmail = `sol-${addr.slice(0, 8).toLowerCase()}@wallet.local`;
		const [existingUser] = await sql`
			select id, deleted_at from users
			where email = ${placeholderEmail}
			limit 1
		`;

		if (existingUser) {
			if (existingUser.deleted_at) {
				return error(
					res,
					403,
					'account_deleted',
					'this wallet is linked to a deleted account',
				);
			}
			userId = existingUser.id;
			await sql`
				insert into user_wallets (user_id, address, chain_type, is_primary)
				values (${userId}, ${addr}, 'solana', true)
				on conflict (address) do update
					set last_used_at = now()
			`;
		} else {
			const [user] = await sql`
				insert into users (email, display_name)
				values (${placeholderEmail}, ${shortAddr(addr)})
				on conflict (email) do update set email = excluded.email
				returning id, (xmax = 0) as inserted
			`;
			userId = user.id;
			await sql`
				insert into user_wallets (user_id, address, chain_type, is_primary)
				values (${userId}, ${addr}, 'solana', true)
				on conflict (address) do update
					set last_used_at = now()
			`;
			if (user.inserted) {
				queueMicrotask(() =>
					sendWelcomeEmail({ to: placeholderEmail, displayName: shortAddr(addr) }),
				);
			}
		}
	}

	// 8. Issue session.
	await destroySession(req);
	const token = await createSession({
		userId,
		userAgent: req.headers['user-agent'],
		ip,
	});
	res.setHeader('set-cookie', sessionCookie(token));

	const [userRow] = await sql`
		select id, email, display_name, plan, avatar_url, created_at
		from users where id = ${userId} limit 1
	`;

	return json(res, 200, {
		user: userRow,
		wallet: { address: addr, chain_type: 'solana', chain_id: fields.chainId || 'mainnet' },
	});
});

function shortAddr(addr) {
	return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
