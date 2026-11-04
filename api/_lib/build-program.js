// The three.ws Build program: rounds, submissions, the activity leaderboard and
// the payout ledger (tables program_rounds, program_submissions,
// program_leaderboard, program_payouts; migration
// 20260922200000_bounties_build_program.sql).
//
// Payouts are read-only here. A payout row is born `pending_confirmation` and
// nothing is signed until the owner confirms that exact row, so this module has
// no code path that moves funds.

import { z } from 'zod';
import { sql } from './db.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class BuildError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

const httpsUrl = z
	.string()
	.trim()
	.max(500)
	.url()
	.refine((u) => /^https:\/\//i.test(u), 'must be an https url');

export const submissionSchema = z.object({
	roundId: z.string().uuid(),
	trackId: z.string().trim().min(1).max(60),
	agentId: z.string().uuid(),
	title: z.string().trim().min(3).max(120),
	summary: z.string().trim().min(20).max(2000),
	repoUrl: httpsUrl.optional(),
	demoUrl: httpsUrl.optional(),
	launchMint: z.string().trim().regex(BASE58_RE, 'launchMint must be a Solana mint address').optional(),
}).refine((v) => v.repoUrl || v.demoUrl || v.launchMint, { message: 'Link a repository, a live demo, or a launch made through three.ws.', path: ['repoUrl'] });

/** Weighted activity score shown on the leaderboard. Pure. */
export function activityScore({ volumeUsd = 0, callsServed = 0, launches = 0 }) {
	const score = Number(volumeUsd) + 5 * Number(callsServed) + 25 * Number(launches);
	return Math.round(score * 10_000) / 10_000;
}

/** Rank rows by score (ties share the better rank, then break by id for stability). Pure. */
export function rankEntries(entries) {
	const sorted = [...entries].sort((a, b) => b.score - a.score || String(a.agentId).localeCompare(String(b.agentId)));
	let rank = 0;
	let prev = null;
	return sorted.map((e, i) => {
		if (e.score !== prev) rank = i + 1;
		prev = e.score;
		return { ...e, rank };
	});
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

export function serializeRound(r) {
	return {
		id: r.id,
		slug: r.slug,
		title: r.title,
		tagline: r.tagline ?? null,
		description: r.description,
		status: r.status,
		startsAt: iso(r.starts_at),
		endsAt: iso(r.ends_at),
		judgingEndsAt: iso(r.judging_ends_at),
		prizePool: r.prize_pool || [],
		tracks: r.tracks || [],
		criteria: r.criteria || [],
		sponsors: r.sponsors || [],
		buybackBps: r.buyback_bps,
		feeRevenueUsd: Number(r.fee_revenue_usd) || 0,
		participants: r.participants ?? 0,
		submissions: r.submissions ?? 0,
		statsComputedAt: iso(r.stats_computed_at),
	};
}

/** Rounds that are not drafts, newest start first. */
export async function listRounds({ status = null } = {}) {
	const rows = await sql`
		SELECT r.*, (SELECT count(*)::int FROM program_submissions s WHERE s.round_id = r.id AND s.status <> 'withdrawn') AS submissions
		  FROM program_rounds r
		 WHERE r.status <> 'draft' AND (${status}::text IS NULL OR r.status = ${status})
		 ORDER BY (r.status = 'open') DESC, r.starts_at DESC
	`;
	return rows.map(serializeRound);
}

/** A round by slug or id, or the open round when none is named. */
export async function resolveRound(ref) {
	const isId = /^[0-9a-f-]{36}$/i.test(String(ref || ''));
	const [row] = ref
		? await sql`
			SELECT r.*, (SELECT count(*)::int FROM program_submissions s WHERE s.round_id = r.id AND s.status <> 'withdrawn') AS submissions
			  FROM program_rounds r
			 WHERE r.status <> 'draft' AND (${isId ? ref : null}::uuid IS NOT NULL AND r.id = ${isId ? ref : null}::uuid OR r.slug = ${String(ref)})
			 LIMIT 1`
		: await sql`
			SELECT r.*, (SELECT count(*)::int FROM program_submissions s WHERE s.round_id = r.id AND s.status <> 'withdrawn') AS submissions
			  FROM program_rounds r
			 WHERE r.status <> 'draft'
			 ORDER BY (r.status = 'open') DESC, r.starts_at DESC
			 LIMIT 1`;
	return row ? serializeRound(row) : null;
}

export async function leaderboardFor(roundId, { limit = 50 } = {}) {
	const rows = await sql`
		SELECT l.agent_id, l.rank, l.score, l.volume_usd, l.calls_served, l.launches, l.computed_at,
		       i.name, i.is_public
		  FROM program_leaderboard l
		  JOIN agent_identities i ON i.id = l.agent_id AND i.deleted_at IS NULL
		 WHERE l.round_id = ${roundId}
		 ORDER BY l.rank ASC, l.score DESC
		 LIMIT ${limit}
	`;
	return rows.map((r) => ({
		rank: r.rank,
		agentId: r.is_public ? r.agent_id : null,
		name: r.is_public ? r.name : 'Private agent',
		score: Number(r.score),
		volumeUsd: Number(r.volume_usd),
		callsServed: r.calls_served,
		launches: r.launches,
		computedAt: iso(r.computed_at),
	}));
}

/**
 * Recompute one round's leaderboard from real activity inside its window:
 * confirmed paid calls and USDC volume on the agent's token-agent payments, and
 * coins the agent launched. Only agents with a live submission are ranked.
 */
export async function computeLeaderboard(round, { now = new Date() } = {}) {
	const from = round.starts_at;
	const to = new Date(Math.min(new Date(round.ends_at).getTime(), now.getTime())).toISOString();
	const rows = await sql`
		SELECT s.agent_id,
		       coalesce((SELECT count(*) FROM pump_agent_payments p JOIN pump_agent_mints m ON m.id = p.mint_id
		                  WHERE m.agent_id = s.agent_id AND p.status = 'confirmed' AND p.confirmed_at BETWEEN ${from} AND ${to}), 0)::int AS calls_served,
		       coalesce((SELECT sum(p.amount_atomics) / 1000000.0 FROM pump_agent_payments p JOIN pump_agent_mints m ON m.id = p.mint_id
		                  WHERE m.agent_id = s.agent_id AND p.status = 'confirmed' AND p.confirmed_at BETWEEN ${from} AND ${to}
		                    AND p.currency_mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), 0)::float AS volume_usd,
		       coalesce((SELECT count(*) FROM pump_agent_mints m
		                  WHERE m.agent_id = s.agent_id AND m.network = 'mainnet' AND m.created_at BETWEEN ${from} AND ${to}), 0)::int AS launches
		  FROM (SELECT DISTINCT agent_id FROM program_submissions
		         WHERE round_id = ${round.id} AND status IN ('submitted', 'shortlisted', 'winner')) s
	`;
	const ranked = rankEntries(
		rows.map((r) => ({
			agentId: r.agent_id,
			volumeUsd: Number(r.volume_usd),
			callsServed: r.calls_served,
			launches: r.launches,
			score: activityScore({ volumeUsd: r.volume_usd, callsServed: r.calls_served, launches: r.launches }),
		})),
	);
	await sql`DELETE FROM program_leaderboard WHERE round_id = ${round.id} AND NOT (agent_id = ANY(${ranked.map((e) => e.agentId)}::uuid[]))`;
	for (const e of ranked) {
		await sql`
			INSERT INTO program_leaderboard (round_id, agent_id, volume_usd, calls_served, launches, score, rank, computed_at)
			VALUES (${round.id}, ${e.agentId}, ${e.volumeUsd}, ${e.callsServed}, ${e.launches}, ${e.score}, ${e.rank}, now())
			ON CONFLICT (round_id, agent_id) DO UPDATE SET
				volume_usd = excluded.volume_usd, calls_served = excluded.calls_served, launches = excluded.launches,
				score = excluded.score, rank = excluded.rank, computed_at = excluded.computed_at
		`;
	}
	await sql`
		UPDATE program_rounds
		   SET participants = ${ranked.length}, stats_computed_at = now(), updated_at = now()
		 WHERE id = ${round.id}
	`;
	return { roundId: round.id, entries: ranked.length };
}

/**
 * File a submission. Throws BuildError for every refusal so the route maps it
 * to a designed response. One live submission per user per round.
 */
export async function createSubmission(userId, input) {
	const [round] = await sql`SELECT id, status, starts_at, ends_at, tracks FROM program_rounds WHERE id = ${input.roundId} LIMIT 1`;
	if (!round || round.status === 'draft') throw new BuildError(404, 'round_not_found', 'That round does not exist.');
	const now = Date.now();
	if (round.status !== 'open' || now >= new Date(round.ends_at).getTime() || now < new Date(round.starts_at).getTime()) {
		throw new BuildError(409, 'round_closed', 'This round is not accepting submissions.');
	}
	const tracks = Array.isArray(round.tracks) ? round.tracks : [];
	if (!tracks.some((t) => t.id === input.trackId)) throw new BuildError(400, 'unknown_track', 'Pick one of the tracks this round lists.');

	const [agent] = await sql`SELECT id, user_id FROM agent_identities WHERE id = ${input.agentId} AND deleted_at IS NULL LIMIT 1`;
	if (!agent) throw new BuildError(404, 'agent_not_found', 'That agent does not exist.');
	if (agent.user_id !== userId) throw new BuildError(403, 'not_your_agent', 'You can only enter an agent you own.');

	if (input.launchMint) {
		const [mint] = await sql`SELECT id FROM pump_agent_mints WHERE mint = ${input.launchMint} AND agent_id = ${input.agentId} LIMIT 1`;
		if (!mint) throw new BuildError(400, 'launch_not_found', 'That mint was not launched by this agent through three.ws.');
	}

	const [existing] = await sql`
		SELECT id FROM program_submissions WHERE round_id = ${input.roundId} AND user_id = ${userId} AND status <> 'withdrawn' LIMIT 1
	`;
	if (existing) throw new BuildError(409, 'already_submitted', 'You already have a submission in this round. Withdraw it to enter again.');

	const [row] = await sql`
		INSERT INTO program_submissions (round_id, track_id, agent_id, user_id, title, summary, repo_url, demo_url, launch_mint)
		VALUES (${input.roundId}, ${input.trackId}, ${input.agentId}, ${userId}, ${input.title}, ${input.summary},
		        ${input.repoUrl ?? null}, ${input.demoUrl ?? null}, ${input.launchMint ?? null})
		ON CONFLICT (round_id, track_id, agent_id) DO NOTHING
		RETURNING *
	`;
	if (!row) throw new BuildError(409, 'already_submitted', 'This agent already has a submission in that track.');
	return serializeSubmission(row);
}

export function serializeSubmission(r) {
	return {
		id: r.id,
		roundId: r.round_id,
		trackId: r.track_id,
		agentId: r.agent_id,
		title: r.title,
		summary: r.summary,
		repoUrl: r.repo_url ?? null,
		demoUrl: r.demo_url ?? null,
		launchMint: r.launch_mint ?? null,
		status: r.status,
		score: r.score == null ? null : Number(r.score),
		placement: r.placement ?? null,
		createdAt: iso(r.created_at),
	};
}

/** The signed-in user's own submissions, newest first. */
export async function listMySubmissions(userId, roundId = null) {
	const rows = await sql`
		SELECT * FROM program_submissions
		 WHERE user_id = ${userId} AND (${roundId}::uuid IS NULL OR round_id = ${roundId})
		 ORDER BY created_at DESC LIMIT 50
	`;
	return rows.map(serializeSubmission);
}

/** Public submissions of a round (withdrawn and rejected are hidden). */
export async function listPublicSubmissions(roundId, { limit = 100 } = {}) {
	const rows = await sql`
		SELECT s.*, i.name AS agent_name, i.is_public
		  FROM program_submissions s
		  JOIN agent_identities i ON i.id = s.agent_id AND i.deleted_at IS NULL
		 WHERE s.round_id = ${roundId} AND s.status IN ('submitted', 'shortlisted', 'winner')
		 ORDER BY (s.status = 'winner') DESC, s.placement ASC NULLS LAST, s.created_at DESC
		 LIMIT ${limit}
	`;
	return rows.map((r) => ({ ...serializeSubmission(r), agentName: r.is_public ? r.agent_name : 'Private agent' }));
}

/** Payout ledger for a round. Never returns confirm tokens or full recipient addresses. */
export async function listPayouts(roundId) {
	const rows = await sql`
		SELECT p.id, p.kind, p.currency, p.amount_atomic, p.decimals, p.status, p.tx_signature, p.created_at, p.sent_at,
		       p.recipient_address, i.name AS agent_name, i.is_public
		  FROM program_payouts p
		  LEFT JOIN agent_identities i ON i.id = p.agent_id
		 WHERE p.round_id = ${roundId}
		 ORDER BY p.created_at DESC
	`;
	return rows.map((r) => ({
		id: r.id,
		kind: r.kind,
		currency: r.currency,
		amount: Number(r.amount_atomic) / 10 ** r.decimals,
		status: r.status,
		agentName: r.is_public ? r.agent_name : null,
		recipient: r.recipient_address ? `${r.recipient_address.slice(0, 4)}...${r.recipient_address.slice(-4)}` : null,
		txSignature: r.status === 'sent' ? r.tx_signature : null,
		createdAt: iso(r.created_at),
		sentAt: iso(r.sent_at),
	}));
}
