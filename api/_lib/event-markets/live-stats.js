// Activity-surface reads for Event Markets: the platform pulse (live count,
// biggest mover, closing soon) and trending (most picks in the last hour).
// Everything comes from our own tables; a quiet platform returns honest zeros.

import { sql } from '../db.js';
import { feedConfig } from './feed-config.js';

const marketUrl = (slug) => `https://three.ws/event-markets/${encodeURIComponent(slug)}`;

/** Pulse view: how many markets are live, the biggest recent mover, what closes soon. */
export async function pulseEventMarkets() {
	const closingHours = feedConfig.pulse.closingSoonHours;
	const [[live], movers, closing] = await Promise.all([
		sql`select count(*)::int as n from event_markets where status = 'open' and locks_at > now()`,
		sql`
			select mv.share_from, mv.share_to, mv.delta_points, mv.window_seconds, mv.created_at,
			       m.slug, m.title, o.label as outcome_label
			  from event_market_moves mv
			  join event_markets m on m.id = mv.market_id
			  join event_market_outcomes o on o.id = mv.outcome_id
			 where mv.created_at > now() - interval '24 hours'
			 order by abs(mv.delta_points) desc, mv.created_at desc
			 limit 1`,
		sql`
			select m.slug, m.title, m.locks_at,
			       (select count(*)::int from event_market_picks p where p.market_id = m.id) as pick_count
			  from event_markets m
			 where m.status = 'open' and m.locks_at > now()
			   and m.locks_at <= now() + (${closingHours} * interval '1 hour')
			 order by m.locks_at asc
			 limit 5`,
	]);
	const mover = movers[0];
	return {
		live_count: live?.n ?? 0,
		biggest_mover: mover
			? {
					slug: mover.slug,
					title: mover.title,
					outcome: mover.outcome_label,
					share_from: Number(mover.share_from),
					share_to: Number(mover.share_to),
					delta_points: Number(mover.delta_points),
					window_seconds: mover.window_seconds,
					at: mover.created_at,
					market_url: marketUrl(mover.slug),
				}
			: null,
		closing_soon: closing.map((r) => ({
			slug: r.slug,
			title: r.title,
			locks_at: r.locks_at,
			pick_count: r.pick_count,
			market_url: marketUrl(r.slug),
		})),
	};
}

/** Trending: open markets ranked by picks placed or changed in the window. */
export async function trendingEventMarkets(limit = 10) {
	const minutes = feedConfig.trending.windowMinutes;
	const rows = await sql`
		select m.slug, m.title, m.locks_at, count(*)::int as picks_in_window
		  from event_market_events e
		  join event_markets m on m.id = e.market_id
		 where e.kind = 'pick'
		   and e.created_at > now() - (${minutes} * interval '1 minute')
		   and m.status = 'open' and m.locks_at > now()
		 group by m.id
		 order by picks_in_window desc, m.locks_at asc
		 limit ${limit}`;
	return rows.map((r, i) => ({
		rank: i + 1,
		slug: r.slug,
		title: r.title,
		locks_at: r.locks_at,
		picks_in_window: r.picks_in_window,
		window_minutes: minutes,
		market_url: marketUrl(r.slug),
	}));
}
