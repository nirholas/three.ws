// Signal subscriptions, the follower side: list, subscribe, pause, resume,
// stop and kill. One implementation behind POST /api/signals/subscribe and the
// threews-agent MCP tool sniper_subscribe, so a subscription an agent opens is
// the row the /signals page would have opened.
//
// A live subscription pays the feed's x402 USDC price and mirrors its trades
// from the subscriber agent's own wallet. Turning one live (or resuming one)
// needs the signed real-funds agreement, which the caller checks because it owns
// the request. simulate mode mirrors on paper: it pays nothing and trades
// nothing, and pause, stop and kill never need the agreement.

import { sql } from './db.js';

export const SUBSCRIPTION_STATUSES = Object.freeze(['active', 'paused', 'stopped']);

/** A designed refusal: a stable code and the HTTP status the REST surface answers with. */
export class SignalSubscriptionError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const normNetwork = (n) => (n === 'devnet' ? 'devnet' : 'mainnet');

/** A live subscription that is currently running. PURE. */
export function isLiveRunning(row) {
	return !!row && row.mode === 'live' && row.status === 'active' && row.killed !== true;
}

/** The wire shape of one subscription row. PURE. */
export function shapeSubscription(s) {
	return {
		id: Number(s.id),
		subscriber_agent_id: s.subscriber_agent_id,
		feed_id: Number(s.feed_id),
		network: s.network,
		mode: s.mode,
		billing: s.billing,
		base_sol: num(s.base_sol, 0),
		size_scaling: num(s.size_scaling, 1),
		max_per_trade_sol: num(s.max_per_trade_sol, 0),
		slippage_bps: num(s.slippage_bps, 300),
		firewall_level: s.firewall_level,
		copy_exits: s.copy_exits,
		status: s.status,
		killed: s.killed,
		epoch_paid_until: s.epoch_paid_until || null,
		last_emission_id: Number(s.last_emission_id || 0),
		created_at: s.created_at,
		updated_at: s.updated_at,
	};
}

/**
 * Size and safety knobs for a new or updated subscription, clamped to the
 * ranges the mirror engine accepts. PURE.
 */
export function subscriptionKnobs(body = {}) {
	return {
		mode: body.mode === 'live' ? 'live' : 'simulate',
		billing: body.billing === 'per_epoch' ? 'per_epoch' : 'per_signal',
		baseSol: Math.max(0.001, Math.min(10, num(body.base_sol, 0.05))),
		sizeScaling: Math.max(0.01, Math.min(20, num(body.size_scaling, 1))),
		maxPerTrade: Math.max(0.001, Math.min(50, num(body.max_per_trade_sol, 0.25))),
		slippageBps: Math.round(Math.max(0, Math.min(5000, num(body.slippage_bps, 300)))),
		firewallLevel: body.firewall_level === 'warn' ? 'warn' : 'block',
		copyExits: body.copy_exits !== false,
	};
}

/** The caller's subscriptions with feed, publisher and delivery stats, newest first. */
export async function listSignalSubscriptions(userId) {
	const rows = await sql`
		select s.*, f.slug as feed_slug, f.title as feed_title,
		       f.price_per_signal_usdc, f.price_per_epoch_usdc, f.epoch_seconds,
		       a.name as publisher_name, a.profile_image_url as publisher_image, a.avatar_url as publisher_avatar,
		       sub.name as subscriber_name,
		       (select count(*) from signal_deliveries d where d.subscription_id = s.id and d.mirror_status = 'executed') as executed,
		       (select count(*) from signal_deliveries d where d.subscription_id = s.id and d.payment_status = 'paid') as paid_count,
		       (select coalesce(sum(d.payment_usdc),0) from signal_deliveries d where d.subscription_id = s.id and d.payment_status = 'paid') as usdc_spent
		from signal_subscriptions s
		join signal_feeds f on f.id = s.feed_id
		join agent_identities a on a.id = f.publisher_agent_id
		join agent_identities sub on sub.id = s.subscriber_agent_id
		where s.owner_user_id = ${userId}
		order by s.created_at desc
	`;
	return rows.map((s) => ({
		...shapeSubscription(s),
		feed: { slug: s.feed_slug, title: s.feed_title, publisher_name: s.publisher_name, publisher_image: s.publisher_image || s.publisher_avatar || null,
			price_per_signal_usdc: num(s.price_per_signal_usdc, 0), price_per_epoch_usdc: num(s.price_per_epoch_usdc, 0), epoch_seconds: num(s.epoch_seconds, 86400) },
		subscriber_name: s.subscriber_name,
		stats: { executed: Number(s.executed) || 0, paid_count: Number(s.paid_count) || 0, usdc_spent: Number(s.usdc_spent) || 0 },
	}));
}

/** The caller's subscription row, or null. */
export async function loadSignalSubscription(subId, userId) {
	const [row] = await sql`select * from signal_subscriptions where id = ${subId} and owner_user_id = ${userId} limit 1`;
	return row || null;
}

/**
 * The feed a subscription would follow, checked for being subscribable by
 * `agentId`. Throws SignalSubscriptionError when it is not.
 */
export async function loadSubscribableFeed(feedId, agentId) {
	const [feed] = await sql`select * from signal_feeds where id = ${feedId} limit 1`;
	if (!feed) throw new SignalSubscriptionError('feed_not_found', 'feed not found', 404);
	if (feed.status !== 'active') throw new SignalSubscriptionError('feed_inactive', 'this feed is not active', 409);
	if (feed.publisher_agent_id === agentId) throw new SignalSubscriptionError('self_subscribe', 'an agent cannot subscribe to its own feed');
	return { ...feed, network: normNetwork(feed.network) };
}

/** The subscriber agent's current subscription to a feed, or null. */
export async function existingSubscription(agentId, feedId) {
	const [cur] = await sql`select * from signal_subscriptions where subscriber_agent_id = ${agentId} and feed_id = ${feedId} limit 1`;
	return cur || null;
}

/**
 * Create or update the subscriber agent's subscription to a feed. A new
 * subscription starts at the feed's current emission head, so it is never
 * charged for or made to mirror a backlog emitted before it subscribed.
 */
export async function upsertSignalSubscription({ userId, agentId, feed, knobs }) {
	const [head] = await sql`select coalesce(max(id),0) as head from signal_emissions where feed_id = ${feed.id}`;
	const startCursor = Number(head?.head || 0);
	const k = knobs;
	const [sub] = await sql`
		insert into signal_subscriptions
			(subscriber_agent_id, owner_user_id, feed_id, network, mode, billing,
			 base_sol, size_scaling, max_per_trade_sol, slippage_bps, firewall_level, copy_exits, status, killed, last_emission_id)
		values (${agentId}, ${userId}, ${feed.id}, ${feed.network}, ${k.mode}, ${k.billing},
			${k.baseSol}, ${k.sizeScaling}, ${k.maxPerTrade}, ${k.slippageBps}, ${k.firewallLevel}, ${k.copyExits}, 'active', false, ${startCursor})
		on conflict (subscriber_agent_id, feed_id) do update set
			mode = excluded.mode, billing = excluded.billing, base_sol = excluded.base_sol,
			size_scaling = excluded.size_scaling, max_per_trade_sol = excluded.max_per_trade_sol,
			slippage_bps = excluded.slippage_bps, firewall_level = excluded.firewall_level,
			copy_exits = excluded.copy_exits, status = 'active', killed = false, updated_at = now()
		returning *
	`;
	return shapeSubscription(sub);
}

/**
 * Pause, resume or stop. Resuming clears any kill; pausing and stopping leave
 * the kill flag as it is. Returns null when the subscription is not the caller's.
 */
export async function setSignalSubscriptionStatus({ userId, subId, status }) {
	const next = SUBSCRIPTION_STATUSES.includes(status) ? status : 'paused';
	const [row] = next === 'active'
		? await sql`
			update signal_subscriptions set status = 'active', killed = false, updated_at = now()
			where id = ${subId} and owner_user_id = ${userId} returning *`
		: await sql`
			update signal_subscriptions set status = ${next}, updated_at = now()
			where id = ${subId} and owner_user_id = ${userId} returning *`;
	return row ? shapeSubscription(row) : null;
}

/** The instant halt (or its release). Returns null when the subscription is not the caller's. */
export async function setSignalSubscriptionKilled({ userId, subId, killed }) {
	const [row] = await sql`
		update signal_subscriptions set killed = ${killed}, status = ${killed ? 'paused' : 'active'}, updated_at = now()
		where id = ${subId} and owner_user_id = ${userId} returning *
	`;
	return row ? shapeSubscription(row) : null;
}

/** Active public feeds an agent could follow, newest first, for discovery. */
export async function listSubscribableFeeds({ network = 'mainnet', limit = 20 } = {}) {
	const rows = await sql`
		select f.id, f.slug, f.title, f.network, f.price_per_signal_usdc, f.price_per_epoch_usdc, f.epoch_seconds,
		       a.id as publisher_agent_id, a.name as publisher_name,
		       (select count(*) from signal_subscriptions s where s.feed_id = f.id and s.status = 'active' and s.killed = false)::int as subscribers
		from signal_feeds f join agent_identities a on a.id = f.publisher_agent_id
		where f.network = ${normNetwork(network)} and f.status = 'active' and f.visibility = 'public' and a.is_public is not false
		order by f.created_at desc
		limit ${limit}
	`;
	return rows.map((f) => ({
		id: Number(f.id),
		slug: f.slug,
		title: f.title,
		network: f.network,
		url: `/signals/${f.slug}`,
		publisher_agent_id: f.publisher_agent_id,
		publisher_name: f.publisher_name,
		price_per_signal_usdc: num(f.price_per_signal_usdc, 0),
		price_per_epoch_usdc: num(f.price_per_epoch_usdc, 0),
		subscribers: Number(f.subscribers) || 0,
	}));
}
