// threews-agent MCP: Event Markets ("who wins this event?"), free-to-play.
//
// Thin adapters over api/_lib/event-markets/index.js. Picks carry points, not
// funds: nothing here signs, escrows or moves money.
//
//   read   event_markets_list, event_market
//   write  event_market_pick (needs confirm: true; replaces any earlier pick on
//          the same market until it locks)

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { EventMarketError, SOURCE_KINDS, getMarket, listMarkets, placePick, pointRules } from '../_lib/event-markets/index.js';

const LIVE_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// Replaces the caller's earlier pick on that market; nothing is paid or lost.
const ACT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const WRITE_SCOPES = ['agents:write', 'wallet:trade'];

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

async function enforce(auth) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

async function run(auth, { signIn = false, scopes = null }, fn) {
	await enforce(auth);
	if (signIn && !auth.userId) return refusal('Sign in to three.ws to make a pick.', 'auth_required', { signed_in: false });
	if (scopes && !scopes.some((s) => hasScope(auth.scope, s))) {
		return refusal(`This action needs the ${scopes.join(' or ')} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scopes[0] });
	}
	try {
		return await fn();
	} catch (err) {
		if (err instanceof EventMarketError) return refusal(err.message, err.code, err.detail || {});
		throw err;
	}
}

const ok = (lines, structured) => ({ content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }], structuredContent: structured });

function oddsLines(m) {
	const rows = m.outcomes.map((o) => `  - ${o.label} [${o.id}]: ${o.percent}% (${o.picks} picks, ${o.points} points)`);
	return m.odds.even_prior ? [m.odds.note, ...rows] : rows;
}

export const eventMarketToolDefs = [
	{
		name: 'event_markets_list',
		title: 'List Event Markets',
		group: 'predictions',
		tier: 'read',
		annotations: LIVE_READ,
		description: 'List free-to-play "who wins this event?" markets on three.ws, closing soonest first. Filter by status (open, locked, resolved, void, all), source_kind or a title search. Each market shows its live crowd odds. Use this when the owner asks what they can call, which events are open, or what has resolved.',
		inputSchema: {
			type: 'object',
			properties: {
				status: { type: 'string', enum: ['open', 'locked', 'resolved', 'void', 'all'], default: 'open' },
				source_kind: { type: 'string', enum: SOURCE_KINDS },
				q: { type: 'string', maxLength: 80, description: 'Search the market title.' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
				cursor: { type: 'string', maxLength: 300, description: 'next_cursor from a previous page.' },
			},
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, {}, async () => {
			const page = await listMarkets({ status: args.status || 'open', sourceKind: args.source_kind || null, q: args.q || null, limit: args.limit || 10, cursor: args.cursor || null });
			const lines = page.items.map((m) => {
				const top = [...m.outcomes].sort((a, b) => b.share - a.share)[0];
				return `- ${m.title} [${m.slug}] ${m.status}, locks ${m.locks_at}: ${m.odds.even_prior ? 'no picks yet, even split' : `${top.label} leads at ${top.percent}%`}.`;
			});
			return ok([
				lines.length ? `${page.items.length} market${page.items.length === 1 ? '' : 's'}:` : 'No markets match. Try status "all".',
				...lines,
				page.next_cursor ? `More: pass cursor "${page.next_cursor}".` : null,
				'event_market with a slug shows the outcomes and your budget.',
			], { ok: true, ...page });
		}),
	},
	{
		name: 'event_market',
		title: 'Read one Event Market',
		group: 'predictions',
		tier: 'read',
		annotations: LIVE_READ,
		description: 'Read one market by slug: outcomes with live odds (an even split is labelled as such until picks arrive), how it resolves, and, when signed in, your current pick and points budget. Use this before event_market_pick to get the outcome ids and see how many points remain.',
		inputSchema: {
			type: 'object',
			properties: { slug: { type: 'string', minLength: 2, maxLength: 80 } },
			required: ['slug'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, {}, async () => {
			const m = await getMarket(args.slug, { viewer: auth.userId || null });
			const v = m.viewer;
			return ok([
				`${m.title} [${m.slug}]: ${m.status}, locks ${m.locks_at}.`,
				m.resolution_text,
				...oddsLines(m),
				m.winner ? `Winner: ${m.winner.label}.` : null,
				v?.pick ? `Your pick: ${v.pick.points} points on outcome ${v.pick.outcome_id}.` : v ? 'You have no pick on this market.' : 'Sign in to see your pick and points budget.',
				v ? `Points: up to ${v.budget.remaining_for_this_market} more here (season ${v.budget.season}, budget ${v.budget.season_budget}).` : null,
			], { ok: true, market: m });
		}),
	},
	{
		name: 'event_market_pick',
		title: 'Pick a winner in an Event Market',
		group: 'predictions',
		tier: 'write',
		annotations: ACT,
		description: `Put free-play points on the outcome you think wins a market. One live pick per market: a new pick replaces the old one until the market locks, and a pick after the lock is refused. Points only, no funds move. Allowed ${pointRules().min_pick} to ${pointRules().max_pick_per_market} points per market, within a per-season budget. Requires confirm: true, so state the market, outcome and points to the owner and get their yes first. Use event_market to get the outcome id.`,
		inputSchema: {
			type: 'object',
			properties: {
				slug: { type: 'string', minLength: 2, maxLength: 80 },
				outcome_id: { type: 'string', format: 'uuid' },
				points: { type: 'integer', minimum: pointRules().min_pick, maximum: pointRules().max_pick_per_market },
				confirm: { type: 'boolean', description: 'Must be true. Set only after the owner approved this exact pick.' },
			},
			required: ['slug', 'outcome_id', 'points', 'confirm'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { signIn: true, scopes: WRITE_SCOPES }, async () => {
			if (args.confirm !== true) {
				return refusal('Pick not placed: confirm must be true. Tell the owner the market, outcome and points, then call again with confirm: true.', 'confirmation_required');
			}
			const res = await placePick({ market: args.slug, accountId: auth.userId, outcomeId: args.outcome_id, points: args.points });
			const picked = res.market.outcomes.find((o) => o.id === res.pick.outcome_id);
			return ok([
				`Pick placed: ${res.pick.points} points on ${picked?.label ?? res.pick.outcome_id} in ${res.market.title}.`,
				`It can be changed until ${res.market.locks_at}. Odds now:`,
				...oddsLines(res.market),
			], { ok: true, ...res });
		}),
	},
];
