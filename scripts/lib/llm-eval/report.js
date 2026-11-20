// Turns saved eval results into the markdown report
// (docs/evals/grok-4-7-on-three-ws.md). PURE: same results, same report, so a
// regenerated doc only changes when the data does.
//
// results: [{ task, id, lane, model, ok, status, error, latencyMs, costMicro, pass, checks, reason, shipped }]
// judged:  [{ task, id, a, b, judge, score, verdicts }]  score = b's result vs a (1 win, 0.5 tie, 0 loss)

import { bootstrapMean, pairedBootstrapDiff, excludesTie, percentile, costPer1k } from './stats.js';

const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : 'n/a');
const ms = (v) => (Number.isFinite(v) ? `${Math.round(v).toLocaleString('en-US')}` : 'n/a');
const usd = (v) => (v === null || v === undefined ? 'unknown' : v === 0 ? '$0 (free tier)' : `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`);
const ci = (c) => (Number.isFinite(c.lo) ? `${pct(c.mean)} (${pct(c.lo)} to ${pct(c.hi)})` : 'n/a');
const signed = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)} pts`;
// Model output is quoted verbatim; dash glyphs are written as HTML entities so
// they still render but the page itself stays free of them.
const cell = (s) =>
	String(s ?? '')
		.replace(/\|/g, '\\|')
		.replace(/\u2014/g, '&mdash;')
		.replace(/\u2013/g, '&ndash;')
		.replace(/\s+/g, ' ')
		.trim();
const clip = (s, n = 180) => {
	const t = cell(s);
	return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

/** Failure reasons on a lane's rows, most frequent first: [[reason, count]]. */
export function failureReasons(rows) {
	const counts = new Map();
	for (const r of rows) {
		if (r.ok && r.pass) continue;
		const reason = r.ok ? r.reason || 'failed' : `error ${r.status}`;
		counts.set(reason, (counts.get(reason) || 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Summary for one lane on one task: every row of the set counts, an errored
 * call scores as a fail (production would have fallen through to another
 * model, which is not this lane's answer).
 */
export function laneSummary(rows, setSize) {
	const answered = rows.filter((r) => r.ok);
	const scores = rows.map((r) => (r.ok && r.pass ? 1 : 0));
	const lat = answered.map((r) => r.latencyMs);
	return {
		n: rows.length,
		setSize,
		answered: answered.length,
		errors: rows.length - answered.length,
		pass: bootstrapMean(scores, { seed: 11 }),
		p50: percentile(lat, 50),
		p95: percentile(lat, 95),
		costPer1k: costPer1k(answered.map((r) => r.costMicro)),
		statuses: [...new Set(rows.filter((r) => !r.ok).map((r) => r.status))],
	};
}

/** Per-check pass counts over answered rows, worst first. */
export function checkBreakdown(rows) {
	const counts = new Map();
	for (const r of rows) {
		if (!r.ok || !r.checks) continue;
		for (const [name, ok] of Object.entries(r.checks)) {
			const c = counts.get(name) || { name, pass: 0, n: 0 };
			c.n++;
			if (ok) c.pass++;
			counts.set(name, c);
		}
	}
	return [...counts.values()].sort((x, y) => x.pass / x.n - y.pass / y.n || x.name.localeCompare(y.name));
}

/** Paired objective comparison of `b` against `a` over ids both lanes ran. */
export function pairedComparison(aRows, bRows) {
	const byId = new Map(aRows.map((r) => [r.id, r]));
	const a = [];
	const b = [];
	for (const r of bRows) {
		const x = byId.get(r.id);
		if (!x) continue;
		a.push(x.ok && x.pass ? 1 : 0);
		b.push(r.ok && r.pass ? 1 : 0);
	}
	if (!a.length) return null;
	return pairedBootstrapDiff(a, b, { seed: 13 });
}

/**
 * The recommendation for one task. A Grok lane is recommended only when it
 * beats the current lane with an interval that excludes a tie (objective
 * paired difference, or the pairwise judge when the objective score ties) and
 * its p95 latency stays within the task's budget.
 */
export function recommend({ task, current, candidates, routeEnv, latencyBudgetMs }) {
	if (!candidates.length) {
		return { route: null, text: `Keep the current lane. No Grok results yet: they fill in with one command once the xAI key is installed (see "Reproduce").` };
	}
	const winners = [];
	const notes = [];
	for (const c of candidates) {
		const objWin = c.diff && excludesTie(c.diff);
		const objLoss = c.diff && Number.isFinite(c.diff.hi) && c.diff.hi < 0;
		const judgeWin = c.judge && !objLoss && excludesTie(c.judge, 0.5);
		const fast = Number.isFinite(c.summary.p95) && c.summary.p95 <= latencyBudgetMs;
		if ((objWin || judgeWin) && fast) winners.push({ ...c, by: objWin ? 'objective score' : 'pairwise judge' });
		else if ((objWin || judgeWin) && !fast) notes.push(`${c.label} scored better but its p95 of ${ms(c.summary.p95)} ms is over the ${ms(latencyBudgetMs)} ms budget.`);
		else if (objLoss) notes.push(`${c.label} scored worse (${signed(c.diff.mean)}).`);
		else notes.push(`${c.label} is a statistical tie with the current lane.`);
	}
	if (!winners.length) return { route: null, text: `Keep the current lane. ${notes.join(' ')}` };
	// Cheapest winner first, then the larger objective gain.
	winners.sort((x, y) => (x.summary.costPer1k ?? Infinity) - (y.summary.costPer1k ?? Infinity) || (y.diff?.mean ?? 0) - (x.diff?.mean ?? 0));
	const w = winners[0];
	const value = w.lane.extraBody?.reasoning_effort ? `${w.lane.model}:${w.lane.extraBody.reasoning_effort}` : w.lane.model;
	if (!routeEnv) return { route: null, text: `${w.label} wins on the ${w.by}, but this task has no route flag.` };
	return { route: { env: routeEnv, value }, text: `Route to ${w.label}: set \`${routeEnv}=${value}\`. It wins on the ${w.by} with an interval that excludes a tie.${notes.length ? ` ${notes.join(' ')}` : ''}` };
}

/**
 * The env flags to set from per-task recommendations. A flag shared by several
 * tasks (LLM_ROUTE_AGENT_CHAT serves both agent chat tasks) is set only when
 * every task behind it recommends the same value; otherwise it is held. PURE.
 * @returns {{ routes: { env: string, value: string }[], held: string[] }}
 */
export function flagsToSet(recs) {
	const byEnv = new Map();
	for (const r of recs) {
		const env = r.route?.env ?? r.routeEnv;
		if (!env) continue;
		if (!byEnv.has(env)) byEnv.set(env, []);
		byEnv.get(env).push(r.route?.value ?? null);
	}
	const routes = [];
	const held = [];
	for (const [env, values] of byEnv) {
		if (values.every((v) => v === null)) continue;
		if (values.every((v) => v === values[0])) routes.push({ env, value: values[0] });
		else held.push(env);
	}
	return { routes, held };
}

/**
 * Build the whole report.
 * @param {object} o
 * @param {object[]} o.results
 * @param {object[]} o.judged
 * @param {Record<string, object[]>} o.sets      task -> rows of the input set
 * @param {Record<string, object>} o.taskInfo    TASK_INFO from tasks.js
 * @param {Record<string, object>} o.lanes       LANES from lanes.js
 * @param {object} o.meta                        { generatedOn, production, keyProbe, judgeNote }
 */
export function buildReport({ results, judged, sets, taskInfo, lanes, meta }) {
	const out = [];
	const recs = [];
	const laneOrder = Object.keys(lanes);
	const ranLanes = laneOrder.filter((l) => results.some((r) => r.lane === l));
	const grokRan = ranLanes.filter((l) => l !== 'current');

	out.push('# Grok on three.ws: five production LLM tasks, measured', '');
	out.push(`Generated ${meta.generatedOn} by \`npm run grok:eval-llm\` ([scripts/grok-eval-llm.mjs](../../scripts/grok-eval-llm.mjs)) from the raw results in [data/evals/llm-results/](../../data/evals/llm-results/). Regenerate this page with \`npm run grok:eval-llm -- --report\`.`, '');
	out.push('three.ws is a member of xAI\'s Grok for Startups program. This page answers one question with data: on the LLM calls whose output a person reads, does Grok beat the model production uses today, by enough to route traffic to it? Credits are a reason to measure, not a reason to switch.', '');

	out.push('## Status', '');
	if (grokRan.length) {
		out.push(`Lanes measured: ${ranLanes.map((l) => lanes[l].label).join(', ')}.`, '');
	} else {
		out.push(`Baseline only. ${meta.keyProbe}`, '');
		out.push('Every task set, grader, judge and the routing flags are in place, so the Grok columns fill in with the one command under "Reproduce" once the key is installed, and this page regenerates from the combined results.', '');
	}

	out.push('## Method', '');
	out.push('**Tasks.** The five highest-traffic LLM calls with a user-visible output, ranked by production `usage_events` (provenance and call counts in [data/evals/README.md](../../data/evals/README.md)). 50 inputs each, 250 per lane.', '');
	out.push('| Task | Production call site | Route flag |', '|---|---|---|');
	for (const t of Object.keys(sets)) out.push(`| ${taskInfo[t].label} | \`${taskInfo[t].path}\` | ${taskInfo[t].route ? `\`${taskInfo[t].route}\`` : 'n/a'} |`);
	out.push('');
	out.push(`**Requests.** Each input is sent exactly as production sends it: the system prompt, user turn, tool list and token budget come from the production modules themselves ([scripts/lib/llm-eval/tasks.js](../../scripts/lib/llm-eval/tasks.js)), never retyped. Agent chat offers its 15 viewer tools on every turn, so both agent tasks carry them.`, '');
	out.push(`**Lanes.** One fixed model per lane, so a score belongs to a model and not to whichever fallback rung answered. ${meta.production}`, '');
	out.push('| Lane | Model | Endpoint |', '|---|---|---|');
	for (const l of laneOrder) out.push(`| ${lanes[l].label} | \`${lanes[l].model}\` | ${new URL(lanes[l].url).host} |`);
	out.push('');
	out.push('**Graders.** Objective first ([scripts/lib/llm-eval/graders.js](../../scripts/lib/llm-eval/graders.js)), each one running the same post-processing production runs on the reply:', '');
	out.push('- Forge director: production\'s own director guard (`finishDirectorReply`) decides whether the rewrite would be forwarded or dropped for the user\'s raw words (empty, clipped, too long, carries a link, or adds nothing).');
	out.push('- Agent tools: the expected tool with matching arguments, no forbidden tool, or a plain answer and no tool where none was asked for.');
	out.push('- Agent chat: a persona rubric per row (language, length, fixed opener, banned punctuation, required voice markers) plus global rules: no emoji, no markdown headers, no "as an AI", and no leak of the system prompt when asked for it.');
	out.push('- X replies: production\'s reply guard (`checkReply`) runs on the reply after production\'s cleaner (`cleanModelText`, which rewrites dash characters as commas) and decides whether it would be posted or swapped for the fixed help reply (length, links off three.ws, mentions, hashtags, other tickers, financial advice).');
	out.push('- Agent spec: the reply must parse with production\'s `parseSpec` and every field must sit inside the bounds the prompt states, with skills, category and starter body from the real lists.');
	out.push('- Reported, not required: dash characters in agent chat replies and agent specs. House style bans them in published copy, but neither prompt asks for it and only the X reply path removes them, so they appear as an advisory line instead of a fail.');
	out.push('');
	out.push(`**Pairwise judge.** For open-ended quality, a third model that produced neither answer compares each pair blind and is asked twice with the answers swapped, so a position preference scores as a tie ([scripts/lib/llm-eval/judge.js](../../scripts/lib/llm-eval/judge.js)). ${meta.judgeNote}`, '');
	out.push('**Statistics.** A call that errors or times out scores as a fail for that lane. Intervals are 95% percentile bootstrap intervals (4,000 resamples, fixed seed). A Grok lane is recommended for a task only when its paired difference against the current lane, or its judge win rate, has an interval that excludes a tie, and its p95 latency stays inside the budget (twice the current lane\'s p95, at least 5 s). Cost per 1,000 calls uses the cost xAI reports per response, else the xAI price table ([api/_lib/xai-pricing.js](../../api/_lib/xai-pricing.js)); the NVIDIA NIM free tier costs the platform nothing.', '');

	out.push('## Results', '');
	for (const task of Object.keys(sets)) {
		const info = taskInfo[task];
		const setSize = sets[task].length;
		const rowsFor = (lane) => results.filter((r) => r.task === task && r.lane === lane);
		const curRows = rowsFor('current');
		const summaries = Object.fromEntries(ranLanes.map((l) => [l, laneSummary(rowsFor(l), setSize)]));
		out.push(`### ${info.label}`, '');
		out.push('| Lane | Pass rate (95% CI) | Answered | p50 ms | p95 ms | Cost per 1,000 calls |', '|---|---|---|---|---|---|');
		for (const l of ranLanes) {
			const s = summaries[l];
			const answered = `${s.answered}/${s.setSize}${s.errors ? ` (errors: ${s.statuses.join(', ')})` : ''}`;
			out.push(`| ${lanes[l].label} | ${ci(s.pass)} | ${answered} | ${ms(s.p50)} | ${ms(s.p95)} | ${usd(s.costPer1k)} |`);
		}
		out.push('');
		const candidates = [];
		for (const l of grokRan) {
			const diff = pairedComparison(curRows, rowsFor(l));
			const j = judged.filter((r) => r.task === task && r.a === 'current' && r.b === l && Number.isFinite(r.score));
			const judge = j.length ? bootstrapMean(j.map((r) => r.score), { seed: 17 }) : null;
			candidates.push({ lane: lanes[l], label: lanes[l].label, summary: summaries[l], diff, judge, judgeName: j[0]?.judge });
			const parts = [];
			if (diff) parts.push(`paired difference vs current ${signed(diff.mean)} (${signed(diff.lo)} to ${signed(diff.hi)})`);
			if (judge) parts.push(`judge win rate ${ci(judge)} over ${judge.n} pairs (judge: ${j[0].judge})`);
			if (parts.length) out.push(`- ${lanes[l].label}: ${parts.join('; ')}.`);
		}
		if (candidates.length) out.push('');
		const breakdown = checkBreakdown(curRows).filter((c) => c.pass < c.n);
		if (breakdown.length) {
			out.push(`Checks the current lane fails most (rows passing out of rows the check applies to): ${breakdown.slice(0, 5).map((c) => `\`${c.name}\` ${c.pass}/${c.n}`).join(', ')}.`, '');
		}
		const reasons = failureReasons(curRows);
		if (reasons.length) out.push(`Why the current lane fails: ${reasons.map(([r, n]) => `\`${r}\` ${n}`).join(', ')}.`, '');
		const advisory = ranLanes
			.map((l) => {
				const rows = rowsFor(l).filter((r) => r.ok && r.advisory && 'no_dash' in r.advisory);
				return rows.length ? `${lanes[l].label} ${rows.filter((r) => r.advisory.no_dash).length}/${rows.length}` : null;
			})
			.filter(Boolean);
		if (advisory.length) out.push(`Advisory, dash-free replies: ${advisory.join(', ')}.`, '');
		const cur = summaries.current;
		const budget = Math.max(5000, 2 * (cur?.p95 || 0));
		const rec = recommend({ task, current: cur, candidates, routeEnv: info.route, latencyBudgetMs: budget });
		recs.push({ task, label: info.label, routeEnv: info.route, ...rec });
		out.push(`**Recommendation:** ${rec.text}`, '');
		const failures = ranLanes.flatMap((l) => rowsFor(l).filter((r) => !(r.ok && r.pass)).slice(0, 3).map((r) => ({ ...r, laneLabel: lanes[l].label })));
		if (failures.length) {
			out.push('<details><summary>Failure examples</summary>', '');
			out.push('| Lane | Input | Failed check | Output |', '|---|---|---|---|');
			for (const f of failures) {
				const input = sets[task].find((r) => r.id === f.id)?.input;
				const inputText = input?.prompt ?? input?.message ?? input?.post ?? input?.brief ?? '';
				const failed = f.ok ? f.reason : `error ${f.status}: ${f.error}`;
				out.push(`| ${f.laneLabel} | \`${f.id}\` ${clip(inputText || '(empty brief)', 70)} | ${cell(failed)} | ${clip(f.ok ? f.shipped || f.text || '(empty)' : '', 160)} |`);
			}
			out.push('', '</details>', '');
		}
	}

	out.push('## Recommendations', '');
	out.push('| Task | Recommendation |', '|---|---|');
	for (const r of recs) out.push(`| ${r.label} | ${cell(r.text)} |`);
	out.push('');
	const { routes, held } = flagsToSet(recs);
	out.push('## Routing', '');
	out.push('Routing is per task and off by default. `LLM_ROUTE_<TASK>` names a chat Grok id from `GROK_MODELS`, optionally with a reasoning effort (`<id>:<effort>`); unset, `off`, `default` or an invalid value leave the task on its current chain ([api/_lib/llm.js](../../api/_lib/llm.js) `llmRouteOverride`). The routed Grok rung leads the chain and every existing rung stays behind it, so an xAI error falls through instead of failing the call. `LLM_ROUTE_AGENT_CHAT` does the same for signed-in agent chat in [api/chat.js](../../api/chat.js) when the caller picked no provider, model or agent brain; anonymous chat stays on the free lanes. The flags take effect only where the server has `GROK_API_KEY`.', '');
	if (routes.length) {
		out.push('Set these on Cloud Run (owner step):', '', '```bash');
		out.push(`gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars ${routes.map((r) => `${r.env}=${r.value}`).join(',')}`);
		out.push('```', '');
	}
	for (const h of held) out.push(`\`${h}\` is shared by several tasks and they do not agree on one Grok model, so it stays unset.`, '');
	if (!routes.length) {
		out.push(grokRan.length ? 'No task cleared the bar, so no flag is recommended and every default stays as it is.' : 'No flag is recommended until the Grok columns exist.', '');
	}

	out.push('## Reproduce', '');
	out.push('```bash');
	out.push('npm run grok:eval-llm -- --prod-env                             # current lane, all five tasks');
	out.push('npm run grok:eval-llm -- --prod-env --lanes grok,grok_budget    # add the Grok columns (needs GROK_API_KEY on Cloud Run)');
	out.push('npm run grok:eval-llm -- --report                               # rebuild this page from saved results');
	out.push('```', '');
	out.push('Runs resume from the results file: finished rows are skipped unless `--force` or `--retry-failed`. Grok calls made by the eval are written to the xAI credit ledger under lane `eval`.', '');
	return { markdown: `${out.join('\n')}\n`, recommendations: recs };
}
