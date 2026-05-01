// POST /api/wallet/balances
// body: { chain: 'solana'|'evm', address: string }
// → { chain, address, native: {symbol, amount, usd}, tokens: [{symbol, amount, usd, logo}] }

import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { z } from 'zod';

const bodySchema = z.object({
	chain: z.enum(['solana', 'evm']),
	address: z.string().trim().min(1),
});

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

	// Native SOL balance
	const solResp = await fetchJson(rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'getBalance',
			params: [address],
		}),
	});
	const lamports = solResp.result?.value ?? 0;
	const solAmount = lamports / 1e9;

	// Token accounts
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
		.slice(0, 9); // top 9 + native SOL = 10

	// Price-enrich via CoinGecko — SOL + top tokens by contract address
	// CoinGecko uses platform "solana" for SPL tokens
	const mintList = fungible.map((t) => t.mint).join(',');
	let cgTokenPrices = {};
	if (mintList) {
		try {
			const cgResp = await fetchJson(
				`https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mintList}&vs_currencies=usd&include_market_cap=false&include_24hr_vol=false&include_last_updated_at=false`,
			);
			cgTokenPrices = cgResp;
		} catch {
			// Price enrichment is best-effort
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

	// Fetch metadata for fungible tokens via Helius DAS
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
		tokens.push({ symbol, amount: t.amount, usd: t.amount * price, logo });
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

	// Native ETH balance
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

	// Token balances
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

	// Resolve metadata for each token
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

	// Price-enrich via CoinGecko
	const contractList = rawTokens.map((t) => t.contractAddress).join(',');
	let cgTokenPrices = {};
	if (contractList) {
		try {
			const cgResp = await fetchJson(
				`https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${contractList}&vs_currencies=usd`,
			);
			cgTokenPrices = cgResp;
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

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		const raw = await readJson(req);
		body = bodySchema.parse(raw);
	} catch (e) {
		return error(res, 400, 'validation_error', e.message);
	}

	try {
		const result =
			body.chain === 'solana'
				? await getSolanaBalances(body.address)
				: await getEvmBalances(body.address);
		return json(res, 200, result);
	} catch (e) {
		if (e.code === 'not_configured') {
			return error(res, 503, 'not_configured', `missing env var: ${e.missing}`, {
				missing_key: e.missing,
			});
		}
		if (e.status === 502) {
			return error(res, 502, 'upstream_error', e.message);
		}
		throw e; // let wrap() handle unexpected errors
	}
});
