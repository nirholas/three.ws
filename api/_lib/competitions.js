// @ts-check
// Builder competitions. The decisions (dates, tracks, prizes, judges, rules)
// live in data/competitions.json, which ships as an empty array; this module
// validates that file, works out a competition's phase from the clock, and
// reads registrations (competition_entries) joined to the platform's own launch
// records (pump_agent_mints) and creator-fee snapshot. Nothing about a prize or
// a deadline is typed anywhere else.
//
// A tokenized entry is one whose agent launched a mainnet coin through three.ws
// between `starts_at` and `tokenize_by`. Entries rank by the creator fees that
// agent has earned (agent-earnings.js, the same attribution rule as the agent
// page and the earnings leaderboard).

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { sql } from './db.js';
import { creatorFeesByAgent } from './agent-earnings.js';

const DEFAULT_FILE = new URL('../../data/competitions.json', import.meta.url);

const isoDate = z
	.string()
	.refine((v) => Number.isFinite(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}/.test(v), 'must be an ISO 8601 date');

const competitionSchema = z
	.object({
		slug: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric with -'),
		title: z.string().min(1).max(120),
		summary: z.string().max(400).optional(),
		starts_at: isoDate,
		register_by: isoDate,
		tokenize_by: isoDate,
		ends_at: isoDate,
		tracks: z.array(z.object({ name: z.string().min(1).max(80), description: z.string().max(600) })).default([]),
		prizes: z
			.array(
				z.object({
					place: z.string().min(1).max(60),
					amount: z.number().nonnegative(),
					asset: z.string().min(1).max(20),
					vesting: z.string().max(300).optional(),
				}),
			)
			.default([]),
		judges: z.array(z.object({ name: z.string().min(1).max(80), role: z.string().max(120).optional(), url: z.string().url().optional() })).default([]),
		rules: z.array(z.string().min(1).max(600)).default([]),
		winners: z.array(z.object({ place: z.string().min(1).max(60), agent_id: z.string().uuid(), note: z.string().max(300).optional() })).default([]),
	})
	.strict()
	.superRefine((c, ctx) => {
		const t = (k) => Date.parse(c[k]);
		const bad = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
		if (!(t('starts_at') < t('register_by'))) bad('register_by', 'must be after starts_at');
		if (!(t('starts_at') < t('tokenize_by'))) bad('tokenize_by', 'must be after starts_at');
		if (!(t('register_by') <= t('ends_at'))) bad('ends_at', 'must be on or after register_by');
		if (!(t('tokenize_by') <= t('ends_at'))) bad('ends_at', 'must be on or after tokenize_by');
	});

/**
 * Validate a parsed competitions file. Throws one Error naming every problem.
 * @param {unknown} raw
 */
export function parseCompetitions(raw) {
	if (!Array.isArray(raw)) throw new Error('competitions: the file must be a JSON array');
	const out = [];
	const seen = new Set();
	raw.forEach((item, i) => {
		const r = competitionSchema.safeParse(item);
		if (!r.success) {
			const detail = r.error.issues.map((x) => `${x.path.join('.') || 'value'}: ${x.message}`).join('; ');
			throw new Error(`competitions[${i}]: ${detail}`);
		}
		if (seen.has(r.data.slug)) throw new Error(`competitions[${i}]: duplicate slug "${r.data.slug}"`);
		seen.add(r.data.slug);
		out.push(r.data);
	});
	return out;
}

/** Read and validate the competitions file. `COMPETITIONS_FILE` overrides the path (tests). */
export function loadCompetitions() {
	const file = process.env.COMPETITIONS_FILE || DEFAULT_FILE;
	return parseCompetitions(JSON.parse(readFileSync(file, 'utf8')));
}

/** @param {string} slug */
export function findCompetition(slug) {
	return loadCompetitions().find((c) => c.slug === slug) || null;
}

/**
 * Where a competition is on the clock.
 *   upcoming  before starts_at, registration not open
 *   open      registration open (starts_at to register_by)
 *   building  registration closed, entrants still building and tokenizing
 *   ended     after ends_at
 * `tokenizing` says whether launches still count; `next_deadline` is the next
 * moment the page counts down to.
 * @param {z.infer<typeof competitionSchema>} c
 * @param {number} [now]
 */
export function competitionPhase(c, now = Date.now()) {
	const starts = Date.parse(c.starts_at);
	const registerBy = Date.parse(c.register_by);
	const tokenizeBy = Date.parse(c.tokenize_by);
	const ends = Date.parse(c.ends_at);
	/** @type {'upcoming'|'open'|'building'|'ended'} */
	let phase;
	if (now < starts) phase = 'upcoming';
	else if (now < registerBy) phase = 'open';
	else if (now < ends) phase = 'building';
	else phase = 'ended';
	const marks = [
		{ key: 'starts_at', label: 'Registration opens', at: starts },
		{ key: 'register_by', label: 'Registration closes', at: registerBy },
		{ key: 'tokenize_by', label: 'Launch your coin by', at: tokenizeBy },
		{ key: 'ends_at', label: 'Competition ends', at: ends },
	]
		.filter((m) => m.at > now)
		.sort((a, b) => a.at - b.at)[0];
	return {
		phase,
		registration_open: phase === 'open',
		tokenizing: now >= starts && now < tokenizeBy,
		next_deadline: marks ? { key: marks.key, label: marks.label, at: new Date(marks.at).toISOString() } : null,
	};
}

/** The listing shape: the config minus nothing secret, plus the phase. */
export function describeCompetition(c, now = Date.now()) {
	return { ...c, ...competitionPhase(c, now) };
}

export function rankingMethod(c) {
	return (
		`Entries are ranked by the creator fees (SOL) their agent's own wallet has earned on pump.fun, from the ` +
		`platform's creator-earnings snapshot (refreshed every 30 minutes) and attributed by the same rule as the ` +
		`agent earnings page. Only a tokenized entry is ranked: its agent launched a mainnet coin through three.ws ` +
		`between ${c.starts_at} and ${c.tokenize_by}. Other entries are listed after the ranked ones, in registration order.`
	);
}

/**
 * Public entries of a competition with their coin and fees, ranked.
 * Only public agents are listed.
 * @param {z.infer<typeof competitionSchema>} c
 */
export async function listEntries(c) {
	const rows = await sql`
		select e.id, e.agent_id, e.team_name, e.x_handle, e.track, e.created_at,
		       ai.name as agent_name
		from competition_entries e
		join agent_identities ai on ai.id = e.agent_id
		where e.competition = ${c.slug} and ai.is_public = true and ai.deleted_at is null
		order by e.created_at asc
	`;
	if (!rows.length) return { entries: [], refreshed_at: null };
	const ids = rows.map((r) => r.agent_id);
	const [coins, fees] = await Promise.all([
		sql`
			select distinct on (agent_id) agent_id, mint, symbol, name, created_at
			from pump_agent_mints
			where agent_id = any(${ids}) and network = 'mainnet'
			  and created_at >= ${c.starts_at} and created_at <= ${c.tokenize_by}
			order by agent_id, created_at asc
		`,
		creatorFeesByAgent(ids),
	]);
	const coinBy = new Map(coins.map((x) => [x.agent_id, x]));
	const entries = rows.map((r) => {
		const coin = coinBy.get(r.agent_id) || null;
		const fee = fees.get(r.agent_id);
		return {
			id: r.id,
			agent: { id: r.agent_id, name: r.agent_name, url: `/agents/${r.agent_id}` },
			team_name: r.team_name,
			x_handle: r.x_handle,
			track: r.track,
			registered_at: r.created_at,
			tokenized: !!coin,
			coin: coin ? { mint: coin.mint, symbol: coin.symbol, name: coin.name, url: `/launches/${coin.mint}`, launched_at: coin.created_at } : null,
			fees_sol: coin ? Number(fee ? fee.lamports : 0n) / 1e9 : null,
			_fee_lamports: coin && fee ? fee.lamports : 0n,
		};
	});
	entries.sort((a, b) => {
		if (a.tokenized !== b.tokenized) return a.tokenized ? -1 : 1;
		if (a.tokenized) {
			if (a._fee_lamports !== b._fee_lamports) return a._fee_lamports > b._fee_lamports ? -1 : 1;
		}
		return String(a.registered_at) < String(b.registered_at) ? -1 : 1;
	});
	let rank = 0;
	const out = entries.map(({ _fee_lamports, ...e }) => ({ rank: e.tokenized ? ++rank : null, ...e }));
	const stamps = [...fees.values()].map((f) => f.refreshed_at).filter(Boolean).map((d) => new Date(d).getTime());
	return { entries: out, refreshed_at: stamps.length ? new Date(Math.min(...stamps)).toISOString() : null };
}

export class RegistrationError extends Error {
	/** @param {number} status @param {string} code @param {string} message */
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

/**
 * Register a caller's agent. Enforces the window, ownership, a public agent and
 * a known track; one entry per agent per competition.
 * @param {z.infer<typeof competitionSchema>} c
 * @param {string} userId
 * @param {{ agent_id: string, team_name?: string, x_handle?: string, track?: string }} input
 * @param {number} [now]
 */
export async function registerEntry(c, userId, input, now = Date.now()) {
	const p = competitionPhase(c, now);
	if (p.phase === 'upcoming') throw new RegistrationError(409, 'registration_not_open', `Registration opens ${c.starts_at}.`);
	if (!p.registration_open) throw new RegistrationError(409, 'registration_closed', `Registration closed ${c.register_by}.`);
	if (c.tracks.length && !input.track) throw new RegistrationError(400, 'validation_error', 'Choose a track.');
	if (input.track && !c.tracks.some((t) => t.name === input.track)) {
		throw new RegistrationError(400, 'validation_error', `Unknown track. Choose one of: ${c.tracks.map((t) => t.name).join(', ')}.`);
	}
	const [agent] = await sql`
		select id, user_id, is_public from agent_identities where id = ${input.agent_id} and deleted_at is null
	`;
	if (!agent || agent.user_id !== userId) {
		throw new RegistrationError(403, 'forbidden', 'That agent does not belong to your account.');
	}
	if (!agent.is_public) {
		throw new RegistrationError(409, 'agent_not_public', 'Make the agent public first: entries appear on the public leaderboard.');
	}
	const [row] = await sql`
		insert into competition_entries (competition, user_id, agent_id, team_name, x_handle, track)
		values (${c.slug}, ${userId}, ${input.agent_id}, ${input.team_name || null}, ${input.x_handle || null}, ${input.track || null})
		on conflict (competition, agent_id) do nothing
		returning id, created_at
	`;
	if (!row) throw new RegistrationError(409, 'already_registered', 'This agent is already entered.');
	return row;
}

/** Entries a signed-in user already has in a competition (agent ids). */
export async function viewerEntries(slug, userId) {
	const rows = await sql`select agent_id from competition_entries where competition = ${slug} and user_id = ${userId}`;
	return rows.map((r) => r.agent_id);
}
