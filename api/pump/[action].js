// Consolidated pump.fun API dispatcher.
//
// Routes via Vercel's [action] file param. Single bundle replaces 22 separate
// serverless functions, each of which used to import @solana/web3.js and the
// @pump-fun/* SDKs from scratch.
//
// Action map:
//   balances                 -> handleBalances
//   buy-prep                 -> handleBuyPrep
//   buy-confirm              -> handleBuyConfirm
//   sell-prep                -> handleSellPrep
//   sell-confirm             -> handleSellConfirm
//   launch-prep              -> handleLaunchPrep
//   launch-confirm           -> handleLaunchConfirm
//   accept-payment-prep      -> handleAcceptPaymentPrep
//   accept-payment-confirm   -> handleAcceptPaymentConfirm
//   payments-list            -> handlePaymentsList
//   portfolio                -> handlePortfolio
//   by-agent                 -> handleByAgent
//   quote                    -> handleQuote
//   governance-prep          -> handleGovernancePrep
//   withdraw-prep            -> handleWithdrawPrep
//   withdraw-confirm         -> handleWithdrawConfirm
//   strategy-backtest        -> handleStrategyBacktest
//   strategy-close-all       -> handleStrategyCloseAll
//   strategy-run             -> handleStrategyRun (SSE; bypasses wrap())
//   strategy-validate        -> handleStrategyValidate

import { z } from 'zod';
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { randomToken } from '../_lib/crypto.js';
import {
	getConnection,
	getPumpSdk,
	getPumpAgent,
	getPumpAgentOffline,
	getAmmPoolState,
	buildUnsignedTxBase64,
	verifySignature,
	solanaPubkey,
} from '../_lib/pump.js';
import { solanaConnection } from '../_lib/agent-pumpfun.js';
import { makeRuntime } from '../_lib/skill-runtime.js';
import { loadWallet } from '../_lib/solana-wallet.js';
import { checkBuyAllowed } from '../_lib/agent-spend-policy.js';
import {
	SOLANA_USDC_MINT,
	SOLANA_USDC_MINT_DEVNET,
	toUsdcAtomics,
} from '../payments/_config.js';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

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

const wrapped = wrap(async (req, res) => {
	const action = req.query?.action;
	switch (action) {
		case 'balances':                return handleBalances(req, res);
		case 'buy-prep':                return handleBuyPrep(req, res);
		case 'buy-confirm':             return handleBuyConfirm(req, res);
		case 'sell-prep':               return handleSellPrep(req, res);
		case 'sell-confirm':            return handleSellConfirm(req, res);
		case 'launch-prep':             return handleLaunchPrep(req, res);
		case 'launch-confirm':          return handleLaunchConfirm(req, res);
		case 'accept-payment-prep':     return handleAcceptPaymentPrep(req, res);
		case 'accept-payment-confirm':  return handleAcceptPaymentConfirm(req, res);
		case 'payments-list':           return handlePaymentsList(req, res);
		case 'portfolio':               return handlePortfolio(req, res);
		case 'by-agent':                return handleByAgent(req, res);
		case 'quote':                   return handleQuote(req, res);
		case 'governance-prep':         return handleGovernancePrep(req, res);
		case 'withdraw-prep':           return handleWithdrawPrep(req, res);
		case 'withdraw-confirm':        return handleWithdrawConfirm(req, res);
		case 'strategy-backtest':       return handleStrategyBacktest(req, res);
		case 'strategy-close-all':      return handleStrategyCloseAll(req, res);
		case 'strategy-validate':       return handleStrategyValidate(req, res);
		case 'channel-feed':            return handleChannelFeed(req, res);
		case 'deliver-telegram':        return handleDeliverTelegram(req, res);
		case 'first-claims':            return handleFirstClaims(req, res);
		default:
			return error(res, 404, 'not_found', 'unknown pump action');
	}
});

// strategy-run and vanity-keygen are SSE — bypass wrap()'s JSON-error fallback.
export default async function dispatcher(req, res) {
	if (req.query?.action === 'strategy-run') return handleStrategyRun(req, res);
	if (req.query?.action === 'vanity-keygen') return handleVanityKeygen(req, res);
	return wrapped(req, res);
}

// ── balances ───────────────────────────────────────────────────────────────

async function handleBalances(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const mintStr = url.searchParams.get('mint');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	const currencyArg = url.searchParams.get('currency');

	const mint = solanaPubkey(mintStr);
	if (!mint) return error(res, 400, 'validation_error', 'invalid mint');

	const currencyStr =
		currencyArg || (network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT);
	const currency = solanaPubkey(currencyStr);
	if (!currency) return error(res, 400, 'validation_error', 'invalid currency');

	try {
		const { agent, agentPda } = await getPumpAgent({ network, mint });
		const balances = await agent.getBalances(currency);
		const fmt = (v) =>
			v && {
				address: v.address?.toString?.() ?? String(v.address),
				balance: v.balance?.toString?.() ?? String(v.balance ?? 0),
			};
		return json(res, 200, {
			mint: mintStr,
			network,
			currency: currencyStr,
			agent_pda: agentPda?.toString?.() ?? null,
			balances: {
				payment: fmt(balances.paymentVault),
				buyback: fmt(balances.buybackVault),
				withdraw: fmt(balances.withdrawVault),
			},
		});
	} catch (err) {
		// Most common: agent not yet bound to mint → PDA missing.
		return error(res, 502, 'pump_agent_error', err.message || 'pump-agent SDK error');
	}
}

// ── buy-prep ───────────────────────────────────────────────────────────────

const buyPrepSchema = z.object({
	mint: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	sol: z.number().positive().max(50),
	slippage_bps: z.number().int().min(0).max(5000).default(100),
	wallet_address: z.string().min(32).max(44),
});

async function handleBuyPrep(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(buyPrepSchema, await readJson(req));
	const userPk = solanaPubkey(body.wallet_address);
	const mintPk = solanaPubkey(body.mint);
	if (!userPk || !mintPk) return error(res, 400, 'validation_error', 'invalid pubkeys');

	try {
		const { sdk, BN, web3 } = await getPumpSdk({ network: body.network });
		const lamports = new BN(Math.floor(body.sol * web3.LAMPORTS_PER_SOL));
		const slippage = body.slippage_bps / 10_000;

		// Try bonding curve.
		let buyState = null;
		try {
			if (sdk.fetchBuyState) buyState = await sdk.fetchBuyState(mintPk, userPk);
		} catch {
			buyState = null;
		}

		if (buyState && buyState.bondingCurve && !buyState.bondingCurve.complete) {
			const global = await sdk.fetchGlobal();
			const ixs = await sdk.buyInstructions({
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
			const tx_base64 = await buildUnsignedTxBase64({
				network: body.network,
				payer: userPk,
				instructions: ixs,
			});
			return json(res, 201, {
				route: 'bonding_curve',
				mint: body.mint,
				network: body.network,
				sol_in: body.sol,
				slippage_bps: body.slippage_bps,
				tx_base64,
			});
		}

		// AMM
		const amm = await getAmmPoolState({ network: body.network, mint: mintPk });
		const ammMod = await import('@pump-fun/pump-swap-sdk');
		const offline = new ammMod.PumpAmmSdk();
		const onlineAmm = new ammMod.OnlinePumpAmmSdk(getConnection({ network: body.network }));
		const swapState = await onlineAmm.swapSolanaState(amm.poolKey, userPk);
		const ixs = await offline.buyQuoteInput(swapState, lamports, slippage);
		const tx_base64 = await buildUnsignedTxBase64({
			network: body.network,
			payer: userPk,
			instructions: ixs,
		});
		return json(res, 201, {
			route: 'amm',
			pool: amm.poolKey.toString(),
			mint: body.mint,
			network: body.network,
			sol_in: body.sol,
			slippage_bps: body.slippage_bps,
			tx_base64,
		});
	} catch (e) {
		return error(
			res,
			e.status || 502,
			e.code || 'pump_sdk_error',
			e.message || 'failed to build buy tx',
		);
	}
}

// ── buy-confirm ────────────────────────────────────────────────────────────

const buyConfirmSchema = z.object({
	mint: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	tx_signature: z.string().min(80).max(100),
	wallet_address: z.string().min(32).max(44),
	sol: z.number().positive().max(50),
	route: z.enum(['bonding_curve', 'amm']),
	slippage_bps: z.number().int().min(0).max(5000).optional(),
});

async function handleBuyConfirm(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(buyConfirmSchema, await readJson(req));

	const [mintRow] = await sql`
		select id from pump_agent_mints where mint=${body.mint} and network=${body.network} limit 1
	`;
	const mintId = mintRow?.id ?? null;

	let tx;
	try {
		tx = await verifySignature({ network: body.network, signature: body.tx_signature });
	} catch (e) {
		return error(res, e.status || 422, e.code || 'tx_failed', e.message);
	}
	const accountKeys = tx.transaction.message.accountKeys.map((k) => (k.pubkey || k).toString());
	if (!accountKeys.includes(body.mint))
		return error(res, 422, 'mint_not_in_tx', 'mint not in tx');
	if (!accountKeys.includes(body.wallet_address))
		return error(res, 422, 'wallet_not_in_tx', 'wallet not in tx');

	if (mintId) {
		const lamports = BigInt(Math.floor(body.sol * 1_000_000_000));
		await sql`
			insert into pump_agent_trades
				(mint_id, user_id, wallet, direction, route, sol_amount, slippage_bps, tx_signature, network)
			values
				(${mintId}, ${user.id}, ${body.wallet_address}, 'buy', ${body.route},
				 ${lamports.toString()}, ${body.slippage_bps ?? null}, ${body.tx_signature}, ${body.network})
			on conflict (tx_signature, network) do nothing
		`;
	}

	return json(res, 200, {
		ok: true,
		tracked: !!mintId,
		mint: body.mint,
		network: body.network,
		tx_signature: body.tx_signature,
	});
}

// ── sell-prep ──────────────────────────────────────────────────────────────

const sellPrepSchema = z.object({
	mint: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	tokens: z.string().regex(/^\d+$/, 'tokens must be a base-units integer string'),
	slippage_bps: z.number().int().min(0).max(5000).default(100),
	wallet_address: z.string().min(32).max(44),
});

async function handleSellPrep(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(sellPrepSchema, await readJson(req));
	const userPk = solanaPubkey(body.wallet_address);
	const mintPk = solanaPubkey(body.mint);
	if (!userPk || !mintPk) return error(res, 400, 'validation_error', 'invalid pubkeys');

	try {
		const { sdk, BN } = await getPumpSdk({ network: body.network });
		const tokens = new BN(body.tokens);
		const slippage = body.slippage_bps / 10_000;

		let sellState = null;
		try {
			if (sdk.fetchSellState) sellState = await sdk.fetchSellState(mintPk, userPk);
		} catch {
			sellState = null;
		}

		if (sellState && sellState.bondingCurve && !sellState.bondingCurve.complete) {
			const global = await sdk.fetchGlobal();
			const ixs = await sdk.sellInstructions({
				global,
				bondingCurveAccountInfo: sellState.bondingCurveAccountInfo,
				bondingCurve: sellState.bondingCurve,
				mint: mintPk,
				user: userPk,
				amount: tokens,
				solAmount: new BN(0),
				slippage,
			});
			const tx_base64 = await buildUnsignedTxBase64({
				network: body.network,
				payer: userPk,
				instructions: ixs,
			});
			return json(res, 201, {
				route: 'bonding_curve',
				mint: body.mint,
				network: body.network,
				tokens_in: body.tokens,
				slippage_bps: body.slippage_bps,
				tx_base64,
			});
		}

		const amm = await getAmmPoolState({ network: body.network, mint: mintPk });
		const ammMod = await import('@pump-fun/pump-swap-sdk');
		const offline = new ammMod.PumpAmmSdk();
		const onlineAmm = new ammMod.OnlinePumpAmmSdk(getConnection({ network: body.network }));
		const swapState = await onlineAmm.swapSolanaState(amm.poolKey, userPk);
		const ixs = await offline.sellBaseInput(swapState, tokens, slippage);
		const tx_base64 = await buildUnsignedTxBase64({
			network: body.network,
			payer: userPk,
			instructions: ixs,
		});
		return json(res, 201, {
			route: 'amm',
			pool: amm.poolKey.toString(),
			mint: body.mint,
			network: body.network,
			tokens_in: body.tokens,
			slippage_bps: body.slippage_bps,
			tx_base64,
		});
	} catch (e) {
		return error(
			res,
			e.status || 502,
			e.code || 'pump_sdk_error',
			e.message || 'failed to build sell tx',
		);
	}
}

// ── sell-confirm ───────────────────────────────────────────────────────────

const sellConfirmSchema = z.object({
	mint: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	tx_signature: z.string().min(80).max(100),
	wallet_address: z.string().min(32).max(44),
	tokens: z.string().regex(/^\d+$/),
	route: z.enum(['bonding_curve', 'amm']),
	slippage_bps: z.number().int().min(0).max(5000).optional(),
});

async function handleSellConfirm(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(sellConfirmSchema, await readJson(req));

	const [mintRow] = await sql`
		select id from pump_agent_mints where mint=${body.mint} and network=${body.network} limit 1
	`;
	const mintId = mintRow?.id ?? null;

	let tx;
	try {
		tx = await verifySignature({ network: body.network, signature: body.tx_signature });
	} catch (e) {
		return error(res, e.status || 422, e.code || 'tx_failed', e.message);
	}
	const accountKeys = tx.transaction.message.accountKeys.map((k) => (k.pubkey || k).toString());
	if (!accountKeys.includes(body.mint))
		return error(res, 422, 'mint_not_in_tx', 'mint not in tx');
	if (!accountKeys.includes(body.wallet_address))
		return error(res, 422, 'wallet_not_in_tx', 'wallet not in tx');

	if (mintId) {
		await sql`
			insert into pump_agent_trades
				(mint_id, user_id, wallet, direction, route, token_amount, slippage_bps, tx_signature, network)
			values
				(${mintId}, ${user.id}, ${body.wallet_address}, 'sell', ${body.route},
				 ${body.tokens}, ${body.slippage_bps ?? null}, ${body.tx_signature}, ${body.network})
			on conflict (tx_signature, network) do nothing
		`;
	}

	return json(res, 200, {
		ok: true,
		tracked: !!mintId,
		mint: body.mint,
		network: body.network,
		tx_signature: body.tx_signature,
	});
}

// ── launch-prep ────────────────────────────────────────────────────────────

const launchPrepSchema = z.object({
	agent_id: z.string().uuid(),
	wallet_address: z.string().min(32).max(44),
	name: z.string().trim().min(1).max(32),
	symbol: z.string().trim().min(1).max(10),
	uri: z.string().url(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	buyback_bps: z.number().int().min(0).max(10_000).default(0),
	sol_buy_in: z.number().nonnegative().max(50).default(0), // optional creator initial buy, capped 50 SOL
	// Optional client-ground vanity mint address. When provided, the client
	// already holds the secret key locally and will co-sign in the wallet —
	// the server never sees the secret. When omitted, the server falls back
	// to a fresh Keypair.generate() and returns the secret key for co-sign.
	mint_address: z.string().min(32).max(44).optional(),
});

async function handleLaunchPrep(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(launchPrepSchema, await readJson(req));
	const creator = solanaPubkey(body.wallet_address);
	if (!creator) return error(res, 400, 'validation_error', 'invalid wallet_address');

	// Verify wallet linked to user.
	const [walletRow] = await sql`
		select id from user_wallets
		where user_id=${user.id} and address=${body.wallet_address} and chain_type='solana'
		limit 1
	`;
	if (!walletRow) return error(res, 403, 'forbidden', 'wallet not linked to your account');

	// Verify the agent belongs to this user.
	const [agent] = await sql`
		select id, name from agent_identities
		where id=${body.agent_id} and user_id=${user.id} and deleted_at is null limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	// Mint pubkey: client-supplied (vanity-ground) or freshly generated.
	let mintKeypair = null;
	let mint;
	if (body.mint_address) {
		const supplied = solanaPubkey(body.mint_address);
		if (!supplied) return error(res, 400, 'validation_error', 'invalid mint_address');
		mint = supplied;
	} else {
		mintKeypair = Keypair.generate();
		mint = mintKeypair.publicKey;
	}

	const { sdk, BN } = await getPumpSdk({ network: body.network });
	const LAMPORTS_PER_SOL_LAUNCH = 1_000_000_000;

	const instructions = [];
	if (body.sol_buy_in > 0 && sdk.createAndBuyInstructions) {
		const global = await sdk.fetchGlobal();
		const solAmount = new BN(Math.floor(body.sol_buy_in * LAMPORTS_PER_SOL_LAUNCH));
		const pumpSdk = await import('@pump-fun/pump-sdk');
		const tokenAmount = pumpSdk.getBuyTokenAmountFromSolAmount(global, null, solAmount);
		const ixs = await sdk.createAndBuyInstructions({
			global,
			mint,
			name: body.name,
			symbol: body.symbol,
			uri: body.uri,
			creator,
			user: creator,
			solAmount,
			amount: tokenAmount,
		});
		instructions.push(...(Array.isArray(ixs) ? ixs : [ixs]));
	} else {
		const ix = await sdk.createInstruction({
			mint,
			name: body.name,
			symbol: body.symbol,
			uri: body.uri,
			creator,
			user: creator,
		});
		instructions.push(ix);
	}

	// Bind PumpAgent.create.
	if (body.buyback_bps > 0) {
		const { offline } = await getPumpAgentOffline({ network: body.network, mint });
		const createIx = await offline.create({
			authority: creator,
			mint,
			agentAuthority: creator,
			buybackBps: body.buyback_bps,
		});
		instructions.push(createIx);
	}

	const txBase64 = await buildUnsignedTxBase64({
		network: body.network,
		payer: creator,
		instructions,
	});

	const prepId = await randomToken(24);
	const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

	await sql`
		insert into agent_registrations_pending (user_id, cid, metadata_uri, payload, expires_at)
		values (
			${user.id},
			${mint.toBase58()},
			${body.uri},
			${JSON.stringify({
				kind: 'pump_launch',
				agent_id: body.agent_id,
				wallet_address: body.wallet_address,
				mint: mint.toBase58(),
				name: body.name,
				symbol: body.symbol,
				network: body.network,
				buyback_bps: body.buyback_bps,
				prep_id: prepId,
			})}::jsonb,
			${expiresAt}
		)
	`;

	return json(res, 201, {
		prep_id: prepId,
		mint: mint.toBase58(),
		// Mint keypair must co-sign the tx. When server-generated, we hand
		// the secret to the frontend; when client-supplied (vanity), the
		// client already holds it and the server never sees it.
		mint_secret_key_b64: mintKeypair ? Buffer.from(mintKeypair.secretKey).toString('base64') : null,
		client_supplied_mint: !mintKeypair,
		tx_base64: txBase64,
		network: body.network,
		buyback_bps: body.buyback_bps,
		expires_at: expiresAt.toISOString(),
		instructions: mintKeypair
			? 'Decode tx_base64 as VersionedTransaction. Sign with the mint keypair (mint_secret_key_b64) AND the user wallet, submit, then POST /api/pump/launch-confirm with the tx_signature.'
			: 'Decode tx_base64 as VersionedTransaction. Sign with your locally-held vanity mint keypair AND the user wallet, submit, then POST /api/pump/launch-confirm with the tx_signature.',
	});
}

// ── launch-confirm ─────────────────────────────────────────────────────────

const launchConfirmSchema = z.object({
	prep_id: z.string().min(8),
	tx_signature: z.string().min(80).max(100),
});

async function handleLaunchConfirm(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(launchConfirmSchema, await readJson(req));

	const [pending] = await sql`
		select id, payload from agent_registrations_pending
		where user_id=${user.id} and payload->>'prep_id'=${body.prep_id}
		  and expires_at > now()
		order by created_at desc limit 1
	`;
	if (!pending) return error(res, 404, 'not_found', 'prep not found or expired');
	const p = pending.payload;
	if (p.kind !== 'pump_launch') return error(res, 400, 'wrong_kind', 'prep is not a pump launch');

	let tx;
	try {
		tx = await verifySignature({ network: p.network, signature: body.tx_signature });
	} catch (e) {
		return error(res, e.status || 422, e.code || 'tx_failed', e.message);
	}
	const accountKeys = tx.transaction.message.accountKeys.map((k) =>
		(k.pubkey || k).toString(),
	);
	if (!accountKeys.includes(p.mint)) {
		return error(res, 422, 'mint_not_in_tx', 'mint pubkey not present in tx');
	}

	const [existing] = await sql`
		select id from pump_agent_mints where mint=${p.mint} and network=${p.network} limit 1
	`;
	if (existing) return error(res, 409, 'conflict', 'mint already registered');

	const [row] = await sql`
		insert into pump_agent_mints
			(agent_id, user_id, network, mint, name, symbol, agent_authority, buyback_bps)
		values
			(${p.agent_id}, ${user.id}, ${p.network}, ${p.mint},
			 ${p.name}, ${p.symbol}, ${p.wallet_address}, ${p.buyback_bps})
		returning id, mint, network, buyback_bps, created_at
	`;

	await sql`delete from agent_registrations_pending where id=${pending.id}`;

	return json(res, 201, {
		ok: true,
		pump_agent_mint: row,
		tx_signature: body.tx_signature,
	});
}

// ── accept-payment-prep ────────────────────────────────────────────────────

const acceptPaymentPrepSchema = z.object({
	mint: z.string().min(32).max(44), // pump.fun token mint = agent token
	payer_wallet: z.string().min(32).max(44),
	amount_usdc: z.number().positive().max(100_000),
	currency_mint: z.string().min(32).max(44).optional(), // defaults to USDC
	currency_token_program: z.string().min(32).max(44).optional(),
	user_token_account: z.string().min(32).max(44),         // payer ATA
	skill_id: z.string().max(100).optional(),
	tool_name: z.string().max(100).optional(),
	duration_seconds: z.number().int().positive().max(60 * 60 * 24 * 365).default(60),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

function bnFromBigint(BN, v) {
	return new BN(v.toString());
}

async function handleAcceptPaymentPrep(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// Allow both session users (browser) and bearer (MCP / agent) callers.
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer)
		return error(res, 401, 'unauthorized', 'sign in or supply a bearer token');
	const userId = session?.id ?? bearer?.userId ?? null;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(acceptPaymentPrepSchema, await readJson(req));
	const payer = solanaPubkey(body.payer_wallet);
	const userAta = solanaPubkey(body.user_token_account);
	if (!payer) return error(res, 400, 'validation_error', 'invalid payer_wallet');
	if (!userAta) return error(res, 400, 'validation_error', 'invalid user_token_account');

	const [agent] = await sql`
		select id, mint, network, buyback_bps from pump_agent_mints
		where mint=${body.mint} and network=${body.network} limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent mint not registered');

	const currencyStr =
		body.currency_mint ||
		(body.network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT);
	const currency = solanaPubkey(currencyStr);
	if (!currency) return error(res, 400, 'validation_error', 'invalid currency_mint');

	const { offline, BN } = await getPumpAgentOffline({
		network: body.network,
		mint: body.mint,
	});

	// Invoice ID = random 64-bit unsigned (memo BN). Used as the PDA seed and
	// as the X402 receipt identifier downstream.
	const invoiceIdHex = (await randomToken(8)).slice(0, 16);
	const invoiceId = new BN(invoiceIdHex, 16);

	const startTime = Math.floor(Date.now() / 1000);
	const endTime = startTime + body.duration_seconds;

	const amountAtomics = toUsdcAtomics(body.amount_usdc); // bigint, USDC = 6 dp

	const tokenProgram = body.currency_token_program
		? solanaPubkey(body.currency_token_program)
		: undefined;

	const ix = await offline.acceptPayment({
		user: payer,
		userTokenAccount: userAta,
		currencyMint: currency,
		amount: bnFromBigint(BN, amountAtomics),
		memo: invoiceId,
		startTime: new BN(startTime),
		endTime: new BN(endTime),
		...(tokenProgram ? { tokenProgram } : {}),
	});

	const txBase64 = await buildUnsignedTxBase64({
		network: body.network,
		payer,
		instructions: [ix],
	});

	const [row] = await sql`
		insert into pump_agent_payments
			(mint_id, user_id, payer_wallet, currency_mint, amount_atomics,
			 invoice_id, start_time, end_time, status, skill_id, tool_name)
		values
			(${agent.id}, ${userId}, ${body.payer_wallet}, ${currencyStr},
			 ${amountAtomics.toString()}, ${invoiceId.toString()},
			 to_timestamp(${startTime}), to_timestamp(${endTime}),
			 'pending', ${body.skill_id || null}, ${body.tool_name || null})
		returning id, invoice_id, start_time, end_time, status
	`;

	return json(res, 201, {
		payment_id: row.id,
		mint: body.mint,
		invoice_id: invoiceId.toString(),
		amount_usdc: body.amount_usdc,
		amount_atomics: amountAtomics.toString(),
		currency_mint: currencyStr,
		start_time: row.start_time,
		end_time: row.end_time,
		network: body.network,
		tx_base64: txBase64,
		instructions:
			'Decode tx_base64, sign with payer wallet, submit, then call /api/pump/accept-payment-confirm with the tx_signature and payment_id.',
	});
}

// ── accept-payment-confirm ─────────────────────────────────────────────────

const acceptPaymentConfirmSchema = z.object({
	payment_id: z.string().uuid(),
	tx_signature: z.string().min(80).max(100),
});

async function handleAcceptPaymentConfirm(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'auth required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(acceptPaymentConfirmSchema, await readJson(req));
	const [payment] = await sql`
		select p.*, m.mint, m.network from pump_agent_payments p
		join pump_agent_mints m on m.id = p.mint_id
		where p.id=${body.payment_id} limit 1
	`;
	if (!payment) return error(res, 404, 'not_found', 'payment not found');
	if (payment.status === 'confirmed')
		return error(res, 409, 'already_confirmed', 'payment already confirmed');

	let tx;
	try {
		tx = await verifySignature({ network: payment.network, signature: body.tx_signature });
	} catch (e) {
		await sql`update pump_agent_payments set status='failed' where id=${payment.id}`;
		return error(res, e.status || 422, e.code || 'tx_failed', e.message);
	}

	const accountKeys = tx.transaction.message.accountKeys.map((k) =>
		(k.pubkey || k).toString(),
	);
	if (!accountKeys.includes(payment.mint)) {
		return error(res, 422, 'mint_not_in_tx', 'agent mint not in tx accounts');
	}

	await sql`
		update pump_agent_payments
		set status='confirmed', tx_signature=${body.tx_signature}, confirmed_at=now()
		where id=${payment.id}
	`;

	return json(res, 200, {
		ok: true,
		payment_id: payment.id,
		invoice_id: payment.invoice_id,
		tx_signature: body.tx_signature,
	});
}

// ── payments-list ──────────────────────────────────────────────────────────

async function handlePaymentsList(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const mint = url.searchParams.get('mint');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	const limit = Math.min(Number(url.searchParams.get('limit') || 50), 500);
	const includePending = url.searchParams.get('include_pending') === '1';

	if (!mint) return error(res, 400, 'validation_error', 'mint required');

	const [agent] = await sql`
		select id, mint, network, buyback_bps from pump_agent_mints
		where mint=${mint} and network=${network} limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent mint not registered');

	const rows = includePending
		? await sql`
			select id, payer_wallet, currency_mint, amount_atomics, invoice_id,
			       start_time, end_time, status, skill_id, tool_name,
			       invoice_pda, tx_signature, created_at, confirmed_at
			from pump_agent_payments
			where mint_id=${agent.id}
			order by created_at desc limit ${limit}
		`
		: await sql`
			select id, payer_wallet, currency_mint, amount_atomics, invoice_id,
			       start_time, end_time, status, skill_id, tool_name,
			       invoice_pda, tx_signature, created_at, confirmed_at
			from pump_agent_payments
			where mint_id=${agent.id} and status='confirmed'
			order by confirmed_at desc nulls last limit ${limit}
		`;

	// Derive invoice PDAs for any rows that lack one (older rows pre-PDA backfill).
	// We do it lazily here so the widget can deep-link without a backfill cron.
	let pdaErrored = false;
	const needsPda = rows.filter((r) => !r.invoice_pda && r.invoice_id);
	if (needsPda.length > 0) {
		try {
			const [{ getInvoiceIdPDA }, { PublicKey }] = await Promise.all([
				import('@pump-fun/agent-payments-sdk'),
				import('@solana/web3.js'),
			]);
			const BN = (await import('bn.js')).default || (await import('bn.js'));
			const mintPk = new PublicKey(mint);
			for (const r of needsPda) {
				try {
					const [pda] = getInvoiceIdPDA(mintPk, new BN(r.invoice_id));
					r.invoice_pda = pda.toBase58();
				} catch {
					/* skip individual failures */
				}
			}
		} catch {
			pdaErrored = true;
		}
	}

	const [agg] = await sql`
		select
			count(*)::int                                                      as total,
			count(*) filter (where status='confirmed')::int                    as confirmed,
			count(distinct payer_wallet) filter (where status='confirmed')::int as unique_payers,
			coalesce(sum(amount_atomics) filter (where status='confirmed'), 0)::text as total_atomics
		from pump_agent_payments where mint_id=${agent.id}
	`;

	return json(res, 200, {
		mint,
		network,
		buyback_bps: agent.buyback_bps,
		summary: agg,
		data: rows,
	});
}

// ── portfolio ──────────────────────────────────────────────────────────────

async function handlePortfolio(req, res) {
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
}

// ── by-agent ───────────────────────────────────────────────────────────────

async function handleByAgent(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const agentId = url.searchParams.get('agent_id');
	if (!agentId) return error(res, 400, 'validation_error', 'agent_id required');

	const [row] = await sql`
		select id, mint, network, name, symbol, buyback_bps, agent_authority,
		       metadata_uri, sharing_config, created_at
		from pump_agent_mints
		where agent_id=${agentId}
		order by created_at desc limit 1
	`;
	if (!row) return json(res, 200, { data: null });

	const [stats] = await sql`
		select
			count(*) filter (where status='confirmed')::int                      as confirmed_payments,
			count(distinct payer_wallet) filter (where status='confirmed')::int  as unique_payers,
			coalesce(sum(amount_atomics) filter (where status='confirmed'),0)::text as total_atomics,
			max(confirmed_at) filter (where status='confirmed')                  as last_payment_at
		from pump_agent_payments where mint_id=${row.id}
	`;

	const [burnRow] = await sql`
		select
			count(*) filter (where status='confirmed')::int                       as runs,
			coalesce(sum(burn_amount) filter (where status='confirmed'),0)::text  as total_burned,
			max(created_at)                                                       as last_burn_at
		from pump_buyback_runs where mint_id=${row.id}
	`;

	// Burns feed (separate from payments feed) — recent confirmed buyback runs
	// for the dashboard / passport "🔥 burns" stream.
	const burnsFeed = await sql`
		select id, currency_mint, tx_signature, burn_amount, created_at
		from pump_buyback_runs
		where mint_id=${row.id} and status='confirmed'
		order by created_at desc
		limit 10
	`;

	return json(res, 200, {
		data: {
			...row,
			stats: stats || { confirmed_payments: 0, unique_payers: 0, total_atomics: '0' },
			burns:  burnRow || { runs: 0, total_burned: '0' },
			burns_feed: burnsFeed,
		},
	});
}

// ── quote ──────────────────────────────────────────────────────────────────

async function handleQuote(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const mintStr = url.searchParams.get('mint');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	const direction = url.searchParams.get('direction') === 'sell' ? 'sell' : 'buy';
	const solRaw = url.searchParams.get('sol');
	const tokenRaw = url.searchParams.get('token');
	const slippageRaw = url.searchParams.get('slippage_bps');
	const slippageBps = Number.isFinite(Number(slippageRaw))
		? Math.max(0, Math.min(5000, Number(slippageRaw)))
		: 100;
	const slippage = slippageBps / 10_000;

	const mint = solanaPubkey(mintStr);
	if (!mint) return error(res, 400, 'validation_error', 'invalid mint');

	try {
		// Try bonding curve first.
		const { sdk, BN, web3 } = await getPumpSdk({ network });
		const LAMPORTS_PER_SOL_Q = web3.LAMPORTS_PER_SOL || 1_000_000_000;

		let curve = null;
		try {
			if (sdk.fetchBuyState) {
				const state = await sdk.fetchBuyState(mint, mint); // any pubkey works for read
				curve = state.bondingCurve;
			} else if (sdk.fetchBondingCurve) {
				curve = await sdk.fetchBondingCurve(mint);
			}
		} catch {
			curve = null;
		}

		if (curve && !curve.complete) {
			const global = typeof sdk.fetchGlobal === 'function' ? await sdk.fetchGlobal() : null;
			const pumpSdk = await import('@pump-fun/pump-sdk');
			let quote = null;

			if (direction === 'buy' && solRaw) {
				const sol = Number(solRaw);
				if (!(sol > 0)) return error(res, 400, 'validation_error', 'sol must be > 0');
				const lamports = new BN(Math.floor(sol * LAMPORTS_PER_SOL_Q));
				const tokens = pumpSdk.getBuyTokenAmountFromSolAmount(global, curve, lamports);
				quote = { sol_in: sol, tokens_out: tokens.toString(), source: 'bonding_curve' };
			} else if (direction === 'sell' && tokenRaw) {
				const tokens = new BN(tokenRaw);
				const lamports = pumpSdk.getSellSolAmountFromTokenAmount(global, curve, tokens);
				quote = {
					tokens_in: tokenRaw,
					sol_out: Number(lamports.toString()) / LAMPORTS_PER_SOL_Q,
					source: 'bonding_curve',
				};
			}

			return json(res, 200, {
				mint: mintStr,
				network,
				graduated: false,
				bonding_curve: {
					real_sol_reserves: curve.realSolReserves?.toString?.() ?? null,
					real_token_reserves: curve.realTokenReserves?.toString?.() ?? null,
					virtual_sol_reserves: curve.virtualSolReserves?.toString?.() ?? null,
					virtual_token_reserves: curve.virtualTokenReserves?.toString?.() ?? null,
					complete: curve.complete ?? false,
				},
				quote,
			});
		}

		// Post-graduation: AMM via canonical pump.fun pool (quote = WSOL).
		let amm;
		try {
			amm = await getAmmPoolState({ network, mint });
		} catch (e) {
			if (e.code === 'pool_not_found') {
				return json(res, 200, {
					mint: mintStr,
					network,
					graduated: true,
					pool: null,
					quote: null,
					note: 'No bonding curve and no canonical AMM pool — token may not be a pump.fun mint or has not graduated yet',
				});
			}
			throw e;
		}

		const {
			pool,
			poolKey,
			baseReserve,
			quoteReserve,
			baseMintAccount,
			globalConfig,
			feeConfig,
		} = amm;
		const LAMPORTS_PER_SOL_AMM = 1_000_000_000;
		const ammSdk = await import('@pump-fun/pump-swap-sdk');
		let quote = null;

		if (direction === 'buy' && solRaw) {
			const sol = Number(solRaw);
			if (!(sol > 0)) return error(res, 400, 'validation_error', 'sol must be > 0');
			const lamports = new BN(Math.floor(sol * LAMPORTS_PER_SOL_AMM));
			const r = ammSdk.buyQuoteInput({
				quote: lamports,
				slippage,
				baseReserve,
				quoteReserve,
				globalConfig,
				baseMintAccount,
				baseMint: pool.baseMint,
				coinCreator: pool.coinCreator,
				creator: pool.creator,
				feeConfig,
			});
			quote = {
				sol_in: sol,
				tokens_out: r.base?.toString?.() ?? null,
				min_tokens_out: r.uiBase?.toString?.() ?? r.minBase?.toString?.() ?? null,
				slippage_bps: slippageBps,
				source: 'amm',
			};
		} else if (direction === 'sell' && tokenRaw) {
			const tokens = new BN(tokenRaw);
			const r = ammSdk.sellBaseInput({
				base: tokens,
				slippage,
				baseReserve,
				quoteReserve,
				globalConfig,
				baseMintAccount,
				baseMint: pool.baseMint,
				coinCreator: pool.coinCreator,
				creator: pool.creator,
				feeConfig,
			});
			const lamportsOut = r.quote ?? r.uiQuote ?? r.minQuote;
			quote = {
				tokens_in: tokenRaw,
				sol_out:
					lamportsOut != null
						? Number(lamportsOut.toString()) / LAMPORTS_PER_SOL_AMM
						: null,
				min_sol_out: (r.minQuote ?? r.uiQuote)?.toString
					? Number((r.minQuote ?? r.uiQuote).toString()) / LAMPORTS_PER_SOL_AMM
					: null,
				slippage_bps: slippageBps,
				source: 'amm',
			};
		}

		return json(res, 200, {
			mint: mintStr,
			network,
			graduated: true,
			pool: {
				address: poolKey.toString(),
				base: pool.baseMint.toString(),
				quote: pool.quoteMint.toString(),
				base_reserve: baseReserve.toString(),
				quote_reserve: quoteReserve.toString(),
				lp_supply: pool.lpSupply?.toString?.() ?? null,
			},
			quote,
		});
	} catch (err) {
		return error(
			res,
			err.status || 502,
			err.code || 'pump_sdk_error',
			err.message || 'pump.fun SDK error',
		);
	}
}

// ── governance-prep ────────────────────────────────────────────────────────

const governancePrepSchema = z.object({
	mint: z.string().min(32).max(44),
	authority_wallet: z.string().min(32).max(44),
	new_buyback_bps: z.number().int().min(0).max(10_000),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function handleGovernancePrep(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(governancePrepSchema, await readJson(req));
	const authority = solanaPubkey(body.authority_wallet);
	if (!authority) return error(res, 400, 'validation_error', 'invalid authority_wallet');

	const [row] = await sql`
		select id, user_id, agent_authority from pump_agent_mints
		where mint=${body.mint} and network=${body.network} limit 1
	`;
	if (!row) return error(res, 404, 'not_found', 'agent mint not registered');
	if (row.user_id !== user.id) return error(res, 403, 'forbidden', 'not your agent');
	if (row.agent_authority && row.agent_authority !== body.authority_wallet) {
		return error(res, 403, 'forbidden', 'authority does not match');
	}

	const { offline } = await getPumpAgentOffline({ network: body.network, mint: body.mint });
	const ix = await offline.updateBuybackBps(
		{ authority, buybackBps: body.new_buyback_bps },
		{}, // UpdateBuybackBpsOptions — empty default
	);

	const txBase64 = await buildUnsignedTxBase64({
		network: body.network,
		payer: authority,
		instructions: [ix],
	});

	return json(res, 201, {
		mint: body.mint,
		network: body.network,
		new_buyback_bps: body.new_buyback_bps,
		tx_base64: txBase64,
		instructions:
			'Sign with the agent authority wallet, submit, then optionally PATCH the local row via /api/agents/:id to refresh display.',
	});
}

// ── withdraw-prep ──────────────────────────────────────────────────────────

const withdrawPrepSchema = z.object({
	mint: z.string().min(32).max(44),
	authority_wallet: z.string().min(32).max(44),
	receiver_ata: z.string().min(32).max(44),
	currency_mint: z.string().min(32).max(44).optional(),
	currency_token_program: z.string().min(32).max(44).optional(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function handleWithdrawPrep(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(withdrawPrepSchema, await readJson(req));
	const authority = solanaPubkey(body.authority_wallet);
	const receiverAta = solanaPubkey(body.receiver_ata);
	if (!authority || !receiverAta)
		return error(res, 400, 'validation_error', 'invalid pubkeys');

	const [row] = await sql`
		select m.id, m.mint, m.user_id, m.agent_authority, m.network from pump_agent_mints m
		where m.mint=${body.mint} and m.network=${body.network} limit 1
	`;
	if (!row) return error(res, 404, 'not_found', 'agent mint not registered');
	if (row.user_id !== user.id) return error(res, 403, 'forbidden', 'not your agent');
	if (row.agent_authority && row.agent_authority !== body.authority_wallet) {
		return error(res, 403, 'forbidden', 'authority does not match');
	}

	const currencyStr =
		body.currency_mint ||
		(body.network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT);
	const currency = solanaPubkey(currencyStr);
	if (!currency) return error(res, 400, 'validation_error', 'invalid currency_mint');

	const { offline } = await getPumpAgentOffline({
		network: body.network,
		mint: body.mint,
	});

	const tokenProgram = body.currency_token_program
		? solanaPubkey(body.currency_token_program)
		: undefined;

	const ix = await offline.withdraw({
		authority,
		currencyMint: currency,
		receiverAta,
		...(tokenProgram ? { tokenProgram } : {}),
	});

	const txBase64 = await buildUnsignedTxBase64({
		network: body.network,
		payer: authority,
		instructions: [ix],
	});

	return json(res, 201, {
		mint: body.mint,
		network: body.network,
		currency_mint: currencyStr,
		tx_base64: txBase64,
	});
}

// ── withdraw-confirm ───────────────────────────────────────────────────────

const withdrawConfirmSchema = z.object({
	mint: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	tx_signature: z.string().min(80).max(100),
});

async function handleWithdrawConfirm(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(withdrawConfirmSchema, await readJson(req));

	const [row] = await sql`
		select id, mint, user_id, agent_authority, network from pump_agent_mints
		where mint=${body.mint} and network=${body.network} limit 1
	`;
	if (!row) return error(res, 404, 'not_found', 'agent mint not registered');
	if (row.user_id !== user.id) return error(res, 403, 'forbidden', 'not your agent');

	let tx;
	try {
		tx = await verifySignature({ network: body.network, signature: body.tx_signature });
	} catch (e) {
		return error(res, e.status || 422, e.code || 'tx_failed', e.message);
	}

	const accountKeys = tx.transaction.message.accountKeys.map((k) => (k.pubkey || k).toString());
	if (!accountKeys.includes(body.mint)) {
		return error(res, 422, 'mint_not_in_tx', 'mint not present in tx accounts');
	}
	if (row.agent_authority && !accountKeys.includes(row.agent_authority)) {
		return error(res, 422, 'authority_not_in_tx', 'agent authority not present in tx');
	}

	return json(res, 200, {
		ok: true,
		mint: body.mint,
		network: body.network,
		tx_signature: body.tx_signature,
		slot: tx.slot ?? null,
		block_time: tx.blockTime ?? null,
	});
}

// ── strategy-backtest ──────────────────────────────────────────────────────

async function resolveStrategyMints(invoke, strategy, explicit, limit) {
	if (Array.isArray(explicit) && explicit.length) return explicit;
	const scan = strategy?.scan ?? {};
	if (scan.kind === 'mintList' && Array.isArray(scan.mints)) return scan.mints;
	const tool = scan.kind === 'trending' ? 'pump-fun.getTrendingTokens' : 'pump-fun.getNewTokens';
	const r = await invoke(tool, { limit: limit ?? scan.limit ?? 20 });
	if (!r.ok) throw new Error(`scan failed: ${r.error}`);
	const items = r.data?.tokens ?? r.data ?? [];
	return items.map((t) => t.mint ?? t.address).filter(Boolean);
}

async function handleStrategyBacktest(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	if (!body?.strategy) return error(res, 400, 'validation_error', 'strategy required');

	const rt = makeRuntime();
	let mints;
	try {
		mints = await resolveStrategyMints(rt.invoke, body.strategy, body.mints, body.limit);
	} catch (e) {
		return error(res, 502, 'upstream_error', e.message);
	}
	if (!mints.length) return error(res, 422, 'no_candidates', 'no mints to backtest');

	const { backtestStrategy } = await import('../../examples/skills/pump-fun-strategy/handlers.js');
	const result = await backtestStrategy(
		{ strategy: body.strategy, mints, sinceMs: body.sinceMs ?? 0 },
		{ skills: { invoke: rt.invoke }, memory: { note: () => {} } },
	);
	if (!result.ok) return error(res, 400, 'validation_error', result.error);
	return json(res, 200, { data: { ...result.data, mintsUsed: mints } });
}

// ── strategy-close-all ─────────────────────────────────────────────────────

async function handleStrategyCloseAll(req, res) {
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
}

// ── strategy-run ───────────────────────────────────────────────────────────
// SSE — manages its own response writes; routed before wrap() above.

async function loadAgentWalletForStrategy(agentId, userId) {
	const [row] = await sql`
		SELECT user_id, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw Object.assign(new Error('agent not found'), { status: 404 });
	if (row.user_id !== userId) throw Object.assign(new Error('not your agent'), { status: 403 });
	const enc = row.meta?.encrypted_solana_secret;
	if (!enc) throw Object.assign(new Error('agent has no solana wallet — provision via /api/agents/:id/solana'), { status: 409 });
	const wallet = await loadWallet(enc);
	return { wallet, address: wallet.publicKey.toBase58(), meta: row.meta };
}

async function handleStrategyRun(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try { body = await readJson(req); }
	catch (e) { return error(res, 400, 'validation_error', e.message); }

	if (!body?.strategy) return error(res, 400, 'validation_error', 'strategy required');
	const durationSec = Math.max(5, Math.min(600, Number(body.durationSec) || 30));
	const mode = body.mode === 'live' ? 'live' : 'simulate';
	const network = body.network === 'devnet' ? 'devnet' : 'mainnet';

	let wallet = null, walletAddress = null, agentMeta = null;
	if (mode === 'live') {
		const auth = await resolveAuth(req);
		if (!auth) return error(res, 401, 'unauthorized', 'sign in required for live mode');
		if (!body.agentId) return error(res, 400, 'validation_error', 'agentId required for live mode');
		try {
			const r = await loadAgentWalletForStrategy(body.agentId, auth.userId);
			wallet = r.wallet;
			walletAddress = r.address;
			agentMeta = r.meta;
		} catch (e) {
			return error(res, e.status ?? 500, e.status === 409 ? 'conflict' : 'unauthorized', e.message);
		}
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'text/event-stream');
	res.setHeader('cache-control', 'no-cache, no-transform');
	res.setHeader('connection', 'keep-alive');
	res.setHeader('access-control-allow-origin', '*');
	const send = (event, data) => {
		res.write(`event: ${event}\n`);
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	let aborted = false;
	req.on('close', () => { aborted = true; });

	const rt = makeRuntime({
		wallet,
		agentId: mode === 'live' ? body.agentId : undefined,
		signerAddress: walletAddress,
		configOverrides: {
			'pump-fun-trade': { rpc: RPC[network] },
			'solana-wallet': { rpc: RPC[network] },
		},
		onEvent: (e) => send('memory', e),
	});

	send('start', { durationSec, mode, network, walletAddress });

	const { runStrategy } = await import('../../examples/skills/pump-fun-strategy/handlers.js');
	const ctx = {
		skills: { invoke: rt.invoke },
		skillConfig: { defaultPollMs: Math.max(1500, Number(body.pollMs) || 3000) },
		memory: { note: (tag, value) => send('memory', { tag, value }) },
		wallet,
	};

	const policyGuard = mode === 'live'
		? async ({ mint, amountSol }) => {
			const block = await checkBuyAllowed({ agentId: body.agentId, meta: agentMeta, mint, solAmount: amountSol });
			return block ? { code: block.code, msg: block.msg } : null;
		}
		: null;

	const abortController = new AbortController();
	req.on('close', () => abortController.abort());

	try {
		const result = await runStrategy(
			{
				strategy: body.strategy,
				durationSec,
				simulate: mode === 'simulate',
				onLog: (entry) => { if (!aborted) send('log', entry); },
				policyGuard,
				abortSignal: abortController.signal,
			},
			ctx,
		);
		send('done', result.data);
	} catch (e) {
		send('error', { message: e.message });
	}
	res.end();
}

// ── strategy-validate ──────────────────────────────────────────────────────

async function handleStrategyValidate(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	if (!body?.strategy || typeof body.strategy !== 'object') {
		return error(res, 400, 'validation_error', 'strategy required');
	}

	const rt = makeRuntime();
	const r = await rt.invoke('pump-fun-strategy.validateStrategy', { strategy: body.strategy });
	if (!r.ok) return error(res, 400, 'validation_error', r.error);
	return json(res, 200, { data: r.data });
}
