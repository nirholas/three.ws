// Verify an EIP-4361 (Sign-In with Ethereum) message + signature.
// On success: create or link a user, issue a browser session cookie.

import { verifyMessage, getAddress } from 'ethers';
import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { createSession, sessionCookie, destroySession } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { parse } from '../../_lib/validate.js';
import { hmacSha256, constantTimeEquals } from '../../_lib/crypto.js';
import { sendWelcomeEmail } from '../../_lib/email.js';

const verifyBody = z.object({
	message: z.string().min(64).max(4000),
	signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

const CSRF_COOKIE = '__Host-csrf-siwe';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// Verify CSRF token before processing the request.
	const csrfHeader = req.headers['x-csrf-token'];
	if (!csrfHeader) return error(res, 403, 'invalid_request', 'CSRF check failed');

	const cookie = req.headers.cookie || '';
	const csrfMatch = cookie.match(/(?:^|;\s*)__Host-csrf-siwe=([^;]+)/);
	const csrfCookie = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;
	if (!csrfCookie) return error(res, 403, 'invalid_request', 'CSRF check failed');

	const expectedCsrf = await hmacSha256(env.JWT_SECRET, `csrf-siwe:${csrfCookie}`);
	if (!constantTimeEquals(expectedCsrf, String(csrfHeader))) {
		return error(res, 403, 'invalid_request', 'CSRF check failed');
	}

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts');

	const body = parse(verifyBody, await readJson(req));

	// 1. Parse SIWE message.
	const fields = parseSiweMessage(body.message);
	if (!fields) return error(res, 400, 'invalid_message', 'malformed SIWE message');

	// 2. Domain + URI must match this deployment. Prevents signature replay from
	//    a phishing site using a valid nonce issued here.
	//    VERCEL_URL is the deployment-specific hostname Vercel injects automatically
	//    (e.g. "three-ws-git-main-moomsi.vercel.app") — allows preview deployments.
	const appOrigin = env.APP_ORIGIN;
	const appHost = new URL(appOrigin).host;
	const vercelHost = process.env.VERCEL_URL || null;
	const isLocalDev =
		process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_ENV !== 'preview';
	const allowedHosts = new Set([appHost, vercelHost].filter(Boolean));
	// In local dev, accept any localhost domain so vercel dev works without
	// overriding PUBLIC_APP_ORIGIN.
	const domainOk =
		allowedHosts.has(fields.domain) || (isLocalDev && /^localhost(:\d+)?$/.test(fields.domain));
	if (!domainOk) {
		return error(res, 400, 'invalid_domain', `domain must be ${appHost}`);
	}
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

	// 4. Nonce must exist, be unconsumed, and not expired. Burn on success.
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

	// Burn the nonce (idempotent race-safe: if already consumed, reject).
	const burned = await sql`
		update siwe_nonces
		set consumed_at = now(), address = ${claimed.toLowerCase()}
		where nonce = ${fields.nonce} and consumed_at is null
		returning nonce
	`;
	if (!burned[0]) return error(res, 400, 'nonce_reused', 'nonce already used');

	// 6. Find or create user. Wallet address is the primary key into the user record.
	const addrLower = claimed.toLowerCase();
	const chainId = fields.chainId || null;

	let [wallet] = await sql`
		select user_id from user_wallets where address = ${addrLower} limit 1
	`;
	let userId;

	if (wallet) {
		userId = wallet.user_id;
		await sql`
			update user_wallets
			set last_used_at = now(), chain_id = coalesce(${chainId}, chain_id)
			where address = ${addrLower}
		`;
	} else {
		// Fall back to users.wallet_address — older rows may have been created
		// before user_wallets existed, or by a different flow that only set the
		// users column. Reconcile by backfilling user_wallets.
		const placeholderEmail = `wallet-${addrLower}@wallet.local`;
		// Include soft-deleted rows so we don't collide on the email unique
		// constraint. Re-signing-in with the same wallet restores the account —
		// the placeholder email is wallet-derived, so SIWE proves ownership.
		const [existingUser] = await sql`
			select id, deleted_at from users
			where wallet_address = ${addrLower} or email = ${placeholderEmail}
			limit 1
		`;

		if (existingUser) {
			userId = existingUser.id;
			await sql`
				update users
				set wallet_address = ${addrLower},
					deleted_at = null
				where id = ${userId}
					and (wallet_address is distinct from ${addrLower} or deleted_at is not null)
			`;
			await sql`
				insert into user_wallets (user_id, address, chain_id, is_primary)
				values (${userId}, ${addrLower}, ${chainId}, true)
				on conflict (address) do update
					set last_used_at = now(),
						chain_id = coalesce(${chainId}, user_wallets.chain_id)
			`;
		} else {
			// Create a new passwordless user. Email is synthesized and placeholder —
			// user can set a real email + password later. ON CONFLICT guards
			// against two concurrent verifies racing past the lookup above.
			const [user] = await sql`
				insert into users (email, display_name, wallet_address)
				values (${placeholderEmail}, ${shortAddr(claimed)}, ${addrLower})
				on conflict (email) do update
					set wallet_address = ${addrLower},
						deleted_at = null
				returning id, (xmax = 0) as inserted
			`;
			userId = user.id;
			await sql`
				insert into user_wallets (user_id, address, chain_id, is_primary)
				values (${userId}, ${addrLower}, ${chainId}, true)
				on conflict (address) do update
					set last_used_at = now(),
						chain_id = coalesce(${chainId}, user_wallets.chain_id)
			`;
			if (user.inserted) {
				queueMicrotask(() =>
					sendWelcomeEmail({ to: placeholderEmail, displayName: shortAddr(claimed) }),
				);
			}
		}
	}

	// 7. Issue session.
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
		wallet: { address: claimed, chain_id: chainId },
	});
});

// ─── EIP-4361 parser ────────────────────────────────────────────────────────
// Minimal hand-rolled parser. We only need the fields we actually verify.
function parseSiweMessage(msg) {
	const lines = msg.split('\n');
	if (lines.length < 6) return null;

	const header = lines[0];
	const m = /^([^\s]+) wants you to sign in with your Ethereum account:$/.exec(header);
	if (!m) return null;
	const domain = m[1];

	const address = (lines[1] || '').trim();
	if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;

	const out = { domain, address };
	for (let i = 2; i < lines.length; i++) {
		const line = lines[i];
		const kv = /^([A-Za-z -]+):\s*(.*)$/.exec(line);
		if (!kv) continue;
		const key = kv[1].trim();
		const val = kv[2].trim();
		switch (key) {
			case 'URI':
				out.uri = val;
				break;
			case 'Version':
				out.version = val;
				break;
			case 'Chain ID':
				out.chainId = parseInt(val, 10) || null;
				break;
			case 'Nonce':
				out.nonce = val;
				break;
			case 'Issued At':
				out.issuedAt = val;
				break;
			case 'Expiration Time':
				out.expirationTime = val;
				break;
			case 'Not Before':
				out.notBefore = val;
				break;
			case 'Request ID':
				out.requestId = val;
				break;
		}
	}
	if (!out.uri || !out.nonce || !out.version) return null;
	return out;
}

function shortAddr(addr) {
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
