// Persistence for the aggregated bounty feed (table bounty_listings, migration
// 20260922200000_bounties_build_program.sql).
//
// refreshSources() pulls every source, upserts what it returned and closes the
// listings a source stopped returning. A source that fails or returns nothing
// closes nothing, so an upstream outage never empties the feed.

import { sql } from '../db.js';
import { contentHash, finalizeListing } from './normalize.js';
import { SOURCES } from './sources/index.js';

/** Upsert one normalized listing. Returns its row id. */
export async function upsertListing(l) {
	const hash = contentHash(l);
	const [row] = await sql`
		INSERT INTO bounty_listings
			(source, external_id, kind, title, summary, body, url, venue, venue_url, sponsor, sponsor_logo,
			 reward_amount, reward_max, reward_currency, reward_usd, deadline, requirements, skills,
			 agent_eligible, submit_mode, status, submissions_count, program_round_id, content_hash, raw)
		VALUES
			(${l.source}, ${l.externalId}, ${l.kind}, ${l.title}, ${l.summary}, ${l.body}, ${l.url}, ${l.venue},
			 ${l.venueUrl}, ${l.sponsor}, ${l.sponsorLogo}, ${l.rewardAmount}, ${l.rewardMax}, ${l.rewardCurrency},
			 ${l.rewardUsd}, ${l.deadline}, ${l.requirements}, ${l.skills}, ${l.agentEligible}, ${l.submitMode},
			 ${l.status}, ${l.submissionsCount}, ${l.programRoundId}, ${hash}, ${JSON.stringify(l.raw)}::jsonb)
		ON CONFLICT (source, external_id) DO UPDATE SET
			kind = excluded.kind, title = excluded.title, summary = excluded.summary, body = excluded.body,
			url = excluded.url, venue = excluded.venue, venue_url = excluded.venue_url, sponsor = excluded.sponsor,
			sponsor_logo = excluded.sponsor_logo, reward_amount = excluded.reward_amount,
			reward_max = excluded.reward_max, reward_currency = excluded.reward_currency,
			reward_usd = excluded.reward_usd, deadline = excluded.deadline, requirements = excluded.requirements,
			skills = excluded.skills, agent_eligible = excluded.agent_eligible, submit_mode = excluded.submit_mode,
			status = excluded.status, submissions_count = excluded.submissions_count,
			program_round_id = excluded.program_round_id, content_hash = excluded.content_hash,
			raw = excluded.raw, last_seen_at = now(),
			updated_at = CASE WHEN bounty_listings.content_hash = excluded.content_hash
			                   AND bounty_listings.status = excluded.status
			                  THEN bounty_listings.updated_at ELSE now() END
		RETURNING id
	`;
	return row.id;
}

/** Close a source's open listings it no longer returns, and every listing past its deadline. */
async function closeStale(sourceId, seenIds) {
	const closed = await sql`
		UPDATE bounty_listings SET status = 'closed', updated_at = now()
		 WHERE source = ${sourceId} AND status = 'open' AND NOT (external_id = ANY(${seenIds}))
		RETURNING id
	`;
	return closed.length;
}

export async function closeExpired() {
	const rows = await sql`
		UPDATE bounty_listings SET status = 'closed', updated_at = now()
		 WHERE status = 'open' AND deadline IS NOT NULL AND deadline < now()
		RETURNING id
	`;
	return rows.length;
}

/** Pull one source and persist it. Never throws: a failure is reported in the result. */
export async function refreshSource(source) {
	const started = Date.now();
	try {
		const raw = await source.fetchListings();
		const listings = raw.map(finalizeListing).filter(Boolean);
		let upserted = 0;
		for (const l of listings) {
			await upsertListing(l);
			upserted++;
		}
		// Our own rounds close by status, so an empty answer there is real; an
		// external source answering empty is treated as an outage.
		const authoritative = source.id === 'threews-build' || listings.length > 0;
		const closed = authoritative ? await closeStale(source.id, listings.map((l) => l.externalId)) : 0;
		return { source: source.id, ok: true, fetched: raw.length, upserted, closed, ms: Date.now() - started };
	} catch (err) {
		return { source: source.id, ok: false, error: String(err?.message || err).slice(0, 300), ms: Date.now() - started };
	}
}

export async function refreshSources(sources = SOURCES) {
	const results = await Promise.all(sources.map((s) => refreshSource(s)));
	const expired = await closeExpired();
	return { results, expired };
}

/** Open listings that have never been triaged for their current content. */
export async function untriagedListings(limit = 20) {
	return sql`
		SELECT * FROM bounty_listings
		 WHERE status = 'open' AND triage_hash IS DISTINCT FROM content_hash
		 ORDER BY (source = 'threews-build') DESC, reward_usd DESC NULLS LAST, first_seen_at DESC
		 LIMIT ${limit}
	`;
}

export async function saveTriage(id, { triage, hash, model }) {
	await sql`
		UPDATE bounty_listings
		   SET triage = ${JSON.stringify(triage)}::jsonb, triage_hash = ${hash}, triage_model = ${model}, triaged_at = now()
		 WHERE id = ${id}
	`;
}

export async function getListing(id) {
	const [row] = await sql`SELECT * FROM bounty_listings WHERE id = ${id} LIMIT 1`;
	return row || null;
}

const SORTS = new Set(['reward', 'deadline', 'new', 'fit']);

/**
 * The open feed with filters. Fit sorting happens in the caller, which has the
 * agent's capabilities; the query then returns a wider window to rank from.
 */
export async function queryFeed({ q = '', source = null, kind = null, category = null, minUsd = null, agentEligible = null, sort = 'reward', limit = 30, offset = 0, status = 'open' } = {}) {
	const order = SORTS.has(sort) ? sort : 'reward';
	const lim = Math.min(200, Math.max(1, Number(limit) || 30));
	const off = Math.max(0, Number(offset) || 0);
	const needle = String(q || '').trim().slice(0, 120);
	const like = needle ? `%${needle.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
	const rows = await sql`
		SELECT *, count(*) OVER () AS total_count
		  FROM bounty_listings
		 WHERE status = ${status}
		   AND (${source}::text IS NULL OR source = ${source})
		   AND (${kind}::text IS NULL OR kind = ${kind})
		   AND (${category}::text IS NULL OR triage->>'category' = ${category})
		   AND (${minUsd}::numeric IS NULL OR reward_usd >= ${minUsd})
		   AND (${agentEligible}::boolean IS NULL OR agent_eligible IS DISTINCT FROM false)
		   AND (${like}::text IS NULL OR title ILIKE ${like} OR summary ILIKE ${like} OR sponsor ILIKE ${like} OR ${needle.toLowerCase()} = ANY(skills))
		 ORDER BY
		   (source = 'threews-build') DESC,
		   CASE WHEN ${order} = 'deadline' THEN deadline END ASC NULLS LAST,
		   CASE WHEN ${order} = 'new' THEN first_seen_at END DESC,
		   reward_usd DESC NULLS LAST,
		   first_seen_at DESC
		 LIMIT ${lim} OFFSET ${off}
	`;
	return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}

/** Feed-wide counts for the page header and the source filter. */
export async function feedStats() {
	const [bySource, totals, cats] = await Promise.all([
		sql`
			SELECT source, count(*)::int AS open, coalesce(sum(reward_usd), 0)::float AS usd, max(last_seen_at) AS last_seen
			  FROM bounty_listings WHERE status = 'open' GROUP BY source
		`,
		sql`
			SELECT count(*)::int AS open, coalesce(sum(reward_usd), 0)::float AS usd,
			       count(*) FILTER (WHERE triage_hash = content_hash)::int AS triaged,
			       max(last_seen_at) AS refreshed_at
			  FROM bounty_listings WHERE status = 'open'
		`,
		sql`
			SELECT triage->>'category' AS category, count(*)::int AS n
			  FROM bounty_listings WHERE status = 'open' AND triage ? 'category'
			 GROUP BY 1 ORDER BY 2 DESC
		`,
	]);
	return { bySource, totals: totals[0], categories: cats.filter((c) => c.category) };
}
