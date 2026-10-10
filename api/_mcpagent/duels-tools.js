// threews-agent MCP: trader duels and agent-to-agent challenges.
//
// Thin adapters over the free-play duel engine (api/_lib/trader-duels.js, the
// /duels pages and api/duels/*) and the challenge store
// (api/_lib/duel-challenges.js). A duel scores the two agents' realized P&L over
// one UTC window; the duels-tick cron resolves it and settles the crowd's
// points. Nothing here moves funds: challenges and calls are free-play.
//
//   read   duel_details, duel_markets (markets, challenges, leaderboard)
//   write  duel_challenge (notifies the opponent's owner),
//          duel_accept (accept opens the duel; decline and cancel close the
//          challenge)

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { listDuels, getDuel, seasonLeaderboard } from '../_lib/trader-duels.js';
import {
	CHALLENGE_NETWORK, CHALLENGE_STATUSES, CHALLENGE_TTL_HOURS, MAX_MESSAGE, DuelChallengeError,
	createChallenge, respondChallenge, getChallenge, listChallenges, challengeLeaderboard,
} from '../_lib/duel-challenges.js';

// Duel state moves with the window clock and the traders' fills, so reads are
// not idempotent; they read only three.ws state.
const LIVE_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// Creates or answers a challenge and notifies the other owner.
const ACT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const WRITE_SCOPES = ['wallet:trade', 'agents:write'];

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

async function enforce(auth) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

/** Sign-in and scope gate (when asked for) plus the designed-error mapping. */
async function run(auth, { signIn = false, scopes = null }, fn) {
	await enforce(auth);
	if (signIn && !auth.userId) return refusal('Sign in to three.ws to duel with your agents.', 'auth_required', { signed_in: false });
	if (scopes && !scopes.some((s) => hasScope(auth.scope, s))) {
		return refusal(`This action needs the ${scopes.join(' or ')} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scopes[0] });
	}
	try {
		return await fn();
	} catch (err) {
		if (err instanceof DuelChallengeError) return refusal(err.message, err.code);
		throw err;
	}
}

const ok = (lines, structured) => ({ content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }], structuredContent: structured });
const sol = (n) => (n == null ? 'n/a' : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(4)} SOL`);
const pct = (r) => (r == null ? 'n/a' : `${Math.round(r * 100)}%`);

function duelLine(d) {
	const winner = d.winner ? `, won by ${d.winner === 'a' ? d.a.name : d.b.name}` : d.void_reason ? `, void (${d.void_reason})` : '';
	return `- ${d.a.name} vs ${d.b.name}: ${d.window_kind} window ${d.window_start.slice(0, 10)}, ${d.phase}${winner}. Crowd ${d.crowd.a.calls}:${d.crowd.b.calls}. ${d.url}`;
}

function challengeLine(c) {
	const action = c.can_respond ? ' Answer with duel_accept.' : c.can_cancel ? ' duel_accept with response "cancel" withdraws it.' : '';
	return `- [${c.id}] ${c.challenger.name} challenged ${c.challenged.name} (${c.window_kind}): ${c.status}${c.duel_url ? `, duel ${c.duel_url}` : ''}.${action}`;
}

function standingLines(d) {
	if (!d.standing) return [];
	const side = (s, name) => (s ? `${name}: ${s.closed ?? 0} closed, ${s.wins ?? 0} wins, ${sol(s.pnl_sol)}` : `${name}: unavailable`);
	const head = d.standing.final ? 'Final:' : `Standing as of ${d.standing.as_of}:`;
	const leading = d.standing.leading ? ` ${d.standing.leading === 'a' ? d.a.name : d.b.name} leads.` : '';
	return [`${head}${leading}`, `  ${side(d.standing.a, d.a.name)}`, `  ${side(d.standing.b, d.b.name)}`];
}

// The UTC dates a window covers: one day, or the first and last day of a week.
function windowSpan(d) {
	const first = String(d.window_start).slice(0, 10);
	const last = new Date(new Date(d.window_end).getTime() - 1).toISOString().slice(0, 10);
	return first === last ? `${first} (UTC)` : `${first} to ${last} (UTC)`;
}

function duelDetailLines(d) {
	// A challenge duel's headline only restates the matchup, so it is shown for
	// generated duels alone.
	const headline = d.headline && !(d.headline.includes(d.a.name) && d.headline.includes(d.b.name)) ? `: ${d.headline}` : '';
	return [
		`${d.a.name} vs ${d.b.name}${headline}`,
		`${d.window_kind} window ${windowSpan(d)}, ${d.phase}. ${d.url}`,
		...standingLines(d),
		`Crowd: ${d.crowd.a.calls} calls (${d.crowd.a.points} pts) on ${d.a.name}, ${d.crowd.b.calls} calls (${d.crowd.b.points} pts) on ${d.b.name}.`,
		d.my_call ? `Your call: ${d.my_call.side === 'a' ? d.a.name : d.b.name} for ${d.my_call.stake} pts (${d.my_call.status}).` : null,
	];
}

const agentIdProp = { type: 'string', format: 'uuid' };

export const duelToolDefs = [
	{
		name: 'duel_challenge',
		title: 'Challenge another agent to a duel',
		group: 'predictions',
		tier: 'write',
		annotations: ACT,
		description: `Challenge another owner's public agent to a trading duel over the next UTC day or week, with one of your public agents. The opponent's owner is notified (bell, push and paired chats) and has ${CHALLENGE_TTL_HOURS} hours to accept. Accepted duels score both agents' realized P&L over the window, are open to free-play crowd calls until the window starts, and count toward the challenge leaderboard (duel_markets view "leaderboard"). Free-play: no funds move. Duels resolve on ${CHALLENGE_NETWORK}. Use this when the owner wants to pit one of their agents against another owner's agent.`,
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { ...agentIdProp, description: 'Your agent that issues the challenge.' },
				opponent_agent_id: { ...agentIdProp, description: 'The agent you challenge. duel_markets view "leaderboard" and /duels show candidates.' },
				window: { type: 'string', enum: ['day', 'week'], default: 'day', description: 'day: the next UTC day. week: the next UTC week.' },
				message: { type: 'string', maxLength: MAX_MESSAGE, description: 'Optional note shown to the opponent\'s owner.' },
			},
			required: ['agent_id', 'opponent_agent_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { signIn: true, scopes: WRITE_SCOPES }, async () => {
			const c = await createChallenge({
				userId: auth.userId,
				challengerAgentId: args.agent_id,
				challengedAgentId: args.opponent_agent_id,
				windowKind: args.window || 'day',
				message: args.message ?? null,
			});
			const channels = Object.entries(c.notified || {}).filter(([, v]) => v === true || (typeof v === 'number' && v > 0)).map(([k]) => k);
			return ok([
				`Challenge ${c.id} sent: ${c.challenger.name} vs ${c.challenged.name}, ${c.window_kind} window. It expires ${c.expires_at}.`,
				channels.length ? `The opponent's owner was notified by ${channels.join(', ')}.` : 'The opponent\'s owner will see it in their challenges list.',
				'duel_details with this challenge_id shows its status.',
			], { ok: true, challenge: c });
		}),
	},
	{
		name: 'duel_accept',
		title: 'Answer a duel challenge',
		group: 'predictions',
		tier: 'write',
		annotations: ACT,
		description: 'Answer a pending challenge. "accept" (the challenged agent\'s owner) opens the duel for its window and notifies the challenger; "decline" turns it down; "cancel" (the challenger\'s owner) withdraws it. duel_markets view "challenges" lists the ones waiting on you. Use this when the owner wants to accept, decline or withdraw a pending challenge.',
		inputSchema: {
			type: 'object',
			properties: {
				challenge_id: { type: 'string', format: 'uuid' },
				response: { type: 'string', enum: ['accept', 'decline', 'cancel'], default: 'accept' },
			},
			required: ['challenge_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { signIn: true, scopes: WRITE_SCOPES }, async () => {
			const response = args.response || 'accept';
			const { challenge, duel } = await respondChallenge({ userId: auth.userId, challengeId: args.challenge_id, response });
			if (response !== 'accept') return ok([`Challenge ${challenge.id} is ${challenge.status}.`], { ok: true, challenge });
			return ok([
				`Accepted. The duel is open: ${challenge.challenger.name} vs ${challenge.challenged.name}.`,
				...(duel ? duelDetailLines(duel) : [challenge.duel_url]),
			], { ok: true, challenge, duel });
		}),
	},
	{
		name: 'duel_details',
		title: 'Duel details',
		group: 'predictions',
		tier: 'read',
		annotations: LIVE_READ,
		description: 'One duel or challenge in full. duel_id: both traders\' 30-day records, the in-window standing (live while running, final once resolved), the crowd\'s calls and your own call. challenge_id (yours, either side): its status and, once accepted, the duel. Use this to follow one duel\'s standing or check where a challenge stands.',
		inputSchema: {
			type: 'object',
			properties: {
				duel_id: { type: 'string', format: 'uuid' },
				challenge_id: { type: 'string', format: 'uuid' },
			},
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, {}, async () => {
			if (!args.duel_id && !args.challenge_id) return refusal('Pass duel_id or challenge_id.', 'invalid_request');
			if (args.challenge_id) {
				if (!auth.userId) return refusal('Sign in to read a challenge.', 'auth_required', { signed_in: false });
				const found = await getChallenge({ userId: auth.userId, challengeId: args.challenge_id });
				if (!found) return refusal('No challenge with that id involves your agents.', 'not_found');
				return ok([
					challengeLine(found.challenge),
					found.challenge.message ? `Message: "${found.challenge.message}"` : null,
					...(found.duel ? duelDetailLines(found.duel) : []),
				], found);
			}
			const duel = await getDuel(args.duel_id, { userId: auth.userId || null });
			if (!duel) return refusal('No duel with that id.', 'not_found');
			return ok(duelDetailLines(duel), { duel });
		}),
	},
	{
		name: 'duel_markets',
		title: 'Duels, challenges and leaderboard',
		group: 'predictions',
		tier: 'read',
		annotations: LIVE_READ,
		description: 'Browse duels. view "markets" (default): duels by phase (open for calls, live, settled, all), optionally for one agent. view "challenges": your incoming and outgoing challenges (sign in). view "leaderboard": agents ranked by their challenge-duel record (wins, losses, realized P&L) plus this season\'s top predictors. Call this first to find a duel_id or challenge_id, or to see the leaderboard.',
		inputSchema: {
			type: 'object',
			properties: {
				view: { type: 'string', enum: ['markets', 'challenges', 'leaderboard'], default: 'markets' },
				phase: { type: 'string', enum: ['open', 'live', 'settled', 'all'], default: 'open', description: 'markets view.' },
				agent_id: { ...agentIdProp, description: 'markets: duels featuring this agent. leaderboard: also return this agent\'s row.' },
				direction: { type: 'string', enum: ['incoming', 'outgoing', 'all'], default: 'all', description: 'challenges view.' },
				status: { type: 'string', enum: CHALLENGE_STATUSES, description: 'challenges view.' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
			},
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, {}, async () => {
			const view = args.view || 'markets';
			const limit = args.limit || 20;
			if (view === 'challenges') {
				if (!auth.userId) return refusal('Sign in to see your challenges.', 'auth_required', { signed_in: false });
				const challenges = await listChallenges({ userId: auth.userId, direction: args.direction || 'all', status: args.status || null, limit });
				return ok([
					challenges.length ? `${challenges.length} challenge${challenges.length === 1 ? '' : 's'}:` : 'No challenges yet. duel_challenge sends one.',
					...challenges.map(challengeLine),
				], { challenges });
			}
			if (view === 'leaderboard') {
				const [board, predictors] = await Promise.all([
					challengeLeaderboard({ limit, agentId: args.agent_id || null }),
					seasonLeaderboard({ limit: Math.min(limit, 10), userId: auth.userId || null }),
				]);
				return ok([
					board.leaders.length ? 'Challenge duel leaderboard:' : 'No challenge duel has settled yet. The first accepted challenge to resolve starts the board.',
					...board.leaders.map((r) => `${r.rank}. ${r.name}: ${r.wins}W ${r.losses}L${r.voids ? ` ${r.voids} void` : ''}, win rate ${pct(r.win_rate)}, ${sol(r.realized_pnl_sol)} (${r.trader})`),
					board.agent ? `${board.agent.name}: rank ${board.agent.rank}, ${board.agent.wins}W ${board.agent.losses}L.` : args.agent_id ? 'That agent has no settled challenge duel yet.' : null,
					`${board.challenges.pending} challenges pending, ${board.challenges.accepted} accepted.`,
					predictors.leaders.length ? `Top predictors (season ${predictors.season.id}):` : null,
					...predictors.leaders.map((p) => `${p.rank}. ${p.name}: ${p.net >= 0 ? '+' : ''}${p.net} pts, ${p.wins}/${p.decided} right`),
				], { leaderboard: board, predictors });
			}
			const phase = args.phase || 'open';
			const duels = await listDuels({ network: CHALLENGE_NETWORK, phase, agentId: args.agent_id || null, userId: auth.userId || null, limit });
			return ok([
				duels.length ? `${duels.length} ${phase} duel${duels.length === 1 ? '' : 's'}:` : `No ${phase} duels right now. New ones open daily on /duels, and duel_challenge starts your own.`,
				...duels.map(duelLine),
			], { phase, duels });
		}),
	},
];
