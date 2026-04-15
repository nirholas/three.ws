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

const verifyBody = z.object({
	message:   z.string().min(64).max(4000),
	signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts');

	const body = parse(verifyBody, await readJson(req));

	// 1. Parse SIWE message.
	const fields = parseSiweMessage(body.message);
	if (!fields) return error(res, 400, 'invalid_message', 'malformed SIWE message');

	// 2. Domain + URI must match this deployment. Prevents signature replay from
	//    a phishing site using a valid nonce issued here.
	const appOrigin = env.APP_ORIGIN;
	const appHost   = new URL(appOrigin).host;
	if (fields.domain !== appHost) {
		return error(res, 400, 'invalid_domain', `domain must be ${appHost}`);
	}
	try {
		const u = new URL(fields.uri);
		if (u.origin !== appOrigin) return error(res, 400, 'invalid_uri', 'uri origin mismatch');
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
	const chainId   = fields.chainId || null;

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
		// Create a new passwordless user. Email is synthesized and placeholder —
		// user can set a real email + password later.
		const placeholderEmail = `wallet-${addrLower}@wallet.local`;
		const [user] = await sql`
			insert into users (email, display_name, wallet_address)
			values (${placeholderEmail}, ${shortAddr(claimed)}, ${addrLower})
			returning id
		`;
		userId = user.id;
		await sql`
			insert into user_wallets (user_id, address, chain_id, is_primary)
			values (${userId}, ${addrLower}, ${chainId}, true)
		`;
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
			case 'URI':              out.uri = val; break;
			case 'Version':          out.version = val; break;
			case 'Chain ID':         out.chainId = parseInt(val, 10) || null; break;
			case 'Nonce':            out.nonce = val; break;
			case 'Issued At':        out.issuedAt = val; break;
			case 'Expiration Time':  out.expirationTime = val; break;
			case 'Not Before':       out.notBefore = val; break;
			case 'Request ID':       out.requestId = val; break;
		}
	}
	if (!out.uri || !out.nonce || !out.version) return null;
	return out;
}

function shortAddr(addr) {
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
