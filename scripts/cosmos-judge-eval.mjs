#!/usr/bin/env node
// Eval: does NVIDIA Cosmos Reason judge Forge models better than the current judge?
//
// Ground truth is what real users did with real Forge output: the keep / throw
// away buttons in the Forge UI write forge_creations.outcome ('accepted' or
// 'rejected') through /api/forge-feedback. Every labelled, finished creation
// with a GLB is judged twice, by the current quality-gate judge (runCurrentJudge,
// exactly as production runs it) and by Cosmos Reason on four views
// (judgeWithCosmos), and both verdicts plus the human label are written to
// forge_judge_shadow (source 'eval', labelled_by 'forge-user'). Re-runs skip
// creations already judged, so the run resumes after an interruption.
//
// Then the report: agreement with the human label, precision and recall on
// rejects, Cohen's kappa, latency, per-issue reject rates, and the promotion
// rule applied to a held-out half. The numbers and every row are written to
// docs/nvidia/evals/data/cosmos-reason-judge-<date>.json (summary alone in
// .summary.json); the written report beside them in docs/nvidia/evals/ cites it.
//
//   node --env-file=<prod env> scripts/cosmos-judge-eval.mjs            judge + report
//   node --env-file=<prod env> scripts/cosmos-judge-eval.mjs --report   report only
//   flags: --limit N  --concurrency N  --date YYYY-MM-DD
//
// Needs DATABASE_URL, S3_* (render storage), COSMOS_REASON_URL and its key, and
// the current judge's vision credentials (CLOUDFLARE_*, NVIDIA_API_KEY, ...).

import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sql } from '../api/_lib/db.js';
import { runCurrentJudge, QUALITY_GATE_DEFAULTS } from '../api/_lib/forge-quality-gate.js';
import {
	renderCosmosViews,
	judgeWithCosmos,
	combineJudgeVerdicts,
	COSMOS_ISSUE_KEYS,
	COSMOS_JUDGE_DEFAULTS,
} from '../api/_lib/cosmos-reason-judge.js';
import { recordJudgeShadow } from '../api/_lib/forge-judge-shadow.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const REPORT_ONLY = args.includes('--report');
const LIMIT = Number(flag('limit', 0)) || null;
const CONCURRENCY = Number(flag('concurrency', 3)) || 3;
const DATE = flag('date', new Date().toISOString().slice(0, 10));

async function judgeAll() {
	const done = new Set((await sql`select creation_id from forge_judge_shadow where source = 'eval'`).map((r) => r.creation_id));
	const rows = await sql`
		select distinct on (glb_url) id, prompt, glb_url, outcome
		from forge_creations
		where outcome in ('accepted', 'rejected') and status = 'done' and glb_url is not null
		order by glb_url, feedback_at desc nulls last`;
	const todo = rows.filter((r) => !done.has(String(r.id))).slice(0, LIMIT || undefined);
	console.log(`labelled creations: ${rows.length}, already judged: ${done.size}, to judge now: ${todo.length}`);

	let next = 0;
	let finished = 0;
	async function worker() {
		while (next < todo.length) {
			const c = todo[next++];
			const t0 = Date.now();
			const [current, cosmosRun] = await Promise.all([
				runCurrentJudge({ glbUrl: c.glb_url, prompt: c.prompt, track: { tool: 'scripts/cosmos-judge-eval' } }).then((v) => ({ v, ms: Date.now() - t0 })),
				renderCosmosViews(c.glb_url)
					.then(async (views) => ({ views, verdict: await judgeWithCosmos({ views, prompt: c.prompt }) }))
					.catch((e) => ({ views: null, verdict: { available: false, error: `render failed: ${e?.message || e}` } })),
			]);
			await recordJudgeShadow({
				source: 'eval',
				creationId: String(c.id),
				glbUrl: c.glb_url,
				prompt: c.prompt,
				subject: current.v.subject,
				current: current.v,
				currentLatencyMs: current.ms,
				cosmos: cosmosRun.verdict,
				views: cosmosRun.views,
				mode: 'shadow',
				applied: 'current',
				humanLabel: c.outcome,
				labelledBy: 'forge-user',
			});
			finished++;
			const cv = cosmosRun.verdict;
			console.log(
				`[${finished}/${todo.length}] ${c.id} human=${c.outcome} current=${current.v.qa_available ? (current.v.pass ? 'pass' : 'fail') : 'n/a'}(${current.v.score ?? '-'})` +
				` cosmos=${cv.available ? (cv.pass ? 'pass' : 'fail') : 'n/a'} ${cv.available ? cv.issues.join(',') : cv.error?.slice(0, 80)} ${cv.latency_ms ?? '-'}ms`,
			);
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// ── metrics ──────────────────────────────────────────────────────────────────

// "Positive" is a rejection: the gate's job is to catch models users throw away.
function confusion(rows, decide) {
	let tp = 0, fp = 0, tn = 0, fn = 0, covered = 0;
	for (const r of rows) {
		const d = decide(r);
		if (d == null) continue;
		covered++;
		const humanReject = r.human_label === 'rejected';
		const judgeReject = d === false;
		if (judgeReject && humanReject) tp++;
		else if (judgeReject) fp++;
		else if (humanReject) fn++;
		else tn++;
	}
	const n = tp + fp + tn + fn;
	const acc = n ? (tp + tn) / n : null;
	const pe = n ? ((tp + fp) * (tp + fn) + (tn + fn) * (tn + fp)) / (n * n) : null;
	return {
		n,
		coverage: rows.length ? covered / rows.length : null,
		tp, fp, tn, fn,
		accuracy: acc,
		reject_precision: tp + fp ? tp / (tp + fp) : null,
		reject_recall: tp + fn ? tp / (tp + fn) : null,
		kappa: acc != null && pe != null && pe < 1 ? (acc - pe) / (1 - pe) : null,
	};
}

function pct(p, q) {
	const s = [...p].sort((a, b) => a - b);
	if (!s.length) return null;
	return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const fmt = (x, d = 3) => (x == null ? 'n/a' : typeof x === 'number' ? x.toFixed(d) : String(x));
const fmtPct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

const asCurrent = (r) => r.current && { pass: r.current.pass, score: r.current.score, qa_available: r.current.available, defects: r.current.defects };
const asCosmos = (r) => r.cosmos && { ...r.cosmos };

function decideWith(mode, opts = {}) {
	return (r) => {
		const cur = asCurrent(r);
		if (!cur?.qa_available && !(r.cosmos?.available && mode !== 'shadow')) return null;
		const { verdict } = combineJudgeVerdicts(cur, asCosmos(r), { mode, passScore: QUALITY_GATE_DEFAULTS.passScore, ...opts });
		if (verdict.qa_available === false) return null;
		return verdict.pass;
	};
}

// Deterministic half split on the creation id: issues are selected on one half
// and the resulting veto is scored on the other, so the promotion number is not
// measured on the data that chose it.
const half = (r) => (createHash('sha256').update(String(r.creation_id)).digest()[0] & 1 ? 'holdout' : 'select');

function confusionRow(name, c) {
	return `| ${name} | ${c.n} | ${fmtPct(c.coverage)} | ${fmtPct(c.accuracy)} | ${fmtPct(c.reject_precision)} | ${fmtPct(c.reject_recall)} | ${fmt(c.kappa)} | ${c.tp}/${c.fp}/${c.tn}/${c.fn} |`;
}
const CONF_HEAD = '| Judge | n | Coverage | Accuracy | Reject precision | Reject recall | Kappa | TP/FP/TN/FN |\n|---|---|---|---|---|---|---|---|';

async function report() {
	const rows = await sql`
		select creation_id, glb_url, prompt, subject, render_keys, current, cosmos, current_pass, cosmos_pass, disagree, human_label, created_at
		from forge_judge_shadow where source = 'eval' and human_label is not null order by id`;
	if (!rows.length) throw new Error('no eval rows; run without --report first');
	const both = rows.filter((r) => r.current?.available && r.cosmos?.available);
	const humanRejects = rows.filter((r) => r.human_label === 'rejected').length;

	const current = confusion(rows, (r) => (r.current?.available ? r.current.pass : null));
	const cosmos = confusion(rows, (r) => (r.cosmos?.available ? r.cosmos.pass : null));
	const currentBoth = confusion(both, (r) => r.current.pass);
	const cosmosBoth = confusion(both, (r) => r.cosmos.pass);
	const cosmosPlausibleOnly = confusion(both, (r) => r.cosmos.plausible);
	const agree = both.length ? both.filter((r) => r.current.pass === r.cosmos.pass).length / both.length : null;

	const curLat = rows.map((r) => r.current?.latency_ms).filter(Number.isFinite);
	const cosLat = rows.filter((r) => r.cosmos?.available).map((r) => r.cosmos.latency_ms).filter(Number.isFinite);

	// Per-issue: among models Cosmos flagged with the issue, how often did the
	// human throw it away, overall and where the current judge passed it (the
	// only place a veto changes anything).
	const baseRate = both.length ? both.filter((r) => r.human_label === 'rejected').length / both.length : null;
	const issueStats = COSMOS_ISSUE_KEYS.map((issue) => {
		const flagged = both.filter((r) => r.cosmos.issues?.includes(issue));
		const flaggedCurPass = flagged.filter((r) => r.current.pass);
		const sel = flaggedCurPass.filter((r) => half(r) === 'select');
		const rate = (xs) => (xs.length ? xs.filter((r) => r.human_label === 'rejected').length / xs.length : null);
		return { issue, n: flagged.length, rejectRate: rate(flagged), nCurPass: flaggedCurPass.length, rejectRateCurPass: rate(flaggedCurPass), nSel: sel.length, rejectRateSel: rate(sel) };
	});

	// Promotion rule, fixed before the numbers were read:
	//   a failure class joins the veto list when, on the selection half, at least
	//   5 current-passed models were flagged with it and at least 70% of them were
	//   thrown away by the user. Veto mode is promoted only if, on the holdout
	//   half, it raises accuracy over the current judge AND its reject precision
	//   is at least the current judge's. Tie-break and primary are promoted on
	//   the same accuracy-and-precision test over the whole set.
	const vetoIssues = issueStats.filter((s) => s.nSel >= 5 && s.rejectRateSel >= 0.7).map((s) => s.issue);
	const holdout = both.filter((r) => half(r) === 'holdout');
	const holdoutCurrent = confusion(holdout, (r) => r.current.pass);
	const holdoutVeto = confusion(holdout, decideWith('veto', { vetoIssues, vetoConfidence: COSMOS_JUDGE_DEFAULTS.vetoConfidence }));
	const tiebreak = confusion(both, decideWith('tiebreak'));
	const primary = confusion(both, decideWith('primary'));

	const better = (a, b) => a.accuracy != null && b.accuracy != null && a.accuracy > b.accuracy && (a.reject_precision ?? 0) >= (b.reject_precision ?? 0);
	const decisions = {
		veto: vetoIssues.length > 0 && better(holdoutVeto, holdoutCurrent),
		tiebreak: better(tiebreak, currentBoth),
		primary: better(primary, currentBoth),
	};
	// Prefer the narrowest mode that clears the rule: veto touches the fewest
	// decisions, primary the most.
	const promoted = decisions.veto ? 'veto' : decisions.tiebreak ? 'tiebreak' : decisions.primary ? 'primary' : 'shadow';

	const cosmosErrors = rows.filter((r) => r.cosmos && !r.cosmos.available).reduce((m, r) => {
		const k = String(r.cosmos.error || 'unknown').replace(/\d{3,}/g, 'N').slice(0, 60);
		m[k] = (m[k] || 0) + 1;
		return m;
	}, {});
	const currentModels = rows.filter((r) => r.current?.available).reduce((m, r) => { m[r.current.model] = (m[r.current.model] || 0) + 1; return m; }, {});

	const out = {
		date: DATE,
		rows: rows.length,
		human_rejects: humanRejects,
		both_answered: both.length,
		agreement_between_judges: agree,
		current, cosmos, currentBoth, cosmosBoth, cosmosPlausibleOnly,
		latency: { current_p50: pct(curLat, 0.5), current_p95: pct(curLat, 0.95), cosmos_p50: pct(cosLat, 0.5), cosmos_p95: pct(cosLat, 0.95) },
		base_reject_rate: baseRate,
		issues: issueStats,
		veto_issues: vetoIssues,
		holdout: { n: holdout.length, current: holdoutCurrent, veto: holdoutVeto },
		tiebreak, primary, decisions, promoted,
		cosmos_errors: cosmosErrors,
		current_models: currentModels,
		cosmos_model: COSMOS_JUDGE_DEFAULTS.model,
		reasoning: COSMOS_JUDGE_DEFAULTS.reasoning,
	};

	mkdirSync('docs/nvidia/evals/data', { recursive: true });
	writeFileSync(`docs/nvidia/evals/data/cosmos-reason-judge-${DATE}.json`, JSON.stringify({
		summary: out,
		rows: rows.map((r) => ({ creation_id: r.creation_id, human_label: r.human_label, subject: r.subject, current: r.current, cosmos: r.cosmos, render_keys: r.render_keys })),
	}, null, 2) + '\n');
	writeFileSync(`docs/nvidia/evals/data/cosmos-reason-judge-${DATE}.summary.json`, JSON.stringify(out, null, 2) + '\n');
	console.log(JSON.stringify(out, null, 2));
	return out;
}

if (!REPORT_ONLY) await judgeAll();
await report();
process.exit(0);
