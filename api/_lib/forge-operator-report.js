// @ts-check
// Shared core of the Forge operator reports: `npm run forge:errors`
// (scripts/forge-error-report.mjs) and `npm run forge:funnel`
// (scripts/forge-funnel-report.mjs, GET /api/ops/forge-funnel, /forge-funnel).
//
// Three things live here so the reports cannot drift apart again:
//
//   1. One definition of a request, a success and a failure. Until 2026-11-27
//      the error report counted catalog-seeder and benchmark rows that the
//      funnel left out, so the same week read 93.9% success in one and 93.0% in
//      the other. Both now print OUTCOME_DEFINITIONS at the top and count by it.
//   2. The blind spot, stated. Requests refused before a job row exists (sign-in,
//      throttles, the reference-image step) never reach forge_creations. On
//      2026-11-26 that was the biggest failure of the day and no per-job report
//      could see it. Every report says so up front, and the funnel CLI reads the
//      one record that does exist (the Cloud Run request log) on request.
//   3. Operator hygiene: actionable messages when the database is missing or
//      unreachable (never a table of zeros), UTC everywhere, and no prompts,
//      emails, wallet addresses or full URLs printed unless --reveal is passed.
//
// Read-only. Every query is a SELECT.

import { sql } from './db.js';
import { classifyForgeError } from './ops/forge-error-class.js';

// ── Definitions ─────────────────────────────────────────────────────────────

export const OUTCOME_DEFINITIONS = Object.freeze([
	Object.freeze({ term: 'request', text: 'one generation someone asked for: a forge_creations row that did not fail over to another lane, platform rows left out' }),
	Object.freeze({ term: 'success', text: 'finished requests over finished plus failed requests; in-flight jobs count as neither' }),
	Object.freeze({ term: 'failure', text: 'a request whose last attempt failed; an attempt that failed over is "recovered", its successor carries the outcome' }),
	Object.freeze({ term: 'attempt', text: 'every finished or failed row, failed-over ones included; lane tables count attempts' }),
	Object.freeze({ term: 'platform rows', text: 'catalog-seeder and quality-benchmark rows (internal, or listed in forge_seed_jobs); left out everywhere' }),
	Object.freeze({ term: 'public lane stats', text: '/api/nvidia/stats counts attempts per lane over every row, platform rows included, so it reads slightly above the lane table here' }),
	Object.freeze({ term: 'time', text: 'rolling windows ending now, days bucketed in UTC' }),
]);

export const PRE_JOB_BLIND_SPOT =
	'Requests refused before a job existed (sign-in required, throttled, image rejected, reference image or lane unavailable) ' +
	'never reach forge_creations, so they are not in these numbers. A healthy job table is not a healthy product. ' +
	'Their only record is the Cloud Run request log: npm run forge:funnel -- --requests';

export const EXIT_CODES = Object.freeze({ ok: 0, degraded: 1, missing_database: 2, unreachable_database: 3 });

export const DATABASE_URL_COMMAND = `export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"`;

/** What to print when DATABASE_URL is absent: the variable, where it is read from, and the one command that provides it. */
export function missingDatabaseMessage(report = 'This report') {
	return [
		`${report} needs DATABASE_URL to read the forge_creations ledger, and it is not set.`,
		'It is read from .env.local, then .env, then the shell. Provide it with:',
		'',
		`  ${DATABASE_URL_COMMAND}`,
		'',
		'That reads the live three-ws-api Cloud Run service and needs a gcloud sign-in that can read it.',
		'If the service you can read is in the three-ws project, prefix the command with GCP_PROJECT=three-ws.',
	].join('\n');
}

/** Host of a database URL, never its credentials. */
export function databaseHost(url) {
	try {
		return new URL(String(url)).hostname || '<DATABASE_URL>';
	} catch {
		return '<DATABASE_URL>';
	}
}

/** What to print when the address is set but the database will not answer. */
export function unreachableDatabaseMessage(err, url) {
	const reason = String(err?.message || err || 'no response').split('\n')[0].slice(0, 240);
	return [
		`Could not read the database at ${databaseHost(url)}: ${reason}`,
		'No report was printed: every number in it would have been empty, not zero.',
		'Check that DATABASE_URL is current (re-read it with the command below) and that this machine can reach it:',
		'',
		`  ${DATABASE_URL_COMMAND}`,
	].join('\n');
}

// ── Privacy ─────────────────────────────────────────────────────────────────

/**
 * Strip what identifies a person from free text an operator report prints: a
 * URL keeps its host (the host is the diagnosis, the path can carry a name),
 * emails, wallet addresses and IPs are replaced.
 * @param {unknown} text
 */
export function redactOperatorText(text) {
	return String(text ?? '')
		.replace(/\bhttps?:\/\/([^/\s?#]+)[^\s)]*/gi, (_, host) => `https://${host}/...`)
		.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
		.replace(/\b0x[0-9a-fA-F]{40}\b/g, '<address>')
		.replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, '<address>')
		.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>');
}

// ── Small shared helpers ────────────────────────────────────────────────────

const int = (v) => {
	const x = Number(v);
	return Number.isFinite(x) ? Math.trunc(x) : 0;
};

/** n/d rounded to 4 places, or null on an empty base. */
function ratio(n, d) {
	return d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null;
}

/** UTC calendar day of a timestamp, whatever the machine's zone. */
export function utcDay(ts) {
	const d = ts instanceof Date ? ts : new Date(String(ts));
	return Number.isNaN(d.getTime()) ? 'unknown' : d.toISOString().slice(0, 10);
}

/** Signed change against the previous window, as a short label. */
export function changeLabel(current, previous) {
	const c = int(current);
	const p = int(previous);
	if (p === 0 && c > 0) return 'new';
	if (c === p) return 'same';
	return c > p ? `+${c - p}` : `-${p - c}`;
}

const countBy = (rows, keyOf) => {
	const m = new Map();
	for (const r of rows) {
		const k = keyOf(r);
		m.set(k, (m.get(k) || 0) + 1);
	}
	return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

// ── Error report: queries ───────────────────────────────────────────────────

// Both queries find catalog-seeder rows with a join, not a per-row NOT EXISTS.
// Behind the `${includeInternal} or ...` switch Postgres plans NOT EXISTS as a
// correlated subplan that scans forge_seed_jobs (34k rows) once per creation,
// which took the report from one second to two minutes on 2026-11-27. The join
// is hashed.

async function errorTotals({ from, to, includeInternal }) {
	const [r] = await sql`
		with w as (
			select fc.status, fc.superseded_by,
			       (fc.internal or seeded.creation_id is not null) as platform
			from forge_creations fc
			left join (select distinct sj.creation_id from forge_seed_jobs sj where sj.creation_id is not null) seeded
				on seeded.creation_id = fc.id
			where fc.created_at > now() - make_interval(days => ${from})
			  and fc.created_at <= now() - make_interval(days => ${to})
		)
		select
			count(*) filter (where (${includeInternal} or not platform) and superseded_by is null)::int                          as requests,
			count(*) filter (where (${includeInternal} or not platform) and superseded_by is null and status = 'done')::int      as done,
			count(*) filter (where (${includeInternal} or not platform) and superseded_by is null and status = 'failed')::int    as failed,
			count(*) filter (where (${includeInternal} or not platform) and superseded_by is null
				and status not in ('done', 'failed'))::int                                                                       as in_flight,
			count(*) filter (where (${includeInternal} or not platform) and superseded_by is not null)::int                      as recovered,
			count(*) filter (where platform)::int                                                                                as platform_rows
		from w
	`;
	return r || {};
}

async function errorFailures({ from, to, includeInternal, includeRecovered, reveal }) {
	return sql`
		select fc.id, fc.error, fc.created_at, fc.backend, fc.path,
		       (fc.superseded_by is not null) as recovered,
		       case when ${reveal} then fc.prompt end as prompt
		from forge_creations fc
		left join (select distinct sj.creation_id from forge_seed_jobs sj where sj.creation_id is not null) seeded
			on seeded.creation_id = fc.id
		where fc.status = 'failed'
		  and fc.created_at > now() - make_interval(days => ${from})
		  and fc.created_at <= now() - make_interval(days => ${to})
		  and (${includeRecovered} or fc.superseded_by is null)
		  and (${includeInternal} or (fc.internal = false and seeded.creation_id is null))
		order by fc.created_at desc
	`;
}

/**
 * Raw rows for the error report over the window and the equal window before it.
 * @param {{ days: number, includeRecovered?: boolean, includeInternal?: boolean, reveal?: boolean }} opts
 */
export async function gatherForgeErrors({ days, includeRecovered = false, includeInternal = false, reveal = false }) {
	const window = { includeInternal, includeRecovered, reveal };
	const [totals, failures, previousTotals, previousFailures] = await Promise.all([
		errorTotals({ from: days, to: 0, ...window }),
		errorFailures({ from: days, to: 0, ...window }),
		errorTotals({ from: days * 2, to: days, ...window }),
		errorFailures({ from: days * 2, to: days, ...window, reveal: false }),
	]);
	return {
		window_days: days,
		include_recovered: includeRecovered,
		include_internal: includeInternal,
		reveal,
		current: { totals, failures },
		previous: { totals: previousTotals, failures: previousFailures },
	};
}

// ── Error report: summary ───────────────────────────────────────────────────

function totalsOf(t = {}) {
	const done = int(t.done);
	const failed = int(t.failed);
	return {
		requests: int(t.requests),
		done,
		failed,
		in_flight: int(t.in_flight),
		recovered: int(t.recovered),
		platform_rows: int(t.platform_rows),
		success_rate: { value: ratio(done, done + failed), n: done, of: done + failed },
	};
}

const classKey = (c) => (c.id === 'other' ? `other:${c.normalized}` : c.id);
const laneOf = (row) => (row.backend == null ? '(not recorded)' : String(row.backend));
const stepOf = (row) => (row.path == null ? '(not recorded)' : String(row.path));

/**
 * Rank the failures by cause, with every cause's count in the previous window.
 * @param {Array<Record<string, any>>} rows
 * @param {Map<string, number>} previous
 * @param {boolean} reveal
 */
function rankCauses(rows, previous, reveal) {
	const groups = new Map();
	for (const row of rows) {
		const c = classifyForgeError(row.error);
		const key = classKey(c);
		let g = groups.get(key);
		if (!g) {
			g = { key, id: c.id, label: c.label, rows: [], seen: new Set(), samples: [] };
			groups.set(key, g);
		}
		g.rows.push(row);
		// One sample per distinct wording, so three samples show three shapes.
		const shape = c.normalized;
		if (g.samples.length < 3 && row.error && !g.seen.has(shape)) {
			g.seen.add(shape);
			const message = String(row.error).slice(0, 200);
			g.samples.push({
				message: reveal ? message : redactOperatorText(message),
				...(reveal && row.prompt ? { prompt: String(row.prompt).slice(0, 160) } : {}),
			});
		}
	}
	return [...groups.values()]
		.map((g) => {
			const times = g.rows.map((r) => new Date(r.created_at).getTime()).filter(Number.isFinite);
			return {
				key: g.key,
				id: g.id,
				label: g.label,
				count: g.rows.length,
				share: rows.length ? Math.round((g.rows.length / rows.length) * 1000) / 1000 : 0,
				previous: previous.get(g.key) || 0,
				change: changeLabel(g.rows.length, previous.get(g.key) || 0),
				lanes: countBy(g.rows, laneOf).map(([lane, n]) => ({ lane, n })),
				steps: countBy(g.rows, stepOf).map(([step, n]) => ({ step, n })),
				first_seen: times.length ? new Date(Math.min(...times)).toISOString() : null,
				last_seen: times.length ? new Date(Math.max(...times)).toISOString() : null,
				samples: g.samples,
			};
		})
		.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * Turn gatherForgeErrors' rows into the report. Pure, so it is tested with
 * fixed rows.
 * @param {Awaited<ReturnType<typeof gatherForgeErrors>>} raw
 */
export function summarizeForgeErrors(raw) {
	const cur = totalsOf(raw.current?.totals);
	const prev = totalsOf(raw.previous?.totals);
	const failures = raw.current?.failures || [];
	const previousByCause = new Map(countBy(raw.previous?.failures || [], (r) => classKey(classifyForgeError(r.error))));
	const causes = rankCauses(failures, previousByCause, Boolean(raw.reveal));
	return {
		window_days: raw.window_days,
		definitions: OUTCOME_DEFINITIONS,
		blind_spot: PRE_JOB_BLIND_SPOT,
		includes_recovered: Boolean(raw.include_recovered),
		includes_platform_rows: Boolean(raw.include_internal),
		revealed: Boolean(raw.reveal),
		...cur,
		previous: prev,
		// What the ranking below counts: the lost requests, plus the recovered
		// attempts when --include-recovered asked for them.
		ranked_failures: failures.length,
		top_problems: causes.slice(0, 3),
		causes,
		by_day: countBy(failures, (r) => utcDay(r.created_at))
			.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
			.map(([day, n]) => ({ day, n })),
		by_lane: countBy(failures, laneOf).map(([lane, n]) => ({ lane, n })),
		by_step: countBy(failures, stepOf).map(([step, n]) => ({ step, n })),
	};
}

// ── Formatting helpers ──────────────────────────────────────────────────────

const pctOf = (v) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);

function definitionLines() {
	const width = Math.max(...OUTCOME_DEFINITIONS.map((d) => d.term.length));
	return OUTCOME_DEFINITIONS.map((d) => `  ${d.term.padEnd(width)}  ${d.text}`);
}

function wrap(text, width = 96, indent = '  ') {
	const out = [];
	let line = '';
	for (const word of String(text).split(/\s+/)) {
		if (line && (line + ' ' + word).length > width) {
			out.push(indent + line);
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) out.push(indent + line);
	return out;
}

// A cell that reads as a number (count, rate, change) aligns right; text aligns left.
const NUMERIC_CELL = /^([-+]?[\d.,]+%?|n\/a|new|same)$/;

function table(headers, rows) {
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
	const numeric = headers.map((_, i) => i > 0 && rows.length > 0 && rows.every((r) => NUMERIC_CELL.test(String(r[i]))));
	const fmt = (r) => r.map((c, i) => (numeric[i] ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join('  ').trimEnd();
	return [`  ${fmt(headers)}`, `  ${widths.map((w) => '-'.repeat(w)).join('  ')}`, ...rows.map((r) => `  ${fmt(r)}`)];
}

// ── Error report: text ──────────────────────────────────────────────────────

/**
 * @param {ReturnType<typeof summarizeForgeErrors>} r
 * @param {{ database?: string }} [opts]
 */
export function formatErrorReport(r, { database = '' } = {}) {
	const days = r.window_days;
	const out = [];
	out.push(`Forge generation errors, last ${days} day(s)${database ? ` on ${databaseHost(database)}` : ''}`);
	out.push('');
	out.push('How this counts');
	out.push(...definitionLines());
	out.push('');
	out.push('Not in these numbers');
	out.push(...wrap(r.blind_spot));
	out.push('');

	out.push(`Top problems by requests lost (change against the ${days} day(s) before)`);
	if (!r.top_problems.length) {
		out.push(
			r.recovered && !r.includes_recovered
				? `  No lost requests in this window. ${r.recovered} attempt(s) failed over and finished; --include-recovered ranks them.`
				: '  No failed requests in this window.',
		);
	}
	r.top_problems.forEach((c, i) => {
		const lane = c.lanes[0] ? `${c.lanes[0].lane} x${c.lanes[0].n}` : '(no lane)';
		out.push(`  ${i + 1}. ${c.id}: ${c.count} (${pctOf(c.share)} of ranked), previously ${c.previous} (${c.change}), worst lane ${lane}`);
		out.push(`     ${c.label}`);
		if (c.samples[0]) out.push(`     e.g. ${c.samples[0].message.slice(0, 110)}`);
	});
	out.push('');

	out.push(
		...table(
			['', 'this window', 'previous'],
			[
				['requests', r.requests, r.previous.requests],
				['finished', r.done, r.previous.done],
				['failed (lost)', r.failed, r.previous.failed],
				['recovered by failover', r.recovered, r.previous.recovered],
				['still in flight', r.in_flight, r.previous.in_flight],
				['success', pctOf(r.success_rate.value), pctOf(r.previous.success_rate.value)],
				[r.includes_platform_rows ? 'platform rows (included)' : 'platform rows (left out)', r.platform_rows, r.previous.platform_rows],
			],
		),
	);
	out.push('');

	if (r.ranked_failures) {
		out.push(`By day (UTC): ${r.by_day.map((d) => `${d.day} ${d.n}`).join(', ')}`);
		out.push(`By lane: ${r.by_lane.map((l) => `${l.lane} ${l.n}`).join(', ')}`);
		out.push(`By step: ${r.by_step.map((s) => `${s.step} ${s.n}`).join(', ')}`);
		out.push('');
		out.push(`All causes (${r.ranked_failures} ${r.includes_recovered ? 'failed attempts, recovered included' : 'lost requests'})`);
		out.push(
			...table(
				['class', 'n', 'share', 'previous', 'change', 'worst lane', 'message'],
				r.causes.map((c) => [
					c.id,
					c.count,
					pctOf(c.share),
					c.previous,
					c.change,
					c.lanes[0] ? `${c.lanes[0].lane} x${c.lanes[0].n}` : '(none)',
					(c.samples[0]?.message || c.label).slice(0, 60),
				]),
			),
		);
		out.push('');
		out.push(`Drill into one cause: npm run forge:errors -- --days ${days} --class ${r.top_problems[0].id}`);
	}
	if (!r.revealed) out.push('Messages are redacted (URLs keep their host; emails, addresses and IPs are masked). --reveal shows them and the prompts.');
	return out.join('\n');
}

/**
 * Every detail of one cause class.
 * @param {ReturnType<typeof summarizeForgeErrors>} r
 * @param {string} classId
 */
export function formatErrorClass(r, classId) {
	const picked = r.causes.filter((c) => c.id === classId);
	if (!picked.length) return null;
	const out = [];
	for (const c of picked) {
		out.push(`${c.id}: ${c.count} of ${r.ranked_failures} (${pctOf(c.share)}), previously ${c.previous} (${c.change})`);
		out.push(`  ${c.label}`);
		out.push(`  lanes: ${c.lanes.map((l) => `${l.lane} x${l.n}`).join(', ')}`);
		out.push(`  steps: ${c.steps.map((s) => `${s.step} x${s.n}`).join(', ')}`);
		out.push(`  first ${c.first_seen}   last ${c.last_seen} (UTC)`);
		for (const s of c.samples) {
			out.push(`  - ${s.message}`);
			if (s.prompt) out.push(`    prompt: ${s.prompt}`);
		}
		out.push('');
	}
	return out.join('\n');
}

// ── Pre-job requests (Cloud Run request log) ────────────────────────────────

const GENERATION_PATHS = new Set(['/api/forge', '/api/gpt-forge']);

export const REQUEST_BUCKETS = Object.freeze([
	{ id: 'accepted', label: 'accepted: a job was created or a cached model served', test: (s) => s >= 200 && s < 300 },
	{ id: 'sign_in', label: 'refused: sign-in required (401)', test: (s) => s === 401 },
	{ id: 'payment', label: 'refused: payment or credits required (402)', test: (s) => s === 402 },
	{ id: 'forbidden', label: 'refused: not allowed here (403)', test: (s) => s === 403 },
	{ id: 'throttled', label: 'throttled: asked to retry later (429)', test: (s) => s === 429 },
	{ id: 'input', label: 'input rejected: bad prompt or unusable image (4xx)', test: (s) => s >= 400 && s < 500 },
	{ id: 'unconfigured', label: 'no lane configured for it (501)', test: (s) => s === 501 },
	{ id: 'server', label: 'failed before a job existed: reference image, lane or storage (5xx)', test: (s) => s >= 500 && s < 600 },
	{ id: 'other', label: 'other status', test: () => true },
]);

/**
 * Parse `gcloud logging read --format='value(httpRequest.status,httpRequest.requestUrl)'`
 * output: one `status<TAB>url` per line.
 * @param {string} text
 */
export function parseRequestLogLines(text) {
	const out = [];
	for (const line of String(text || '').split('\n')) {
		const [status, url] = line.trim().split(/\s+/);
		if (!status || !url) continue;
		out.push({ status: Number(status), url });
	}
	return out;
}

/**
 * Count generation requests by outcome. Polls (GET), rigging (?action=rig) and
 * other routes are not generation requests and are dropped.
 * @param {Array<{ status: number, url: string }>} entries
 * @param {{ truncated?: boolean }} [opts]
 */
export function summarizeRequestLog(entries, { truncated = false } = {}) {
	const counts = new Map(REQUEST_BUCKETS.map((b) => [b.id, 0]));
	let total = 0;
	for (const e of entries) {
		let u;
		try {
			u = new URL(e.url, 'https://three.ws');
		} catch {
			continue;
		}
		if (!GENERATION_PATHS.has(u.pathname) || u.searchParams.get('action') === 'rig') continue;
		const status = Number(e.status);
		if (!Number.isFinite(status)) continue;
		total += 1;
		const bucket = REQUEST_BUCKETS.find((b) => b.test(status));
		counts.set(bucket.id, counts.get(bucket.id) + 1);
	}
	const buckets = REQUEST_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: counts.get(b.id) })).filter((b) => b.count > 0);
	const accepted = counts.get('accepted');
	return { total, accepted, refused: total - accepted, refused_rate: ratio(total - accepted, total), truncated, buckets };
}

// ── Funnel: top problems ────────────────────────────────────────────────────

/**
 * The three problems that cost users the most requests: requests each lane lost
 * (request level, failovers excluded) plus, when the request log was read, each
 * kind of refusal before a job existed. Ranked by requests affected.
 * @param {Array<{ backend: string, lost?: number }>} lanes
 * @param {Array<{ backend: string, lost?: number }>} previousLanes
 * @param {ReturnType<typeof summarizeRequestLog> | null} [requestLog]
 */
export function funnelTopProblems(lanes = [], previousLanes = [], requestLog = null) {
	const prevLost = new Map(previousLanes.map((l) => [l.backend, int(l.lost)]));
	const problems = lanes
		.filter((l) => int(l.lost) > 0)
		.map((l) => ({
			key: `lane:${l.backend}`,
			title: `${l.backend} lost ${int(l.lost)} request(s) after a job was created`,
			affected: int(l.lost),
			previous: prevLost.get(l.backend) ?? 0,
			change: changeLabel(l.lost, prevLost.get(l.backend) ?? 0),
		}));
	for (const b of requestLog?.buckets || []) {
		if (b.id === 'accepted') continue;
		problems.push({ key: `request:${b.id}`, title: `${b.count} request(s) ${b.label}`, affected: b.count, previous: null, change: null });
	}
	return problems.sort((a, b) => b.affected - a.affected || a.key.localeCompare(b.key)).slice(0, 3);
}

// ── Funnel: text ────────────────────────────────────────────────────────────

const mPct = (m) => (m?.value == null ? 'n/a' : `${(m.value * 100).toFixed(1)}%`);
const mBase = (m) => `${m?.n ?? 0}/${m?.of ?? 0}${m?.low_sample ? '  (low sample)' : ''}`;
const mLine = (label, m) => `  ${label.padEnd(36)} ${mPct(m).padStart(7)}   ${mBase(m)}`;

/**
 * The funnel CLI's text. `requestLog` is the Cloud Run request-log read when
 * --requests asked for it: `{ ok: true, summary }` or `{ ok: false, error }`.
 * @param {Record<string, any>} report gatherForgeFunnel's result
 * @param {{ requestLog?: { ok: boolean, summary?: ReturnType<typeof summarizeRequestLog>, error?: string, project?: string } | null }} [opts]
 */
export function formatFunnelReport(report, { requestLog = null } = {}) {
	const { output: o, new_actors: a, retention: r, destinations: d, lanes, share: sh, revenue: v } = report;
	const prev = report.previous || {};
	const days = report.window_days;
	const out = [];
	out.push(`Forge funnel, last ${days} day(s)  (rates under ${report.min_sample} rows are flagged low sample)`);
	out.push('');

	// The blind spot leads, so nobody reads a healthy job table as a healthy product.
	if (requestLog?.ok && requestLog.summary) {
		const s = requestLog.summary;
		out.push(`Before a job existed (Cloud Run request log, POST /api/forge and /api/gpt-forge${requestLog.project ? `, ${requestLog.project}` : ''})`);
		out.push(`  ${s.truncated ? 'at least ' : ''}${s.total} generation request(s); ${s.refused} (${pctOf(s.refused_rate)}) never became a job`);
		for (const b of s.buckets) out.push(`  ${String(b.count).padStart(7)}  ${b.label}`);
		out.push('  A refused request may be retried and succeed later, so these are requests, not people.');
	} else {
		out.push('NOT IN THESE NUMBERS');
		out.push(...wrap(PRE_JOB_BLIND_SPOT));
		if (requestLog && !requestLog.ok) out.push(...wrap(`The request log could not be read: ${requestLog.error}`));
	}
	out.push('');

	out.push('How this counts');
	out.push(...definitionLines());
	out.push('');

	const top = funnelTopProblems(lanes, prev.lanes, requestLog?.ok ? requestLog.summary : null);
	out.push(`Top problems by requests affected (change against the ${days} day(s) before)`);
	if (!top.length) out.push('  No lost requests in this window.');
	top.forEach((p, i) => out.push(`  ${i + 1}. ${p.title}${p.change ? `  (previously ${p.previous}, ${p.change})` : ''}`));
	out.push('');

	out.push('Output');
	out.push(`  requests ${o.requests}   done ${o.done}   failed ${o.failed}   in flight ${o.in_flight}   keyless (left out of per-maker metrics) ${o.unattributed_requests}`);
	if (prev.output) {
		const p = prev.output;
		out.push(`  previous ${days} day(s): requests ${p.requests}   done ${p.done}   failed ${p.failed}   success ${mPct(p.generation_success_rate)}   useful ${mPct(p.useful_output_rate)}`);
	}
	out.push(mLine('Generation success', o.generation_success_rate));
	out.push(mLine('Useful output (kept or downloaded)', o.useful_output_rate));
	out.push(mLine('Feedback coverage', o.feedback_coverage));
	out.push(`  accepted ${o.accepted}   rejected ${o.rejected}   downloaded ${o.downloaded}   rated ${o.rated}   avg rating ${o.avg_rating ?? 'n/a'}`);
	out.push('');

	out.push(`New makers (first-ever creation inside the window): ${a.new_actors}`);
	out.push(mLine('First asset success', a.first_asset_success_rate));
	out.push(mLine('Reached any finished asset', a.reached_any_asset_rate));
	out.push(mLine('Second asset', a.second_asset_rate));
	out.push('');

	out.push(`Retention (makers first seen in the last ${r.cohort_lookback_days} days)`);
	out.push(mLine('Came back after day 7', r.d7));
	out.push(mLine('Came back after day 30', r.d30));
	out.push('');

	out.push('What it was for');
	out.push(mLine('Answered', d.answer_rate));
	out.push(...table(['destination', 'done', 'useful', 'downloaded', 'useful rate'], d.rows.map((x) => [x.label, x.done, x.useful, x.downloaded, mPct(x.useful_output_rate)])));
	out.push('');

	out.push('Lanes (attempts: failed-over attempts included; "lost" counts requests that ended on that lane)');
	if (lanes.length) {
		out.push(
			...table(
				['backend', 'class', 'attempts', 'done', 'lost', 'useful', 'success', 'useful rate', 'attempts/useful', 'avg s', 's/useful'],
				lanes.map((l) => [
					l.backend, l.cost_class, l.attempts, l.done, l.lost ?? 0, l.useful,
					mPct(l.generation_success_rate), mPct(l.useful_output_rate),
					l.attempts_per_useful ?? 'n/a', l.avg_generation_seconds ?? 'n/a', l.generation_seconds_per_useful ?? 'n/a',
				]),
			),
		);
	} else {
		out.push('  no terminal attempts in this window');
	}
	out.push('');

	out.push('Shares (aggregate counters, no identifiers; unfurls are cards rendered, not human views)');
	if (sh.empty) {
		out.push('  no shares recorded in this window');
	} else {
		out.push(`  unfurls ${sh.unfurls}   creation page loads ${sh.page_loads}   AR launches ${sh.ar_launches}   share-sheet actions ${sh.share_actions}   "make your own" clicks ${sh.cta_clicks}`);
		out.push(`  creations started from a share ${sh.from_share.started}   done ${sh.from_share.done}   useful ${sh.from_share.useful}`);
		out.push(`  X share clicks ${sh.x_share.total} (model ${sh.x_share.model}, avatar ${sh.x_share.avatar}, anatomy ${sh.x_share.anatomy})   Ask @grok clicks ${sh.grok_ask.total} (model ${sh.grok_ask.model}, avatar ${sh.grok_ask.avatar}, anatomy ${sh.grok_ask.anatomy})`);
		out.push(mLine('Useful rate (from a share)', sh.from_share.useful_output_rate));
		out.push(mLine('Share to forge (starts per page load)', sh.share_to_forge));
	}
	out.push('');

	out.push(`Revenue (${v.rail} only: the one rail whose price is recorded on the row)`);
	out.push(`  paid generations ${v.paid_generations}   distinct payers ${v.distinct_payers}   USDC ${v.usdc.toFixed(2)}   USDC per useful asset ${v.usdc_per_useful_asset ?? 'n/a'}`);
	out.push(mLine('Paying agents back next week', v.agent_weekly_retention));

	if (report.degraded?.length) {
		out.push('');
		out.push('Degraded panels (their numbers above are empty, not zero):');
		for (const g of report.degraded) out.push(`  ${g.panel}: ${g.error}`);
	}
	out.push('');
	out.push('No prompts, emails or wallet addresses are printed by this report.');
	return out.join('\n');
}
