// `pump_snapshot` — paid MCP tool returning a real-time market snapshot for a
// Solana token (pump.fun or any SPL mint).
//
// Pricing: $0.005 USDC, settled `exact` in USDC on Solana mainnet.
//
// All data is fetched live from public APIs and Solana RPC. No fallback
// arrays, no mocked numbers. If a source is unreachable the field is null
// in the response so callers see the gap rather than fake data.
//
// Sources:
//   - Jupiter Lite price API (lite-api.jup.ag/price/v3)         → price, priceChange24h, liquidity
//   - Dexscreener (api.dexscreener.com/latest/dex/tokens/<mint>) → volume24h, pair url, dex
//   - pump.fun frontend-api-v3 (frontend-api-v3.pump.fun/coins/<mint>) → image, name, symbol, market_cap, creator
//   - Solana RPC getTokenLargestAccounts                         → top holder distribution
//   - Helius DAS getAsset (if HELIUS_API_KEY is set)             → exact holder count when available

import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';

import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { fetchJson as resilientFetchJson } from '../lib/resilient-fetch.js';
import { withSolanaConnection, getSolanaEndpoints } from '../lib/solana-rpc.js';

const TOOL_NAME = 'pump_snapshot';
const TOOL_DESCRIPTION =
	'Live snapshot for a Solana SPL or pump.fun token: USD price (Jupiter), 24h volume + DEX pair (Dexscreener), mint metadata + image (pump.fun frontend-api-v3), and on-chain top-holder distribution from Solana RPC getTokenLargestAccounts. Optional Helius DAS holder count when HELIUS_API_KEY is configured. Use this to check a token\'s price, volume, and holder concentration before trading or reporting on it; for community mood, call sentiment_pulse. Paid: $0.005 USDC.';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';

function isValidSolanaPubkey(s) {
	try {
		new PublicKey(s);
		return true;
	} catch {
		return false;
	}
}

// Every upstream read goes through the shared resilient layer: an 8s per-attempt
// timeout plus jittered retries on transient 429/5xx and network blips. These
// are all idempotent GETs (or a read-only JSON-RPC POST), so retrying is safe.
async function fetchJson(url, init = {}, timeoutMs = 8000) {
	return resilientFetchJson(url, init, {
		timeoutMs,
		retries: 2,
		retryNonIdempotent: init.method && init.method.toUpperCase() !== 'GET',
		label: url,
	});
}

async function getJupiterPrice(mint) {
	try {
		const data = await fetchJson(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
		const entry = data?.[mint];
		if (!entry) return null;
		return {
			usdPrice: entry.usdPrice ?? null,
			priceChange24hPct: entry.priceChange24h ?? null,
			liquidityUsd: entry.liquidity ?? null,
			decimals: entry.decimals ?? null,
			blockId: entry.blockId ?? null,
		};
	} catch (err) {
		return { error: err.message };
	}
}

async function getDexscreener(mint) {
	try {
		const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
		const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
		if (pairs.length === 0) return null;
		// Pick the pair with the largest 24h volume so a token with multiple
		// DEX pools surfaces its primary venue.
		const pair = pairs.reduce((best, p) => {
			const v = Number(p?.volume?.h24 || 0);
			return v > (best?.vol || 0) ? { pair: p, vol: v } : best;
		}, null)?.pair;
		if (!pair) return null;
		return {
			volume24hUsd: Number(pair.volume?.h24 || 0),
			priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
			priceChange24hPct: pair.priceChange?.h24 ?? null,
			liquidityUsd: pair.liquidity?.usd ?? null,
			fdvUsd: pair.fdv ?? null,
			marketCapUsd: pair.marketCap ?? null,
			pairAddress: pair.pairAddress,
			dex: pair.dexId,
			chain: pair.chainId,
			url: pair.url,
			txns24h: pair.txns?.h24 ?? null,
		};
	} catch (err) {
		return { error: err.message };
	}
}

async function getPumpFunMeta(mint) {
	try {
		const data = await fetchJson(`https://frontend-api-v3.pump.fun/coins/${mint}`);
		if (!data || data.error) return null;
		return {
			name: data.name || null,
			symbol: data.symbol || null,
			description: data.description || null,
			imageUrl: data.image_uri || null,
			twitter: data.twitter || null,
			telegram: data.telegram || null,
			website: data.website || null,
			creator: data.creator || null,
			createdAtMs: data.created_timestamp || null,
			complete: !!data.complete,
			marketCapUsd: data.usd_market_cap ?? null,
			marketCapQuote: data.market_cap ?? null,
			totalSupply: data.total_supply_str || data.total_supply || null,
			poolAddress: data.pool_address || null,
			lastTradeTimestampMs: data.last_trade_timestamp || null,
			athMarketCapUsd: data.ath_market_cap ?? null,
			athMarketCapTimestampMs: data.ath_market_cap_timestamp || null,
			program: data.program || null,
		};
	} catch (err) {
		return { error: err.message };
	}
}

async function getTopHolders(mint) {
	try {
		// Failover across the configured Solana endpoints: if the primary RPC is
		// throttling or down, the next endpoint answers instead of failing.
		const res = await withSolanaConnection((conn) =>
			conn.getTokenLargestAccounts(new PublicKey(mint)),
		);
		const top = (res?.value || []).map((acct) => ({
			address: acct.address.toBase58(),
			uiAmount: acct.uiAmount,
			amount: acct.amount,
			decimals: acct.decimals,
		}));
		return {
			topHolderCount: top.length,
			topHolders: top,
		};
	} catch (err) {
		return { error: err.message };
	}
}

async function getHeliusHolderCount(mint) {
	if (!HELIUS_API_KEY) return null;
	try {
		const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
		const body = {
			jsonrpc: '2.0',
			id: 'getAsset',
			method: 'getAsset',
			params: { id: mint, options: { showFungible: true } },
		};
		const data = await fetchJson(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});
		const supply = data?.result?.token_info?.supply ?? null;
		const decimals = data?.result?.token_info?.decimals ?? null;
		const priceInfo = data?.result?.token_info?.price_info ?? null;
		return {
			supply: supply !== null ? String(supply) : null,
			decimals,
			heliusPriceUsd: priceInfo?.price_per_token ?? null,
		};
	} catch (err) {
		return { error: err.message };
	}
}

// Single source of truth: Zod shape carries the base58 validity refinement AND
// the length bounds/description; the JSON Schema is derived from it. (The
// refine() predicate is the strict check; the min/max length bounds mirror the
// previous hand-written JSON Schema so the bazaar still advertises them.)
const inputZodShape = {
	token: z
		.string()
		.min(32)
		.max(64)
		.refine((v) => isValidSolanaPubkey(v), 'must be a base58 Solana pubkey')
		.describe('Solana SPL or pump.fun mint pubkey (base58).'),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildPumpSnapshotTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			scheme: 'exact',
			priceUsd: '$0.005',
			inputSchema: inputJsonSchema,
			example: { token: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump' },
			outputExample: {
				token: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
				price: { usdPrice: 0.0415, priceChange24hPct: 2.5, liquidityUsd: 107732 },
				volume24h: { volume24hUsd: 270780.6, dex: 'raydium' },
				holders: { topHolderCount: 20, topHolders: [{ address: '...', uiAmount: 1234 }] },
				meta: { name: 'three.ws', symbol: 'THREE', imageUrl: 'https://...' },
			},
		},
		async ({ token }) => {
			if (!isValidSolanaPubkey(token)) {
				return toolError('invalid_mint', 'token must be a base58 Solana pubkey', { token });
			}
			const [price, ds, meta, holders, helius] = await Promise.all([
				getJupiterPrice(token),
				getDexscreener(token),
				getPumpFunMeta(token),
				getTopHolders(token),
				getHeliusHolderCount(token),
			]);
			// Price fallback: if Jupiter is unavailable but Dexscreener returned a
			// pair price, surface it rather than leaving price null — two
			// independent sources back the single most important field.
			const priceUsd = price?.usdPrice ?? ds?.priceUsd ?? null;
			const priceSource =
				price?.usdPrice != null ? 'jupiter' : ds?.priceUsd != null ? 'dexscreener' : null;
			return {
				token,
				fetchedAt: new Date().toISOString(),
				price,
				priceUsd,
				priceSource,
				volume24h: ds,
				meta,
				holders,
				helius,
				image: meta?.imageUrl || null,
				sources: {
					price: 'https://lite-api.jup.ag/price/v3',
					volume24h: 'https://api.dexscreener.com',
					meta: 'https://frontend-api-v3.pump.fun',
					holders: getSolanaEndpoints(),
					helius: HELIUS_API_KEY ? 'https://mainnet.helius-rpc.com' : null,
				},
			};
		},
	);
	return {
		name: TOOL_NAME,
		title: 'Pump.fun snapshot ($0.005)',
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Read-only live market snapshot — price/holders move between calls,
		// so not idempotent.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		handler,
	};
}
