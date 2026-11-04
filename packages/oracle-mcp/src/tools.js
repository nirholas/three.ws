// The Oracle read tools. Every tool is a live GET against /api/oracle/*; a 404
// is reported as "not found" and a 5xx or timeout as "temporarily unavailable",
// never as an empty market, so an agent does not loosen its filters during an
// outage.

import { z } from 'zod';

import { apiRequest } from './lib/api.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const NETWORK = z.enum(['mainnet', 'devnet']).default('mainnet').describe('Solana network. Default mainnet.');
const TIERS = ['prime', 'strong', 'lean', 'watch', 'avoid'];
const CATEGORIES = ['meme', 'tech', 'ai', 'culture', 'community', 'political', 'news', 'animal', 'celebrity', 'utility', 'unknown'];
const PERIOD = z.enum(['1d', '7d', '30d', '90d', 'all']).default('30d');
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const GETTING_STARTED_TEXT = [
	'three.ws Oracle MCP: free, read-only, no key.',
	'',
	'What it is: a conviction score (0-100) and tier (prime, strong, lean, watch, avoid) for every pump.fun launch, built from four pillars (pedigree, structure, narrative, momentum).',
	'',
	'Start here:',
	'1. oracle_stats: how much to trust the signal today (win rate of calls vs the market base rate).',
	'2. oracle_top_plays: the best current calls. oracle_feed is the wider, filterable board.',
	'3. oracle_coin: the full verdict for one mint. oracle_search finds a mint from a symbol.',
	'4. oracle_wins, oracle_backtest, oracle_calibration: proof the signal worked before you size anything off it.',
	'5. oracle_leaderboard, oracle_wallet: which agents and wallets are actually winning.',
	'',
	'Reading rules: a score is a lead, not a promise. Scale by data confidence. A 404 is "not found", a 5xx is "temporarily unavailable", neither is an empty market.',
	'',
	'Arming an agent to trade on these signals is NOT in this server. That moves real SOL and lives in @three-ws/agent-trader-mcp or the hosted server at https://three.ws/api/mcp-oracle (oracle_arm_watch), behind a signed real-funds agreement. Default mode there is simulate.',
].join('\n');

export function shapeError(err, subject) {
	if (err?.code === 'upstream_error' && err.status === 404) {
		return { ok: false, found: false, message: `${subject} was not found. This is not an outage.` };
	}
	if (err?.code === 'upstream_error' && err.status === 429) {
		return { ok: false, rate_limited: true, message: 'Rate limited by three.ws. Retry after a short wait.' };
	}
	if (err?.code === 'upstream_error' && err.status >= 400 && err.status < 500) {
		return { ok: false, message: err.message, status: err.status };
	}
	return {
		ok: false,
		transient: true,
		message: `Oracle is temporarily unavailable for ${subject}. Retry shortly. This is not an empty market.`,
		detail: err?.message,
	};
}

function readTool({ name, title, description, path, shape, subject, inputSchema = {} }) {
	return {
		name,
		title,
		description,
		annotations: READ,
		inputSchema: { ...inputSchema, network: NETWORK },
		async handler(args = {}) {
			try {
				const data = await apiRequest(path, { query: { network: args.network, ...shape(args) } });
				return { ok: true, ...(Array.isArray(data) ? { items: data } : data) };
			} catch (err) {
				return shapeError(err, subject(args));
			}
		},
	};
}

export const TOOLS = [
	{
		name: 'oracle_getting_started',
		title: 'Oracle getting started',
		description:
			'Explain what the Oracle is, which tool to call first and what it can and cannot do. Use this first when you have not used the Oracle before.',
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		inputSchema: {},
		async handler() {
			return GETTING_STARTED_TEXT;
		},
	},
	readTool({
		name: 'oracle_top_plays',
		title: 'Oracle top conviction plays',
		description:
			'Get the current best pump.fun launches ranked by Oracle conviction, each with score, tier, pillar scores and badges. Use this when you want the shortlist worth looking at right now.',
		path: '/api/oracle/feed',
		inputSchema: {
			limit: z.number().int().min(1).max(20).default(5).describe('Plays to return (max 20).'),
			min_score: z.number().int().min(0).max(100).default(72).describe('Minimum conviction score. 72 is strong and above.'),
			category: z.enum(CATEGORIES).optional().describe('Narrative category filter.'),
		},
		shape: (a) => ({ limit: a.limit ?? 5, min_score: a.min_score ?? 72, category: a.category }),
		subject: () => 'the top plays',
	}),
	{
		name: 'oracle_coin',
		title: 'Oracle verdict for one coin',
		description:
			'Get the full Oracle verdict for one pump.fun mint: score, tier, four pillar scores with reasons, narrative, and who is in. Use this when you have a mint and want to know whether to trust it.',
		annotations: READ,
		inputSchema: { mint: z.string().describe('SPL mint pubkey (base58).'), network: NETWORK },
		async handler(args = {}) {
			const mint = String(args.mint ?? '').trim();
			if (!MINT_RE.test(mint)) return { ok: false, message: 'Invalid mint: must be a base58 Solana address (32-44 chars).' };
			try {
				const data = await apiRequest('/api/oracle/coin', { query: { mint, network: args.network } });
				return { ok: true, ...data };
			} catch (err) {
				return shapeError(err, `coin ${mint}`);
			}
		},
	},
	readTool({
		name: 'oracle_feed',
		title: 'Oracle live feed',
		description:
			'Read the live conviction feed with filters: score, tier and category, plus the tier hit-rate backtest. Use this when you want a wider board than oracle_top_plays.',
		path: '/api/oracle/feed',
		inputSchema: {
			limit: z.number().int().min(1).max(200).default(50),
			min_score: z.number().int().min(0).max(100).default(0),
			tier: z.enum(TIERS).optional(),
			category: z.enum(CATEGORIES).optional(),
		},
		shape: (a) => ({ limit: a.limit, min_score: a.min_score, tier: a.tier, category: a.category }),
		subject: () => 'the feed',
	}),
	readTool({
		name: 'oracle_search',
		title: 'Search Oracle coins',
		description: 'Find scored coins by symbol or name and get their mint, score and tier. Use this when you know a coin by name but not its mint.',
		path: '/api/oracle/search',
		inputSchema: { q: z.string().min(1).max(40).describe('Symbol or name fragment.'), limit: z.number().int().min(1).max(20).default(10) },
		shape: (a) => ({ q: a.q, limit: a.limit }),
		subject: (a) => `"${a.q}"`,
	}),
	readTool({
		name: 'oracle_movers',
		title: 'Oracle conviction movers',
		description: 'List coins whose conviction score moved the most over a window. Use this when you want momentum in the signal itself rather than in price.',
		path: '/api/oracle/movers',
		inputSchema: {
			hours: z.number().int().min(1).max(48).default(24),
			direction: z.enum(['rising', 'falling', 'all']).default('rising'),
			limit: z.number().int().min(1).max(60).default(30),
			min_delta: z.number().int().min(1).default(5),
		},
		shape: (a) => ({ hours: a.hours, direction: a.direction, limit: a.limit, min_delta: a.min_delta }),
		subject: () => 'the movers board',
	}),
	readTool({
		name: 'oracle_wins',
		title: 'Oracle resolved wins',
		description: 'List coins Oracle called that later graduated or ran at least 2x without rugging. Use this when you want proof the signal worked, not a promise that it will.',
		path: '/api/oracle/wins',
		inputSchema: {
			period: PERIOD,
			tier: z.string().optional().describe('called (lean and above) or one tier name.'),
			min_ath: z.number().min(1).default(2),
			limit: z.number().int().min(1).max(100).default(50),
			before: z.string().optional().describe('Pagination cursor.'),
		},
		shape: (a) => ({ period: a.period, tier: a.tier, min_ath: a.min_ath, limit: a.limit, before: a.before }),
		subject: () => 'the wins board',
	}),
	readTool({
		name: 'oracle_backtest',
		title: 'Oracle backtest',
		description: 'Read the realized hit rate of calls per tier over a period, next to the base rate of all launches. Use this before you size a position off a tier.',
		path: '/api/oracle/backtest',
		inputSchema: { period: PERIOD, tier: z.enum([...TIERS, 'all']).default('all') },
		shape: (a) => ({ period: a.period, tier: a.tier }),
		subject: () => 'the backtest',
	}),
	readTool({
		name: 'oracle_calibration',
		title: 'Oracle calibration',
		description: 'Read whether scores are calibrated: per score band, the share of coins that went on to win. Use this when you need to know if an 80 really beats a 60.',
		path: '/api/oracle/calibration',
		shape: () => ({}),
		subject: () => 'the calibration table',
	}),
	readTool({
		name: 'oracle_leaderboard',
		title: 'Oracle agent leaderboard',
		description: 'Rank the autonomous agents trading the Oracle stream by realized results. Use this to see which armed agents are winning before you compare one.',
		path: '/api/oracle/leaderboard',
		inputSchema: { limit: z.number().int().min(1).max(50).default(20), min_actions: z.number().int().min(1).max(1000).default(3) },
		shape: (a) => ({ limit: a.limit, min_actions: a.min_actions }),
		subject: () => 'the agent leaderboard',
	}),
	readTool({
		name: 'oracle_wallet',
		title: 'Oracle wallet intelligence',
		description:
			'Read one wallet reputation card (archetype, win rate, early entries, dump rate), or with no address the ranked wallet leaderboard. Use this to tell smart money from a sniper.',
		path: '/api/oracle/wallet',
		inputSchema: {
			address: z.string().optional().describe('Wallet pubkey. Omit for the leaderboard.'),
			label: z.string().optional().describe('Leaderboard only: restrict to one label.'),
			limit: z.number().int().min(1).max(200).default(50),
		},
		shape: (a) => (a.address ? { address: a.address } : { leaderboard: 1, label: a.label, limit: a.limit }),
		subject: (a) => (a.address ? `wallet ${a.address}` : 'the wallet leaderboard'),
	}),
	readTool({
		name: 'oracle_stats',
		title: 'Oracle engine stats',
		description: 'Read the headline numbers: coins scored, prime and strong counts, the win rate of calls next to the market base rate, and agents armed. Use this first to judge how much to trust the signal today.',
		path: '/api/oracle/stats',
		shape: () => ({}),
		subject: () => 'the engine stats',
	}),
];
