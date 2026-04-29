// Cloudflare Workers mirror of /api/pump-fun-mcp (Vercel).
//
// Implements the MCP Streamable HTTP transport (JSON-RPC 2.0 over POST).
// Tool definitions are shared with the Vercel handler via src/pump/mcp-tools.js.
// Handler logic is adapted from api/pump-fun-mcp.js — the only differences are:
//   • CF Workers fetch handler (Request/Response) instead of Node req/res.
//   • Env vars come from the `env` binding parameter, not process.env.
//   • No rate limiting (handled at the Cloudflare edge layer).
//
// Secrets (wrangler secret put <NAME>):
//   SOLANA_RPC_URL          mainnet RPC endpoint (default: public)
//   SOLANA_RPC_URL_DEVNET   devnet  RPC endpoint (default: public)
//   PUMPFUN_BOT_URL         upstream indexer endpoint (optional)
//   PUMPFUN_BOT_TOKEN       bearer token for indexer (optional)
//
// Deploy: wrangler deploy

import { TOOLS, rpcError, rpcEnvelope } from '../../src/pump/mcp-tools.js';

// ── Constants ────────────────────────────────────────────────────────────────

const GRADUATION_REAL_SOL_LAMPORTS = 85_000_000_000n;

const CORS_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'POST,OPTIONS',
	'access-control-allow-headers': 'content-type',
};

// ── Solana helpers (adapted for CF Workers env bindings) ─────────────────────

function getRpcUrl(env, network = 'mainnet') {
	if (network === 'devnet') {
		return env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
	}
	return env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

function solanaPubkey(s) {
	if (!s) return null;
	try {
		const { PublicKey } = globalThis._solanaWeb3 || {};
		if (PublicKey) return new PublicKey(s);
		return null;
	} catch {
		return null;
	}
}

// ── On-chain handlers ────────────────────────────────────────────────────────

async function handleGetBondingCurve({ mint, network = 'mainnet' }, env) {
	const { Connection, PublicKey } = await import('@solana/web3.js');
	let pk;
	try {
		pk = new PublicKey(mint);
	} catch {
		throw rpcError(-32602, 'invalid mint');
	}

	const conn = new Connection(getRpcUrl(env, network), 'confirmed');
	const { OnlinePumpSdk, PumpSdk } = await import('@pump-fun/pump-sdk');

	let curve;
	try {
		const sdk = new OnlinePumpSdk(conn);
		if (sdk.fetchBuyState) {
			const state = await sdk.fetchBuyState(pk, pk);
			curve = state.bondingCurve;
		} else if (sdk.fetchBondingCurve) {
			curve = await sdk.fetchBondingCurve(pk);
		}
		if (!curve) {
			const sdk2 = new PumpSdk(conn);
			if (sdk2.fetchBondingCurve) curve = await sdk2.fetchBondingCurve(pk);
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

async function handleGetTokenDetails({ mint, network = 'mainnet' }, env) {
	const { Connection, PublicKey } = await import('@solana/web3.js');
	const { MintLayout } = await import('@solana/spl-token');

	let pk;
	try {
		pk = new PublicKey(mint);
	} catch {
		throw rpcError(-32602, 'invalid mint');
	}

	const conn = new Connection(getRpcUrl(env, network), 'confirmed');
	const info = await conn.getAccountInfo(pk);
	if (!info) throw rpcError(-32004, 'mint account not found');
	const mintAccount = MintLayout.decode(info.data);

	const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
	const [metadataPda] = PublicKey.findProgramAddressSync(
		[Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), pk.toBuffer()],
		METADATA_PROGRAM,
	);
	let name = null;
	let symbol = null;
	let uri = null;
	try {
		const metaInfo = await conn.getAccountInfo(metadataPda);
		if (metaInfo) {
			const buf = Buffer.from(metaInfo.data);
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
		// Metadata is optional.
	}

	return {
		mint,
		name,
		symbol,
		uri,
		decimals: mintAccount.decimals,
		supply: mintAccount.supply.toString(),
		mintAuthority: mintAccount.mintAuthorityOption ? mintAccount.mintAuthority.toString() : null,
		freezeAuthority: mintAccount.freezeAuthorityOption
			? mintAccount.freezeAuthority.toString()
			: null,
	};
}

async function handleGetTokenHolders({ mint, limit = 10, network = 'mainnet' }, env) {
	const { Connection, PublicKey } = await import('@solana/web3.js');

	let pk;
	try {
		pk = new PublicKey(mint);
	} catch {
		throw rpcError(-32602, 'invalid mint');
	}

	const conn = new Connection(getRpcUrl(env, network), 'confirmed');
	let largest;
	try {
		largest = await conn.getTokenLargestAccounts(pk);
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
	return {
		mint,
		count: holders.length,
		topHolderPercent: holders[0]?.percent ?? 0,
		holders,
	};
}

// ── Indexer-backed handlers ──────────────────────────────────────────────────

async function rawBotCall(tool, args, env) {
	const url = env.PUMPFUN_BOT_URL;
	if (!url) return { ok: false, error: 'PUMPFUN_BOT_URL not set' };
	const headers = { 'content-type': 'application/json', accept: 'application/json' };
	if (env.PUMPFUN_BOT_TOKEN) headers.authorization = `Bearer ${env.PUMPFUN_BOT_TOKEN}`;
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

function indexerHandler(name, env) {
	return async (args) => {
		if (!env.PUMPFUN_BOT_URL) {
			throw rpcError(
				-32004,
				`tool "${name}" requires the pump.fun indexer (PUMPFUN_BOT_URL) to be configured`,
			);
		}
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
		const r = await rawBotCall(upstream.tool, upstream.args, env);
		if (!r.ok) throw rpcError(-32004, r.error || 'indexer error');
		return r.data;
	};
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function buildHandlers(env) {
	return {
		getBondingCurve: (a) => handleGetBondingCurve(a, env),
		getTokenDetails: (a) => handleGetTokenDetails(a, env),
		getTokenHolders: (a) => handleGetTokenHolders(a, env),
		searchTokens: indexerHandler('searchTokens', env),
		getTokenTrades: indexerHandler('getTokenTrades', env),
		getTrendingTokens: indexerHandler('getTrendingTokens', env),
		getNewTokens: indexerHandler('getNewTokens', env),
		getGraduatedTokens: indexerHandler('getGraduatedTokens', env),
		getKingOfTheHill: indexerHandler('getKingOfTheHill', env),
		getCreatorProfile: indexerHandler('getCreatorProfile', env),
	};
}

// ── HTTP fetch handler ───────────────────────────────────────────────────────

export default {
	async fetch(request, env) {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		if (request.method !== 'POST') {
			return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
		}

		const respond = (payload, status = 200) =>
			new Response(JSON.stringify(payload), {
				status,
				headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
			});

		let body;
		try {
			body = await request.json();
		} catch {
			return respond(rpcEnvelope(null, null, { code: -32700, message: 'parse error' }), 400);
		}

		const { id = null, method, params } = body || {};

		if (method === 'initialize') {
			return respond(
				rpcEnvelope(id, {
					protocolVersion: '2024-11-05',
					capabilities: { tools: {} },
					serverInfo: { name: 'pump-fun-mcp-worker', version: '0.1.0' },
				}),
			);
		}

		if (method === 'tools/list') {
			return respond(rpcEnvelope(id, { tools: TOOLS }));
		}

		if (method === 'tools/call') {
			const name = params?.name;
			const args = params?.arguments || {};
			const handlers = buildHandlers(env);
			const handler = handlers[name];
			if (!handler) {
				return respond(rpcEnvelope(id, null, { code: -32601, message: `unknown tool: ${name}` }));
			}
			try {
				const data = await handler(args);
				return respond(
					rpcEnvelope(id, {
						content: [{ type: 'text', text: JSON.stringify(data) }],
						structuredContent: data,
					}),
				);
			} catch (err) {
				const code = err.rpcCode || -32603;
				return respond(rpcEnvelope(id, null, { code, message: err.message || 'tool error' }));
			}
		}

		return respond(rpcEnvelope(id, null, { code: -32601, message: `unknown method: ${method}` }));
	},
};
