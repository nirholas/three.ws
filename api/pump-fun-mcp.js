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
import { getPumpSdk, getConnection, solanaPubkey } from './_lib/pump.js';
import { pumpfunMcp, pumpfunBotEnabled } from './_lib/pumpfun-mcp.js';
import { getRadarSignals } from '../src/kol/radar.js';
import { computeWalletPnl, WINDOW_SECONDS } from '../src/kol/wallet-pnl.js';

// ── Tool registry ──────────────────────────────────────────────────────────

const TOOLS = [
	{
		name: 'searchTokens',
		description: 'Search pump.fun tokens by name, symbol, or mint address.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
			},
			required: ['query'],
		},
	},
	{
		name: 'getTokenDetails',
		description: 'Full details for a specific pump.fun token by mint address.',
		inputSchema: {
			type: 'object',
			properties: { mint: { type: 'string' } },
			required: ['mint'],
		},
	},
	{
		name: 'getBondingCurve',
		description:
			'Bonding curve analysis: real reserves, virtual reserves, and graduation progress (on-chain).',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
			},
			required: ['mint'],
		},
	},
	{
		name: 'getTokenTrades',
		description: 'Recent buy/sell history for a token.',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
			},
			required: ['mint'],
		},
	},
	{
		name: 'getTrendingTokens',
		description: 'Top pump.fun tokens by market cap.',
		inputSchema: {
			type: 'object',
			properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
		},
	},
	{
		name: 'getNewTokens',
		description: 'Most recently launched pump.fun tokens.',
		inputSchema: {
			type: 'object',
			properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
		},
	},
	{
		name: 'getGraduatedTokens',
		description: 'Tokens that graduated from the bonding curve to Raydium AMM.',
		inputSchema: {
			type: 'object',
			properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
		},
	},
	{
		name: 'getKingOfTheHill',
		description: 'Highest-market-cap token still on the bonding curve.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'kol_radar',
		description:
			'gmgn radar signals: early-detection patterns filtered by category, sorted by score desc.',
		inputSchema: {
			type: 'object',
			properties: {
				category: {
					type: 'string',
					enum: ['pump-fun', 'new-mints', 'volume-spike'],
					default: 'pump-fun',
				},
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
			},
		},
	},
	{
		name: 'getCreatorProfile',
		description: 'All tokens by a creator wallet, with rug-pull risk flags.',
		inputSchema: {
			type: 'object',
			properties: { creator: { type: 'string' } },
			required: ['creator'],
		},
	},
	{
		name: 'getTokenHolders',
		description: 'Top holders of a token with concentration analysis (on-chain).',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
			},
			required: ['mint'],
		},
	},
	{
		name: 'kol_wallet_pnl',
		description: 'Realized + unrealized P&L for a Solana wallet (FIFO cost basis). Requires PUMPFUN_BOT_URL to be configured for live trade data.',
		inputSchema: {
			type: 'object',
			properties: {
				wallet: { type: 'string', description: 'Solana wallet address (base58)' },
				window: {
					type: 'string',
					enum: ['24h', '7d', '30d', 'all'],
					default: '7d',
				},
			},
			required: ['wallet'],
		},
	},
	{
		name: 'pumpfun_vanity_mint',
		description:
			'Generate a Solana keypair whose address ends/starts with a vanity pattern. Returns publicKey + secretKey (base58). Caller must save the secret key immediately — it is never stored. Hard timeout: 60 s.',
		inputSchema: {
			type: 'object',
			properties: {
				suffix: { type: 'string', description: 'Desired address suffix (case-insensitive by default)' },
				prefix: { type: 'string', description: 'Desired address prefix (case-insensitive by default)' },
				caseSensitive: { type: 'boolean', default: false },
				maxAttempts: { type: 'integer', default: 5000000 },
			},
		},
	},	,
	{
		name: 'pumpfun_list_claims',
		description: 'List recent pump.fun fee-claim events for a creator wallet. On-chain RPC — no indexer needed.',
		inputSchema: {
			type: 'object',
			properties: {
				creator: { type: 'string', description: 'Creator wallet address (base58)' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
			},
			required: ['creator'],
		},
	},
	{
		name: 'pumpfun_watch_claims',
		description:
			'Return all pump.fun fee-claim events for a creator wallet within the last durationMs milliseconds.',
		inputSchema: {
			type: 'object',
			properties: {
				creator: { type: 'string', description: 'Creator wallet address (base58)' },
				durationMs: {
					type: 'number',
					description: 'Look-back window in ms (default 300000 = 5 min, max 1800000)',
				},
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
			},
			required: ['creator'],
		},
	},

];

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

// ── kol_wallet_pnl handler ─────────────────────────────────────────────────

async function handleKolWalletPnl({ wallet, window: win = '7d' }) {
	if (!wallet) throw rpcError(-32602, 'wallet is required');
	const windowSecs = WINDOW_SECONDS[win] ?? WINDOW_SECONDS['7d'];

	// Fetch trades from upstream bot when configured; return empty gracefully.
	let trades = [];
	if (pumpfunBotEnabled()) {
		const r = await rawBotCall('getWalletTrades', { wallet, limit: 500 });
		if (r.ok && Array.isArray(r.data)) trades = r.data;
	}

	const result = computeWalletPnl({ trades, windowSecs });
	return { wallet, window: win, ...result };
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


// ── Claims handlers (on-chain) ─────────────────────────────────────────────

const PUMP_CLAIM_PROGRAMS = new Set([
	'6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
	'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
	'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
]);

async function fetchClaimsFromChain({ creator, limit = 20, network = 'mainnet', sinceTs = 0 }) {
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
	return { creator, network, claims: await fetchClaimsFromChain({ creator, limit, network }) };
}

async function handleWatchClaims({ creator, durationMs = 300_000, network = 'mainnet' }) {
	if (!creator) throw rpcError(-32602, 'creator required');
	const window = Math.min(1_800_000, Math.max(1, durationMs));
	const sinceTs = Math.floor((Date.now() - window) / 1000);
	const claims = await fetchClaimsFromChain({ creator, limit: 50, network, sinceTs });
	return { creator, network, windowMs: window, claims };
}

// ── Dispatch ───────────────────────────────────────────────────────────────

const HANDLERS = {
	getBondingCurve: handleGetBondingCurve,
	getTokenDetails: handleGetTokenDetails,
	getTokenHolders: handleGetTokenHolders,
	kol_radar: handleKolRadar,
	kol_wallet_pnl: handleKolWalletPnl,
	searchTokens: indexerOrUnavailable('searchTokens'),
	getTokenTrades: indexerOrUnavailable('getTokenTrades'),
	getTrendingTokens: indexerOrUnavailable('getTrendingTokens'),
	getNewTokens: indexerOrUnavailable('getNewTokens'),
	getGraduatedTokens: indexerOrUnavailable('getGraduatedTokens'),
	getKingOfTheHill: indexerOrUnavailable('getKingOfTheHill'),
	getCreatorProfile: indexerOrUnavailable('getCreatorProfile'),
	pumpfun_list_claims: handleListClaims,
	pumpfun_watch_claims: handleWatchClaims,
};

function rpcError(code, message) {
	const err = new Error(message);
	err.rpcCode = code;
	return err;
}

function rpcEnvelope(id, result, errObj) {
	if (errObj) {
		return { jsonrpc: '2.0', id: id ?? null, error: errObj };
	}
	return { jsonrpc: '2.0', id: id ?? null, result };
}

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
