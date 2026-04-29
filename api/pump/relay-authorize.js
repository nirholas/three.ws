// POST /api/pump/relay-authorize
// Records a user's SIWS-signed authorization granting the server relayer
// pubkey delegated trading authority up to a cumulative SOL cap.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { parseSiwsMessage, verifySiwsSignature } from '../_lib/siws.js';
import { relayerPubkeyString } from '../_lib/pump-relayer.js';

const bodySchema = z.object({
	agent_id: z.string().uuid().optional(),
	user_wallet: z.string().min(32).max(44),
	max_sol: z.number().positive().max(100), // cap on cumulative spend (SOL)
	direction_filter: z.enum(['buy', 'sell', 'both']).default('both'),
	mint_filter: z.string().min(32).max(44).optional(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	ttl_hours: z.number().int().min(1).max(720).default(24),
	siws_message: z.string().min(20).max(2000),
	siws_signature: z.string().min(40).max(200),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	// Verify SIWS — message must reference the relayer pubkey + max_sol so
	// the user has signed the *exact* delegation terms.
	const fields = parseSiwsMessage(body.siws_message);
	if (!fields) return error(res, 400, 'invalid_siws', 'malformed SIWS message');
	if (fields.address !== body.user_wallet)
		return error(res, 403, 'siws_address_mismatch', 'SIWS address does not match user_wallet');
	const ok = verifySiwsSignature(body.siws_message, body.siws_signature, body.user_wallet);
	if (!ok) return error(res, 403, 'siws_signature_invalid', 'SIWS signature did not verify');

	const relayer = await relayerPubkeyString();
	if (!body.siws_message.includes(relayer))
		return error(
			res,
			400,
			'siws_missing_relayer',
			'SIWS statement must reference relayer pubkey',
		);
	if (!body.siws_message.includes(`max=${body.max_sol}`))
		return error(res, 400, 'siws_missing_cap', 'SIWS statement must include max=<SOL> cap');

	// Verify the wallet is linked to the user.
	const [walletRow] = await sql`
		select id from user_wallets
		where user_id=${user.id} and address=${body.user_wallet} and chain_type='solana'
		limit 1
	`;
	if (!walletRow) return error(res, 403, 'forbidden', 'wallet not linked to your account');

	const lamports = BigInt(Math.floor(body.max_sol * 1_000_000_000));
	const expiresAt = new Date(Date.now() + body.ttl_hours * 3600 * 1000).toISOString();

	const [row] = await sql`
		insert into pump_trade_delegations
			(user_id, agent_id, relayer_pubkey, user_wallet, max_sol_lamports,
			 direction_filter, mint_filter, network, expires_at, siws_signature)
		values
			(${user.id}, ${body.agent_id ?? null}, ${relayer}, ${body.user_wallet},
			 ${lamports.toString()}, ${body.direction_filter},
			 ${body.mint_filter ?? null}, ${body.network}, ${expiresAt}, ${body.siws_signature})
		returning id, expires_at, max_sol_lamports
	`;

	return json(res, 201, {
		ok: true,
		delegation_id: row.id,
		relayer_pubkey: relayer,
		expires_at: row.expires_at,
		max_sol_lamports: row.max_sol_lamports.toString(),
	});
});
