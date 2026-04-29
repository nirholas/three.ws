// POST /api/pump/relay-trade
//
// Executes a pump.fun buy/sell using the server-held relayer keypair on
// behalf of a user with an active delegation. Auth: session OR bearer (so
// MCP / wallet-less clients can drive trades). Spend cap is enforced via
// SELECT … FOR UPDATE on pump_trade_delegations.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { getConnection, getPumpSdk, getAmmPoolState, solanaPubkey } from '../_lib/pump.js';
import { loadRelayer } from '../_lib/pump-relayer.js';

const bodySchema = z.object({
	delegation_id: z.string().uuid(),
	mint: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	direction: z.enum(['buy', 'sell']),
	sol: z.number().positive().max(50).optional(),
	tokens: z.string().regex(/^\d+$/).optional(),
	slippage_bps: z.number().int().min(0).max(5000).default(100),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'auth required');
	const userId = session?.id ?? bearer.userId;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	if (body.direction === 'buy' && !body.sol)
		return error(res, 400, 'validation_error', 'sol required for buy');
	if (body.direction === 'sell' && !body.tokens)
		return error(res, 400, 'validation_error', 'tokens required for sell');

	const relayer = await loadRelayer().catch((e) => {
		throw e;
	});

	// Reserve cap atomically. We bump spent_sol_lamports up-front; if the tx
	// then fails on-chain, we refund in the catch path below.
	const lamports = body.direction === 'buy' ? BigInt(Math.floor(body.sol * 1_000_000_000)) : 0n;

	// Atomic reservation: single UPDATE that advances spent_sol_lamports only
	// if every constraint passes. Returns the delegation row on success or
	// nothing if any check (cap, expiry, filters) fails.
	const [delegation] = await sql`
		update pump_trade_delegations
		set spent_sol_lamports = spent_sol_lamports + ${lamports.toString()}
		where id = ${body.delegation_id}
		  and user_id = ${userId}
		  and revoked_at is null
		  and expires_at > now()
		  and network = ${body.network}
		  and (direction_filter = 'both' or direction_filter = ${body.direction})
		  and (mint_filter is null or mint_filter = ${body.mint})
		  and spent_sol_lamports + ${lamports.toString()} <= max_sol_lamports
		returning id, max_sol_lamports, spent_sol_lamports
	`;
	if (!delegation) {
		// Diagnose which constraint failed for a clearer error.
		const [d] = await sql`
			select revoked_at, expires_at, network, direction_filter, mint_filter,
			       spent_sol_lamports, max_sol_lamports
			from pump_trade_delegations where id=${body.delegation_id} and user_id=${userId}
		`;
		if (!d) return error(res, 404, 'not_found', 'delegation not found');
		if (d.revoked_at) return error(res, 403, 'revoked', 'delegation revoked');
		if (new Date(d.expires_at) < new Date())
			return error(res, 403, 'expired', 'delegation expired');
		if (d.network !== body.network)
			return error(res, 400, 'network_mismatch', 'network mismatch');
		if (d.direction_filter !== 'both' && d.direction_filter !== body.direction)
			return error(res, 403, 'direction_blocked', 'direction not permitted');
		if (d.mint_filter && d.mint_filter !== body.mint)
			return error(res, 403, 'mint_blocked', 'mint not permitted');
		return error(res, 403, 'cap_exceeded', 'spend cap exceeded');
	}

	let sig, route;
	try {
		const result = await executeTrade({ body, relayer });
		sig = result.signature;
		route = result.route;
	} catch (e) {
		// Refund the reservation by subtracting `lamports` from current value.
		// Done as a relative update to avoid clobbering concurrent reservations.
		if (lamports > 0n) {
			await sql`
				update pump_trade_delegations
				set spent_sol_lamports = greatest(0, spent_sol_lamports - ${lamports.toString()})
				where id=${delegation.id}
			`;
		}
		return error(res, e.status || 502, e.code || 'pump_sdk_error', e.message || 'trade failed');
	}

	await sql`
		insert into pump_relay_trades
			(delegation_id, direction, mint, network, route, sol_lamports, token_amount, tx_signature)
		values
			(${delegation.id}, ${body.direction}, ${body.mint}, ${body.network}, ${route},
			 ${body.direction === 'buy' ? lamports.toString() : null},
			 ${body.direction === 'sell' ? body.tokens : null},
			 ${sig})
		on conflict (tx_signature, network) do nothing
	`;

	return json(res, 200, {
		ok: true,
		delegation_id: delegation.id,
		direction: body.direction,
		route,
		mint: body.mint,
		network: body.network,
		tx_signature: sig,
	});
});

async function executeTrade({ body, relayer }) {
	const userPk = relayer.publicKey;
	const mintPk = solanaPubkey(body.mint);
	if (!mintPk) throw Object.assign(new Error('invalid mint'), { status: 400 });

	const { sdk, BN } = await getPumpSdk({ network: body.network });
	const slippage = body.slippage_bps / 10_000;
	const connection = getConnection({ network: body.network });

	let ixs;
	let route;

	if (body.direction === 'buy') {
		const lamports = new BN(Math.floor(body.sol * 1_000_000_000));
		let buyState = null;
		try {
			if (sdk.fetchBuyState) buyState = await sdk.fetchBuyState(mintPk, userPk);
		} catch {}
		if (buyState && buyState.bondingCurve && !buyState.bondingCurve.complete) {
			const global = await sdk.fetchGlobal();
			ixs = await sdk.buyInstructions({
				global,
				bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
				bondingCurve: buyState.bondingCurve,
				associatedUserAccountInfo: buyState.associatedUserAccountInfo,
				mint: mintPk,
				user: userPk,
				amount: new BN(0),
				solAmount: lamports,
				slippage,
			});
			route = 'bonding_curve';
		} else {
			const amm = await getAmmPoolState({ network: body.network, mint: mintPk });
			const ammMod = await import('@pump-fun/pump-swap-sdk');
			const offline = new ammMod.PumpAmmSdk();
			const onlineAmm = new ammMod.OnlinePumpAmmSdk(connection);
			const swapState = await onlineAmm.swapSolanaState(amm.poolKey, userPk);
			ixs = await offline.buyQuoteInput(swapState, lamports, slippage);
			route = 'amm';
		}
	} else {
		const tokens = new BN(body.tokens);
		let sellState = null;
		try {
			if (sdk.fetchSellState) sellState = await sdk.fetchSellState(mintPk, userPk);
		} catch {}
		if (sellState && sellState.bondingCurve && !sellState.bondingCurve.complete) {
			const global = await sdk.fetchGlobal();
			ixs = await sdk.sellInstructions({
				global,
				bondingCurveAccountInfo: sellState.bondingCurveAccountInfo,
				bondingCurve: sellState.bondingCurve,
				mint: mintPk,
				user: userPk,
				amount: tokens,
				solAmount: new BN(0),
				slippage,
			});
			route = 'bonding_curve';
		} else {
			const amm = await getAmmPoolState({ network: body.network, mint: mintPk });
			const ammMod = await import('@pump-fun/pump-swap-sdk');
			const offline = new ammMod.PumpAmmSdk();
			const onlineAmm = new ammMod.OnlinePumpAmmSdk(connection);
			const swapState = await onlineAmm.swapSolanaState(amm.poolKey, userPk);
			ixs = await offline.sellBaseInput(swapState, tokens, slippage);
			route = 'amm';
		}
	}

	const { TransactionMessage, VersionedTransaction } = await import('@solana/web3.js');
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
	const msg = new TransactionMessage({
		payerKey: userPk,
		recentBlockhash: blockhash,
		instructions: ixs,
	}).compileToV0Message();
	const vtx = new VersionedTransaction(msg);
	vtx.sign([relayer]);

	const sig = await connection.sendRawTransaction(vtx.serialize(), { skipPreflight: false });
	await connection.confirmTransaction(
		{ signature: sig, blockhash, lastValidBlockHeight },
		'confirmed',
	);
	return { signature: sig, route };
}
