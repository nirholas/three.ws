/**
 * Jupiter Swap + Pyth Oracle skills
 * ----------------------------------
 * Jupiter:  quote-only and full swap for any Solana SPL token pair.
 * Pyth:     live USD prices for SOL, BTC, ETH, USDC, BONK, WIF, JUP, PYTH.
 *
 * Skills registered:
 *   jupiter-quote   — read-only quote, no signing
 *   jupiter-swap    — full swap (wallet signature required)
 *   jupiter-tokens  — search / resolve token symbols → mint addresses
 *   pyth-price      — fetch latest price for one or more tokens
 */

import {
	quoteJupiter,
	executeJupiterSwap,
	resolveTokenMint,
	getJupiterTopTokens,
	WSOL_MINT,
	USDC_MINT,
} from './solana/jupiter-swap.js';

import { getPrices, getPrice, PRICE_FEED_IDS } from './solana/pyth-price.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const KNOWN_MINTS = {
	SOL:  WSOL_MINT,
	WSOL: WSOL_MINT,
	USDC: USDC_MINT,
};

async function resolveMint(symbol) {
	const upper = symbol.toUpperCase();
	if (upper.length > 32) return symbol; // looks like a raw mint address
	return KNOWN_MINTS[upper] ?? (await resolveTokenMint(symbol));
}

function fmtUsd(n) {
	return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
}

function fmtToken(raw, decimals = 9) {
	return (Number(raw) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

// ── registration ─────────────────────────────────────────────────────────────

/**
 * @param {import('./agent-skills.js').AgentSkills} skills
 */
export function registerJupiterSkills(skills) {
	// ── jupiter-quote ─────────────────────────────────────────────────────────
	skills.register({
		name: 'jupiter-quote',
		description:
			'Get a Jupiter DEX swap quote for any Solana token pair. Read-only, no wallet required.',
		instruction: 'Use Jupiter aggregator to find the best swap route and estimated output.',
		animationHint: 'inspect',
		voicePattern: 'Checking Jupiter for {{amountIn}} {{symbolIn}} → {{symbolOut}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			required: ['symbolIn', 'symbolOut', 'amountIn'],
			properties: {
				symbolIn: {
					type: 'string',
					description: 'Input token symbol (SOL, USDC, BONK, …) or raw mint address',
				},
				symbolOut: {
					type: 'string',
					description: 'Output token symbol or raw mint address',
				},
				amountIn: {
					type: 'number',
					description: 'Human-readable input amount, e.g. 1.5 for 1.5 SOL',
				},
				decimalsIn: {
					type: 'number',
					description: 'Decimals for input token (default 9 for SOL)',
				},
				slippageBps: {
					type: 'number',
					description: 'Slippage tolerance in basis points (default 50 = 0.5%)',
				},
			},
		},
		handler: async (args, _ctx) => {
			const inputMint = await resolveMint(args.symbolIn);
			if (!inputMint)
				return { success: false, output: `Unknown token: ${args.symbolIn}`, sentiment: -0.2 };

			const outputMint = await resolveMint(args.symbolOut);
			if (!outputMint)
				return { success: false, output: `Unknown token: ${args.symbolOut}`, sentiment: -0.2 };

			const quote = await quoteJupiter({
				inputMint,
				outputMint,
				amountIn: args.amountIn,
				decimalsIn: args.decimalsIn ?? 9,
				slippageBps: args.slippageBps ?? 50,
			});

			const outReadable = fmtToken(quote.outAmount, 6);
			const impact = (quote.priceImpactPct * 100).toFixed(3);
			const routes = quote.routePlan?.join(' → ') || 'direct';

			return {
				success: true,
				output: `${args.amountIn} ${args.symbolIn} → ~${outReadable} ${args.symbolOut} (impact ${impact}%) via ${routes}`,
				sentiment: quote.priceImpactPct > 0.05 ? -0.1 : 0.3,
				data: {
					inputMint,
					outputMint,
					inAmount: quote.inAmount,
					outAmount: quote.outAmount,
					priceImpactPct: quote.priceImpactPct,
					slippageBps: quote.slippageBps,
					routePlan: quote.routePlan,
					expiresAtMs: quote.expiresAtMs,
					_quoteRef: quote,
				},
			};
		},
	});

	// ── jupiter-swap ──────────────────────────────────────────────────────────
	skills.register({
		name: 'jupiter-swap',
		description:
			'Execute a Jupiter DEX swap on Solana. Requires connected browser wallet for signing.',
		instruction:
			'Quotes first, then sends a versioned transaction for the user to approve. Wallet approval dialog will appear.',
		animationHint: 'celebrate',
		voicePattern: 'Swapping {{amountIn}} {{symbolIn}} for {{symbolOut}} on Jupiter…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			required: ['symbolIn', 'symbolOut', 'amountIn'],
			properties: {
				symbolIn: { type: 'string', description: 'Input token symbol or mint address' },
				symbolOut: { type: 'string', description: 'Output token symbol or mint address' },
				amountIn: { type: 'number', description: 'Human-readable input amount' },
				decimalsIn: { type: 'number' },
				slippageBps: { type: 'number' },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
			},
		},
		handler: async (args, _ctx) => {
			const inputMint = await resolveMint(args.symbolIn);
			if (!inputMint)
				return { success: false, output: `Unknown token: ${args.symbolIn}`, sentiment: -0.3 };

			const outputMint = await resolveMint(args.symbolOut);
			if (!outputMint)
				return { success: false, output: `Unknown token: ${args.symbolOut}`, sentiment: -0.3 };

			// Step 1: quote
			const quote = await quoteJupiter({
				inputMint,
				outputMint,
				amountIn: args.amountIn,
				decimalsIn: args.decimalsIn ?? 9,
				slippageBps: args.slippageBps ?? 50,
			});

			// Step 2: execute (wallet approval dialog fires here)
			const result = await executeJupiterSwap(quote, {
				network: args.network ?? 'mainnet',
				wrapUnwrapSOL: true,
			});

			return {
				success: true,
				output: `Swap confirmed! ${args.amountIn} ${args.symbolIn} → ${fmtToken(result.outAmount, 6)} ${args.symbolOut}. Tx: ${result.txid}`,
				sentiment: 0.9,
				data: { ...result, symbolIn: args.symbolIn, symbolOut: args.symbolOut },
			};
		},
	});

	// ── jupiter-tokens ────────────────────────────────────────────────────────
	skills.register({
		name: 'jupiter-tokens',
		description: 'Search Jupiter token list and resolve symbol → mint address.',
		instruction: 'Look up token info by symbol. Read-only, no wallet.',
		animationHint: 'inspect',
		voicePattern: 'Looking up {{symbol}} on Jupiter…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			required: ['symbol'],
			properties: {
				symbol: { type: 'string', description: 'Token symbol to look up (e.g. BONK, WIF)' },
			},
		},
		handler: async (args, _ctx) => {
			const mint = await resolveTokenMint(args.symbol);
			if (!mint)
				return {
					success: false,
					output: `Token "${args.symbol}" not found on Jupiter strict list.`,
					sentiment: -0.1,
				};

			const tokens = await getJupiterTopTokens();
			const info = tokens.find((t) => t.address === mint);

			return {
				success: true,
				output: `${info?.name ?? args.symbol} (${args.symbol.toUpperCase()}) — mint: ${mint}`,
				sentiment: 0.2,
				data: { symbol: info?.symbol, name: info?.name, mint, decimals: info?.decimals },
			};
		},
	});

	// ── pyth-price ────────────────────────────────────────────────────────────
	skills.register({
		name: 'pyth-price',
		description:
			'Get the current USD price for one or more tokens from Pyth Network oracle. ' +
			`Supported: ${Object.keys(PRICE_FEED_IDS).join(', ')}.`,
		instruction:
			'Fetch live price from Pyth Hermes API. Returns price, confidence interval, and publish timestamp.',
		animationHint: 'inspect',
		voicePattern: '{{symbol}} is {{price}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			required: ['symbols'],
			properties: {
				symbols: {
					oneOf: [
						{ type: 'string', description: 'Single symbol, e.g. SOL' },
						{
							type: 'array',
							items: { type: 'string' },
							description: 'Multiple symbols, e.g. ["SOL","BTC"]',
						},
					],
				},
			},
		},
		handler: async (args, _ctx) => {
			const syms = Array.isArray(args.symbols) ? args.symbols : [args.symbols];
			const prices = await getPrices(syms);

			const lines = syms.map((s) => {
				const p = prices[s.toUpperCase()];
				if (!p || isNaN(p.price)) return `${s}: unavailable`;
				return `${s}: ${fmtUsd(p.price)} ±${fmtUsd(p.confidence)}`;
			});

			const isSingle = syms.length === 1;
			const singlePrice = isSingle ? prices[syms[0].toUpperCase()]?.price : null;

			return {
				success: true,
				output: lines.join('\n'),
				sentiment: 0.1,
				data: {
					prices,
					...(isSingle && singlePrice ? { price: singlePrice, symbol: syms[0].toUpperCase() } : {}),
				},
			};
		},
	});
}
