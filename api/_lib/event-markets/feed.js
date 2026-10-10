// Turns raw log rows (pick, open, lock, resolve; written by the database
// triggers in 20261012200000_event_market_live_feed.sql) into the derived rows the
// stream serves: a fresh `odds` snapshot per touched market and a `move` when an
// outcome's share crossed the threshold.
//
// Idempotent and safe to run from several places at once: the stream hub runs it
// whenever it sees raw rows, and /api/cron/event-markets-feed runs it so moves
// are still recorded when nobody is watching. A batch is claimed with a
// compare-and-set on event_market_feed_state, so two instances never process the
// same raw rows twice. If an instance dies between claiming and writing, that
// batch's odds rows are skipped, which is self-healing: the next pick on the
// market writes a fresh absolute snapshot, and every new connection starts from
// a snapshot read straight from the market tables.

import { sql } from '../db.js';
import { feedConfig } from './feed-config.js';
import { appendEvent } from './events.js';
import { notableMoves, moveBucket, normalizeShares } from './moves.js';

const RAW_KINDS = new Set(['pick', 'open', 'lock', 'resolve']);

/** The compact, label-carrying odds shape every feed surface shares. */
export function feedMarket(view) {
	const outcomes = normalizeShares(view.outcomes.map((o) => ({ id: o.id, label: o.label, image_url: o.image_url ?? null, picks: o.picks ?? 0, share: o.share })));
	return {
		slug: view.slug,
		title: view.title,
		status: view.status,
		locks_at: view.locks_at,
		even_prior: Boolean(view.odds?.even_prior),
		pick_count: view.pick_count ?? 0,
		outcomes: outcomes.map((o) => ({
			id: o.id,
			label: o.label,
			image_url: o.image_url,
			picks: o.picks,
			share: Math.round(o.share * 10000) / 10000,
			percent: Math.round(o.share * 100),
		})),
	};
}

async function loadMarket(id) {
	const { getMarket } = await import('./index.js');
	try {
		return await getMarket(id);
	} catch (err) {
		if (err?.status === 404) return null;
		throw err;
	}
}

/**
 * An open market past its lock time gets its `lock` row even if no cron has
 * flipped the stored status yet. The unique index on (market, kind) makes this
 * a no-op once the real status change, or an earlier sweep, wrote it.
 */
export async function sweepLocks() {
	await sql`
		insert into event_market_events (market_id, kind, payload)
		select m.id, 'lock', jsonb_build_object('title', m.title, 'status', 'locked', 'locks_at', m.locks_at)
		  from event_markets m
		 where m.status = 'open' and m.locks_at <= now()
		on conflict (market_id, kind) where kind in ('open','lock','resolve') do nothing`;
}

async function detectMoves(view, snapshotId) {
	const { windowSeconds } = feedConfig.move;
	const [before] = await sql`
		select payload from event_market_events
		 where market_id = ${view.id} and kind = 'odds' and id < ${snapshotId}
		   and created_at <= now() - (${windowSeconds} * interval '1 second')
		 order by id desc limit 1`;
	const [within] = before ? [] : await sql`
		select payload from event_market_events
		 where market_id = ${view.id} and kind = 'odds' and id < ${snapshotId}
		   and created_at > now() - (${windowSeconds} * interval '1 second')
		 order by id asc limit 1`;
	const base = (before || within)?.payload;
	if (!base) return [];
	const baseline = new Map(base.outcomes.map((o) => [o.id, o.share]));
	const current = feedMarket(view).outcomes.map((o) => ({ outcome_id: o.id, share: o.share }));
	const emitted = [];
	for (const mv of notableMoves(baseline, current)) {
		const [recent] = await sql`
			select 1 as hit from event_market_moves
			 where market_id = ${view.id} and outcome_id = ${mv.outcome_id}
			   and created_at > now() - (${windowSeconds} * interval '1 second') limit 1`;
		if (recent) continue;
		const [row] = await sql`
			insert into event_market_moves (market_id, outcome_id, window_bucket, share_from, share_to, delta_points, window_seconds)
			values (${view.id}, ${mv.outcome_id}, ${moveBucket(Date.now(), windowSeconds)}, ${mv.share_from.toFixed(6)}, ${mv.share_to.toFixed(6)}, ${mv.delta_points}, ${windowSeconds})
			on conflict (market_id, outcome_id, window_bucket) do nothing
			returning id`;
		if (!row) continue;
		const label = view.outcomes.find((o) => o.id === mv.outcome_id)?.label ?? null;
		const payload = {
			title: view.title,
			outcome_id: mv.outcome_id,
			label,
			share_from: Math.round(mv.share_from * 10000) / 10000,
			share_to: Math.round(mv.share_to * 10000) / 10000,
			delta_points: mv.delta_points,
			window_seconds: windowSeconds,
		};
		await appendEvent(view.id, 'move', payload);
		emitted.push(payload);
	}
	return emitted;
}

/**
 * Process every raw row newer than the shared cursor.
 * @returns {Promise<{ claimed: boolean, markets: number, odds: number, moves: number }>}
 */
export async function processFeed() {
	await sweepLocks();
	const [state] = await sql`select processed_id from event_market_feed_state where id = 1`;
	const from = Number(state?.processed_id ?? 0);
	const rows = await sql`
		select id, market_id, kind from event_market_events
		 where id > ${from} order by id asc limit ${feedConfig.processing.batchLimit}`;
	const result = { claimed: false, markets: 0, odds: 0, moves: 0 };
	if (!rows.length) return result;

	const upTo = Number(rows[rows.length - 1].id);
	const [claim] = await sql`
		update event_market_feed_state set processed_id = ${upTo}, updated_at = now()
		 where id = 1 and processed_id = ${from} returning processed_id`;
	if (!claim) return result;
	result.claimed = true;

	const touched = [...new Set(rows.filter((r) => RAW_KINDS.has(r.kind)).map((r) => r.market_id))];
	for (const marketId of touched) {
		const view = await loadMarket(marketId);
		if (!view) continue;
		result.markets++;
		const snap = feedMarket(view);
		const { id } = await appendEvent(marketId, 'odds', snap);
		result.odds++;
		if (view.status === 'open') result.moves += (await detectMoves(view, id)).length;
	}
	return result;
}

/** Odds for the markets a new connection should see first. */
export async function snapshotMarkets(slug = null) {
	const { getMarket, listMarkets } = await import('./index.js');
	if (slug) {
		try {
			return { markets: [feedMarket(await getMarket(slug))] };
		} catch (err) {
			if (err?.status === 404) return { markets: [] };
			throw err;
		}
	}
	const { items } = await listMarkets({ status: 'open', limit: 50 });
	return { markets: items.map(feedMarket) };
}
