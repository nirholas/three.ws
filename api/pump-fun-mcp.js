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

// ── Dispatch ───────────────────────────────────────────────────────────────

const HANDLERS = {
	getBondingCurve: handleGetBondingCurve,
	getTokenDetails: handleGetTokenDetails,
	getTokenHolders: handleGetTokenHolders,
	searchTokens: indexerOrUnavailable('searchTokens'),
	getTokenTrades: indexerOrUnavailable('getTokenTrades'),
	getTrendingTokens: indexerOrUnavailable('getTrendingTokens'),
	getNewTokens: indexerOrUnavailable('getNewTokens'),
	getGraduatedTokens: indexerOrUnavailable('getGraduatedTokens'),
	getKingOfTheHill: indexerOrUnavailable('getKingOfTheHill'),
	getCreatorProfile: indexerOrUnavailable('getCreatorProfile'),
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
