// The shared findings board: the policy that shapes it, the pure rules for
// expiry and reuse, and the DB reads/writes behind /api/teams/:id/findings.
//
// Reuse, never redo: before a Trader acts on a mint it looks for the newest
// research finding on that mint that has not expired. If one exists it cites it;
// if not, research runs once and is written back so the next specialist reuses
// it. traderClearance() is the single rule that turns a research verdict into
// "may trade" or "refused", and its `rule` string is stored on the trade finding
// so every decision says which rule matched.

import { sql } from '../db.js';
import { TeamError } from './roles.js';

export const KINDS = Object.freeze(['research', 'entry_signal', 'trade', 'launch_prep']);

export const VERDICTS = Object.freeze({
	research: ['pass', 'caution', 'avoid'],
	entry_signal: ['setup', 'no_setup'],
	trade: ['quoted', 'simulated', 'executed', 'refused', 'failed'],
	launch_prep: ['ready', 'blocked'],
});

// The Entry specialist's gates, in the exact field names the sniper scorer
// (workers/agent-sniper/scorer.js scoreIntel) reads off a strategy row. They live
// on the team policy rather than in agent_sniper_strategies so no worker can ever
// arm the Entry agent to trade: it only scores and posts.
export const ENTRY_DEFAULTS = Object.freeze({
	min_quality_score: 60,
	max_bundle_score: 0.5,
	require_two_sided_market: true,
	require_smart_money: false,
	min_market_cap_usd: null,
	max_market_cap_usd: null,
});

export const POLICY_DEFAULTS = Object.freeze({
	per_trade_sol: 0.05,
	daily_budget_sol: 0.25,
	finding_ttl_seconds: 900,
	allow_caution: false,
	entry: ENTRY_DEFAULTS,
});

const POLICY_BOUNDS = {
	per_trade_sol: [0.001, 50],
	daily_budget_sol: [0.001, 500],
	finding_ttl_seconds: [60, 86_400],
};

const ENTRY_BOUNDS = {
	min_quality_score: [0, 100],
	max_bundle_score: [0, 1],
	min_market_cap_usd: [0, 1e12],
	max_market_cap_usd: [0, 1e12],
};

const finite = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Validate and fill a team policy. Out-of-range values are refused, not
 * clamped, so an owner who typed 5000 SOL learns that instead of silently
 * getting a different cap.
 */
export function normalizeTeamPolicy(input = {}, base = POLICY_DEFAULTS) {
	const src = input && typeof input === 'object' ? input : {};
	const out = { ...POLICY_DEFAULTS, ...base };
	for (const [key, [lo, hi]] of Object.entries(POLICY_BOUNDS)) {
		if (src[key] === undefined) continue;
		const v = finite(src[key]);
		if (v == null || v < lo || v > hi) {
			throw new TeamError(400, 'bad_policy', `${key} must be between ${lo} and ${hi}`);
		}
		out[key] = key === 'finding_ttl_seconds' ? Math.round(v) : v;
	}
	if (src.allow_caution !== undefined) out.allow_caution = src.allow_caution === true;
	out.entry = normalizeEntryGates(src.entry, out.entry);
	if (out.per_trade_sol > out.daily_budget_sol) {
		throw new TeamError(400, 'bad_policy', 'per_trade_sol cannot exceed daily_budget_sol');
	}
	return out;
}

function normalizeEntryGates(input, base) {
	const out = { ...ENTRY_DEFAULTS, ...(base || {}) };
	if (input == null) return out;
	if (typeof input !== 'object') throw new TeamError(400, 'bad_policy', 'entry must be an object');
	for (const [key, [lo, hi]] of Object.entries(ENTRY_BOUNDS)) {
		if (input[key] === undefined) continue;
		if (input[key] === null || input[key] === '') {
			out[key] = null;
			continue;
		}
		const v = finite(input[key]);
		if (v == null || v < lo || v > hi) throw new TeamError(400, 'bad_policy', `entry.${key} must be between ${lo} and ${hi}`);
		out[key] = key === 'min_quality_score' ? Math.round(v) : v;
	}
	for (const key of ['require_two_sided_market', 'require_smart_money']) {
		if (input[key] !== undefined) out[key] = input[key] === true;
	}
	if (out.min_market_cap_usd != null && out.max_market_cap_usd != null && out.min_market_cap_usd > out.max_market_cap_usd) {
		throw new TeamError(400, 'bad_policy', 'entry.min_market_cap_usd cannot exceed entry.max_market_cap_usd');
	}
	return out;
}

export function expiryFor(policy, now = Date.now()) {
	const ttl = finite(policy?.finding_ttl_seconds) ?? POLICY_DEFAULTS.finding_ttl_seconds;
	return new Date(now + ttl * 1000);
}

/** A finding is live until its expires_at; one without an expiry never expires. */
export function isLive(finding, now = Date.now()) {
	if (!finding) return false;
	if (!finding.expires_at) return true;
	return new Date(finding.expires_at).getTime() > now;
}

/**
 * Newest live research finding on `mint` from a list (any author: a Trader's
 * own write-back counts the same as the Researcher's).
 */
export function pickReusableResearch(findings, mint, now = Date.now()) {
	let best = null;
	for (const f of findings || []) {
		if (f.kind !== 'research' || f.subject !== mint || !isLive(f, now)) continue;
		if (!best || new Date(f.created_at) > new Date(best.created_at)) best = f;
	}
	return best;
}

/**
 * Turn a research verdict into a trade decision. `avoid` is always refused;
 * `caution` only clears when the owner opted into it; a sell is never blocked
 * by research (getting out of a position must always be possible).
 */
export function traderClearance(research, policy, side = 'buy') {
	if (side === 'sell') return { allowed: true, rule: 'sell_always_allowed', reason: 'Exits are never blocked by research.' };
	if (!research) return { allowed: false, rule: 'no_research', reason: 'No live research finding to cite.' };
	if (research.verdict === 'pass') return { allowed: true, rule: 'research_pass', reason: 'Research passed this mint.' };
	if (research.verdict === 'caution') {
		return policy?.allow_caution === true
			? { allowed: true, rule: 'research_caution_allowed', reason: 'Research flagged caution and the team allows caution trades.' }
			: { allowed: false, rule: 'research_caution_blocked', reason: 'Research flagged caution and the team only trades on a pass.' };
	}
	return { allowed: false, rule: 'research_avoid', reason: 'Research says avoid this mint.' };
}

export function assertVerdict(kind, verdict) {
	if (!KINDS.includes(kind)) throw new TeamError(400, 'bad_kind', `kind must be one of ${KINDS.join(', ')}`);
	if (!VERDICTS[kind].includes(verdict)) {
		throw new TeamError(400, 'bad_verdict', `a ${kind} finding's verdict must be one of ${VERDICTS[kind].join(', ')}`);
	}
}

// ── DB ───────────────────────────────────────────────────────────────────────

const FINDING_COLUMNS = sql`
	id, team_id, member_id, author_role, author_agent_id, kind, subject_kind, subject,
	verdict, score, summary, evidence, cites, receipt_id, expires_at, created_at
`;

export async function insertFinding({
	teamId, member, kind, subjectKind = 'mint', subject, verdict, score = null,
	summary, evidence = {}, cites = [], receiptId = null, expiresAt = null,
}) {
	assertVerdict(kind, verdict);
	const cleanScore = score == null ? null : Math.max(0, Math.min(100, Math.round(Number(score))));
	const [row] = await sql`
		insert into team_findings
			(team_id, member_id, author_role, author_agent_id, kind, subject_kind, subject,
			 verdict, score, summary, evidence, cites, receipt_id, expires_at)
		values
			(${teamId}, ${member?.id || null}, ${member?.role || 'custom'}, ${member?.agent_id || null},
			 ${kind}, ${subjectKind}, ${String(subject).slice(0, 120)}, ${verdict}, ${cleanScore},
			 ${String(summary || '').slice(0, 600)}, ${JSON.stringify(evidence || {})}::jsonb,
			 ${cites.filter(Boolean)}::uuid[], ${receiptId}, ${expiresAt})
		returning ${FINDING_COLUMNS}
	`;
	return row;
}

export async function findLiveResearch(teamId, mint) {
	const rows = await sql`
		select ${FINDING_COLUMNS} from team_findings
		where team_id = ${teamId} and kind = 'research' and subject = ${mint}
		  and (expires_at is null or expires_at > now())
		order by created_at desc
		limit 1
	`;
	return rows[0] || null;
}

export async function getFinding(teamId, findingId) {
	const rows = await sql`
		select ${FINDING_COLUMNS} from team_findings where team_id = ${teamId} and id = ${findingId} limit 1
	`;
	return rows[0] || null;
}

export async function listFindings(teamId, { kind = null, subject = null, before = null, limit = 50 } = {}) {
	return sql`
		select ${FINDING_COLUMNS} from team_findings
		where team_id = ${teamId}
		  and (${kind}::text is null or kind = ${kind})
		  and (${subject}::text is null or subject = ${subject})
		  and (${before}::timestamptz is null or created_at < ${before})
		order by created_at desc
		limit ${limit}
	`;
}

export async function findingsSince(teamId, sinceIso, limit = 50) {
	return sql`
		select ${FINDING_COLUMNS} from team_findings
		where team_id = ${teamId} and created_at > ${sinceIso}
		order by created_at asc
		limit ${limit}
	`;
}
