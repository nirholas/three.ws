// GET /api/agents/:id/pumpfun/portfolio?network=mainnet|devnet
//
// Aggregates pumpfun.buy / pumpfun.sell rows from agent_actions into per-mint
// positions. For each mint with a non-zero token balance, fetches the current
// SPL token amount from chain and quotes a sell-back to estimate live value.
//
// Response shape:
//   {
//     data: {
//       wallet,                 // agent's solana_address
//       network,
//       positions: [{
//         mint,
//         sol_in,               // total SOL spent buying
//         sol_out,              // total SOL received selling
//         realized_pnl_sol,     // sol_out - matched-cost portion (FIFO not modeled; = sol_out)
//         token_balance,        // base-unit string from chain
//         estimated_sol_value,  // sell-back quote in SOL (decimal), null if graduated/curve missing
//         unrealized_pnl_sol,   // estimated_sol_value - sol_in + sol_out
//         graduated,            // bondingCurve.complete
//       }],
//       totals: { sol_in, sol_out, estimated_value_sol, unrealized_pnl_sol },
//     }
//   }
//
// Pricing is best-effort — RPC failures per mint are surfaced as
// `error: <code>` on the position, not a 5xx for the whole call.

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { loadAgentForSigning, solanaConnection } from '../../_lib/agent-pumpfun.js';
import { sql } from '../../_lib/db.js';
import { PublicKey } from '@solana/web3.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

function lamportsToSol(bnLike) {
	if (!bnLike) return 0;
	const s = typeof bnLike === 'string' ? bnLike : bnLike.toString();
	return Number(s) / 1e9;
}

export default async function handler(req, res, id) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';

	const loaded = await loadAgentForSigning(id, auth.userId);
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair, meta } = loaded;

	const rows = await sql`
		SELECT type, payload
		FROM agent_actions
		WHERE agent_id = ${id}
			AND type IN ('pumpfun.buy', 'pumpfun.sell', 'pumpfun.launch')
			AND (payload->>'network') = ${network}
	`;

	// Aggregate per mint
	const byMint = new Map();
	for (const row of rows) {
		const p = row.payload || {};
		const mint = p.mint;
		if (!mint) continue;
		const e = byMint.get(mint) || { mint, sol_in: 0, sol_out: 0 };
		if (row.type === 'pumpfun.buy' || row.type === 'pumpfun.launch') {
			e.sol_in += Number(p.solAmount) || 0;
		} else if (row.type === 'pumpfun.sell') {
			e.sol_out += lamportsToSol(p.expectedSolLamports);
		}
		byMint.set(mint, e);
	}

	if (byMint.size === 0) {
		return json(res, 200, {
			data: {
				wallet: meta.solana_address,
				network,
				positions: [],
				totals: { sol_in: 0, sol_out: 0, estimated_value_sol: 0, unrealized_pnl_sol: 0 },
			},
		});
	}

	const conn = solanaConnection(network);
	const [{ PumpSdk, OnlinePumpSdk, getSellSolAmountFromTokenAmount }, splToken, BN] =
		await Promise.all([
			import('@pump-fun/pump-sdk'),
			import('@solana/spl-token'),
			import('bn.js').then((m) => m.default || m),
		]);
	const online = new OnlinePumpSdk(conn);
	let global;
	try {
		global = await online.fetchGlobal();
	} catch (err) {
		console.error('[pumpfun/portfolio] fetchGlobal failed', err);
		global = null;
	}

	const positions = await Promise.all(
		[...byMint.values()].map(async (pos) => {
			const out = { ...pos, token_balance: '0', estimated_sol_value: null, unrealized_pnl_sol: null, graduated: null };
			let mintPk;
			try {
				mintPk = new PublicKey(pos.mint);
			} catch {
				out.error = 'invalid_mint';
				return out;
			}

			try {
				const ata = await splToken.getAssociatedTokenAddress(mintPk, keypair.publicKey);
				const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
				out.token_balance = bal?.value?.amount || '0';
			} catch (err) {
				out.error = 'balance_fetch_failed';
			}

			if (out.token_balance === '0' || !global) {
				out.unrealized_pnl_sol = out.sol_out - out.sol_in;
				out.estimated_sol_value = 0;
				return out;
			}

			try {
				const state = await online.fetchSellState(mintPk, keypair.publicKey);
				out.graduated = !!state.bondingCurve.complete;
				if (out.graduated) {
					// AMM pricing path not implemented here; surface graduation
					out.estimated_sol_value = null;
					out.unrealized_pnl_sol = null;
					return out;
				}
				const expectedSol = getSellSolAmountFromTokenAmount({
					global,
					feeConfig: null,
					mintSupply: state.bondingCurve.tokenTotalSupply,
					bondingCurve: state.bondingCurve,
					amount: new BN(out.token_balance),
				});
				out.estimated_sol_value = lamportsToSol(expectedSol);
				out.unrealized_pnl_sol = out.estimated_sol_value + out.sol_out - out.sol_in;
			} catch (err) {
				out.error = out.error || 'curve_quote_failed';
			}

			return out;
		}),
	);

	const totals = positions.reduce(
		(acc, p) => {
			acc.sol_in += p.sol_in;
			acc.sol_out += p.sol_out;
			if (typeof p.estimated_sol_value === 'number') acc.estimated_value_sol += p.estimated_sol_value;
			return acc;
		},
		{ sol_in: 0, sol_out: 0, estimated_value_sol: 0 },
	);
	totals.unrealized_pnl_sol = totals.estimated_value_sol + totals.sol_out - totals.sol_in;

	return json(res, 200, {
		data: {
			wallet: meta.solana_address,
			network,
			positions,
			totals,
		},
	});
}
