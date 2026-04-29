// POST /api/pump-fun-mcp
//
// Real, in-house JSON-RPC 2.0 MCP server exposing read-only pump.fun tools to
// the in-page <agent-3d> skill bundle (public/skills/pump-fun/).
//
// Tools backed by on-chain reads (no external indexer required):
//   - getBondingCurve     → @pump-fun/pump-sdk fetchBondingCurve
//   - getTokenDetails     → @solana/web3.js getAccountInfo + Metaplex metadata
//   - getTokenHolders     → connection.getTokenLargestAccounts + concentration
//
// Tools that require indexed/aggregate data are routed through the existing
// pumpfunMcp client (api/_lib/pumpfun-mcp.js → upstream pumpfun-claims-bot).
// When PUMPFUN_BOT_URL is unset they return JSON-RPC error -32004 ("indexer
// not configured") — never a fabricated payload.
//
// Methods: initialize, tools/list, tools/call. CORS open (read-only data).
// Rate-limited by IP via limits.mcpIp.

import { cors, json, method, wrap, readJson, error } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { getPumpSdk, getConnection, solanaPubkey, getAmmPoolState } from './_lib/pump.js';
import { pumpfunMcp, pumpfunBotEnabled } from './_lib/pumpfun-mcp.js';
import { getRadarSignals } from '../src/kol/radar.js';
import { TOOLS, rpcError, rpcEnvelope } from '../src/pump/mcp-tools.js';
import { generateVanityKey } from '../src/pump/vanity-keygen.js';
import bs58 from 'bs58';
import { resolveSnsName, reverseLookupAddress } from '../src/solana/sns.js';

// ── On-chain handlers ──────────────────────────────────────────────────────

const TOTAL_PUMP_TOKEN_SUPPLY = 1_000_000_000; // 1B pump.fun standard
const GRADUATION_REAL_SOL_LAMPORTS = 85_000_000_000n; // ~85 SOL — heuristic

async function handleGetBondingCurve({ mint, network = 'mainnet' }) {
	const pk = solanaPubkey(mint);
	if (!pk) throw rpcError(-32602, 'invalid mint');
	const { sdk } = await getPumpSdk({ network });
	let curve;
	try {
		if (sdk.fetchBuyState) {
			const state = await sdk.fetchBuyState(pk, pk);
			curve = state.bondingCurve;
		} else if (sdk.fetchBondingCurve) {
			curve = await sdk.fetchBondingCurve(pk);
		}
	} catch (e) {
		throw rpcError(-32004, `bonding curve unavailable: ${e?.message || 'unknown'}`);
	}
	if (!curve) throw rpcError(-32004, 'no bonding curve found for this mint');

	const realSol = BigInt(curve.realSolReserves?.toString?.() ?? '0');
	const realToken = BigInt(curve.realTokenReserves?.toString?.() ?? '0');
	const virtSol = BigInt(curve.virtualSolReserves?.toString?.() ?? '0');
	const virtToken = BigInt(curve.virtualTokenReserves?.toString?.() ?? '0');
	const complete = !!curve.complete;
	// Graduation % heuristic: complete=100, else realSol/graduationTarget * 100.
	const graduationPercent = complete
		? 100
		: Number((realSol * 10000n) / GRADUATION_REAL_SOL_LAMPORTS) / 100;

	return {
		mint,
		network,
		complete,
		graduationPercent,
		solReserves: (Number(realSol) / 1e9).toFixed(4),
		tokenReserves: realToken.toString(),
		virtualSolReserves: virtSol.toString(),
		virtualTokenReserves: virtToken.toString(),
	};
}

async function handleGetTokenDetails({ mint, network = 'mainnet' }) {
	const pk = solanaPubkey(mint);
	if (!pk) throw rpcError(-32602, 'invalid mint');
	const connection = getConnection({ network });
	const [{ MintLayout }, { PublicKey }] = await Promise.all([
		import('@solana/spl-token'),
		import('@solana/web3.js'),
	]);

	const info = await connection.getAccountInfo(pk);
	if (!info) throw rpcError(-32004, 'mint account not found');
	const mintAccount = MintLayout.decode(info.data);

	// Best-effort Metaplex Token Metadata read. PDA = [b"metadata", program, mint].
	const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
	const [metadataPda] = PublicKey.findProgramAddressSync(
		[Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), pk.toBuffer()],
		METADATA_PROGRAM,
	);
	let name = null;
	let symbol = null;
	let uri = null;
	try {
		const metaInfo = await connection.getAccountInfo(metadataPda);
		if (metaInfo) {
			// Layout: 1 key + 32 updateAuthority + 32 mint + 4-byte string-length-prefixed name/symbol/uri.
			const buf = metaInfo.data;
			let cursor = 1 + 32 + 32;
			const readStr = (max) => {
				const len = buf.readUInt32LE(cursor);
				cursor += 4;
				const slice = buf.slice(cursor, cursor + len);
				cursor += max;
				return slice.toString('utf8').replace(/\0+$/g, '').trim();
			};
			name = readStr(32);
			symbol = readStr(10);
			uri = readStr(200);
		}
	} catch {
		// Metadata is optional — proceed without it.
	}

	const supply = mintAccount.supply.toString();
	const decimals = mintAccount.decimals;

	return {
		mint,
		name,
		symbol,
		uri,
		decimals,
		supply,
		mintAuthority: mintAccount.mintAuthorityOption ? mintAccount.mintAuthority.toString() : null,
		freezeAuthority: mintAccount.freezeAuthorityOption
			? mintAccount.freezeAuthority.toString()
			: null,
	};
}

async function handleGetTokenHolders({ mint, limit = 10, network = 'mainnet' }) {
	const pk = solanaPubkey(mint);
	if (!pk) throw rpcError(-32602, 'invalid mint');
	const connection = getConnection({ network });
	let largest;
	try {
		largest = await connection.getTokenLargestAccounts(pk);
	} catch (e) {
		throw rpcError(-32004, `holders unavailable: ${e?.message || 'rpc error'}`);
	}
	const accounts = (largest?.value || []).slice(0, Math.min(20, Math.max(1, limit)));
	const total = accounts.reduce((sum, a) => sum + Number(a.uiAmount || 0), 0);
	const holders = accounts.map((a) => ({
		address: a.address.toString(),
		amount: a.amount,
		uiAmount: a.uiAmount,
		percent: total > 0 ? (Number(a.uiAmount || 0) / total) * 100 : 0,
	}));
	const topHolderPercent = holders[0]?.percent ?? 0;
	return {
		mint,
		count: holders.length,
		topHolderPercent,
		holders,
	};
}

// ── kol_radar handler ──────────────────────────────────────────────────────

async function handleKolRadar({ category = 'pump-fun', limit = 20 }) {
	return getRadarSignals({ category, limit });
}

async function handleKolLeaderboard({ window = '7d', limit = 25 }) {
	const { getLeaderboard } = await import('../src/kol/leaderboard.js');
	return getLeaderboard({ window, limit });
}

// ── SNS handlers ──────────────────────────────────────────────────────────

async function handleSnsResolve({ name }) {
	if (!name) throw rpcError(-32602, 'name is required');
	const address = await resolveSnsName(name);
	if (!address) throw rpcError(-32004, `domain "${name}" not found`);
	return { name, address };
}

async function handleSnsReverseLookup({ address }) {
	if (!address) throw rpcError(-32602, 'address is required');
	const name = await reverseLookupAddress(address);
	if (!name) throw rpcError(-32004, `no .sol domain found for address`);
	return { address, name };
}

// ── Indexer-backed handlers (route through pumpfunMcp) ─────────────────────

function indexerOrUnavailable(name) {
	return async (args) => {
		if (!pumpfunBotEnabled()) {
			throw rpcError(
				-32004,
				`tool "${name}" requires the pump.fun indexer (PUMPFUN_BOT_URL) to be configured`,
			);
		}
		// Map our tool names to the upstream bot's tool surface.
		const upstreamMap = {
			searchTokens: { tool: 'searchTokens', args: { query: args.query, limit: args.limit } },
			getTokenTrades: { tool: 'getTokenTrades', args: { mint: args.mint, limit: args.limit } },
			getTrendingTokens: { tool: 'getTrendingTokens', args: { limit: args.limit } },
			getNewTokens: { tool: 'getNewTokens', args: { limit: args.limit } },
			getGraduatedTokens: { tool: 'getGraduatedTokens', args: { limit: args.limit } },
			getKingOfTheHill: { tool: 'getKingOfTheHill', args: {} },
			getCreatorProfile: { tool: 'getCreatorIntel', args: { wallet: args.creator } },
		};
		const upstream = upstreamMap[name];
		if (!upstream) throw rpcError(-32601, `tool "${name}" not implemented`);
		// Use the lower-level rpc-style call via callTool; pumpfunMcp's named
		// methods cover only a subset, so fall back to a generic invocation.
		const r = await pumpfunMcpCall(upstream.tool, upstream.args);
		if (!r.ok) throw rpcError(-32004, r.error || 'indexer error');
		return r.data;
	};
}

// Generic tools/call against the upstream bot using the same transport that
// pumpfunMcp uses internally. Encapsulated here so we don't leak transport
// details into the route.
async function pumpfunMcpCall(tool, args) {
	if (tool === 'getCreatorIntel') return pumpfunMcp.creatorIntel({ wallet: args?.wallet });
	if (tool === 'getRecentClaims') return pumpfunMcp.recentClaims({ limit: args?.limit });
	if (tool === 'getGraduations') return pumpfunMcp.graduations({ limit: args?.limit });
	// Fall through: not in the named surface — call raw rpc.
	return rawBotCall(tool, args);
}

async function rawBotCall(tool, args) {
	const url = process.env.PUMPFUN_BOT_URL;
	if (!url) return { ok: false, error: 'PUMPFUN_BOT_URL not set' };
	const headers = { 'content-type': 'application/json', accept: 'application/json' };
	if (process.env.PUMPFUN_BOT_TOKEN)
		headers.authorization = `Bearer ${process.env.PUMPFUN_BOT_TOKEN}`;
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 8000);
	try {
		const r = await fetch(url.replace(/\/$/, ''), {
			method: 'POST',
			headers,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: tool, arguments: args || {} },
			}),
			signal: ctrl.signal,
		});
		if (!r.ok) return { ok: false, error: `bot ${r.status}` };
		const j = await r.json();
		if (j.error) return { ok: false, error: j.error.message || 'rpc error' };
		const payload = j.result?.structuredContent ?? j.result?.content ?? j.result;
		return { ok: true, data: payload };
	} catch (err) {
		return {
			ok: false,
			error: err?.name === 'AbortError' ? 'timeout' : err?.message || 'fetch failed',
		};
	} finally {
		clearTimeout(t);
	}
}

async function handleVanityMint({ suffix = '', prefix = '', caseSensitive = false, maxAttempts = 5_000_000 }) {
	if (!suffix && !prefix) throw rpcError(-32602, 'at least one of suffix or prefix is required');
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), 58_000);
	let result;
	try {
		result = await generateVanityKey({ suffix, prefix, caseSensitive, maxAttempts, signal: ac.signal });
	} finally {
		clearTimeout(timer);
	}
	if (!result) throw rpcError(-32003, `no match found in ${maxAttempts} attempts`);
	return {
		publicKey: result.publicKey,
		secretKey: bs58.encode(result.secretKey),
		attempts: result.attempts,
		ms: result.ms,
	};
}


// ── Claims handlers (on-chain) ─────────────────────────────────────────────

const PUMP_CLAIM_PROGRAMS = new Set([
	'6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
	'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
	'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
]);

async function _fetchClaimsFromChain({ creator, limit = 20, network = 'mainnet', sinceTs = 0 }) {
	const pk = solanaPubkey(creator);
	if (!pk) throw rpcError(-32602, 'invalid creator wallet');
	const conn = getConnection({ network });
	const sigInfos = await conn.getSignaturesForAddress(pk, { limit: Math.min(100, limit * 4) });
	const results = [];
	for (const { signature, blockTime } of sigInfos) {
		if (results.length >= limit) break;
		if (sinceTs && (blockTime ?? 0) <= sinceTs) break;
		let tx;
		try {
			tx = await conn.getParsedTransaction(signature, {
				maxSupportedTransactionVersion: 0,
				commitment: 'confirmed',
			});
		} catch { continue; }
		if (!tx) continue;
		const allIxs = [
			...(tx.transaction.message.instructions ?? []),
			...(tx.meta?.innerInstructions?.flatMap((i) => i.instructions) ?? []),
		];
		if (!allIxs.some((ix) => PUMP_CLAIM_PROGRAMS.has(ix.programId?.toString?.()))) continue;
		const accounts = tx.transaction.message.accountKeys;
		const idx = accounts.findIndex((a) => a.pubkey.toString() === creator);
		if (idx === -1) continue;
		const lamports = (tx.meta.postBalances[idx] ?? 0) - (tx.meta.preBalances[idx] ?? 0);
		if (lamports <= 0) continue;
		results.push({
			signature,
			mint: tx.meta.postTokenBalances?.[0]?.mint ?? null,
			lamports,
			ts: blockTime ?? Math.floor(Date.now() / 1000),
		});
	}
	return results;
}

async function handleListClaims({ creator, limit = 20, network = 'mainnet' }) {
	if (!creator) throw rpcError(-32602, 'creator required');
	return { creator, network, claims: await _fetchClaimsFromChain({ creator, limit, network }) };
}

async function handleWatchClaims({ creator, durationMs = 300_000, network = 'mainnet' }) {
	if (!creator) throw rpcError(-32602, 'creator required');
	const window = Math.min(1_800_000, Math.max(1, Number(durationMs) || 300_000));
	const sinceTs = Math.floor((Date.now() - window) / 1000);
	const claims = await _fetchClaimsFromChain({ creator, limit: 50, network, sinceTs });
	return { creator, network, windowMs: window, claims };
}


async function handleSocialCashtagSentiment({ posts }) {
	if (!Array.isArray(posts) || posts.length === 0) throw rpcError(-32602, 'posts must be a non-empty array');
	const { scoreSentiment } = await import('../src/social/sentiment.js');
	return scoreSentiment(posts);
}

async function handleGetFirstClaims({ sinceMinutes = 60, limit = 20 }) {
	const sinceTs = Math.floor(Date.now() / 1000) - Math.max(1, Math.min(1440, sinceMinutes)) * 60;
	const items = await scanFirstClaims({ sinceTs, limit: Math.max(1, Math.min(50, limit)) });
	return { items };
}

async function handleQuoteSwap({ inputMint, outputMint, amountIn, slippageBps, network = 'mainnet' }) {
	if (!solanaPubkey(inputMint)) throw rpcError(-32602, 'invalid inputMint');
	if (!solanaPubkey(outputMint)) throw rpcError(-32602, 'invalid outputMint');
	const WSOL = 'So11111111111111111111111111111111111111112';
	if (inputMint !== WSOL && outputMint !== WSOL) {
		throw rpcError(-32602, `one of inputMint or outputMint must be wSOL (${WSOL})`);
	}
	const baseMint = inputMint === WSOL ? outputMint : inputMint;
	let state;
	try {
		state = await getAmmPoolState({ network, mint: baseMint });
	} catch (err) {
		throw rpcError(err.status === 404 ? -32004 : -32603, err.message || 'pool unavailable');
	}
	const { buyQuoteInput, sellBaseInput } = await import('@pump-fun/pump-swap-sdk');
	const BNMod = await import('bn.js');
	const BN = BNMod.default || BNMod;
	const { poolKey, pool, baseReserve, quoteReserve, baseMintAccount, globalConfig, feeConfig } = state;
	const amountBn = new BN(String(amountIn));
	const slip = (slippageBps ?? 100) / 10_000;
	const shared = {
		slippage: slip,
		baseReserve,
		quoteReserve,
		globalConfig,
		baseMintAccount,
		baseMint: pool.baseMint,
		coinCreator: pool.coinCreator,
		creator: pool.creator,
		feeConfig,
	};
	let amountOut, priceImpactBps;
	if (inputMint === WSOL) {
		const r = buyQuoteInput({ quote: amountBn, ...shared });
		amountOut = r.base;
		const num = amountBn.mul(baseReserve);
		const denom = amountOut.mul(quoteReserve);
		priceImpactBps = denom.isZero() ? 0 : Math.max(0, num.muln(10_000).div(denom).subn(10_000).toNumber());
	} else {
		const r = sellBaseInput({ base: amountBn, ...shared });
		amountOut = r.uiQuote;
		const spot = quoteReserve.mul(amountBn);
		const exec = amountOut.mul(baseReserve);
		priceImpactBps = spot.isZero() ? 0 : Math.max(0, spot.sub(exec).muln(10_000).div(spot).toNumber());
	}
	return {
		amountOut: amountOut.toString(),
		priceImpactBps,
		route: poolKey.toBase58(),
		expiresAtMs: Date.now() + 10_000,
	};
}

async function handleSocialXPostImpact({ postUrl, mint, windowMin = 30, network = 'mainnet' }) {
	if (!postUrl) throw rpcError(-32602, 'postUrl is required');
	const pk = solanaPubkey(mint);
	if (!pk) throw rpcError(-32602, `invalid mint: ${mint}`);

	let post = null;
	const postId = String(postUrl).match(/\/status(?:es)?\/(\d+)/)?.[1] ?? null;
	try {
		const oRes = await fetch(
			`https://publish.twitter.com/oembed?url=${encodeURIComponent(postUrl)}&omit_script=true`,
			{ signal: AbortSignal.timeout(5000) },
		);
		if (oRes.ok) {
			const od = await oRes.json();
			const ts = postId ? Number(BigInt(postId) >> 22n) + 1288834974657 : null;
			post = {
				id: postId,
				ts,
				author: od.author_name ?? null,
				text: od.html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ?? null,
			};
		}
	} catch {}

	const { sdk } = await getPumpSdk({ network });
	let curve;
	try {
		if (sdk.fetchBuyState) {
			const state = await sdk.fetchBuyState(pk, pk);
			curve = state.bondingCurve;
		} else if (sdk.fetchBondingCurve) {
			curve = await sdk.fetchBondingCurve(pk);
		}
	} catch (e) {
		throw rpcError(-32004, `bonding curve unavailable: ${e?.message ?? 'unknown'}`);
	}
	if (!curve) throw rpcError(-32004, 'no bonding curve found for this mint');

	const virtSol = Number(curve.virtualSolReserves?.toString?.() ?? '0');
	const virtToken = Number(curve.virtualTokenReserves?.toString?.() ?? '0');
	const realSolLamports = Number(curve.realSolReserves?.toString?.() ?? '0');
	const priceRaw = virtToken > 0 ? virtSol / virtToken : null;
	const volSol = realSolLamports / 1e9;

	return {
		post,
		priceBefore: priceRaw,
		priceAfter: priceRaw,
		deltaPct: 0,
		volBefore: volSol,
		volAfter: volSol,
		deltaVolPct: 0,
		note: 'priceBefore/After reflect current bonding curve state; historical delta requires trade data.',
	};
}


// ── pumpfun_watch_whales ───────────────────────────────────────────────────

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

async function handleWatchWhales({ mint, minUsd = 5000, durationMs = 5000 }) {
	const pk = solanaPubkey(mint);
	if (!pk) throw rpcError(-32602, 'invalid mint');

	// Cap at 10 s — serverless max execution time.
	const windowMs = Math.min(10_000, Math.max(1_000, Number(durationMs) || 5_000));
	const minUsdNum = Math.max(0, Number(minUsd) || 5000);

	const [{ BorshCoder, EventParser }, { PUMP_PROGRAM_ID, pumpIdl }] = await Promise.all([
		import('@coral-xyz/anchor'),
		import('@pump-fun/pump-sdk'),
	]);

	let solPrice = 150;
	try {
		const pr = await fetch(`https://api.jup.ag/price/v2?ids=${NATIVE_SOL_MINT}`, {
			signal: AbortSignal.timeout(3000),
		});
		const pd = await pr.json();
		const p = Number(pd?.data?.[NATIVE_SOL_MINT]?.price ?? 0);
		if (p > 0) solPrice = p;
	} catch {}

	const connection = getConnection({ network: 'mainnet' });
	const coder = new BorshCoder(pumpIdl);
	const parser = new EventParser(PUMP_PROGRAM_ID, coder);
	const mintStr = pk.toString();
	const trades = [];

	const subId = connection.onLogs(
		PUMP_PROGRAM_ID,
		(logInfo) => {
			if (logInfo.err) return;
			try {
				for (const event of parser.parseLogs(logInfo.logs)) {
					if (event.name !== 'TradeEvent') continue;
					const { mint: evMint, isBuy, solAmount, user, timestamp } = event.data;
					if (evMint.toString() !== mintStr) continue;
					const sol = Number(solAmount.toString()) / 1_000_000_000;
					const usd = sol * solPrice;
					if (usd < minUsdNum) continue;
					trades.push({
						signature: logInfo.signature,
						wallet: user.toString(),
						sideBuy: isBuy,
						usd,
						sol,
						ts: Number(timestamp.toString()) * 1000,
					});
				}
			} catch {}
		},
		'confirmed',
	);

	await new Promise((resolve) => setTimeout(resolve, windowMs));
	await connection.removeOnLogsListener(subId).catch(() => {});

	return { mint, minUsd: minUsdNum, durationMs: windowMs, count: trades.length, trades };
}

// ── Dispatch ───────────────────────────────────────────────────────────────

const HANDLERS = {
	getBondingCurve: handleGetBondingCurve,
	getTokenDetails: handleGetTokenDetails,
	getTokenHolders: handleGetTokenHolders,
	kol_radar: handleKolRadar,
	kol_leaderboard: handleKolLeaderboard,
	searchTokens: indexerOrUnavailable('searchTokens'),
	getTokenTrades: indexerOrUnavailable('getTokenTrades'),
	getTrendingTokens: indexerOrUnavailable('getTrendingTokens'),
	getNewTokens: indexerOrUnavailable('getNewTokens'),
	getGraduatedTokens: indexerOrUnavailable('getGraduatedTokens'),
	getKingOfTheHill: indexerOrUnavailable('getKingOfTheHill'),
	social_cashtag_sentiment: handleSocialCashtagSentiment,
	social_x_post_impact: handleSocialXPostImpact,
	getCreatorProfile: indexerOrUnavailable('getCreatorProfile'),
	pumpfun_list_claims: handleListClaims,
	pumpfun_watch_claims: handleWatchClaims,
	pumpfun_first_claims: handleGetFirstClaims,
	pumpfun_vanity_mint: handleVanityMint,
	pumpfun_watch_whales: handleWatchWhales,
	pumpfun_quote_swap: handleQuoteSwap,
	sns_resolve: handleSnsResolve,
	sns_reverseLookup: handleSnsReverseLookup,
};

// ── HTTP entrypoint ────────────────────────────────────────────────────────

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = await readJson(req);
	} catch (e) {
		return json(res, 400, rpcEnvelope(null, null, { code: -32700, message: 'parse error' }));
	}

	const { id = null, method: rpcMethod, params } = body || {};

	if (rpcMethod === 'initialize') {
		return json(
			res,
			200,
			rpcEnvelope(id, {
				protocolVersion: '2024-11-05',
				capabilities: { tools: {} },
				serverInfo: { name: 'three.ws-pumpfun-mcp', version: '0.1.0' },
			}),
		);
	}

	if (rpcMethod === 'tools/list') {
		return json(res, 200, rpcEnvelope(id, { tools: TOOLS }));
	}

	if (rpcMethod === 'tools/call') {
		const name = params?.name;
		const args = params?.arguments || {};
		const handler = HANDLERS[name];
		if (!handler) {
			return json(
				res,
				200,
				rpcEnvelope(id, null, { code: -32601, message: `unknown tool: ${name}` }),
			);
		}
		try {
			const data = await handler(args);
			// Mirror MCP content shape so existing skill clients can unwrap text.
			return json(
				res,
				200,
				rpcEnvelope(id, {
					content: [{ type: 'text', text: JSON.stringify(data) }],
					structuredContent: data,
				}),
			);
		} catch (err) {
			const code = err.rpcCode || -32603;
			return json(
				res,
				200,
				rpcEnvelope(id, null, { code, message: err.message || 'tool error' }),
			);
		}
	}

	return json(
		res,
		200,
		rpcEnvelope(id, null, { code: -32601, message: `unknown method: ${rpcMethod}` }),
	);
});
