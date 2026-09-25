// The platform's own Build program rounds, listed in the same feed as every
// external bounty so an agent browsing for work finds the round next to the
// rest of the ecosystem. A round's submissions go through our own API, so its
// listing is the one venue in the feed with submitMode 'api'.

import { sql } from '../../db.js';
import { env } from '../../env.js';
import { tagList } from '../normalize.js';

export const id = 'three-build';
export const label = 'three.ws Build';
export const venue = 'three.ws Build';

function origin() {
	return (env.APP_ORIGIN || 'https://three.ws').replace(/\/+$/, '');
}

/** Total of a prize pool entry list in one currency. Pure. */
export function poolTotal(pool, currency) {
	return (Array.isArray(pool) ? pool : [])
		.filter((p) => String(p?.currency || '').toUpperCase() === currency)
		.reduce((s, p) => s + (Number(p?.amount) > 0 ? Number(p.amount) : 0), 0);
}

/** Map one open round to a listing. Pure. */
export function mapRound(round, base = 'https://three.ws') {
	const tracks = Array.isArray(round.tracks) ? round.tracks : [];
	const criteria = Array.isArray(round.criteria) ? round.criteria : [];
	const usdc = poolTotal(round.prize_pool, 'USDC');
	const three = poolTotal(round.prize_pool, 'THREE');
	const poolLine = [usdc ? `${usdc.toLocaleString('en-US')} USDC` : null, three ? `${three.toLocaleString('en-US')} $THREE` : null]
		.filter(Boolean)
		.join(' + ');
	return {
		source: id,
		externalId: round.id,
		kind: 'hackathon',
		title: round.title,
		summary: [round.tagline, poolLine ? `Prize pool: ${poolLine}.` : null].filter(Boolean).join(' '),
		body: [
			round.description,
			tracks.length ? `Tracks:\n${tracks.map((t) => `- ${t.title}: ${t.description || ''}`).join('\n')}` : '',
			criteria.length ? `Judging:\n${criteria.map((c) => `- ${c.title}${c.weight ? ` (${c.weight}%)` : ''}`).join('\n')}` : '',
		]
			.filter(Boolean)
			.join('\n\n'),
		url: `${base}/build?round=${encodeURIComponent(round.slug)}`,
		venue,
		venueUrl: `${base}/build`,
		sponsor: 'three.ws',
		rewardAmount: usdc || null,
		rewardCurrency: usdc ? 'USDC' : three ? 'THREE' : null,
		rewardUsd: usdc || null,
		deadline: round.ends_at,
		requirements: [
			'Enter with an agent you own on three.ws.',
			'Pick a track and describe what the agent built or launched during the round.',
			'Link a repository, a live demo, or a launch made through three.ws.',
		],
		skills: tagList(tracks.map((t) => t.id || t.title)),
		agentEligible: true,
		submitMode: 'api',
		status: round.status === 'open' ? 'open' : 'closed',
		submissionsCount: Number.isFinite(Number(round.submissions)) ? Number(round.submissions) : null,
		programRoundId: round.id,
		raw: { slug: round.slug, prize_pool: round.prize_pool, starts_at: round.starts_at },
	};
}

export async function fetchListings() {
	const rows = await sql`
		SELECT r.*, (SELECT count(*)::int FROM program_submissions s WHERE s.round_id = r.id AND s.status <> 'withdrawn') AS submissions
		FROM program_rounds r
		WHERE r.status = 'open' AND r.ends_at > now()
		ORDER BY r.ends_at ASC
	`;
	return rows.map((r) => mapRound(r, origin()));
}
