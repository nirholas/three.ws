// Real pump.fun launch feed, fetched directly from this machine so a strategy
// keeps evaluating while three.ws is unreachable. Mainnet only: the venue has
// no public devnet feed, so devnet agents see no entries (open positions still
// exit). Mirrors api/_lib/pump-launch-feed.js normalizeLaunch.

import { PublicKey } from '@solana/web3.js';

const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

// The venue's per-coin HTTP route is not reliable, so live reserves are read
// from the coin's bonding-curve account on chain (the source of truth the
// frontend itself mirrors): discriminator, then u64 virtual token reserves,
// virtual SOL reserves, real token reserves, real SOL reserves, total supply,
// and a complete flag.
export function parseBondingCurve(data) {
	if (!data || data.length < 49) return null;
	const buf = Buffer.from(data);
	return {
		virtual_token_reserves: Number(buf.readBigUInt64LE(8)),
		virtual_sol_reserves: Number(buf.readBigUInt64LE(16)),
		real_token_reserves: Number(buf.readBigUInt64LE(24)),
		real_sol_reserves: Number(buf.readBigUInt64LE(32)),
		complete: buf[48] === 1,
	};
}

export const bondingCurveAddress = (mint) =>
	PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], PUMP_PROGRAM)[0].toBase58();

const BASE = process.env.PUMP_FRONTEND_BASE || 'https://frontend-api-v3.pump.fun';
const UA = 'three.ws-desktop-runtime/1';

async function getJson(fetchImpl, url, ms = 8000) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), ms);
	try {
		const r = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': UA } });
		return r.ok ? await r.json() : null;
	} catch {
		return null;
	} finally {
		clearTimeout(t);
	}
}

export function normalizeLaunch(c, solUsd = 0) {
	if (!c?.mint) return null;
	const real = Number(c.real_sol_reserves);
	const virt = Number(c.virtual_sol_reserves);
	return {
		mint: c.mint, name: c.name || null, symbol: c.symbol || null,
		created_at: c.created_timestamp ? Number(c.created_timestamp) : null,
		market_cap_usd: typeof c.usd_market_cap === 'number' ? c.usd_market_cap : typeof c.market_cap === 'number' && solUsd > 0 ? c.market_cap * solUsd : null,
		liquidity_sol: real > 0 ? real / 1e9 : virt > 0 ? virt / 1e9 : null,
		creator: c.creator || null, creator_launches: null, creator_graduated: null,
		twitter: c.twitter || null, telegram: c.telegram || null, website: c.website || null,
		is_usdc_pair: false, graduated: c.complete === true || !!c.raydium_pool || !!c.pump_swap_pool,
	};
}

export function createPumpFeed({ fetchImpl = fetch, base = BASE, rpcUrl = DEFAULT_RPC, now = Date.now } = {}) {
	let sol = { at: 0, usd: 0 };
	// SOL/USD from Coinbase's public spot endpoint, cached a minute, so the
	// launch market cap (reported in SOL) can be gated in dollars.
	async function solUsd() {
		if (now() - sol.at < 60_000 && sol.usd > 0) return sol.usd;
		const d = await getJson(fetchImpl, 'https://api.coinbase.com/v2/prices/SOL-USD/spot');
		const usd = Number(d?.data?.amount);
		if (usd > 0) sol = { at: now(), usd };
		return sol.usd;
	}
	return {
		async launches({ network = 'mainnet', limit = 50 } = {}) {
			if (network !== 'mainnet') return [];
			const data = await getJson(fetchImpl, `${base}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`);
			const list = Array.isArray(data) ? data : Array.isArray(data?.coins) ? data.coins : [];
			const usd = await solUsd();
			return list.map((c) => normalizeLaunch(c, usd)).filter((l) => l && !l.graduated);
		},
		async coin(mint, { symbol = null } = {}) {
			let address;
			try {
				address = bondingCurveAddress(mint);
			} catch {
				return null;
			}
			try {
				const r = await fetchImpl(rpcUrl, {
					method: 'POST', headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64', commitment: 'confirmed' }] }),
					signal: AbortSignal.timeout(8000),
				});
				const body = await r.json();
				const b64 = body?.result?.value?.data?.[0];
				const curve = b64 ? parseBondingCurve(Buffer.from(b64, 'base64')) : null;
				return curve ? { mint, symbol, ...curve } : null;
			} catch {
				return null;
			}
		},
	};
}
