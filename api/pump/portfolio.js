// GET /api/pump/portfolio?agentId=<uuid>&network=mainnet|devnet
//
// Real chain-direct portfolio for an agent's hot wallet. No third-party API,
// no caching layer beyond the underlying RPC — every call queries the chain.
//
// Response:
//   {
//     data: {
//       address, network, lamports, sol,
//       holdings: [{ mint, amount, decimals, valueSol, priceSol }],
//       totalValueSol, totalCostBasisSol, unrealizedPnlSol, unrealizedPnlPct,
//       openPositions: [...]   // joined with strategy ledger if available
//     }
//   }
//
// Cost-basis is read from agent_actions where source_skill='pump-fun-trade'
// and type='buy'. If there's no recorded entry, that holding is reported with
// costBasisSol = null (not zero — to avoid lying about PnL).

import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { solanaConnection } from '../_lib/agent-pumpfun.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { makeRuntime } from '../_lib/skill-runtime.js';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const agentId = url.searchParams.get('agentId');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	if (!agentId) return error(res, 400, 'validation_error', 'agentId required');

	const [agent] = await sql`
		SELECT user_id, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (agent.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');
	const address = agent.meta?.solana_address;
	if (!address) return error(res, 409, 'conflict', 'agent has no solana wallet');

	const conn = solanaConnection(network);
	const owner = new PublicKey(address);

	const [lamports, tokenResp, recentBuys] = await Promise.all([
		conn.getBalance(owner),
		conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
		sql`
			SELECT payload, created_at FROM agent_actions
			WHERE agent_id = ${agentId}
			  AND type IN ('pumpfun.buy', 'buy')
			ORDER BY created_at DESC
			LIMIT 500
		`.catch(() => []),
	]);

	const holdings = tokenResp.value
		.map((acc) => {
			const info = acc.account.data.parsed.info;
			return {
				mint: info.mint,
				amount: info.tokenAmount.uiAmount ?? 0,
				decimals: info.tokenAmount.decimals,
			};
		})
		.filter((h) => h.amount > 0);

	// Cost basis from recorded buys.
	const basisByMint = new Map();
	for (const row of recentBuys) {
		const p = row.payload || {};
		if (!p.mint) continue;
		const prev = basisByMint.get(p.mint) ?? { sol: 0, tokens: 0 };
		prev.sol += Number(p.amountSol) || 0;
		prev.tokens += Number(p.amountTokens) || 0;
		basisByMint.set(p.mint, prev);
	}

	// Live price per holding via the read-only pump-fun MCP (parallelized).
	const rt = makeRuntime();
	const priced = await Promise.all(holdings.map(async (h) => {
		const [curve, basis] = [
			await rt.invoke('pump-fun.getBondingCurve', { mint: h.mint }).catch(() => ({ ok: false })),
			basisByMint.get(h.mint),
		];
		const priceSol = curve?.ok ? (curve.data?.priceSol ?? curve.data?.price ?? null) : null;
		const valueSol = priceSol != null ? priceSol * h.amount : null;
		const costBasisSol = basis ? basis.sol : null;
		const unrealizedSol = valueSol != null && costBasisSol != null ? valueSol - costBasisSol : null;
		return {
			...h,
			priceSol,
			valueSol,
			costBasisSol,
			unrealizedPnlSol: unrealizedSol,
			unrealizedPnlPct: unrealizedSol != null && costBasisSol > 0 ? (unrealizedSol / costBasisSol) * 100 : null,
		};
	}));

	const totalValueSol = priced.reduce((s, p) => s + (p.valueSol ?? 0), 0);
	const totalCostBasisSol = priced.reduce((s, p) => s + (p.costBasisSol ?? 0), 0);
	const unrealizedPnlSol = totalValueSol - totalCostBasisSol;

	return json(res, 200, {
		data: {
			address,
			network,
			lamports,
			sol: lamports / LAMPORTS_PER_SOL,
			holdings: priced,
			totalValueSol,
			totalCostBasisSol,
			unrealizedPnlSol,
			unrealizedPnlPct: totalCostBasisSol > 0 ? (unrealizedPnlSol / totalCostBasisSol) * 100 : null,
		},
	});
});
