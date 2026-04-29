// POST /api/pump/strategy-close-all
//
// Body:
//   agentId: string                       required
//   network: 'mainnet' | 'devnet'         default 'mainnet'
//   mints?:  string[]                     optional: only close these mints
//   simulate?: boolean                    dry-run; emit intended sells
//
// Loads the agent's hot wallet, enumerates SPL holdings, and sells each
// position 100% via pump-fun-trade.sellToken. Returns per-mint result.

import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { makeRuntime } from '../_lib/skill-runtime.js';
import { loadWallet } from '../_lib/solana-wallet.js';

const RPC = {
	mainnet: process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com',
	devnet: process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com',
};

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	if (!body?.agentId) return error(res, 400, 'validation_error', 'agentId required');
	const network = body.network === 'devnet' ? 'devnet' : 'mainnet';

	const [row] = await sql`
		SELECT user_id, meta FROM agent_identities
		WHERE id = ${body.agentId} AND deleted_at IS NULL
	`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');
	const enc = row.meta?.encrypted_solana_secret;
	if (!enc) return error(res, 409, 'conflict', 'agent has no solana wallet');

	const wallet = await loadWallet(enc);
	const rt = makeRuntime({
		wallet,
		agentId: body.agentId,
		signerAddress: wallet.publicKey.toBase58(),
		configOverrides: {
			'pump-fun-trade': { rpc: RPC[network] },
			'solana-wallet': { rpc: RPC[network] },
		},
	});

	const { closeAllPositions } = await import('../../examples/skills/pump-fun-strategy/handlers.js');
	const result = await closeAllPositions(
		{ mints: body.mints, simulate: !!body.simulate },
		{ skills: { invoke: rt.invoke }, wallet, memory: { note: () => {} } },
	);
	if (!result.ok) return error(res, 400, 'sell_failed', result.error);
	return json(res, 200, { data: result.data });
});
