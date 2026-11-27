// Shared by scripts/forge-error-report.mjs and scripts/forge-funnel-report.mjs:
// generation requests that ended before a job existed, by stage and cause, plus
// the end-to-end success rate, for the last hour and the last 24 hours.
//
// Those endings never create a forge_creations row, so the SQL in both reports
// cannot see them. They live in the Redis counters api/_lib/forge-events.js
// writes (24h retention). Read order:
//   1. the store directly, when this shell has the Upstash env;
//   2. otherwise the public health payload (GET /api/forge?health=1, `pre_job`),
//      which reads the same counters on the server.

const DEFAULT_HEALTH_URL = 'https://three.ws/api/forge?health=1';

/**
 * @returns {Promise<{ source: string, pre_job: object|null, note: string|null }>}
 */
export async function loadPreJobBreakdown({ healthUrl = process.env.FORGE_HEALTH_URL || DEFAULT_HEALTH_URL } = {}) {
	try {
		const { readSubmitOutcomes } = await import('../../api/_lib/forge-events.js');
		const direct = await readSubmitOutcomes();
		if (direct) return { source: 'redis', pre_job: direct, note: null };
	} catch {
		/* no store from this shell: fall through to the public payload */
	}
	try {
		const res = await fetch(healthUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
		if (!res.ok) return { source: healthUrl, pre_job: null, note: `health answered HTTP ${res.status}` };
		const body = await res.json();
		if (body?.pre_job) return { source: healthUrl, pre_job: body.pre_job, note: null };
		return {
			source: healthUrl,
			pre_job: null,
			note: 'the deployment does not serve a pre_job block yet (it ships with the submit observer) or has no counter store',
		};
	} catch (err) {
		return { source: healthUrl, pre_job: null, note: `health unreachable: ${err?.message || err}` };
	}
}

const rate = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

function printWindow(label, w) {
	console.log(`  ${label}: accepted ${w.accepted}   jobs ${w.jobs_created}   delivered at once ${w.delivered_in_response}   ended before a job ${w.failed_before_job}   refused at sign-in ${w.sign_in_refused}`);
	console.log(`    end-to-end success ${rate(w.end_to_end_success_rate)}   lane success ${rate(w.lane_success_rate)}   pre-job failure ${rate(w.pre_job_failure_rate)}`);
	const stages = Object.entries(w.by_stage || {}).sort((a, b) => b[1] - a[1]);
	if (stages.length) console.log(`    by stage: ${stages.map(([s, n]) => `${s} ${n}`).join(', ')}`);
	for (const c of (w.by_cause || []).slice(0, 8)) console.log(`      ${String(c.count).padStart(5)}  ${c.stage} / ${c.cause}`);
	const providers = Object.entries(w.by_provider || {}).sort((a, b) => b[1] - a[1]);
	if (providers.length) console.log(`    refused by: ${providers.map(([p, n]) => `${p} ${n}`).join(', ')}`);
	if (w.avg_stated_wait_s != null) console.log(`    average wait the response stated: ${w.avg_stated_wait_s}s`);
}

/** Print the block as the text reports' section. */
export function printPreJobSection({ source, pre_job: preJob, note }) {
	console.log('\nBefore a job existed (requests no SQL row records; Redis counters, 24h retention)');
	if (!preJob) {
		console.log(`  not available: ${note || 'no data'}`);
		console.log(`  source tried: ${source}`);
		return;
	}
	printWindow('last hour', preJob.last_hour);
	printWindow('last 24h', preJob.last_24h);
	console.log(`  source: ${source}`);
}
