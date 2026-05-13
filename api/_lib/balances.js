// Live on-chain balance + USD-price helpers, shared by /api/wallet/balances and
// /api/portfolio. Server-side memoizes results per (chain, address) for 60s to
// shield upstream RPCs and CoinGecko from per-page-load fan-out.

const RPC_CACHE_TTL_MS = 60_000;
const _cache = new Map(); // key: `${chain}:${address}` → { at, value }

function cacheGet(key) {
	const hit = _cache.get(key);
	if (!hit) return null;
	if (Date.now() - hit.at > RPC_CACHE_TTL_MS) {
		_cache.delete(key);
		return null;
	}
	return hit.value;
}
function cacheSet(key, value) {
	_cache.set(key, { at: Date.now(), value });
}

async function fetchJson(url, opts = {}) {
	const r = await fetch(url, opts);
	if (!r.ok) {
		const text = await r.text().catch(() => r.status.toString());
		throw Object.assign(new Error(`upstream ${r.status}: ${text}`), { status: 502 });
	}
	return r.json();
}

async function getSolanaBalances(address) {
	const heliusKey = process.env.HELIUS_API_KEY;
	if (!heliusKey) {
		const e = new Error('not_configured: HELIUS_API_KEY');
		e.status = 503;
		e.code = 'not_configured';
		e.missing = 'HELIUS_API_KEY';
		throw e;
	}

	const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;

	const solResp = await fetchJson(rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
	});
	const lamports = solResp.result?.value ?? 0;
	const solAmount = lamports / 1e9;

	const tokenResp = await fetchJson(rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 2,
			method: 'getTokenAccountsByOwner',
			params: [
				address,
				{ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
				{ encoding: 'jsonParsed' },
			],
		}),
	});

	const tokenAccounts = tokenResp.result?.value ?? [];
	const fungible = tokenAccounts
		.map((a) => {
			const info = a.account?.data?.parsed?.info;
			if (!info) return null;
			const { mint, tokenAmount } = info;
			if (!tokenAmount || tokenAmount.uiAmount === 0) return null;
			return { mint, amount: tokenAmount.uiAmount, decimals: tokenAmount.decimals };
		})
		.filter(Boolean)
		.sort((a, b) => b.amount - a.amount)
		.slice(0, 9);

	const mintList = fungible.map((t) => t.mint).join(',');
	let cgTokenPrices = {};
	if (mintList) {
		try {
			cgTokenPrices = await fetchJson(
				`https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mintList}&vs_currencies=usd`,
			);
		} catch {
			// best-effort
		}
	}

	let solUsdPrice = 0;
	try {
		const cgSol = await fetchJson(
			'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
		);
		solUsdPrice = cgSol?.solana?.usd ?? 0;
	} catch {
		// best-effort
	}

	const tokens = [];
	for (const t of fungible) {
		const price = cgTokenPrices[t.mint.toLowerCase()]?.usd ?? 0;
		let symbol = t.mint.slice(0, 6);
		let logo = null;
		try {
			const das = await fetchJson(rpcUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 'meta',
					method: 'getAsset',
					params: { id: t.mint },
				}),
			});
			symbol = das.result?.content?.metadata?.symbol || symbol;
			logo = das.result?.content?.links?.image || null;
		} catch {
			// metadata is best-effort
		}
		tokens.push({ symbol, mint: t.mint, decimals: t.decimals, amount: t.amount, usd: t.amount * price, logo });
	}

	return {
		chain: 'solana',
		address,
		native: { symbol: 'SOL', amount: solAmount, usd: solAmount * solUsdPrice },
		tokens,
	};
}

async function getEvmBalances(address) {
	const alchemyKey = process.env.ALCHEMY_API_KEY;
	if (!alchemyKey) {
		const e = new Error('not_configured: ALCHEMY_API_KEY');
		e.status = 503;
		e.code = 'not_configured';
		e.missing = 'ALCHEMY_API_KEY';
		throw e;
	}

	const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`;

	const ethBalResp = await fetchJson(rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_getBalance',
			params: [address, 'latest'],
		}),
	});
	const ethWei = BigInt(ethBalResp.result ?? '0x0');
	const ethAmount = Number(ethWei) / 1e18;

	const tokenBalResp = await fetchJson(rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 2,
			method: 'alchemy_getTokenBalances',
			params: [address],
		}),
	});

	const rawTokens = (tokenBalResp.result?.tokenBalances ?? [])
		.filter((t) => t.tokenBalance && t.tokenBalance !== '0x0' && t.tokenBalance !== '0x')
		.slice(0, 9);

	const metadataResults = await Promise.allSettled(
		rawTokens.map((t) =>
			fetchJson(rpcUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 'meta',
					method: 'alchemy_getTokenMetadata',
					params: [t.contractAddress],
				}),
			}),
		),
	);

	const contractList = rawTokens.map((t) => t.contractAddress).join(',');
	let cgTokenPrices = {};
	if (contractList) {
		try {
			cgTokenPrices = await fetchJson(
				`https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${contractList}&vs_currencies=usd`,
			);
		} catch {
			// best-effort
		}
	}

	let ethUsdPrice = 0;
	try {
		const cgEth = await fetchJson(
			'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
		);
		ethUsdPrice = cgEth?.ethereum?.usd ?? 0;
	} catch {
		// best-effort
	}

	const tokens = rawTokens.map((t, i) => {
		const meta = metadataResults[i].status === 'fulfilled' ? metadataResults[i].value?.result : null;
		const decimals = meta?.decimals ?? 18;
		const rawBal = BigInt(t.tokenBalance || '0x0');
		const amount = Number(rawBal) / Math.pow(10, decimals);
		const price = cgTokenPrices[t.contractAddress.toLowerCase()]?.usd ?? 0;
		return {
			symbol: meta?.symbol || t.contractAddress.slice(0, 8),
			contract: t.contractAddress,
			decimals,
			amount,
			usd: amount * price,
			logo: meta?.logo || null,
		};
	});

	return {
		chain: 'evm',
		address,
		native: { symbol: 'ETH', amount: ethAmount, usd: ethAmount * ethUsdPrice },
		tokens,
	};
}

export async function getBalances({ chain, address }) {
	const key = `${chain}:${address}`;
	const cached = cacheGet(key);
	if (cached) return cached;
	const value = chain === 'solana' ? await getSolanaBalances(address) : await getEvmBalances(address);
	cacheSet(key, value);
	return value;
}

export function invalidateBalances({ chain, address }) {
	_cache.delete(`${chain}:${address}`);
}

export function walletUsdTotal(balances) {
	const nativeUsd = balances?.native?.usd ?? 0;
	const tokensUsd = (balances?.tokens ?? []).reduce((s, t) => s + (t.usd ?? 0), 0);
	return nativeUsd + tokensUsd;
}
