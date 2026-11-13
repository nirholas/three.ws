// Tool definitions for the Oracle MCP server (/api/mcp-oracle).
//
// Fourteen tools at most. Four are the existing Oracle tools, shared verbatim
// with /api/mcp (api/_mcp/tools/oracle.js is the single definition): the ranked
// board, one coin's verdict, and the two account-scoped watch tools. The rest
// are read tools that front the live public /api/oracle/* endpoints through
// invokeEndpoint(), so a tool is the endpoint and cannot drift from it.
//
// Honesty contract, enforced by tests/api/mcp-oracle-tools.test.js: a degraded
// store answers a transient error (never an empty market), an unknown subject
// is a distinct not-found answer, and a rate limit says when to retry.

import { toolDefs as sharedOracleDefs } from '../_mcp/tools/oracle.js';
import { invokeEndpoint } from './invoke.js';

const NETWORK = { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet', description: 'Solana network. Defaults to mainnet.' };
const TIERS = ['prime', 'strong', 'lean', 'watch', 'avoid'];
const CATEGORIES = ['meme', 'tech', 'ai', 'culture', 'community', 'political', 'news', 'animal', 'celebrity', 'utility', 'unknown'];
const WALLET_LABELS = ['smart_money', 'sniper', 'dumper', 'rugger', 'fresh', 'neutral', 'unproven'];

const READ_ANNOTATIONS = Object.freeze({
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
});

const ok = (payload) => ({
	content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
	structuredContent: payload,
});

const fail = (text, structured) => ({
	content: [{ type: 'text', text }],
	...(structured ? { structuredContent: structured } : {}),
	isError: true,
});

/**
 * Turn an endpoint answer into a tool result. The mapping is the honesty rule:
 * 200 is data, 404 is "not found" (a real answer), 429 is "retry after N", 4xx
 * is the caller's input, and anything else is a transient outage.
 */
export function shapeEndpointResult({ status, body, retryAfter }, subject) {
	if (status === 200) return ok(body ?? {});
	if (status === 404) {
		return fail(`No Oracle record for ${subject}. It has not been observed yet. This is not an outage.`, { found: false, subject });
	}
	if (status === 429) {
		const wait = retryAfter ? ` Retry in ${retryAfter}s.` : ' Retry in a moment.';
		return fail(`Rate limit exceeded.${wait}`, { rate_limited: true, retry_after: retryAfter });
	}
	if (status >= 400 && status < 500) {
		return fail(`Oracle rejected the request: ${body?.error_description || body?.message || body?.error || `HTTP ${status}`}.`, { rejected: true });
	}
	return fail(
		`Oracle is temporarily unavailable for ${subject}: its data store is degraded. This is not an empty market. Retry shortly.`,
		{ transient: true, retry_after: retryAfter ?? 5 },
	);
}

function clientIp(req) {
	return req?.headers?.['x-forwarded-for'] || undefined;
}

// Endpoint modules load on first use, so listing tools never pulls the oracle
// store and its database client into the census or the discovery path.
const ENDPOINTS = {
	feed: () => import('../oracle/feed.js'),
	search: () => import('../oracle/search.js'),
	movers: () => import('../oracle/movers.js'),
	wins: () => import('../oracle/wins.js'),
	backtest: () => import('../oracle/backtest.js'),
	calibration: () => import('../oracle/calibration.js'),
	leaderboard: () => import('../oracle/leaderboard.js'),
	wallet: () => import('../oracle/wallet.js'),
	stats: () => import('../oracle/stats.js'),
};

function readTool({ name, title, description, endpoint, properties = {}, required, query, subject }) {
	return {
		name,
		title,
		description,
		annotations: READ_ANNOTATIONS,
		inputSchema: {
			type: 'object',
			properties: { ...properties, network: NETWORK },
			...(required ? { required } : {}),
			additionalProperties: false,
		},
		async handler(args = {}, _auth, req) {
			const mod = await ENDPOINTS[endpoint]();
			const result = await invokeEndpoint(mod.default, `/api/oracle/${endpoint}`, {
				query: { network: args.network, ...query(args) },
				ip: clientIp(req),
			});
			return shapeEndpointResult(result, subject(args));
		},
	};
}

const readTools = [
	readTool({
		name: 'oracle_feed',
		title: 'Oracle live feed',
		endpoint: 'feed',
		description:
			'Read the live Oracle conviction feed: the most recently scored pump.fun launches with score, tier, pillars and badges, plus the tier hit-rate backtest. Use this when you want a wider, filterable board than oracle_top_plays, for example every strong-tier coin in one category.',
		properties: {
			limit: { type: 'integer', minimum: 1, maximum: 200, default: 50, description: 'Rows to return (max 200).' },
			min_score: { type: 'integer', minimum: 0, maximum: 100, default: 0, description: 'Minimum conviction score.' },
			tier: { type: 'string', enum: TIERS, description: 'Only coins in this tier.' },
			category: { type: 'string', enum: CATEGORIES, description: 'Only coins in this narrative category.' },
		},
		query: (a) => ({ limit: a.limit, min_score: a.min_score, tier: a.tier, category: a.category }),
		subject: () => 'the feed',
	}),
	readTool({
		name: 'oracle_search',
		title: 'Search Oracle coins',
		endpoint: 'search',
		description:
			'Find scored coins by symbol or name and get their mint, score and tier. Use this when you know a coin by name but not its mint, then pass the mint to oracle_coin for the full verdict.',
		properties: {
			q: { type: 'string', minLength: 1, maxLength: 40, description: 'Symbol or name fragment to match.' },
			limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'Rows to return (max 20).' },
		},
		required: ['q'],
		query: (a) => ({ q: a.q, limit: a.limit }),
		subject: (a) => `"${a.q}"`,
	}),
	readTool({
		name: 'oracle_movers',
		title: 'Oracle conviction movers',
		endpoint: 'movers',
		description:
			'List coins whose conviction score moved the most over a window, rising or falling. Use this when you want momentum in the signal itself rather than in price, for example coins climbing toward the strong tier.',
		properties: {
			hours: { type: 'integer', minimum: 1, maximum: 48, default: 24, description: 'Look-back window in hours.' },
			direction: { type: 'string', enum: ['rising', 'falling', 'all'], default: 'rising', description: 'Which way the score moved.' },
			limit: { type: 'integer', minimum: 1, maximum: 60, default: 30, description: 'Rows to return (max 60).' },
			min_delta: { type: 'integer', minimum: 1, default: 5, description: 'Smallest score change that counts.' },
		},
		query: (a) => ({ hours: a.hours, direction: a.direction, limit: a.limit, min_delta: a.min_delta }),
		subject: () => 'the movers board',
	}),
	readTool({
		name: 'oracle_wins',
		title: 'Oracle resolved wins',
		endpoint: 'wins',
		description:
			'List coins Oracle called that later graduated or ran at least 2x without rugging, newest best first, with the entry score and the realized peak. Use this when you want proof the signal worked, not a promise that it will.',
		properties: {
			period: { type: 'string', enum: ['1d', '7d', '30d', '90d', 'all'], default: '30d', description: 'Resolution window.' },
			tier: { type: 'string', description: 'called (lean and above, default) or one tier name.' },
			min_ath: { type: 'number', minimum: 1, default: 2, description: 'Smallest all-time-high multiple that counts as a win.' },
			limit: { type: 'integer', minimum: 1, maximum: 100, default: 50, description: 'Rows to return (max 100).' },
			before: { type: 'string', description: 'Pagination cursor from a previous page.' },
		},
		query: (a) => ({ period: a.period, tier: a.tier, min_ath: a.min_ath, limit: a.limit, before: a.before }),
		subject: () => 'the wins board',
	}),
	readTool({
		name: 'oracle_backtest',
		title: 'Oracle backtest',
		endpoint: 'backtest',
		description:
			'Read the realized hit rate of Oracle calls per tier over a period, with the base rate of all launches next to it. Use this before you size a position off a tier, so the size reflects what that tier actually delivered.',
		properties: {
			period: { type: 'string', enum: ['1d', '7d', '30d', '90d', 'all'], default: '30d', description: 'Window of resolved coins.' },
			tier: { type: 'string', enum: [...TIERS, 'all'], default: 'all', description: 'Restrict to one tier.' },
		},
		query: (a) => ({ period: a.period, tier: a.tier }),
		subject: () => 'the backtest',
	}),
	readTool({
		name: 'oracle_calibration',
		title: 'Oracle calibration',
		endpoint: 'calibration',
		description:
			'Read whether Oracle scores are calibrated: for each score band, the share of coins that went on to win. Use this when you need to know if an 80 really means better odds than a 60.',
		query: () => ({}),
		subject: () => 'the calibration table',
	}),
	readTool({
		name: 'oracle_leaderboard',
		title: 'Oracle agent leaderboard',
		endpoint: 'leaderboard',
		description:
			'Rank the autonomous agents that trade on the Oracle stream by realized results. Use this to see which armed agents are actually winning before you copy or compare one.',
		properties: {
			limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'Rows to return (max 50).' },
			min_actions: { type: 'integer', minimum: 1, maximum: 1000, default: 3, description: 'Fewest settled actions an agent needs to rank.' },
		},
		query: (a) => ({ limit: a.limit, min_actions: a.min_actions }),
		subject: () => 'the agent leaderboard',
	}),
	readTool({
		name: 'oracle_wallet',
		title: 'Oracle wallet intelligence',
		endpoint: 'wallet',
		description:
			'Read one wallet\'s reputation card (archetype, win rate, early entries, dump rate, recent coins), or with no address the ranked wallet reputation leaderboard filtered by label. Use this when you want to know whether a buyer behind a coin is smart money or a sniper. A wallet the brain has never seen returns known=false, which is different from an outage.',
		properties: {
			address: { type: 'string', description: 'Wallet pubkey (base58). Omit to get the leaderboard.' },
			label: { type: 'string', enum: WALLET_LABELS, description: 'Leaderboard only: restrict to one wallet label.' },
			limit: { type: 'integer', minimum: 1, maximum: 200, default: 50, description: 'Leaderboard only: rows to return.' },
		},
		query: (a) => (a.address ? { address: a.address } : { leaderboard: 1, label: a.label, limit: a.limit }),
		subject: (a) => (a.address ? `wallet ${a.address}` : 'the wallet leaderboard'),
	}),
	readTool({
		name: 'oracle_stats',
		title: 'Oracle engine stats',
		endpoint: 'stats',
		description:
			'Read the engine\'s headline numbers: coins scored in 24 hours and all time, prime and strong counts, the win rate of its calls next to the market base rate, and how many agents are armed. Use this first when you need to judge how much to trust the signal today. When labels.status is \'degraded\' both rates are null: the outcome labeler could not judge most coins, so treat the track record as unknown for now, never as perfect.',
		query: () => ({}),
		subject: () => 'the engine stats',
	}),
];

// Free, static orientation. Named oracle_getting_started so it is unambiguous
// next to other three.ws servers in one client.
export const ORACLE_GETTING_STARTED = 'oracle_getting_started';

const LINKS = { homepage: 'https://three.ws/oracle', docs: 'https://github.com/nirholas/three.ws/blob/main/docs/oracle.md', source: 'https://github.com/nirholas/three.ws' };

export const SHARED_ORACLE_DEFS = sharedOracleDefs;

/** Tool defs in listing order, with getting_started injected by the catalog. */
export const toolDefs = [...sharedOracleDefs, ...readTools];

export { LINKS as ORACLE_LINKS, READ_ANNOTATIONS };
