// The append-only live log behind the stream. Every state change a viewer cares
// about is one row; the row id is the SSE event id, so a reconnect with
// Last-Event-ID replays exactly the rows it missed, on any Cloud Run instance.

import { sql } from '../db.js';
import { feedConfig } from './feed-config.js';

export const EVENT_KINDS = ['open', 'odds', 'pick', 'move', 'lock', 'resolve'];

export async function appendEvent(marketId, kind, payload) {
	const [row] = await sql`
		insert into event_market_events (market_id, kind, payload)
		values (${marketId}, ${kind}, ${JSON.stringify(payload)}::jsonb)
		returning id, created_at
	`;
	return { id: Number(row.id), created_at: row.created_at };
}

export async function latestEventId() {
	const [row] = await sql`select coalesce(max(id), 0)::bigint as id from event_market_events`;
	return Number(row.id);
}

export async function oldestRetainedEventId() {
	const [row] = await sql`select coalesce(min(id), 0)::bigint as id from event_market_events`;
	return Number(row.id);
}

/**
 * Events after a cursor, joined to the market slug so a client can filter and
 * label without a second lookup.
 */
export async function eventsSince(afterId, limit = feedConfig.stream.replayLimit) {
	const rows = await sql`
		select e.id, e.kind, e.payload, e.created_at, m.slug
		from event_market_events e
		join event_markets m on m.id = e.market_id
		where e.id > ${afterId}
		order by e.id asc
		limit ${limit}
	`;
	return rows.map((r) => ({ id: Number(r.id), kind: r.kind, slug: r.slug, at: r.created_at, ...r.payload }));
}

export async function pruneEvents(hours = feedConfig.stream.retentionHours) {
	await sql`delete from event_market_events where created_at < now() - (${hours} * interval '1 hour')`;
}
