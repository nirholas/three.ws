// POST /api/agents/:id/sign — owner-only; signs an arbitrary message with the
// agent's server-held wallet. The key is encrypted at rest with JWT_SECRET-
// derived AES-GCM and decrypted in-memory just long enough to sign.
//
// Request:  { message: string, kind?: 'personal'|'eip191' (default personal) }
// Response: { address, signature }

import { z } from 'zod';
import { Wallet } from 'ethers';
import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { recoverAgentKey } from '../../_lib/agent-wallet.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';

const signBody = z.object({
	// EIP-191 personal messages — what wallets sign today. Keep the upper bound
	// generous for signed action JSON / SIWE-like payloads the agent emits.
	message: z.string().min(1).max(8192),
	kind: z.enum(['personal']).default('personal'),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'invalid_request', 'agent id required');

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	// Rate limit — signing decrypts a private key; keep the budget tight.
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many sign requests');

	const [row] = await sql`
		SELECT id, user_id, wallet_address, meta
		FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL
		LIMIT 1
	`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const encryptedKey = row.meta?.encrypted_wallet_key;
	if (!encryptedKey) return error(res, 409, 'no_wallet', 'agent has no server wallet');

	const body = parse(signBody, await readJson(req));

	let signature;
	try {
		const pkHex = await recoverAgentKey(encryptedKey);
		const wallet = new Wallet(pkHex);
		signature = await wallet.signMessage(body.message);
	} catch (e) {
		console.error('[agents/sign] signing failed', e);
		return error(res, 500, 'sign_failed', 'could not sign message');
	}

	return json(res, 200, { address: row.wallet_address, signature });
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer)  return { userId: bearer.userId };
	return null;
}
