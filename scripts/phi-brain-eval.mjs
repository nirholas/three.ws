#!/usr/bin/env node
// Phi brain-lane evaluation (docs/phi-brain-lane.md).
//
// Compares self-hosted Phi-4-mini (workers/model-phi) with the production
// chain's lead rung on the cheap internal task types the lane could take:
//
//   feedback_triage   api/_lib/feedback/triage.js   real feedback reports
//   bounty_triage     api/_lib/bounties/triage.js   real bounty listings
//   memory_summary    api/agent-reflect-digest.js   real agent memories -> diary
//   agent_tools       evals/suites/*.json           first tool-calling round
//   emote_actions     api/chat.js ACTION_TOOLS      real widget openers + action asks
//
// Every prompt is built with the production prompt builders, so the score is
// the score of the exact request each caller would send. Steps:
//
//   build     read the DB (read-only), anonymize, write tasks.json and upload it
//             to gs://three-ws-avatar-reconstructions/verify/phi/tasks.json,
//             where the GPU verification job (cloudbuild.verify.yaml) reads it
//   baseline  answer every task with the current default chain: its first
//             rung (Groq qwen3.8-27b) or, with --baseline groq#120b, the rung
//             production serves while the first one's daily quota is spent,
//             or --baseline nvidia, the rung that answers when both Groq
//             quotas are spent and the OpenRouter free upstream throttles
//   judge     blind reference labels for the classifiers and 1-5 rubric scores
//             for the summaries, by Nemotron Ultra (a third, larger model)
//   report    score both candidates, print the table and the routing verdict
//
//   node --env-file=.env.local scripts/phi-brain-eval.mjs build
//   node scripts/phi-brain-eval.mjs baseline
//   node scripts/phi-brain-eval.mjs judge --phi <run-id>
//   node scripts/phi-brain-eval.mjs report --phi <run-id>
//
// Task data and answers stay in the scratch directory and the results bucket:
// they are real user text, so only the aggregate table is committed.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';

const BUCKET = 'gs://three-ws-avatar-reconstructions/verify/phi';
const PROJECT = 'aerial-vehicle-466722-p5';
// The two Groq rungs that lead llm.js providerChain(), with the body extras
// the platform sends each one.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const BASELINES = {
	groq: { name: 'groq', model: 'qwen/qwen3.8-27b', url: GROQ_URL, secret: 'groq-api-key', extra: { reasoning_effort: 'none' } },
	'groq#120b': { name: 'groq#120b', model: 'openai/gpt-oss-120b', url: GROQ_URL, secret: 'groq-api-key', extra: {} },
	// The NIM rung both chains reach once the Groq daily quotas are spent and
	// the OpenRouter free upstream throttles: what production serves on such a day.
	nvidia: {
		name: 'nvidia',
		model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
		url: 'https://integrate.api.nvidia.com/v1/chat/completions',
		secret: 'nvidia-api-key',
		extra: { chat_template_kwargs: { enable_thinking: false } },
	},
};
const JUDGE = {
	name: 'nvidia',
	model: 'nvidia/nemotron-3-ultra-550b-a55b',
	url: 'https://integrate.api.nvidia.com/v1/chat/completions',
	secret: 'nvidia-api-key',
	extra: { chat_template_kwargs: { enable_thinking: false } },
};
// A task type is routed to Phi when its score is within this many points
// (0-100 scale) of the baseline and its outputs parse at least this often.
export const BAR = Object.freeze({ maxGapPoints: 5, minValidity: 0.95 });

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		dir: { type: 'string', default: join(tmpdir(), 'phi-eval') },
		phi: { type: 'string' },
		concurrency: { type: 'string', default: '3' },
		'no-upload': { type: 'boolean', default: false },
		baseline: { type: 'string', default: 'groq' },
	},
});
const BASELINE = BASELINES[opts.baseline];
if (!BASELINE) throw new Error(`--baseline must be one of ${Object.keys(BASELINES).join(', ')}`);
const step = positionals[0];
const DIR = opts.dir;
mkdirSync(DIR, { recursive: true });
const file = (name) => join(DIR, name);
const readJson = (name) => JSON.parse(readFileSync(file(name), 'utf8'));
const writeJson = (name, value) => writeFileSync(file(name), JSON.stringify(value, null, 1));

// ── Anonymization ────────────────────────────────────────────────────────────

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EVM = /\b0x[a-fA-F0-9]{40}\b/g;
const BASE58 = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const SECRETISH = /\b(sk|pk|key|token)[-_][A-Za-z0-9_-]{16,}\b/gi;
export function anonymize(text) {
	return String(text ?? '')
		.replace(EMAIL, '[email]')
		.replace(EVM, '[address]')
		.replace(BASE58, '[address]')
		.replace(SECRETISH, '[secret]');
}

// ── Build ────────────────────────────────────────────────────────────────────

async function build() {
	const { neon } = await import('@neondatabase/serverless');
	if (!process.env.DATABASE_URL) throw new Error('build reads the DB: run with node --env-file=.env.local');
	const sql = neon(process.env.DATABASE_URL);
	const tasks = [];

	// feedback_triage: real reports with a body worth classifying.
	const fb = await import('../api/_lib/feedback/triage.js');
	const reports = await sql`
		SELECT id, route, page_title, build_sha, viewport, locale, user_id, console_errors, failed_requests, body
		FROM feedback_reports WHERE length(coalesce(body, '')) >= 12 ORDER BY created_at DESC LIMIT 30`;
	for (const r of reports) {
		const report = {
			route: r.route,
			page_title: r.page_title,
			build_sha: r.build_sha,
			viewport: r.viewport,
			locale: r.locale,
			signed_in: Boolean(r.user_id),
			console_errors: (r.console_errors || []).map(anonymize),
			failed_requests: (r.failed_requests || []).map(anonymize),
			body: anonymize(r.body),
		};
		const rules = fb.scoreByRules(report);
		tasks.push({
			id: `feedback_triage:${r.id}`,
			type: 'feedback_triage',
			messages: [{ role: 'system', content: fb.SYSTEM }, { role: 'user', content: fb.buildUser(report, rules) }],
			max_tokens: 400,
			temperature: 0,
		});
	}

	// bounty_triage: real listings across venues.
	const bt = await import('../api/_lib/bounties/triage.js');
	const listings = await sql`
		SELECT id, title, venue, kind, summary, requirements, body FROM bounty_listings
		WHERE length(coalesce(body, summary, '')) >= 40 ORDER BY md5(id::text) LIMIT 15`;
	for (const l of listings) {
		const row = { ...l, title: anonymize(l.title), summary: anonymize(l.summary), body: anonymize(l.body), requirements: (l.requirements || []).map(anonymize) };
		tasks.push({
			id: `bounty_triage:${l.id}`,
			type: 'bounty_triage',
			messages: [{ role: 'system', content: bt.SYSTEM }, { role: 'user', content: bt.listingPrompt(row) }],
			max_tokens: 300,
			temperature: 0,
		});
	}

	// memory_summary: agents with real memories, prompt built as composeDiary does.
	const digest = await import('../api/agent-reflect-digest.js');
	const graphLib = await import('../src/agent-memory-graph.js');
	// Production composes one diary per window (?since=, default the last day),
	// so each agent-day with enough memories is one task: top 12 by salience.
	const days = await sql`
		SELECT a.id, a.name, a.description, date_trunc('day', m.created_at) AS day, count(*)::int AS n
		FROM agent_identities a JOIN agent_memories m ON m.agent_id = a.id
		WHERE a.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > now())
		GROUP BY 1, 2, 3, 4 HAVING count(DISTINCT m.content) >= 3 ORDER BY 5 DESC`;
	const perAgent = new Map();
	const picked = days.filter((d) => {
		const n = perAgent.get(d.id) || 0;
		if (n >= 5) return false;
		perAgent.set(d.id, n + 1);
		return true;
	}).slice(0, 18);
	for (const a of picked) {
		const dayRows = await sql`
			SELECT id, type, content, tags, context, salience, created_at FROM agent_memories
			WHERE agent_id = ${a.id} AND (expires_at IS NULL OR expires_at > now())
			  AND created_at >= ${a.day} AND created_at < ${a.day}::timestamptz + interval '1 day'
			ORDER BY salience DESC, created_at DESC LIMIT 40`;
		const seenContent = new Set();
		const memories = dayRows.filter((m) => !seenContent.has(m.content) && seenContent.add(m.content)).slice(0, 12);
		// Read the already-mined entity rows directly: buildGraph would mine
		// (write) first, and the eval must not change production data.
		const ents = await sql`
			SELECT id, kind, label, salience, mention_count FROM agent_memory_entities
			WHERE agent_id = ${a.id} ORDER BY mention_count DESC, last_seen_at DESC LIMIT 200`;
		const nodes = ents.map((e) => ({ id: e.id, kind: e.kind, label: anonymize(e.label), salience: e.salience, mentions: e.mention_count, meta: {} }));
		const entities = graphLib.shapeDigestEntities(nodes, { topN: 12 });
		const highlights = memories.map((m) => ({
			type: m.type,
			content: anonymize(String(m.content || '').slice(0, 600)),
			tags: m.tags || [],
			salience: Number(m.salience) || 0,
		}));
		const counts = graphLib.digestCounts(memories, entities);
		tasks.push({
			id: `memory_summary:${a.id}:${new Date(a.day).toISOString().slice(0, 10)}`,
			type: 'memory_summary',
			messages: [
				{ role: 'system', content: digest.DIARY_SYSTEM },
				{ role: 'user', content: digest.buildDiaryUserPrompt({ agent: { name: anonymize(a.name), description: anonymize(a.description) }, highlights, entities, counts }) },
			],
			max_tokens: 320,
			temperature: 0.3,
		});
	}

	// agent_tools: the eval suites' prompts, tools and checks, first round only.
	const { AGENT_TOOLS } = await import('../api/_lib/agent-tools.js');
	const { systemMessages, buildToolSurface } = await import('../api/_lib/evals/execute.js');
	const { loadSuite } = await import('../api/_lib/evals/suites.js');
	for (const name of ['smoke', 'trading']) {
		const suite = loadSuite(name);
		for (const t of suite.tasks) {
			const allowed = t.tools ?? Object.keys(AGENT_TOOLS);
			const { schemas } = buildToolSurface({ allowed, sandbox: t.sandbox || [] });
			tasks.push({
				id: `agent_tools:${name}/${t.id}`,
				type: 'agent_tools',
				messages: [...systemMessages(null, { sandboxed: Boolean(t.sandbox?.length) }), { role: 'user', content: t.prompt }],
				tools: schemas.length ? schemas : undefined,
				max_tokens: 512,
				temperature: suite.defaults?.temperature ?? 0.2,
				expect: { checks: t.checks },
			});
		}
	}

	// emote_actions: the /api/chat system prompt and action tools. Real widget
	// openers (no action asked: any tool other than an emote is wrong) plus
	// explicit action asks with the tool and arguments the viewer needs.
	const chat = await import('../api/chat.js');
	const system = chat.buildSystemPrompt({}).text;
	const openers = await sql`
		SELECT DISTINCT ON (lower(trim(content))) content FROM widget_chat_messages
		WHERE role = 'user' AND length(trim(content)) >= 2 ORDER BY lower(trim(content)), created_at DESC LIMIT 12`;
	for (const [i, o] of openers.entries()) {
		tasks.push({
			id: `emote_actions:opener-${i + 1}`,
			type: 'emote_actions',
			messages: [{ role: 'system', content: system }, { role: 'user', content: anonymize(o.content) }],
			tools: chat.OPENAI_TOOLS,
			max_tokens: 256,
			temperature: 0.2,
			expect: { none: true },
		});
	}
	const asks = [
		['dance for me!', 'playAnimation', { name: 'dance' }],
		['can you wave at everyone', 'playAnimation', { name: 'wave' }],
		['do a little celebration, we shipped it', 'playAnimation', { name: 'celebrate' }],
		['jump!', 'playAnimation', { name: 'jump' }],
		['do the thriller dance', 'playAnimation', { name: 'thriller' }],
		['show me some capoeira moves', 'playAnimation', { name: 'capoeira' }],
		['turn on wireframe mode', 'setWireframe', { value: true }],
		['hide the grid please', 'setGrid', { value: false }],
		['make the background pure black', 'setBgColor', { value: { matches: '^#0{3}(0{3})?([fF]{2})?$' } }],
		['switch the lighting to the Venice Sunset environment', 'setEnvironment', { value: { matches: 'venice', flags: 'i' } }],
		['start auto rotating the camera', 'setAutoRotate', { value: true }],
		['take a screenshot of the scene', 'takeScreenshot', {}],
	];
	for (const [i, [prompt, tool, args]] of asks.entries()) {
		tasks.push({
			id: `emote_actions:ask-${i + 1}`,
			type: 'emote_actions',
			messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
			tools: chat.OPENAI_TOOLS,
			max_tokens: 256,
			temperature: 0.2,
			expect: { tool, args },
		});
	}

	const out = { schema: 'three-ws/phi-eval-tasks@1', built_at: new Date().toISOString(), tasks };
	writeJson('tasks.json', out);
	const byType = countBy(tasks, (t) => t.type);
	console.log(`wrote ${file('tasks.json')}: ${tasks.length} tasks`, byType);
	if (!opts['no-upload']) {
		execFileSync('gcloud', ['storage', 'cp', file('tasks.json'), `${BUCKET}/tasks.json`, `--project=${PROJECT}`], { stdio: 'inherit' });
	}
}

// ── Model calls ──────────────────────────────────────────────────────────────

const keyCache = new Map();
function secret(name) {
	if (!keyCache.has(name)) {
		keyCache.set(name, execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${PROJECT}`], { encoding: 'utf8' }).trim());
	}
	return keyCache.get(name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chatCall(provider, body, { attempts = 6 } = {}) {
	const key = secret(provider.secret);
	for (let i = 0; i < attempts; i++) {
		const t0 = Date.now();
		let res;
		try {
			res = await fetch(provider.url, {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
				body: JSON.stringify({ model: provider.model, ...provider.extra, ...body, stream: false }),
				signal: AbortSignal.timeout(120_000),
			});
		} catch (err) {
			if (i === attempts - 1) return { error: `network: ${err.message}` };
			await sleep(2000 * (i + 1));
			continue;
		}
		if (res.status === 429 || res.status >= 500) {
			const wait = Number(res.headers.get('retry-after')) * 1000 || 4000 * (i + 1);
			if (i === attempts - 1) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
			await sleep(Math.min(wait, 60_000));
			continue;
		}
		if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
		const data = await res.json();
		const msg = data.choices?.[0]?.message || {};
		return {
			content: msg.content ?? null,
			tool_calls: (msg.tool_calls || []).map((tc) => ({ name: tc.function?.name, arguments: tc.function?.arguments })),
			finish_reason: data.choices?.[0]?.finish_reason,
			usage: data.usage,
			latency_s: (Date.now() - t0) / 1000,
		};
	}
	return { error: 'retries exhausted' };
}

async function pool(items, n, fn) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: n }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i], i);
			}
		}),
	);
	return out;
}

async function baseline() {
	const { tasks } = readJson('tasks.json');
	const answers = await pool(tasks, Number(opts.concurrency), async (t) => {
		const body = { messages: t.messages, max_tokens: t.max_tokens, temperature: t.temperature };
		if (t.tools) body.tools = t.tools;
		const r = await chatCall(BASELINE, body);
		process.stdout.write(r.error ? 'x' : '.');
		return { id: t.id, ...r };
	});
	console.log();
	writeJson('baseline.json', { model: BASELINE.model, answers });
	console.log(`baseline: ${answers.filter((a) => a.error).length} errors of ${answers.length}`);
}

function phiAnswers(runId) {
	const local = file(`phi-${runId}.json`);
	if (!existsSync(local)) {
		execFileSync('gcloud', ['storage', 'cp', `${BUCKET}/${runId}/report.json`, local, `--project=${PROJECT}`], { stdio: 'inherit' });
	}
	return JSON.parse(readFileSync(local, 'utf8'));
}

// ── Judge ────────────────────────────────────────────────────────────────────

const RUBRIC = [
	'You grade a diary paragraph an AI agent wrote from its own memories.',
	'Score each criterion 1-5 against the SOURCE material only:',
	'grounding: 5 = every fact, name and number appears in the source; 1 = invents facts.',
	'coverage: 5 = captures the most important memories; 1 = misses what matters.',
	'form: 5 = one first-person past-tense paragraph of 3-5 sentences, no lists or headings, names no coin other than $THREE; 1 = ignores the format.',
	'Reply with JSON only: {"grounding":n,"coverage":n,"form":n}',
].join('\n');

async function judge() {
	const { tasks } = readJson('tasks.json');
	const base = readJson('baseline.json').answers;
	const phi = opts.phi ? phiAnswers(opts.phi).eval : [];
	const prior = existsSync(file('judge.json')) ? readJson('judge.json') : { references: {}, rubric: {} };

	// Reference labels: the judge answers the classifier prompt itself, blind
	// to both candidates.
	const classify = tasks.filter((t) => (t.type === 'feedback_triage' || t.type === 'bounty_triage') && !prior.references[t.id]);
	await pool(classify, 2, async (t) => {
		const r = await chatCall(JUDGE, { messages: t.messages, max_tokens: 400, temperature: 0 });
		prior.references[t.id] = r.error ? { error: r.error } : { content: r.content };
		process.stdout.write(r.error ? 'x' : 'r');
	});

	const grade = [];
	for (const t of tasks.filter((x) => x.type === 'memory_summary')) {
		for (const [who, list] of [['baseline', base], ['phi', phi]]) {
			const a = list.find((x) => x.id === t.id);
			const key = `${who}:${t.id}`;
			if (!a || a.error || prior.rubric[key]) continue;
			grade.push({ key, source: t.messages[1].content, text: a.content || '' });
		}
	}
	await pool(grade, 2, async (g) => {
		const r = await chatCall(JUDGE, {
			messages: [{ role: 'system', content: RUBRIC }, { role: 'user', content: `SOURCE:\n${g.source}\n\nDIARY PARAGRAPH:\n${g.text}` }],
			max_tokens: 80,
			temperature: 0,
		});
		prior.rubric[g.key] = r.error ? { error: r.error } : parseJsonObject(r.content);
		process.stdout.write(r.error ? 'x' : 'g');
	});
	console.log();
	writeJson('judge.json', prior);
	console.log(`judge: ${Object.keys(prior.references).length} references, ${Object.keys(prior.rubric).length} rubric grades`);
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function parseJsonObject(text) {
	const s = String(text || '');
	const a = s.indexOf('{');
	const b = s.lastIndexOf('}');
	if (a < 0 || b <= a) return null;
	try {
		return JSON.parse(s.slice(a, b + 1));
	} catch {
		return null;
	}
}

function parsedCalls(answer, offered) {
	const calls = [];
	let valid = true;
	for (const c of answer.tool_calls || []) {
		let args = c.arguments;
		if (typeof args === 'string') {
			try {
				args = args.trim() ? JSON.parse(args) : {};
			} catch {
				valid = false;
				continue;
			}
		}
		if (!offered.has(c.name)) valid = false;
		calls.push({ tool: c.name, args: args || {} });
	}
	return { calls, valid };
}

export async function scoreTask(task, answer, refs) {
	if (!answer || answer.error) return { score: 0, valid: false };
	if (task.type === 'feedback_triage') {
		const { parseVerdict } = await import('../api/_lib/feedback/triage.js');
		const v = parseVerdict(answer.content);
		const ref = refs.references[task.id] && parseVerdict(refs.references[task.id].content);
		if (!v || !v.kind) return { score: 0, valid: false };
		if (!ref) return null;
		return { score: 0.6 * (v.kind === ref.kind) + 0.4 * (Math.abs(v.severity - ref.severity) <= 20), valid: true };
	}
	if (task.type === 'bounty_triage') {
		const { parseTriage } = await import('../api/_lib/bounties/triage.js');
		const v = parseTriage(answer.content);
		const ref = refs.references[task.id] && parseTriage(refs.references[task.id].content);
		if (!v) return { score: 0, valid: false };
		if (!ref) return null;
		return { score: 0.6 * (v.category === ref.category) + 0.4 * (v.effort === ref.effort), valid: true };
	}
	if (task.type === 'memory_summary') {
		const text = String(answer.content || '').trim();
		if (!text) return { score: 0, valid: false };
		const g = refs.rubric[`${refs.who}:${task.id}`];
		if (!g || g.error || !Number.isFinite(g.grounding)) return null;
		return { score: (g.grounding + g.coverage + g.form) / 15, valid: true, rubric: g };
	}
	const offered = new Set((task.tools || []).map((t) => t.function.name));
	const { calls, valid } = parsedCalls(answer, offered);
	const { argsMatch, runCheck } = await import('../api/_lib/evals/checks.js');
	if (task.type === 'agent_tools') {
		// First round only: tool checks always apply; answer checks apply when
		// the model answered without a tool; a task capped at one step expects
		// no tool at all.
		const trace = { answer: answer.content || '', toolCalls: calls };
		const results = [];
		for (const check of task.expect.checks) {
			if (check.type === 'tool_called' || check.type === 'tool_not_called') results.push(runCheck(check, trace).pass);
			else if (check.type.startsWith('answer_') && !calls.length) results.push(runCheck(check, trace).pass);
			else if (check.type === 'steps_below' && check.max <= 1) results.push(calls.length === 0);
		}
		if (!calls.length && !String(answer.content || '').trim()) return { score: 0, valid: false };
		return { score: results.length ? results.filter(Boolean).length / results.length : 1, valid };
	}
	// emote_actions
	if (task.expect.none) return { score: calls.every((c) => c.tool === 'playAnimation') ? 1 : 0, valid };
	const hit = calls.find((c) => c.tool === task.expect.tool && argsMatch(task.expect.args, c.args));
	return { score: hit ? 1 : 0, valid };
}

function countBy(list, key) {
	const out = {};
	for (const x of list) out[key(x)] = (out[key(x)] || 0) + 1;
	return out;
}

async function scoreAll(tasks, answers, refs, who) {
	const byId = new Map(answers.map((a) => [a.id, a]));
	const rows = {};
	for (const t of tasks) {
		const s = await scoreTask(t, byId.get(t.id), { ...refs, who });
		const r = (rows[t.type] ||= { n: 0, scored: 0, score: 0, valid: 0, latency: [] });
		r.n++;
		const a = byId.get(t.id);
		if (a?.latency_s) r.latency.push(a.latency_s);
		if (!s) continue;
		r.scored++;
		r.score += s.score;
		r.valid += s.valid ? 1 : 0;
	}
	for (const r of Object.values(rows)) {
		r.score = r.scored ? (100 * r.score) / r.scored : null;
		r.validity = r.scored ? r.valid / r.scored : null;
		r.latency.sort((x, y) => x - y);
		r.p50 = r.latency.length ? r.latency[Math.floor(r.latency.length / 2)] : null;
		delete r.latency;
	}
	return rows;
}

async function report() {
	if (!opts.phi) throw new Error('report needs --phi <run-id>');
	const { tasks } = readJson('tasks.json');
	const refs = readJson('judge.json');
	const baselineRun = readJson('baseline.json');
	const base = await scoreAll(tasks, baselineRun.answers, refs, 'baseline');
	const phiReport = phiAnswers(opts.phi);
	const phi = await scoreAll(tasks, phiReport.eval, refs, 'phi');
	const verdict = {};
	const lines = ['| Task type | Tasks | Baseline score | Phi score | Gap (pts) | Phi parse validity | Baseline p50 s | Phi p50 s | Route to Phi |', '|---|---|---|---|---|---|---|---|---|'];
	const fmt = (v, d = 1) => (v == null ? 'n/a' : v.toFixed(d));
	for (const type of Object.keys(base)) {
		const b = base[type];
		const p = phi[type] || {};
		const gap = b.score != null && p.score != null ? b.score - p.score : null;
		const routed = gap != null && gap <= BAR.maxGapPoints && (p.validity ?? 0) >= BAR.minValidity;
		verdict[type] = { routed, baseline: b, phi: p, gap };
		lines.push(`| ${type} | ${b.n} | ${fmt(b.score)} | ${fmt(p.score)} | ${fmt(gap)} | ${p.validity == null ? 'n/a' : `${(100 * p.validity).toFixed(0)}%`} | ${fmt(b.p50, 2)} | ${fmt(p.p50, 2)} | ${routed ? 'yes' : 'no'} |`);
	}
	const total = (rows) => {
		const all = Object.values(rows).filter((r) => r.score != null);
		return all.reduce((s, r) => s + r.score * r.scored, 0) / all.reduce((s, r) => s + r.scored, 0);
	};
	lines.push(`| all | ${tasks.length} | ${fmt(total(base))} | ${fmt(total(phi))} | ${fmt(total(base) - total(phi))} | | | | |`);
	writeJson(`verdict-${opts.phi}.json`, { bar: BAR, baseline_model: baselineRun.model, judge_model: JUDGE.model, verdict });
	console.log(lines.join('\n'));
}

const steps = { build, baseline, judge, report };
if (!steps[step]) {
	console.error('usage: phi-brain-eval.mjs build|baseline|judge|report [--phi <run-id>] [--dir <scratch dir>] [--baseline groq|groq#120b|nvidia]');
	process.exit(2);
}
await steps[step]();
