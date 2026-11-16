// @ts-check
// GET/POST /api/cron/nim-release-eval: works the day-0 NIM release queue.
//
// /api/cron/free-model-audit queues a row in nim_release_evals for every model
// id that newly appears in the NVIDIA NIM catalog. Each run of this cron claims
// ONE queued row, classifies the model by probing it (api/_lib/nim-lanes.js),
// runs the lane's versioned eval set against it and against the lane's current
// first rung (api/_lib/nim-lane-eval.js), stores the verdict, the report, the
// config diff and the post draft, and pages ops with all four.
//
// It never changes production config. The diff is a proposal a human applies
// and deploys; tests/nim-release-eval.test.js asserts that a run leaves every
// lane source file byte-identical.
//
// One model per run keeps a run inside the Cloud Scheduler attempt deadline
// (320 s): a full chat eval is two 24-prompt passes at concurrency 4. A run the
// platform kills mid-eval leaves its row `running`; claimNextReleaseEval
// re-claims it after 30 minutes, up to three attempts.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { env } from '../_lib/env.js';
import { nimClient } from '../_lib/nim-lanes.js';
import { evaluateRelease } from '../_lib/nim-lane-eval.js';
import {
	MAX_ATTEMPTS, claimNextReleaseEval, completeReleaseEval, failReleaseEval,
} from '../_lib/nim-release-store.js';

const ALERT_DIFF_CHARS = 2500;

/** Admin board link for one model. */
export function reportLink(modelId, origin = env.APP_ORIGIN) {
	return `${origin}/admin/nim-releases?model=${encodeURIComponent(modelId)}`;
}

/**
 * The ops alert for a finished evaluation: verdict, the measured numbers, the
 * report link, the exact config diff and the post draft.
 * @param {any} report evaluateRelease() output
 * @param {string} link
 */
export function buildEvalAlert(report, link) {
	const pct = (n) => `${Math.round((n ?? 0) * 100)}%`;
	const verdict = report.verdict || 'skip';
	const title = `NIM release eval: ${report.modelId} ${verdict.toUpperCase()}${report.lane ? ` (${report.lane} lane)` : ''}`;
	const lines = [...(report.reasons || []).map((r) => `- ${r}`)];
	if (report.candidate) {
		lines.push(`Candidate: quality ${pct(report.candidate.quality)}, format ${pct(report.candidate.formatAdherence)}, errors ${pct(report.candidate.errorRate)}, p50/p95 ${report.candidate.latencyMs.p50}/${report.candidate.latencyMs.p95} ms`);
	}
	if (report.incumbent) {
		lines.push(`Today (${report.incumbent.model}): quality ${pct(report.incumbent.quality)}, errors ${pct(report.incumbent.errorRate)}, p50 ${report.incumbent.latencyMs.p50} ms`);
	}
	lines.push(`Report: ${link}`);
	if (report.diff) {
		if (report.diff.patch) {
			const patch = report.diff.patch.length > ALERT_DIFF_CHARS
				? `${report.diff.patch.slice(0, ALERT_DIFF_CHARS)}\n... (truncated; full diff on the report page)`
				: report.diff.patch;
			lines.push('', `Config diff (${report.diff.file}), not applied:`, patch.trimEnd());
		} else if (report.diff.note) {
			lines.push('', report.diff.note);
		}
	}
	if (report.postDraft) {
		lines.push('', 'Post draft (post only after the diff is deployed and verified):', report.postDraft);
	}
	return { title, detail: lines.join('\n') };
}

/**
 * Claim and evaluate one queued release. Injectable so tests and the CLI's
 * --pipeline mode run the exact same path as the cron.
 * @param {{ client: import('../_lib/nim-lanes.js').NimClient,
 *   claim?: typeof claimNextReleaseEval, complete?: typeof completeReleaseEval,
 *   fail?: typeof failReleaseEval, alert?: typeof sendOpsAlert,
 *   evaluate?: typeof evaluateRelease, origin?: string }} deps
 */
export async function runNextReleaseEval({
	client,
	claim = claimNextReleaseEval,
	complete = completeReleaseEval,
	fail = failReleaseEval,
	alert = sendOpsAlert,
	evaluate = evaluateRelease,
	origin = env.APP_ORIGIN,
}) {
	const row = await claim();
	if (!row) return { status: 'idle' };

	let report;
	try {
		report = await evaluate({ modelId: row.model_id, ownedBy: row.owned_by, client });
	} catch (err) {
		const message = String(/** @type {Error} */ (err)?.message || err);
		console.error(`[nim-release-eval] ${row.model_id} failed: ${message}`);
		const failed = await fail(row.id, { error: message, transient: false });
		return { status: 'failed', modelId: row.model_id, error: message, row: failed };
	}

	// A model we could not reach at all is retried on a later run rather than
	// stored as "no lane": unreachable is our network or their outage, not a fact
	// about the model.
	if (!report.lane && report.classification.availability === 'unreachable') {
		const failed = await fail(row.id, { error: report.classification.reason, transient: true, classification: report.classification });
		const final = failed?.status === 'failed';
		if (final) {
			await alert(`NIM release eval: ${row.model_id} unreachable after ${MAX_ATTEMPTS} attempts`, `${report.classification.reason}\nReport: ${reportLink(row.model_id, origin)}`, { signature: `llm:nim-release-eval:${row.model_id}`, severity: 'info' });
		}
		return { status: final ? 'failed' : 'requeued', modelId: row.model_id, error: report.classification.reason, row: failed };
	}

	const { markdown, ...stored } = report;
	const saved = await complete(row.id, {
		lane: report.lane,
		classification: report.classification,
		verdict: report.verdict || 'skip',
		report: stored,
		markdown,
		configDiff: report.diff?.patch || null,
		postDraft: report.postDraft || null,
	});
	const { title, detail } = buildEvalAlert(report, reportLink(row.model_id, origin));
	await alert(title, detail, { signature: `llm:nim-release-eval:${row.model_id}`, severity: 'info' });
	return { status: 'done', modelId: row.model_id, lane: report.lane, verdict: report.verdict || 'skip', row: saved };
}

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	if (!env.NVIDIA_API_KEY) {
		console.warn('[nim-release-eval] NVIDIA_API_KEY unset; leaving the queue untouched');
		return json(res, 200, { status: 'skipped', reason: 'NVIDIA_API_KEY unset' });
	}
	const out = await runNextReleaseEval({ client: nimClient({ key: env.NVIDIA_API_KEY }) });
	const { row, ...summary } = out;
	return json(res, 200, summary);
}, { maxDurationMs: 300_000 });
