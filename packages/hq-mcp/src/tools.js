// Tool definitions. Each maps 1:1 onto a tool in apps/hq/api/agent-tools.js.

import { z } from 'zod';

import { callHq } from './lib/api.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const limit = z.number().int().min(1).max(25).optional().describe('Rows to return (default 10).');

function remote(name, title, description, inputSchema) {
	return {
		name,
		title,
		description,
		inputSchema,
		annotations: READ_ONLY,
		async handler(args) {
			const data = await callHq({ tool: name.replace(/^hq_/, ''), args: args ?? {} });
			return { ok: true, ...data };
		},
	};
}

export const TOOLS = [
	remote('hq_top_yields', 'Top DeFi yields', 'Highest-APY DeFi pools above a TVL floor, optionally for one chain, one token, or stablecoin pools only. Live DeFiLlama data via HQ. Use this to find where stablecoin, token-specific or chain-specific yield is highest before choosing a pool.', {
		chain: z.string().optional().describe('Chain name, e.g. Ethereum, Solana.'),
		symbol: z.string().max(16).optional().describe('Single-asset pools of this token only, e.g. USDC or SOL. LP pairs that merely contain it are excluded.'),
		minTvl: z.number().min(0).optional().describe('Minimum pool TVL in USD (default 1000000).'),
		stablecoinOnly: z.boolean().optional(),
		limit,
	}),
	remote('hq_chain_tvl', 'Chain TVL ranking', "Total value locked by chain, ranked, with each chain's share of the tracked total. Use this to compare how much value each chain holds or to size one chain against the rest.", {
		chain: z.string().optional().describe('Return just this chain.'),
		limit,
	}),
	remote('hq_protocol_health', 'Protocol health scores', 'Composite 0-100 health score per DeFi protocol (TVL scale, momentum, stability, maturity). A heuristic, not financial advice. Use this to vet a DeFi protocol before depositing or to find the weakest ones.', {
		protocol: z.string().optional().describe('Name or slug filter.'),
		category: z.string().optional().describe('Category filter, e.g. Lending, Dexes.'),
		sort: z.enum(['score', 'tvl', 'weakest']).optional().describe('weakest lists the lowest scores first.'),
		limit,
	}),
	remote('hq_funding_rates', 'Perp funding rates', 'Perpetual funding rates averaged across Binance, Hyperliquid and OKX. Positive means longs pay shorts. Use this to see which assets have crowded long or short leverage.', {
		symbol: z.string().optional().describe('Base asset, e.g. BTC.'),
		limit,
	}),
	remote('hq_liquidations', 'Recent liquidations', 'Perp liquidations over the last four hours: totals, long versus short pain, and the symbols hit hardest. Use this to gauge current market stress or a liquidation cascade.', {
		symbol: z.string().optional(),
		limit,
	}),
	remote('hq_venue_spread', 'Cross-venue spreads', 'Cross-venue price spreads in basis points per asset, widest first. Use this to spot arbitrage or thin liquidity across venues.', {
		symbol: z.string().optional(),
		limit,
	}),
	remote('hq_whale_activity', 'Whale transfers', 'Large ETH transfers (above $500K) in the last hour with exchange net flow. Use this to watch large-holder movement into or out of exchanges.', { limit }),
	remote('hq_gas', 'Gas prices', 'Current gas price per EVM chain with the cheapest chain highlighted. Use this to pick the cheapest EVM chain to transact on right now.', {
		chain: z.string().optional(),
	}),
	{
		name: 'analyze_portfolio_risk',
		title: 'Portfolio risk score',
		description:
			'Score a portfolio 0-100 from positions you supply: concentration, exposure to weakly scored protocols, and crowded-leverage assets, using live HQ protocol health and funding data. Nothing is stored. A heuristic, not financial advice. Use this to check how risky a set of holdings is before rebalancing.',
		inputSchema: {
			positions: z
				.array(
					z.object({
						symbol: z.string().min(1).max(32),
						usd: z.number().positive(),
						protocol: z.string().optional().describe('Protocol name or slug when the position sits in one.'),
						chain: z.string().optional(),
					}),
				)
				.min(1)
				.max(50),
		},
		annotations: READ_ONLY,
		async handler(args) {
			const data = await callHq({ tool: 'portfolio_risk', args: { positions: args.positions } });
			return { ok: true, ...data };
		},
	},
	{
		name: 'hq_ask',
		title: 'Ask HQ a market question',
		description:
			'Ask a plain-language DeFi market question (yields, TVL, protocol safety, funding, liquidations, spreads, whales, gas). HQ routes it to the right tool and returns the data plus a short narrative when its summarizer is configured. Use this when you have a plain-language market question and do not know which hq_ tool answers it.',
		inputSchema: { question: z.string().min(1).max(500) },
		annotations: READ_ONLY,
		async handler(args) {
			const data = await callHq({ question: args.question, narrate: true });
			return { ok: true, ...data };
		},
	},
];
