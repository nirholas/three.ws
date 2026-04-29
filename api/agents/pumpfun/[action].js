/**
 * Consolidated pumpfun action dispatcher.
 *
 * Routes (via vercel.json rewrites):
 *   POST /api/agents/:id/pumpfun/launch    — create a pump.fun token from this agent
 *   POST /api/agents/:id/pumpfun/buy       — bonding-curve buy
 *   POST /api/agents/:id/pumpfun/sell      — bonding-curve sell
 *   GET  /api/agents/:id/pumpfun/portfolio — aggregated positions + live PnL
 *   POST /api/agents/:id/pumpfun/swap      — AMM swap (graduated tokens)
 *   POST /api/agents/:id/pumpfun/pay       — @pump-fun/agent-payments-sdk surface
 *
 * One bundle so Vercel doesn't re-bundle @solana/web3.js + @pump-fun/* per file.
 */

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { loadAgentForSigning, solanaConnection } from '../../_lib/agent-pumpfun.js';
import { checkBuyAllowed } from '../../_lib/agent-spend-policy.js';
import { grindMintKeypair } from '../../_lib/pump-vanity.js';
import { sql } from '../../_lib/db.js';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { z } from 'zod';

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

function extractAgentId(req) {
	// Original URL pattern: /api/agents/:id/pumpfun/:action — id at parts[2].
	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	if (parts[1] === 'agents' && parts[3] === 'pumpfun') return parts[2];
	// Fallback: query string (in case vercel.json passes it that way).
	return req.query?.id || null;
}

export default wrap(async (req, res) => {
	const action = req.query?.action;
	const id = extractAgentId(req);

	if (!id) {
		if (cors(req, res)) return;
		return error(res, 400, 'bad_request', 'missing agent id');
	}

	if (action === 'buy') return handleBuy(req, res, id);
	if (action === 'launch') return handleLaunch(req, res, id);
	if (action === 'pay') return handlePay(req, res, id);
	if (action === 'portfolio') return handlePortfolio(req, res, id);
	if (action === 'sell') return handleSell(req, res, id);
	if (action === 'swap') return handleSwap(req, res, id);

	if (cors(req, res)) return;
	return error(res, 404, 'not_found', 'unknown pumpfun action');
});

// ── buy ────────────────────────────────────────────────────────────────────

const buyBodySchema = z.object({
	mint: z.string().min(32).max(64),
	solAmount: z.number().positive().max(1000),
	slippageBps: z.number().int().min(0).max(10_000).default(500),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function handleBuy(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = buyBodySchema.parse(await readJson(req));
	} catch (e) {
		return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
	}

	const loaded = await loadAgentForSigning(id, auth.userId);
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair, meta } = loaded;

	const blocked = await checkBuyAllowed({
		agentId: id,
		meta,
		mint: body.mint,
		solAmount: body.solAmount,
	});
	if (blocked) return error(res, blocked.status, blocked.code, blocked.msg);

	const [{ PumpSdk, OnlinePumpSdk, getBuyTokenAmountFromSolAmount }, BN, splToken] =
		await Promise.all([
			import('@pump-fun/pump-sdk'),
			import('bn.js').then((m) => m.default || m),
			import('@solana/spl-token'),
		]);

	const conn = solanaConnection(body.network);
	const online = new OnlinePumpSdk(conn);
	const sdk = new PumpSdk();
	const mint = new PublicKey(body.mint);
	const solLamports = new BN(Math.floor(body.solAmount * 1e9));

	let instructions;
	try {
		const [global, state] = await Promise.all([
			online.fetchGlobal(),
			online.fetchBuyState(mint, keypair.publicKey),
		]);
		const expected = getBuyTokenAmountFromSolAmount({
			global,
			feeConfig: null,
			mintSupply: state.bondingCurve.tokenTotalSupply,
			bondingCurve: state.bondingCurve,
			amount: solLamports,
		});
		instructions = await sdk.buyInstructions({
			global,
			bondingCurveAccountInfo: state.bondingCurveAccountInfo,
			bondingCurve: state.bondingCurve,
			associatedUserAccountInfo: state.associatedUserAccountInfo,
			mint,
			user: keypair.publicKey,
			amount: expected,
			solAmount: solLamports,
			slippage: body.slippageBps / 10_000,
			tokenProgram: splToken.TOKEN_PROGRAM_ID,
		});
	} catch (err) {
		console.error('[pumpfun/buy] build failed', err);
		return error(res, 422, 'build_failed', err.message || 'could not build buy ix');
	}

	const tx = new Transaction().add(...instructions);
	tx.feePayer = keypair.publicKey;
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.sign(keypair);

	let signature;
	try {
		signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
		await conn.confirmTransaction(signature, 'confirmed');
	} catch (err) {
		console.error('[pumpfun/buy] send failed', err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (
			${id},
			${'pumpfun.buy'},
			${JSON.stringify({
				mint: body.mint,
				solAmount: body.solAmount,
				slippageBps: body.slippageBps,
				signature,
				network: body.network,
			})}::jsonb,
			${'pumpfun'}
		)
	`.catch((e) => console.error('[pumpfun/buy] log failed', e));

	// Mirror into pump_agent_trades for cross-feature analytics (reputation,
	// admin health, strategy backtests). Best-effort — agent may not have a
	// pump_agent_mints row yet if the mint was launched outside three.ws.
	try {
		const [m] = await sql`
			select id from pump_agent_mints where mint=${body.mint} and network=${body.network} limit 1
		`;
		if (m) {
			const lamports = BigInt(Math.floor(body.solAmount * 1_000_000_000));
			await sql`
				INSERT INTO pump_agent_trades
					(mint_id, user_id, wallet, direction, route, sol_amount, slippage_bps, tx_signature, network)
				VALUES
					(${m.id}, ${auth.userId}, ${keypair.publicKey.toBase58()}, 'buy',
					 'bonding_curve', ${lamports.toString()}, ${body.slippageBps || null},
					 ${signature}, ${body.network})
				ON CONFLICT (tx_signature, network) DO NOTHING
			`;
		}
	} catch (e) {
		console.error('[pumpfun/buy] trade index failed', e);
	}

	return json(res, 200, {
		data: {
			signature,
			mint: body.mint,
			solAmount: body.solAmount,
			explorer: `https://solscan.io/tx/${signature}${body.network === 'devnet' ? '?cluster=devnet' : ''}`,
		},
	});
}

// ── launch ─────────────────────────────────────────────────────────────────

const launchBodySchema = z.object({
	name: z.string().trim().min(1).max(32),
	symbol: z.string().trim().min(1).max(10),
	uri: z.string().url().max(2048),
	solAmount: z.number().nonnegative().max(1000).optional(),
	tokenAmount: z.number().nonnegative().optional(),
	vanityPrefix: z.string().min(1).max(6).optional(),
	vanitySuffix: z.string().min(1).max(6).optional(),
	vanityIgnoreCase: z.boolean().optional(),
	mintSecretKey: z.array(z.number().int().min(0).max(255)).length(64).optional(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function handleLaunch(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = launchBodySchema.parse(await readJson(req));
	} catch (e) {
		return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
	}

	const loaded = await loadAgentForSigning(id, auth.userId);
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair } = loaded;

	const { PumpSdk, OnlinePumpSdk } = await import('@pump-fun/pump-sdk');
	const BN = (await import('bn.js')).default;
	const conn = solanaConnection(body.network);
	const online = new OnlinePumpSdk(conn);
	const sdk = new PumpSdk();

	let mint;
	let vanityIterations = 1;
	let vanityDurationMs = 0;
	if (body.mintSecretKey) {
		try {
			mint = Keypair.fromSecretKey(Uint8Array.from(body.mintSecretKey));
		} catch (e) {
			return error(res, 400, 'validation_error', 'mintSecretKey did not parse as a valid Solana keypair');
		}
		const addr = mint.publicKey.toBase58();
		const ic = !!body.vanityIgnoreCase;
		const cmp = (a, b) => (ic ? a.toLowerCase() === b.toLowerCase() : a === b);
		if (body.vanityPrefix && !cmp(addr.slice(0, body.vanityPrefix.length), body.vanityPrefix)) {
			return error(res, 400, 'validation_error', 'mintSecretKey does not match vanityPrefix');
		}
		if (body.vanitySuffix && !cmp(addr.slice(-body.vanitySuffix.length), body.vanitySuffix)) {
			return error(res, 400, 'validation_error', 'mintSecretKey does not match vanitySuffix');
		}
	} else {
		try {
			const ground = await grindMintKeypair({
				prefix: body.vanityPrefix,
				suffix: body.vanitySuffix,
				ignoreCase: body.vanityIgnoreCase,
			});
			mint = ground.keypair;
			vanityIterations = ground.iterations;
			vanityDurationMs = ground.durationMs;
		} catch (err) {
			return error(res, err.status || 500, err.code || 'internal', err.message);
		}
	}
	const solLamports = new BN(Math.floor((body.solAmount || 0) * 1e9));
	const tokenAmount = new BN(body.tokenAmount || 0);

	let instructions;
	if (solLamports.gtn(0)) {
		const global = await online.fetchGlobal();
		instructions = await sdk.createV2AndBuyInstructions({
			global,
			mint: mint.publicKey,
			name: body.name,
			symbol: body.symbol,
			uri: body.uri,
			creator: keypair.publicKey,
			user: keypair.publicKey,
			amount: tokenAmount,
			solAmount: solLamports,
			mayhemMode: false,
		});
	} else {
		const ix = await sdk.createV2Instruction({
			mint: mint.publicKey,
			name: body.name,
			symbol: body.symbol,
			uri: body.uri,
			creator: keypair.publicKey,
			user: keypair.publicKey,
			mayhemMode: false,
		});
		instructions = [ix];
	}

	const tx = new Transaction().add(...instructions);
	tx.feePayer = keypair.publicKey;
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.sign(keypair, mint);

	let signature;
	try {
		signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
		await conn.confirmTransaction(signature, 'confirmed');
	} catch (err) {
		console.error('[pumpfun/launch] send failed', err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	const mintAddr = mint.publicKey.toBase58();
	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (
			${id},
			${'pumpfun.launch'},
			${JSON.stringify({
				mint: mintAddr,
				name: body.name,
				symbol: body.symbol,
				uri: body.uri,
				signature,
				network: body.network,
				solAmount: body.solAmount || 0,
				vanity_prefix: body.vanityPrefix || null,
				vanity_suffix: body.vanitySuffix || null,
				vanity_ignore_case: body.vanityIgnoreCase || false,
				vanity_iterations: vanityIterations,
				vanity_duration_ms: vanityDurationMs,
			})}::jsonb,
			${'pumpfun'}
		)
	`.catch((e) => console.error('[pumpfun/launch] log failed', e));

	// Register the mint in the indexer table so pump-agent-stats cron picks it up.
	await sql`
		INSERT INTO pump_agent_mints
			(agent_id, user_id, network, mint, name, symbol, metadata_uri, agent_authority)
		VALUES
			(${id}, ${auth.userId}, ${body.network}, ${mintAddr},
			 ${body.name}, ${body.symbol}, ${body.uri}, ${keypair.publicKey.toBase58()})
		ON CONFLICT (mint, network) DO NOTHING
	`.catch((e) => console.error('[pumpfun/launch] mint index failed', e));

	return json(res, 201, {
		data: {
			mint: mint.publicKey.toBase58(),
			signature,
			explorer: `https://solscan.io/tx/${signature}${body.network === 'devnet' ? '?cluster=devnet' : ''}`,
			pumpfun_url: `https://pump.fun/${mint.publicKey.toBase58()}`,
			vanity_prefix: body.vanityPrefix || null,
			vanity_suffix: body.vanitySuffix || null,
			vanity_iterations: vanityIterations,
			vanity_duration_ms: vanityDurationMs,
		},
	});
}

// ── pay ────────────────────────────────────────────────────────────────────

const payBodySchema = z.object({
	action: z.enum([
		'create',
		'accept',
		'withdraw',
		'distribute',
		'extend_account',
		'update_authority',
		'update_buyback',
		'balances',
	]),
	tokenMint: z.string().min(32).max(64),
	currencyMint: z.string().min(32).max(64).default(NATIVE_SOL_MINT),
	amount: z.string().regex(/^\d+$/).optional(),
	memo: z.string().regex(/^\d+$/).optional(),
	startTime: z.number().int().nonnegative().optional(),
	endTime: z.number().int().nonnegative().optional(),
	receiverAta: z.string().min(32).max(64).optional(),
	userTokenAccount: z.string().min(32).max(64).optional(),
	account: z.string().min(32).max(64).optional(),
	newAuthority: z.string().min(32).max(64).optional(),
	buybackBps: z.number().int().min(0).max(10_000).optional(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

function payNeed(body, ...fields) {
	const missing = fields.filter((f) => body[f] == null || body[f] === '');
	if (missing.length)
		return { status: 400, code: 'validation_error', msg: `missing: ${missing.join(', ')}` };
	return null;
}

function explorerUrl(sig, network) {
	return `https://solscan.io/tx/${sig}${network === 'devnet' ? '?cluster=devnet' : ''}`;
}

async function handlePay(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = payBodySchema.parse(await readJson(req));
	} catch (e) {
		return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
	}

	const loaded = await loadAgentForSigning(id, auth.userId, {
		reason: `pumpfun.pay.${body.action}`,
		meta: { tokenMint: body.tokenMint, network: body.network },
	});
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair } = loaded;

	const conn = solanaConnection(body.network);
	const tokenMint = new PublicKey(body.tokenMint);
	const currencyMint = new PublicKey(body.currencyMint);
	const { PumpAgent } = await import('@pump-fun/agent-payments-sdk');
	const agent = new PumpAgent(tokenMint, body.network, conn);

	// ── Read-only ──────────────────────────────────────────────────────────
	if (body.action === 'balances') {
		try {
			const balances = await agent.getBalances(currencyMint);
			return json(res, 200, {
				data: {
					tokenMint: body.tokenMint,
					currencyMint: body.currencyMint,
					balances: {
						paymentVault: {
							address: balances.paymentVault.address.toBase58(),
							balance: balances.paymentVault.balance.toString(),
						},
						buybackVault: {
							address: balances.buybackVault.address.toBase58(),
							balance: balances.buybackVault.balance.toString(),
						},
						withdrawVault: {
							address: balances.withdrawVault.address.toBase58(),
							balance: balances.withdrawVault.balance.toString(),
						},
					},
				},
			});
		} catch (err) {
			console.error('[pumpfun/pay] balances failed', err);
			return error(res, 502, 'rpc_error', err.message || 'balance fetch failed');
		}
	}

	// ── Build instructions per action ──────────────────────────────────────
	let instructions;
	let extra = {};
	try {
		switch (body.action) {
			case 'create': {
				const miss = payNeed(body, 'buybackBps');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.create({
					authority: keypair.publicKey,
					mint: tokenMint,
					agentAuthority: keypair.publicKey,
					buybackBps: body.buybackBps,
				});
				instructions = [ix];
				extra = { buybackBps: body.buybackBps };
				break;
			}
			case 'accept': {
				const miss = payNeed(body, 'amount', 'memo', 'startTime', 'endTime');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				instructions = await agent.buildAcceptPaymentInstructions({
					user: keypair.publicKey,
					currencyMint,
					amount: body.amount,
					memo: body.memo,
					startTime: body.startTime,
					endTime: body.endTime,
				});
				extra = {
					amount: body.amount,
					memo: body.memo,
					startTime: body.startTime,
					endTime: body.endTime,
				};
				break;
			}
			case 'withdraw': {
				const miss = payNeed(body, 'receiverAta');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.withdraw({
					authority: keypair.publicKey,
					currencyMint,
					receiverAta: new PublicKey(body.receiverAta),
				});
				instructions = [ix];
				extra = { receiverAta: body.receiverAta };
				break;
			}
			case 'distribute': {
				instructions = await agent.distributePayments({
					user: keypair.publicKey,
					currencyMint,
				});
				break;
			}
			case 'extend_account': {
				const miss = payNeed(body, 'account');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.extendAccount({
					account: new PublicKey(body.account),
					user: keypair.publicKey,
				});
				instructions = [ix];
				extra = { account: body.account };
				break;
			}
			case 'update_authority': {
				const miss = payNeed(body, 'newAuthority');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.updateAuthority({
					authority: keypair.publicKey,
					newAuthority: new PublicKey(body.newAuthority),
				});
				instructions = [ix];
				extra = { newAuthority: body.newAuthority };
				break;
			}
			case 'update_buyback': {
				const miss = payNeed(body, 'buybackBps');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.updateBuybackBps({
					authority: keypair.publicKey,
					buybackBps: body.buybackBps,
				});
				instructions = [ix];
				extra = { buybackBps: body.buybackBps };
				break;
			}
		}
	} catch (err) {
		console.error(`[pumpfun/pay] ${body.action} build failed`, err);
		return error(res, 422, 'build_failed', err.message || 'could not build instruction');
	}

	const tx = new Transaction().add(...instructions);
	tx.feePayer = keypair.publicKey;
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.sign(keypair);

	let signature;
	try {
		signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
		await conn.confirmTransaction(signature, 'confirmed');
	} catch (err) {
		console.error(`[pumpfun/pay] ${body.action} send failed`, err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (
			${id},
			${`pumpfun.pay.${body.action}`},
			${JSON.stringify({
				tokenMint: body.tokenMint,
				currencyMint: body.currencyMint,
				signature,
				network: body.network,
				...extra,
			})}::jsonb,
			${'pumpfun'}
		)
	`.catch((e) => console.error('[pumpfun/pay] log failed', e));

	return json(res, 200, {
		data: {
			signature,
			action: body.action,
			tokenMint: body.tokenMint,
			currencyMint: body.currencyMint,
			explorer: explorerUrl(signature, body.network),
			...extra,
		},
	});
}

// ── portfolio ──────────────────────────────────────────────────────────────

function lamportsToSol(bnLike) {
	if (!bnLike) return 0;
	const s = typeof bnLike === 'string' ? bnLike : bnLike.toString();
	return Number(s) / 1e9;
}

async function handlePortfolio(req, res, id) {
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
			AND type IN ('pumpfun.buy', 'pumpfun.sell', 'pumpfun.launch',
			             'pumpfun.swap.buy', 'pumpfun.swap.sell')
			AND (payload->>'network') = ${network}
	`;

	// Aggregate per mint
	const byMint = new Map();
	for (const row of rows) {
		const p = row.payload || {};
		const mint = p.mint;
		if (!mint) continue;
		const e = byMint.get(mint) || { mint, sol_in: 0, sol_out: 0 };
		if (row.type === 'pumpfun.buy' || row.type === 'pumpfun.launch' || row.type === 'pumpfun.swap.buy') {
			e.sol_in += Number(p.solAmount) || 0;
		} else if (row.type === 'pumpfun.sell' || row.type === 'pumpfun.swap.sell') {
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
	const [{ PumpSdk, OnlinePumpSdk, getSellSolAmountFromTokenAmount }, ammMod, splToken, BN] =
		await Promise.all([
			import('@pump-fun/pump-sdk'),
			import('@pump-fun/pump-swap-sdk'),
			import('@solana/spl-token'),
			import('bn.js').then((m) => m.default || m),
		]);
	const online = new OnlinePumpSdk(conn);
	const onlineAmm = new ammMod.OnlinePumpAmmSdk(conn);
	const ammSdk = new ammMod.PumpAmmSdk();
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
				if (!out.graduated) {
					const expectedSol = getSellSolAmountFromTokenAmount({
						global,
						feeConfig: null,
						mintSupply: state.bondingCurve.tokenTotalSupply,
						bondingCurve: state.bondingCurve,
						amount: new BN(out.token_balance),
					});
					out.estimated_sol_value = lamportsToSol(expectedSol);
					out.venue = 'curve';
				} else {
					// AMM quote: simulate sellBaseInput to get expected SOL out.
					try {
						const poolKey = ammMod.canonicalPumpPoolPda(mintPk);
						const swapState = await onlineAmm.swapSolanaState(poolKey, keypair.publicKey);
						const result = ammSdk.sellAutocompleteQuoteFromBase
							? ammSdk.sellAutocompleteQuoteFromBase(swapState, new BN(out.token_balance), 0)
							: null;
						if (result && result.uiQuote != null) {
							out.estimated_sol_value = lamportsToSol(result.uiQuote);
						} else {
							const pool = swapState.pool;
							const baseReserve = pool.baseReserve || pool.virtualBaseReserves;
							const quoteReserve = pool.quoteReserve || pool.virtualQuoteReserves;
							if (baseReserve && quoteReserve) {
								const bal = new BN(out.token_balance);
								const out_q = bal.mul(quoteReserve).div(baseReserve.add(bal));
								out.estimated_sol_value = lamportsToSol(out_q);
							} else {
								out.estimated_sol_value = null;
							}
						}
						out.venue = 'amm';
						out.pool = poolKey.toBase58();
					} catch (e) {
						console.error('[pumpfun/portfolio] amm quote failed', e);
						out.estimated_sol_value = null;
						out.error = 'amm_quote_failed';
					}
				}
				if (typeof out.estimated_sol_value === 'number') {
					out.unrealized_pnl_sol = out.estimated_sol_value + out.sol_out - out.sol_in;
				} else {
					out.unrealized_pnl_sol = null;
				}
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

// ── sell ───────────────────────────────────────────────────────────────────

const sellBodySchema = z.object({
	mint: z.string().min(32).max(64),
	tokenAmount: z.string().regex(/^\d+$/, 'must be a base-unit integer string'),
	slippageBps: z.number().int().min(0).max(10_000).default(500),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function handleSell(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = sellBodySchema.parse(await readJson(req));
	} catch (e) {
		return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
	}

	const loaded = await loadAgentForSigning(id, auth.userId);
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair } = loaded;

	const [{ PumpSdk, OnlinePumpSdk, getSellSolAmountFromTokenAmount }, BN, splToken] =
		await Promise.all([
			import('@pump-fun/pump-sdk'),
			import('bn.js').then((m) => m.default || m),
			import('@solana/spl-token'),
		]);

	const conn = solanaConnection(body.network);
	const online = new OnlinePumpSdk(conn);
	const sdk = new PumpSdk();
	const mint = new PublicKey(body.mint);
	const tokenAmount = new BN(body.tokenAmount);

	let instructions;
	let expectedSolStr;
	try {
		const [global, state] = await Promise.all([
			online.fetchGlobal(),
			online.fetchSellState(mint, keypair.publicKey),
		]);
		const expectedSol = getSellSolAmountFromTokenAmount({
			global,
			feeConfig: null,
			mintSupply: state.bondingCurve.tokenTotalSupply,
			bondingCurve: state.bondingCurve,
			amount: tokenAmount,
		});
		expectedSolStr = expectedSol.toString();
		instructions = await sdk.sellInstructions({
			global,
			bondingCurveAccountInfo: state.bondingCurveAccountInfo,
			bondingCurve: state.bondingCurve,
			mint,
			user: keypair.publicKey,
			amount: tokenAmount,
			solAmount: expectedSol,
			slippage: body.slippageBps / 10_000,
			tokenProgram: splToken.TOKEN_PROGRAM_ID,
			mayhemMode: false,
		});
	} catch (err) {
		console.error('[pumpfun/sell] build failed', err);
		return error(res, 422, 'build_failed', err.message || 'could not build sell ix');
	}

	const tx = new Transaction().add(...instructions);
	tx.feePayer = keypair.publicKey;
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.sign(keypair);

	let signature;
	try {
		signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
		await conn.confirmTransaction(signature, 'confirmed');
	} catch (err) {
		console.error('[pumpfun/sell] send failed', err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (
			${id},
			${'pumpfun.sell'},
			${JSON.stringify({
				mint: body.mint,
				tokenAmount: body.tokenAmount,
				expectedSolLamports: expectedSolStr,
				slippageBps: body.slippageBps,
				signature,
				network: body.network,
			})}::jsonb,
			${'pumpfun'}
		)
	`.catch((e) => console.error('[pumpfun/sell] log failed', e));

	try {
		const [m] = await sql`
			select id from pump_agent_mints where mint=${body.mint} and network=${body.network} limit 1
		`;
		if (m) {
			await sql`
				INSERT INTO pump_agent_trades
					(mint_id, user_id, wallet, direction, route, sol_amount, token_amount, slippage_bps, tx_signature, network)
				VALUES
					(${m.id}, ${auth.userId}, ${keypair.publicKey.toBase58()}, 'sell',
					 'bonding_curve', ${expectedSolStr || null}, ${body.tokenAmount},
					 ${body.slippageBps || null}, ${signature}, ${body.network})
				ON CONFLICT (tx_signature, network) DO NOTHING
			`;
		}
	} catch (e) {
		console.error('[pumpfun/sell] trade index failed', e);
	}

	return json(res, 200, {
		data: {
			signature,
			mint: body.mint,
			tokenAmount: body.tokenAmount,
			expectedSolLamports: expectedSolStr,
			explorer: `https://solscan.io/tx/${signature}${body.network === 'devnet' ? '?cluster=devnet' : ''}`,
		},
	});
}

// ── swap ───────────────────────────────────────────────────────────────────

const swapBodySchema = z.object({
	mint: z.string().min(32).max(64),
	side: z.enum(['buy', 'sell']),
	solAmount: z.number().nonnegative().max(1000).optional(),
	tokenAmount: z.string().regex(/^\d+$/).optional(),
	slippageBps: z.number().int().min(0).max(10_000).default(500),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function handleSwap(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = swapBodySchema.parse(await readJson(req));
	} catch (e) {
		return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
	}
	if (body.side === 'buy' && !body.solAmount)
		return error(res, 400, 'validation_error', 'side=buy requires solAmount');
	if (body.side === 'sell' && !body.tokenAmount)
		return error(res, 400, 'validation_error', 'side=sell requires tokenAmount');

	const loaded = await loadAgentForSigning(id, auth.userId, {
		reason: `pumpfun.swap.${body.side}`,
		meta: { mint: body.mint, network: body.network },
	});
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair, meta } = loaded;

	if (body.side === 'buy') {
		const blocked = await checkBuyAllowed({
			agentId: id, meta, mint: body.mint, solAmount: body.solAmount,
		});
		if (blocked) return error(res, blocked.status, blocked.code, blocked.msg);
	}

	const conn = solanaConnection(body.network);
	const mint = new PublicKey(body.mint);

	// Detect graduation. If still on bonding curve, delegate to /buy or /sell.
	const { PumpSdk, bondingCurvePda } = await import('@pump-fun/pump-sdk');
	const pumpSdk = new PumpSdk();
	const bcInfo = await conn.getAccountInfo(bondingCurvePda(mint));
	const bc = bcInfo ? pumpSdk.decodeBondingCurveNullable(bcInfo) : null;
	const graduated = !bc || bc.complete;

	if (!graduated) {
		return error(
			res,
			409,
			'not_graduated',
			`mint is still on the bonding curve — use /api/agents/${id}/pumpfun/${body.side} instead`,
		);
	}

	// AMM path.
	const { PumpAmmSdk, OnlinePumpAmmSdk, canonicalPumpPoolPda } = await import(
		'@pump-fun/pump-swap-sdk'
	);
	const BN = (await import('bn.js')).default;
	const amm = new PumpAmmSdk();
	const online = new OnlinePumpAmmSdk(conn);

	const poolKey = canonicalPumpPoolPda(mint);
	const swapState = await online.swapSolanaState(poolKey, keypair.publicKey).catch(async (err) => {
		// Fall back: pool account may not be initialized (race after graduation).
		console.error('[pumpfun/swap] swapSolanaState failed', err);
		return online.swapSolanaStateNoPool(poolKey, keypair.publicKey);
	});

	const slippage = body.slippageBps / 10_000;

	let instructions;
	let quotedAmount;
	try {
		if (body.side === 'buy') {
			const quoteLamports = new BN(Math.floor(body.solAmount * 1e9));
			instructions = await amm.buyQuoteInput(swapState, quoteLamports, slippage);
			quotedAmount = { quote_lamports: quoteLamports.toString() };
		} else {
			const baseAmount = new BN(body.tokenAmount);
			instructions = await amm.sellBaseInput(swapState, baseAmount, slippage);
			quotedAmount = { base_amount: baseAmount.toString() };
			// Best-effort expected-SOL-out via constant-product on pool reserves.
			try {
				const pool = swapState.pool || {};
				const baseReserve = pool.baseReserve || pool.virtualBaseReserves;
				const quoteReserve = pool.quoteReserve || pool.virtualQuoteReserves;
				if (baseReserve && quoteReserve) {
					const out = baseAmount.mul(quoteReserve).div(baseReserve.add(baseAmount));
					quotedAmount.expectedSolLamports = out.toString();
				}
			} catch (e) {
				console.error('[pumpfun/swap] sell quote failed', e);
			}
		}
	} catch (err) {
		console.error('[pumpfun/swap] build failed', err);
		return error(res, 422, 'build_failed', err.message || 'could not build swap ix');
	}

	const tx = new Transaction().add(...instructions);
	tx.feePayer = keypair.publicKey;
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.sign(keypair);

	let signature;
	try {
		signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
		await conn.confirmTransaction(signature, 'confirmed');
	} catch (err) {
		console.error('[pumpfun/swap] send failed', err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (
			${id},
			${`pumpfun.swap.${body.side}`},
			${JSON.stringify({
				mint: body.mint,
				side: body.side,
				...(body.side === 'buy'
					? { solAmount: body.solAmount }
					: { tokenAmount: body.tokenAmount }),
				slippageBps: body.slippageBps,
				signature,
				network: body.network,
				venue: 'amm',
				...quotedAmount,
			})}::jsonb,
			${'pumpfun'}
		)
	`.catch((e) => console.error('[pumpfun/swap] log failed', e));

	return json(res, 200, {
		data: {
			signature,
			mint: body.mint,
			side: body.side,
			venue: 'amm',
			pool: poolKey.toBase58(),
			explorer: `https://solscan.io/tx/${signature}${body.network === 'devnet' ? '?cluster=devnet' : ''}`,
		},
	});
}
