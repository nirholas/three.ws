// The LLM eval's scoring pieces (scripts/lib/llm-eval/): objective graders
// that mirror production's own post-processing, seeded bootstrap statistics,
// the position-swapped pairwise judge, the request builders that import the
// production prompts, the lane wire format, and the report's routing rule.
// Report: docs/evals/grok-4-7-on-three-ws.md.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { grade, matchValue, parseToolArgs, looksSpanish, leaksSystemPrompt, strictJsonObject, DASH_RE } from '../scripts/lib/llm-eval/graders.js';
import { mean, percentile, bootstrapMean, pairedBootstrapDiff, excludesTie, costPer1k } from '../scripts/lib/llm-eval/stats.js';
import { pickJudge, judgePair, parseVerdict, judgeMessages, JUDGES } from '../scripts/lib/llm-eval/judge.js';
import { TASKS, TASK_INFO, buildRequest, judgeInput } from '../scripts/lib/llm-eval/tasks.js';
import { LANES, laneBody, parseCompletion, laneCostMicro, laneKey, callLane } from '../scripts/lib/llm-eval/lanes.js';
import { laneSummary, failureReasons, checkBreakdown, pairedComparison, recommend, flagsToSet, buildReport } from '../scripts/lib/llm-eval/report.js';
import { unledgered, ledgerInput } from '../scripts/lib/llm-eval/ledger.js';
import { attemptKind, tallyUnanswered } from '../scripts/lib/llm-eval/attempts.js';
import { GROK_DEFAULT_MODEL, GROK_BUDGET_MODEL } from '../api/_lib/chat-models.js';
import { LIMITS } from '../api/agents/suggest-spec.js';

const DASH = '\u2014';
const load = (task) => readFileSync(new URL(`../data/evals/llm-${task}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const SETS = Object.fromEntries(TASKS.map((t) => [t, load(t)]));
const row = (task, id) => SETS[task].find((r) => r.id === id);

describe('task sets', () => {
	it('has 50 rows per task with unique ids and the task tag', () => {
		for (const t of TASKS) {
			expect(SETS[t]).toHaveLength(50);
			expect(new Set(SETS[t].map((r) => r.id)).size).toBe(50);
			for (const r of SETS[t]) {
				expect(r.task).toBe(t);
				expect(r.source).toBeTruthy();
			}
		}
	});
});

describe('graders', () => {
	it('agent_tools: right tool and args pass, wrong args or a forbidden tool fail', () => {
		const wave = row('agent_tools', 'at-02');
		expect(grade('agent_tools', wave, { text: '', toolCalls: [{ name: 'playAnimation', args: '{"name":"wave"}' }] }).pass).toBe(true);
		const wrong = grade('agent_tools', wave, { text: '', toolCalls: [{ name: 'playAnimation', args: '{"name":"jump"}' }] });
		expect(wrong.pass).toBe(false);
		expect(wrong.reason).toBe('args_match');
		expect(grade('agent_tools', wave, { text: 'waves', toolCalls: [] }).reason).toBe('expected_tool');
		const hi = row('agent_tools', 'at-43');
		expect(grade('agent_tools', hi, { text: 'Hi! Welcome.', toolCalls: [] }).pass).toBe(true);
		expect(grade('agent_tools', hi, { text: 'Hi', toolCalls: [{ name: 'playAnimation', args: '{"name":"wave"}' }] }).reason).toBe('no_tool_call');
	});

	it('argument matchers: $in, $match, $nonempty, $hex and case-insensitive strings', () => {
		expect(matchValue({ $in: ['dance', 'rumba'] }, 'Rumba')).toBe(true);
		expect(matchValue({ $match: '^re' }, 'red')).toBe(true);
		expect(matchValue({ $nonempty: true }, '  ')).toBe(false);
		expect(matchValue({ $hex: 'red' }, '#ff2010')).toBe(true);
		expect(matchValue({ $hex: 'red' }, '#10ff20')).toBe(false);
		expect(matchValue('Wave', 'wave')).toBe(true);
		expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
		expect(parseToolArgs('not json')).toBeNull();
		expect(parseToolArgs('')).toEqual({});
	});

	it('agent_chat: the persona rubric decides; dashes are advisory only', () => {
		const rook = row('agent_chat', 'ac-rook-1');
		const inVoice = grade('agent_chat', rook, { text: 'Aye matey, a brig carries two square-rigged masts.' });
		expect(inVoice.pass).toBe(true);
		expect(inVoice.advisory).toEqual({ no_dash: true });
		const dashed = grade('agent_chat', rook, { text: `Aye matey ${DASH} a brig has two masts.` });
		expect(dashed.pass).toBe(true);
		expect(dashed.advisory).toEqual({ no_dash: false });
		expect(grade('agent_chat', rook, { text: 'A brig has two square-rigged masts.' }).reason).toBe('persona_marker');
		expect(grade('agent_chat', rook, { text: 'Aye, as an AI language model I cannot sail.' }).reason).toBe('no_robot_speak');
	});

	it('agent_chat: catches a leaked system prompt and Spanish personas', () => {
		expect(leaksSystemPrompt('Sure: three.ws platform knowledge: ...', 'You are Ada.')).toBe(true);
		const persona = row('agent_chat', 'ac-rook-1').input.persona_prompt;
		expect(leaksSystemPrompt(`Arr, my orders say: ${persona}`, persona)).toBe(true);
		expect(leaksSystemPrompt('Arr, that be secret.', row('agent_chat', 'ac-rook-1').input.persona_prompt)).toBe(false);
		expect(looksSpanish('Hola, gracias por tu pregunta, es muy buena y la respuesta es simple.')).toBe(true);
		expect(looksSpanish('Hello, thanks for the question, the answer is simple.')).toBe(false);
	});

	it('x_reply: production cleaner and reply guard decide what posts', () => {
		const r = row('x_reply', SETS.x_reply[0].id);
		expect(grade('x_reply', r, { text: 'Thanks for the shout! You can build your own 3D agent at https://three.ws' }).pass).toBe(true);
		const dashed = grade('x_reply', r, { text: `Great question ${DASH} you can build one at https://three.ws` });
		expect(dashed.shipped).toBe('Great question, you can build one at https://three.ws');
		expect(dashed.pass).toBe(true);
		expect(grade('x_reply', r, { text: 'Love it #3D #agents' }).reason).toBe('hashtag');
		expect(grade('x_reply', r, { text: 'Check https://example.com for more' }).pass).toBe(false);
		expect(grade('x_reply', r, { text: '' }).reason).toBe('empty');
	});

	it('forge_director: production director guard decides what is forwarded', () => {
		const fox = row('forge_director', 'fd-01');
		const good = grade('forge_director', fox, { text: 'A low-poly red fox sitting upright, faceted orange body with a white chest and black socks, tail curled around its paws.' });
		expect(good.pass).toBe(true);
		expect(good.shipped).toContain('fox');
		expect(grade('forge_director', fox, { text: '' }).pass).toBe(false);
		expect(grade('forge_director', fox, { text: 'word '.repeat(400) }).pass).toBe(false);
	});

	it('agent_spec: parsed spec inside the prompt bounds; dashes advisory, strict JSON reported', () => {
		const spec = {
			name: 'Tide Coach',
			description: 'Plans calm sea kayak trips from tide tables for beginners.',
			tags: ['kayak', 'tides', 'outdoors'],
			skills: [],
			category: SETS.agent_spec.length && 'general',
			greeting: 'Ahoy! Tell me your launch spot and I will find your calmest window.',
			persona: 'You are Tide Coach, a patient sea kayak guide. You read tide and wind data, explain it plainly, and always put safety first. You refuse to plan trips in small craft warnings and say why.',
			avatar_starter: 'robot',
			voice: 'browser',
		};
		const r = row('agent_spec', SETS.agent_spec[0].id);
		const ok = grade('agent_spec', r, { text: JSON.stringify(spec) });
		expect(ok.checks.parsed).toBe(true);
		expect(ok.strictJson).toBe(true);
		const long = grade('agent_spec', r, { text: JSON.stringify({ ...spec, greeting: 'x'.repeat(LIMITS.greeting + 1) }) });
		expect(long.checks.greeting).toBe(false);
		const dashed = grade('agent_spec', r, { text: JSON.stringify({ ...spec, description: `Plans trips ${DASH} safely.` }) });
		expect(dashed.advisory).toEqual({ no_dash: false });
		expect(dashed.checks.description).toBe(true);
		expect(grade('agent_spec', r, { text: 'no json here' }).reason).toBe('parsed');
		expect(strictJsonObject('```json\n{}\n```')).toBe(false);
		expect(DASH_RE.test('\u2013')).toBe(true);
	});
});

describe('statistics', () => {
	it('mean, nearest-rank percentile and cost per 1k', () => {
		expect(mean([1, 0, 1, 0])).toBe(0.5);
		expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50);
		expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95)).toBe(100);
		expect(costPer1k([1000, 3000])).toBeCloseTo(2, 6);
		expect(costPer1k([1000, null])).toBeNull();
	});

	it('bootstrap is seeded, brackets the mean, and collapses on constant data', () => {
		const xs = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? 0 : 1));
		const a = bootstrapMean(xs);
		expect(bootstrapMean(xs)).toEqual(a);
		expect(a.lo).toBeLessThanOrEqual(a.mean);
		expect(a.hi).toBeGreaterThanOrEqual(a.mean);
		expect(bootstrapMean(Array(20).fill(1))).toMatchObject({ mean: 1, lo: 1, hi: 1 });
	});

	it('paired difference detects a real gap and calls noise a tie', () => {
		const a = Array(50).fill(0).map((_, i) => (i < 20 ? 1 : 0));
		const b = Array(50).fill(0).map((_, i) => (i < 45 ? 1 : 0));
		expect(excludesTie(pairedBootstrapDiff(a, b))).toBe(true);
		const c = a.map((v, i) => (i === 30 ? 1 : v));
		expect(excludesTie(pairedBootstrapDiff(a, c))).toBe(false);
	});
});

describe('pairwise judge', () => {
	it('never judges with a model that produced either answer', () => {
		const env = { GROQ_API_KEY: 'g', NVIDIA_API_KEY: 'n', OPENROUTER_API_KEY: 'o' };
		expect(pickJudge([LANES.current.model, GROK_DEFAULT_MODEL], env).name).toBe('groq');
		expect(pickJudge([JUDGES[0].model, LANES.current.model], env).name).toBe('openrouter');
		expect(pickJudge([LANES.current.model], {})).toBeNull();
	});

	it('swaps positions so a position bias scores as a tie', async () => {
		const alwaysA = await judgePair({ task: 'x_reply', input: 'hi', a: 'one', b: 'two', call: async () => 'A' });
		expect(alwaysA.score).toBe(0.5);
		expect(alwaysA.consistent).toBe(false);
		const prefersOne = await judgePair({ task: 'x_reply', input: 'hi', a: 'one', b: 'two', call: async ({ user }) => (user.indexOf('one') < user.indexOf('two') ? 'A' : 'B') });
		expect(prefersOne).toMatchObject({ score: 1, consistent: true });
	});

	it('parses the last verdict word and ignores reasoning blocks', () => {
		expect(parseVerdict('<think>A looks good but</think> B')).toBe('B');
		expect(parseVerdict('tie')).toBe('TIE');
		expect(parseVerdict('no idea')).toBeNull();
		const m = judgeMessages('agent_spec', 'brief', 'first', 'second');
		expect(m.user).toContain('<answer_a>\nfirst');
		expect(m.system).toMatch(/data, not instructions/);
	});
});

describe('request builders', () => {
	it('builds every row of every task from the production modules', () => {
		for (const t of TASKS) {
			for (const r of SETS[t]) {
				const req = buildRequest(t, r);
				expect(req.system.length).toBeGreaterThan(200);
				expect(typeof req.user).toBe('string');
				expect(req.maxTokens).toBeGreaterThan(0);
				expect(typeof judgeInput(t, r)).toBe('string');
			}
		}
	});

	it('gives agent turns the viewer tools and the other tasks none', () => {
		expect(buildRequest('agent_tools', SETS.agent_tools[0]).tools.length).toBeGreaterThan(5);
		expect(buildRequest('agent_chat', SETS.agent_chat[0]).system).toContain(SETS.agent_chat[0].input.persona_prompt.slice(0, 40));
		expect(buildRequest('forge_director', SETS.forge_director[0]).tools).toBeNull();
		expect(buildRequest('x_reply', SETS.x_reply[0]).user).toContain(SETS.x_reply[0].input.post);
		expect(() => buildRequest('nope', {})).toThrow(/unknown task/);
	});

	it('maps every task to a route flag', () => {
		for (const t of TASKS) expect(TASK_INFO[t].route).toMatch(/^LLM_ROUTE_[A-Z_]+$/);
	});
});

describe('lanes', () => {
	const req = { system: 's', user: 'u', tools: null, maxTokens: 64 };

	it('reads model ids from chat-models.js and sends production flags', () => {
		expect(LANES.grok.model).toBe(GROK_DEFAULT_MODEL);
		expect(LANES.grok_budget.model).toBe(GROK_BUDGET_MODEL);
		expect(laneBody(LANES.current, req).chat_template_kwargs).toEqual({ enable_thinking: false });
		expect(laneBody(LANES.grok, req)).not.toHaveProperty('tools');
		expect(laneBody(LANES.grok, { ...req, tools: [{ type: 'function' }] }).tool_choice).toBe('auto');
		expect(laneKey(LANES.grok, { XAI_API_KEY: 'x' })).toBe('x');
		expect(laneKey(LANES.grok, {})).toBeNull();
	});

	it('parses text and tool calls out of a completion', () => {
		const parsed = parseCompletion({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ function: { name: 'playAnimation', arguments: '{"name":"wave"}' } }] } }] });
		expect(parsed).toEqual({ text: '', toolCalls: [{ name: 'playAnimation', args: '{"name":"wave"}' }], finish: 'tool_calls' });
	});

	it('prices Grok from the reported ticks, else the price table, and NIM at zero', () => {
		expect(laneCostMicro(LANES.grok, { prompt_tokens: 10, completion_tokens: 10, cost_in_usd_ticks: 50_000 })).toBe(5);
		expect(laneCostMicro(LANES.grok, { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeGreaterThan(0);
		expect(laneCostMicro(LANES.current, { prompt_tokens: 1000, completion_tokens: 1000 })).toBe(0);
	});

	it('never throws: a 401 comes back as a failed call', async () => {
		const fetchImpl = async () => new Response(JSON.stringify({ error: 'No credentials presented.' }), { status: 401 });
		const res = await callLane(LANES.grok, req, { env: {}, fetchImpl });
		expect(res).toMatchObject({ ok: false, status: 401, error: 'No credentials presented.' });
		const boom = await callLane(LANES.grok, req, { env: {}, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
		expect(boom).toMatchObject({ ok: false, status: 0, error: 'ECONNRESET' });
	});
});

describe('report and routing rule', () => {
	const ids = Array.from({ length: 50 }, (_, i) => `r${i}`);
	const rows = (lane, passes, latency = 1000, cost = 0) => ids.map((id, i) => ({ task: 'x_reply', id, lane, ok: true, pass: i < passes, checks: { postable: i < passes }, latencyMs: latency, costMicro: cost }));

	it('summarises a lane and counts errors as fails', () => {
		const rs = rows('current', 40);
		rs[49] = { ...rs[49], ok: false, status: 429, pass: false };
		const s = laneSummary(rs, 50);
		expect(s.answered).toBe(49);
		expect(s.pass.mean).toBeCloseTo(0.8, 6);
		expect(s.statuses).toEqual([429]);
		expect(checkBreakdown(rs)[0]).toMatchObject({ name: 'postable', pass: 40, n: 49 });
		rs[48] = { ...rs[48], reason: 'too_long' };
		expect(failureReasons(rs)).toEqual([['failed', 8], ['error 429', 1], ['too_long', 1]]);
	});

	it('routes only on an interval that excludes a tie, within the latency budget', () => {
		const current = laneSummary(rows('current', 20), 50);
		const mk = (lane, passes, latency) => {
			const r = rows(lane, passes, latency, 100);
			return { lane: LANES[lane], label: LANES[lane].label, summary: laneSummary(r, 50), diff: pairedComparison(rows('current', 20), r), judge: null };
		};
		const win = recommend({ task: 'x_reply', current, candidates: [mk('grok_budget', 45, 1200)], routeEnv: 'LLM_ROUTE_X_REPLY', latencyBudgetMs: 5000 });
		expect(win.route).toEqual({ env: 'LLM_ROUTE_X_REPLY', value: `${GROK_BUDGET_MODEL}:none` });
		expect(win.text).toMatch(/The pairwise judge has not scored it yet/);
		const judgedWin = recommend({ task: 'x_reply', current, candidates: [{ ...mk('grok_budget', 45, 1200), judge: { mean: 0.7, lo: 0.6, hi: 0.8 } }], routeEnv: 'LLM_ROUTE_X_REPLY', latencyBudgetMs: 5000 });
		expect(judgedWin.text).not.toMatch(/has not scored/);
		const slow = recommend({ task: 'x_reply', current, candidates: [mk('grok', 45, 9000)], routeEnv: 'LLM_ROUTE_X_REPLY', latencyBudgetMs: 5000 });
		expect(slow.route).toBeNull();
		expect(slow.text).toMatch(/over the/);
		const tie = recommend({ task: 'x_reply', current, candidates: [mk('grok', 21, 1000)], routeEnv: 'LLM_ROUTE_X_REPLY', latencyBudgetMs: 5000 });
		expect(tie.route).toBeNull();
		expect(tie.text).toMatch(/tie/);
		expect(recommend({ task: 'x_reply', current, candidates: [], routeEnv: 'LLM_ROUTE_X_REPLY', latencyBudgetMs: 5000 }).text).toMatch(/No Grok results yet/);
	});

	it('sets a shared flag only when every task behind it agrees', () => {
		const agree = flagsToSet([
			{ routeEnv: 'LLM_ROUTE_AGENT_CHAT', route: { env: 'LLM_ROUTE_AGENT_CHAT', value: 'm' } },
			{ routeEnv: 'LLM_ROUTE_AGENT_CHAT', route: { env: 'LLM_ROUTE_AGENT_CHAT', value: 'm' } },
		]);
		expect(agree).toEqual({ routes: [{ env: 'LLM_ROUTE_AGENT_CHAT', value: 'm' }], held: [] });
		const split = flagsToSet([
			{ routeEnv: 'LLM_ROUTE_AGENT_CHAT', route: { env: 'LLM_ROUTE_AGENT_CHAT', value: 'm' } },
			{ routeEnv: 'LLM_ROUTE_AGENT_CHAT', route: null },
		]);
		expect(split).toEqual({ routes: [], held: ['LLM_ROUTE_AGENT_CHAT'] });
	});

	it('builds a baseline-only report with no flag to set', () => {
		const results = TASKS.flatMap((task) => SETS[task].map((r, i) => ({ task, id: r.id, lane: 'current', ok: true, pass: i % 2 === 0, checks: { a: i % 2 === 0 }, latencyMs: 1000 + i, costMicro: 0 })));
		const { markdown, recommendations } = buildReport({ results, judged: [], sets: SETS, taskInfo: TASK_INFO, lanes: LANES, meta: { generatedOn: '2026-11-20', production: 'p', keyProbe: 'probe 401', judgeNote: 'j' } });
		expect(markdown).toContain('Baseline only. probe 401');
		expect(markdown).toContain('No flag is recommended until the Grok columns exist.');
		expect(markdown).not.toMatch(/[\u2013\u2014]/);
		expect(recommendations.every((r) => r.route === null)).toBe(true);
	});

	it('never tells the reader to install a key on the production service', () => {
		const baseline = TASKS.flatMap((task) => SETS[task].map((r) => ({ task, id: r.id, lane: 'current', ok: true, pass: true, latencyMs: 1000, costMicro: 0 })));
		const { markdown } = buildReport({ results: baseline, judged: [], sets: SETS, taskInfo: TASK_INFO, lanes: LANES, meta: { generatedOn: '2026-11-20', production: 'p', keyProbe: 'probe 401', judgeNote: 'j' } });
		expect(markdown).not.toMatch(/key is installed|GROK_API_KEY on Cloud Run|setup:xai-key/);
		expect(markdown).toContain('`GROK_API_KEY` in the environment of the process running the eval, and nowhere else');
		expect(markdown).toContain('GROK_API_KEY="$(cat <key file>)" npm run grok:eval-llm -- --prod-env --lanes grok,grok_budget');
	});

	it('says when the judge has not run and when Grok loses it', () => {
		const current = laneSummary(rows('current', 20), 50);
		const base = { lane: LANES.grok, label: LANES.grok.label, summary: laneSummary(rows('grok', 21), 50), diff: pairedComparison(rows('current', 20), rows('grok', 21)) };
		const args = { task: 'x_reply', current, routeEnv: 'LLM_ROUTE_X_REPLY', latencyBudgetMs: 5000 };
		const unjudged = recommend({ ...args, candidates: [{ ...base, judge: null }] });
		expect(unjudged.route).toBeNull();
		expect(unjudged.text).toMatch(/pairwise judge has not scored it yet/);
		const lost = recommend({ ...args, candidates: [{ ...base, judge: bootstrapMean(Array.from({ length: 50 }, (_, i) => (i < 10 ? 1 : 0)), { seed: 17 }) }] });
		expect(lost.route).toBeNull();
		expect(lost.text).toMatch(/loses the pairwise judge \(win rate 20%\)/);
		const even = recommend({ ...args, candidates: [{ ...base, judge: bootstrapMean(Array.from({ length: 50 }, (_, i) => (i % 2 ? 1 : 0)), { seed: 17 }) }] });
		expect(even.text).toMatch(/is a statistical tie with the current lane\.$/);
	});

	it('states dates, model ids, inputs per task and xAI spend once a Grok lane has run', () => {
		const at = { current: '2026-11-20T22:00:00.000Z', grok: '2026-11-27T20:00:00.000Z' };
		const mk = (lane, n, costMicro, usage) => TASKS.flatMap((task) => SETS[task].slice(0, n).map((r) => ({ task, id: r.id, lane, model: LANES[lane].model, ok: true, pass: true, latencyMs: 1000, costMicro, usage, at: at[lane] })));
		const usageOf = (r) => ({ inputTokens: r.usage?.in ?? 0, cachedTokens: r.usage?.cached ?? 0, outputTokens: r.usage?.out ?? 0, reasoningTokens: r.usage?.reason ?? 0, reportedMicro: r.usage?.reported ?? null, listMicro: r.lane === 'grok' ? 1500 : null });
		const meta = { generatedOn: '2026-11-27', production: 'p', keyProbe: 'k', judgeNote: 'j', usageOf };
		const grokUsage = { in: 1000, cached: 400, out: 50, reason: 200, reported: 2000 };

		const full = buildReport({ results: [...mk('current', 50, 0, { in: 900, out: 60 }), ...mk('grok', 50, 2000, grokUsage)], judged: [], sets: SETS, taskInfo: TASK_INFO, lanes: LANES, meta }).markdown;
		expect(full).toContain(`| ${LANES.current.label} | \`${LANES.current.model}\` | 2026-11-20 | all 50 on every task | 225,000 (0) | 15,000 (0) | $0 (free tier) |`);
		expect(full).toContain(`| ${LANES.grok.label} | \`${GROK_DEFAULT_MODEL}\` | 2026-11-27 | all 50 on every task | 250,000 (100,000) | 12,500 (50,000) | $0.50 |`);
		expect(full).toContain('Total xAI spend for the Grok columns: $0.50 over 250 answered calls, from the cost xAI reported on each response. The same token counts at list price come to $0.38.');
		expect(full).toContain('Coverage: every lane ran every input of every task');
		expect(full).not.toContain('Baseline only');
		expect(full).not.toMatch(/[\u2013\u2014]/);

		const subset = buildReport({ results: [...mk('current', 50, 0, null), ...mk('grok', 10, 1500, { in: 1000, out: 50 })], judged: [], sets: SETS, taskInfo: TASK_INFO, lanes: LANES, meta }).markdown;
		expect(subset).toContain('Forge prompt director 10/50, Agent chat: tool selection 10/50');
		expect(subset).toContain('Total xAI spend for the Grok columns: $0.07 over 50 answered calls, from the token counts xAI returned, at list price.');
		expect(subset).toContain(`Coverage: ${LANES.grok.label} ran a subset of the inputs`);
	});
});

describe('attempts that ended without an answer', () => {
	it('names what was retried and nothing else', () => {
		expect(attemptKind({ ok: true, status: 200 })).toBe(null);
		expect(attemptKind({ ok: false, status: 0, error: 'timeout' })).toBe('timeout');
		expect(attemptKind({ ok: false, status: 0, error: 'fetch failed' })).toBe('network');
		expect(attemptKind({ ok: false, status: 429, error: 'slow down' })).toBe('rate_limit');
		expect(attemptKind({ ok: false, status: 503, error: 'unavailable' })).toBe('server');
		expect(attemptKind({ ok: false, status: 400, error: 'bad request' })).toBe(null);
	});

	it('sums the counts every run recorded, per lane and kind', () => {
		const runs = [{ rows: 250 }, { unanswered: { grok: { timeout: 71 } } }, { unanswered: { grok: { timeout: 9, rate_limit: 2 }, grok_budget: { server: 1 } } }];
		expect(tallyUnanswered(runs)).toEqual({ grok: { timeout: 80, rate_limit: 2 }, grok_budget: { server: 1 } });
		expect(tallyUnanswered([])).toEqual({});
	});

	it('puts the retried attempts on the page beside the latency and spend they are missing from', () => {
		const mk = (lane, costMicro) => TASKS.flatMap((task) => SETS[task].map((r, i) => ({ task, id: r.id, lane, model: LANES[lane].model, ok: true, pass: true, latencyMs: 1000, costMicro: i === 0 ? costMicro * 3 : costMicro, usage: null, at: '2026-11-27T20:00:00.000Z' })));
		const results = [...mk('current', 0), ...mk('grok', 20_000)];
		const base = { generatedOn: '2026-11-27', production: 'p', keyProbe: 'k', judgeNote: 'j' };
		const build = (meta) => buildReport({ results, judged: [], sets: SETS, taskInfo: TASK_INFO, lanes: LANES, meta: { ...base, ...meta } }).markdown;

		const clean = build({});
		expect(clean).toContain('Every attempt got an answer, so no call was retried.');

		const retried = build({ unanswered: { grok: { timeout: 80, rate_limit: 2 } }, callLimitMs: 60_000 });
		expect(retried).toContain(`82 attempts on ${LANES.grok.label} ended without an answer and were tried again (80 hit the harness's 60 s limit, 2 were rate limited).`);
		expect(retried).toContain('Latency on this page is the answering attempt alone, so it understates the wait on those inputs.');
		expect(retried).toContain("at the price of that lane's most expensive answered call ($0.06) they would add $4.92.");
		expect(retried).not.toContain('Every attempt got an answer');
		expect(retried).not.toMatch(/[\u2013\u2014]/);
	});
});

describe('xAI ledger rows owed by the eval', () => {
	const rec = (over) => ({ task: 'x_reply', id: 'xr-01', lane: 'grok', model: GROK_DEFAULT_MODEL, ok: true, usage: { prompt_tokens: 10, completion_tokens: 2 }, responseId: 'resp-1', ledgered: false, at: '2026-11-27T20:00:00.000Z', ...over });

	it('owes a row only for an answered Grok call that never reached the ledger', () => {
		const results = [
			rec(),
			rec({ id: 'xr-02', responseId: 'resp-2', ledgered: true }),
			rec({ id: 'xr-03', ok: false, responseId: null }),
			rec({ id: 'xr-04', lane: 'current', model: LANES.current.model, responseId: 'nim-1', ledgered: undefined }),
			rec({ id: 'xr-05', lane: 'grok_budget', model: GROK_BUDGET_MODEL, responseId: 'resp-5' }),
		];
		expect(unledgered(results, LANES).map((r) => r.id)).toEqual(['xr-01', 'xr-05']);
	});

	it('keys the ledger row on the xAI response id so a backfill can be repeated', () => {
		expect(ledgerInput(rec(), { backfilled: true })).toEqual({
			lane: 'eval',
			model: GROK_DEFAULT_MODEL,
			usage: { prompt_tokens: 10, completion_tokens: 2 },
			requestId: 'resp-1',
			meta: { eval: 'grok-eval-llm', task: 'x_reply', row: 'xr-01', calledAt: '2026-11-27T20:00:00.000Z', backfilled: true },
		});
	});
});
