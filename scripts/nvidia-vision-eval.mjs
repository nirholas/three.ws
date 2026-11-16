#!/usr/bin/env node
// Vision eval: which model should lead the vision chain, per consumer task.
//
// Runs every candidate NVIDIA vision model (plus the reference rungs the chain
// already leads with for some tasks) over the licence-clean set in
// data/evals/vision/ using each consumer's EXACT production prompt, token cap
// and request body (api/_lib/vision.js openaiCompatVisionProvider, reasoning
// stripping included), then scores the replies with scripts/lib/vision-eval-score.mjs.
//
//   npm run nvidia:vision-eval                         # run (resumes) and write the report
//   npm run nvidia:vision-eval -- --report-only        # rebuild the report from the raw rows
//   npm run nvidia:vision-eval -- --models super-vl,nano-omni --tasks caption
//
// Keys come from the environment: NVIDIA_API_KEY for the NIM candidates,
// CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_API_TOKEN for the Workers AI reference.
// A candidate without its key is recorded as "not configured", never faked.
//
// Raw rows (one per model x item x task, reply text included) are appended to
// data/evals/vision/runs/vision-<date>.jsonl as they finish, so a run stopped
// by a rate limit or a crash resumes from the last finished row. A 429 is
// retried with backoff; the set is never shrunk to get under a limit.
//
// The report is written to docs/nvidia/evals/vision-<date>.md between the
// eval:begin / eval:end markers; prose outside the markers is kept.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

import { openaiCompatVisionProvider } from '../api/_lib/vision.js';
import { PROMPT as FORGE_PRECHECK_PROMPT } from '../api/_lib/forge-image-validate.js';
import { REVIEW_PROMPT as IMAGE3D_REVIEW_PROMPT } from '../api/_lib/x-mention-image3d.js';
import { REVIEW_PROMPT as AVATAR_REVIEW_PROMPT } from '../api/_lib/x-mention-avatar.js';
import { PROMPT as ALT_TEXT_PROMPT, cleanAltText } from '../api/_lib/avatar-alt-text.js';
import { DETECT_PROMPT, DEFAULT_SCENE_OBJECTS } from '../api/_lib/forge-objects.js';
import { PHOTO_SET_DESIGNER_PROMPT } from '../api/_lib/diorama-photo.js';
import { rubricPrompt, subjectFromPrompt } from '../api/_lib/forge-quality-gate.js';
import { buildJudgePrompt } from '../api/_lib/quality-bench.js';
import { SEED_WATCHLIST } from '../api/_lib/seed-quality.js';
import { describePhotoPrompt } from '../api/_lib/gateway/media.js';
import { MOODS, GROUNDS } from '../src/diorama/schema.js';
import { SCORERS, summarize, parseReplyFor } from './lib/vision-eval-score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SET_DIR = join(ROOT, 'data/evals/vision');
const RUNS_DIR = join(SET_DIR, 'runs');
const REPORT_DIR = join(ROOT, 'docs/nvidia/evals');
const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const THINKING_OFF = { chat_template_kwargs: { enable_thinking: false } };
// Generous on purpose: the eval measures how long a model takes, and a reply
// that lands after the production budget still counts for accuracy (the
// in-budget column is where the budget bites).
const EVAL_TIMEOUT_MS = 90_000;
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000];
// Two points of overall accuracy: inside that, the faster model wins the tie.
export const TIE_THRESHOLD = 0.02;

// Every NIM model that answered a real image in the 2026-11-16 catalog probe,
// plus the models that need a re-check. Text-only and unserved ids are listed
// in the report's "not evaluated" table instead.
export const CANDIDATES = [
	{ id: 'super-vl', host: 'nim', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', extraBody: THINKING_OFF, current: true },
	{ id: 'nano-omni', host: 'nim', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', extraBody: THINKING_OFF },
	{ id: 'bolt-e4b', host: 'nim', model: 'nvidia/nemotron-3.5-bolt-e4b', extraBody: THINKING_OFF },
	{ id: 'mistral-large-4', host: 'nim', model: 'mistralai/mistral-large-4-1t-a52b', extraBody: THINKING_OFF },
	{ id: 'muse-glimmer', host: 'nim', model: 'meta/muse-glimmer-30b', extraBody: THINKING_OFF },
	{ id: 'step-5', host: 'nim', model: 'stepfun-ai/step-5-preview', extraBody: THINKING_OFF },
	{ id: 'gemma-4-31b', host: 'nim', model: 'google/gemma-4-31b-it', extraBody: THINKING_OFF },
	{ id: 'cf-scout', host: 'cloudflare', model: '@cf/meta/llama-4-scout-17b-16e-instruct', reference: true },
];

// Each consumer's production prompt, token cap and per-attempt budget.
export const TASKS = {
	caption: { consumer: 'api/_lib/avatar-alt-text.js', json: false, maxTokens: 60, budgetMs: 15_000, prompt: () => ALT_TEXT_PROMPT },
	describe: { consumer: 'api/_lib/gateway/media.js', json: false, maxTokens: 400, budgetMs: 20_000, prompt: () => describePhotoPrompt('') },
	forge_precheck: { consumer: 'api/_lib/forge-image-validate.js', json: true, maxTokens: 120, budgetMs: 12_000, prompt: () => FORGE_PRECHECK_PROMPT },
	image3d_review: { consumer: 'api/_lib/x-mention-image3d.js', json: true, maxTokens: 120, budgetMs: 20_000, prompt: () => IMAGE3D_REVIEW_PROMPT },
	avatar_review: { consumer: 'api/_lib/x-mention-avatar.js', json: true, maxTokens: 80, budgetMs: 20_000, prompt: () => AVATAR_REVIEW_PROMPT },
	quality_gate: {
		consumer: 'api/_lib/forge-quality-gate.js',
		json: true,
		maxTokens: 1536,
		budgetMs: 25_000,
		prompt: (exp) => rubricPrompt(subjectFromPrompt(exp.prompt), exp.prompt),
	},
	seed_judge: {
		consumer: 'api/_lib/seed-quality.js',
		json: true,
		maxTokens: 700,
		budgetMs: 20_000,
		prompt: (exp, item) =>
			buildJudgePrompt({ prompt: exp.prompt, subjectClass: 'catalog-seed', watch: SEED_WATCHLIST, viewLabel: item.source.view || 'three-quarter' }),
	},
	object_detect: { consumer: 'api/_lib/forge-objects.js', json: true, maxTokens: 1024, budgetMs: 25_000, prompt: () => DETECT_PROMPT(DEFAULT_SCENE_OBJECTS) },
	diorama: { consumer: 'api/_lib/diorama-photo.js', json: true, maxTokens: 2000, budgetMs: 30_000, prompt: () => PHOTO_SET_DESIGNER_PROMPT },
};

const HOSTS = {
	nim: { concurrency: 6, intervalMs: 1_700 },
	cloudflare: { concurrency: 4, intervalMs: 300 },
};

function laneFor(c) {
	if (c.host === 'nim') {
		const key = process.env.NVIDIA_API_KEY;
		return key ? openaiCompatVisionProvider({ name: 'nvidia', key, url: NIM_URL, model: c.model, extraBody: c.extraBody }) : null;
	}
	const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
	const key = process.env.CLOUDFLARE_AI_API_TOKEN;
	if (!acct || !key) return null;
	return openaiCompatVisionProvider({
		name: 'cloudflare',
		key,
		url: `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/v1/chat/completions`,
		model: c.model,
	});
}

/** A per-host gate: at most `concurrency` in flight, starts spaced `intervalMs` apart. */
function makeGate({ concurrency, intervalMs }) {
	let active = 0;
	let nextStart = 0;
	const waiting = [];
	const pump = () => {
		while (active < concurrency && waiting.length) {
			active++;
			const wait = Math.max(0, nextStart - Date.now());
			nextStart = Math.max(Date.now(), nextStart) + intervalMs;
			setTimeout(waiting.shift(), wait);
		}
	};
	return async (fn) => {
		await new Promise((resolve) => {
			waiting.push(resolve);
			pump();
		});
		try {
			return await fn();
		} finally {
			active--;
			pump();
		}
	};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One request through the production lane. Retries 429 with backoff. */
async function ask(lane, parts, maxTokens, { timeoutMs = EVAL_TIMEOUT_MS } = {}) {
	let throttled = 0;
	for (;;) {
		const started = Date.now();
		let res;
		try {
			res = await fetch(lane.url, {
				method: 'POST',
				headers: lane.headers,
				body: JSON.stringify(lane.buildBody(null, parts, maxTokens)),
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (e) {
			return { ok: false, status: null, error: e.name === 'TimeoutError' ? 'timeout' : String(e.message).slice(0, 160), latencyMs: Date.now() - started, throttled };
		}
		const latencyMs = Date.now() - started;
		if (res.status === 429 && throttled < BACKOFF_MS.length) {
			await res.text().catch(() => '');
			await sleep(BACKOFF_MS[throttled++]);
			continue;
		}
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			return { ok: false, status: res.status, error: body.slice(0, 200), latencyMs, throttled };
		}
		const data = await res.json().catch(() => null);
		if (!data) return { ok: false, status: res.status, error: 'reply was not JSON', latencyMs, throttled };
		const raw = data.choices?.[0]?.message?.content ?? null;
		return {
			ok: true,
			status: res.status,
			latencyMs,
			throttled,
			text: lane.extractText(data),
			rawHadThink: typeof raw === 'string' && /<\/?think/i.test(raw),
			reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? null,
			outputTokens: data.usage?.completion_tokens ?? null,
		};
	}
}

function imagePart(base64, mime = 'image/jpeg') {
	return { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } };
}

function loadImage(id) {
	return readFileSync(join(SET_DIR, 'images', `${id}.jpg`)).toString('base64');
}

function scoreRow(task, exp, reply) {
	if (!reply.ok) return { schemaOk: false, correct: false, detail: reply.error || `HTTP ${reply.status}` };
	let json = null;
	if (TASKS[task].json) {
		try {
			json = parseReplyFor(task, reply.text);
		} catch {
			return { schemaOk: false, correct: false, detail: 'reply was not valid JSON' };
		}
	}
	const text = task === 'caption' ? cleanAltText(reply.text) || '' : reply.text;
	return SCORERS[task](exp, { text, json }, { moods: MOODS, grounds: GROUNDS });
}

// Input modes and limits, probed once per candidate: production inlines every
// image as base64, so URL pass-through, a large image and a second image in one
// message are measured here to know what each model accepts.
const URL_PROBE = 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/thumbs/alarm_clock_01.png';
async function inputProbes(lane) {
	const q = { type: 'text', text: 'Name the main object in this image in at most five words.' };
	const big = await sharp(join(SET_DIR, 'images/c-mountain-lake.jpg')).resize({ width: 3072 }).jpeg({ quality: 92 }).toBuffer();
	const probes = {
		base64_1024: [q, imagePart(loadImage('r-alarm-clock'))],
		url: [q, { type: 'image_url', image_url: { url: URL_PROBE } }],
		base64_3072: [{ type: 'text', text: 'Describe this landscape in at most eight words.' }, imagePart(big.toString('base64'))],
		two_images: [{ type: 'text', text: 'Name the object in each of these two images, in order, comma separated.' }, imagePart(loadImage('r-apple')), imagePart(loadImage('r-lemon'))],
	};
	const out = {};
	for (const [name, parts] of Object.entries(probes)) {
		const r = await ask(lane, parts, 60, { timeoutMs: 60_000 });
		out[name] = { ok: r.ok, status: r.status, latencyMs: r.latencyMs, reply: r.ok ? r.text.slice(0, 80) : r.error?.slice(0, 80) };
	}
	out.bytes3072 = big.length;
	return out;
}

const fmtPct = (v) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const fmtMs = (v) => (v == null ? 'n/a' : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${(v / 1000).toFixed(2)} s`);
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Best model per task on in-budget accuracy, ties within TIE_THRESHOLD go to lower p50. */
export function pickPerTask(stats, models, tasks) {
	const out = {};
	for (const t of tasks) {
		const ranked = models
			.map((m) => ({ m, s: stats[m]?.[t] }))
			.filter((x) => x.s && x.s.n)
			.sort((a, b) => b.s.inBudget - a.s.inBudget || b.s.accuracy - a.s.accuracy);
		if (!ranked.length) continue;
		const top = ranked[0].s.inBudget;
		const tied = ranked.filter((x) => top - x.s.inBudget <= TIE_THRESHOLD);
		tied.sort((a, b) => (a.s.p50 ?? Infinity) - (b.s.p50 ?? Infinity));
		out[t] = { winner: tied[0].m, tiedWith: tied.slice(1).map((x) => x.m), ranked: ranked.map((x) => x.m) };
	}
	return out;
}

function buildReport({ date, rows, meta, manifest }) {
	const models = CANDIDATES.map((c) => c.id).filter((id) => rows.some((r) => r.model === id));
	const tasks = Object.keys(TASKS).filter((t) => rows.some((r) => r.task === t));
	const stats = {};
	for (const m of models) {
		stats[m] = { all: summarize(rows.filter((r) => r.model === m)) };
		for (const t of tasks) stats[m][t] = summarize(rows.filter((r) => r.model === m && r.task === t));
	}
	const L = [];
	L.push(`Run date ${date}. ${manifest.items.length} images, ${tasks.length} consumer tasks, ${rows.length} scored replies across ${models.length} models.`);
	L.push(`Raw rows: [data/evals/vision/runs/vision-${date}.jsonl](../../../data/evals/vision/runs/vision-${date}.jsonl). Rebuild this section with \`npm run nvidia:vision-eval -- --report-only --date ${date}\`.`);
	L.push('');
	L.push('### Overall');
	L.push('');
	L.push('Accuracy and schema adherence count every attempt, errors included. "In budget" is the share of attempts that were correct AND answered inside the consumer\'s production per-attempt budget. Latency percentiles are over successful replies.');
	L.push('');
	L.push('| Model | Role | Accuracy | In budget | JSON/schema | Error rate | p50 | p95 | n |');
	L.push('|---|---|---|---|---|---|---|---|---|');
	for (const m of models) {
		const c = CANDIDATES.find((x) => x.id === m);
		const s = stats[m].all;
		const role = c.current ? 'current first rung' : c.reference ? 'reference (current lead for quality gate and seed judge)' : 'candidate';
		L.push(`| \`${c.model}\` | ${role} | ${fmtPct(s.accuracy)} | ${fmtPct(s.inBudget)} | ${fmtPct(s.schema)} | ${fmtPct(s.errorRate)} | ${fmtMs(s.p50)} | ${fmtMs(s.p95)} | ${s.n} |`);
	}
	L.push('');
	L.push('### Accuracy per task');
	L.push('');
	L.push(`| Task (consumer, budget) | ${models.join(' | ')} |`);
	L.push(`|---|${models.map(() => '---').join('|')}|`);
	for (const t of tasks) {
		const n = stats[models[0]][t].n;
		L.push(`| ${t} (\`${TASKS[t].consumer}\`, ${TASKS[t].budgetMs / 1000} s, n=${n}) | ${models.map((m) => `${fmtPct(stats[m][t].accuracy)} / ${fmtPct(stats[m][t].inBudget)}`).join(' | ')} |`);
	}
	L.push('');
	L.push('Each cell is accuracy / in-budget accuracy.');
	L.push('');
	L.push('### Latency and schema per task');
	L.push('');
	L.push(`| Task | ${models.join(' | ')} |`);
	L.push(`|---|${models.map(() => '---').join('|')}|`);
	for (const t of tasks) {
		L.push(`| ${t} | ${models.map((m) => `${fmtMs(stats[m][t].p50)} / ${fmtMs(stats[m][t].p95)} / ${fmtPct(stats[m][t].schema)}`).join(' | ')} |`);
	}
	L.push('');
	L.push('Each cell is p50 / p95 / schema adherence.');
	L.push('');
	const picks = pickPerTask(stats, models, tasks);
	L.push('### Winner per task');
	L.push('');
	L.push(`Ranked on in-budget accuracy; models within ${TIE_THRESHOLD * 100} points of the top are a tie and the lower p50 wins.`);
	L.push('');
	L.push('| Task | Winner | Tied within threshold | Full ranking |');
	L.push('|---|---|---|---|');
	for (const t of tasks) {
		const p = picks[t];
		if (p) L.push(`| ${t} | ${p.winner} | ${p.tiedWith.join(', ') || 'none'} | ${p.ranked.join(' > ')} |`);
	}
	L.push('');
	L.push('### Input modes and limits');
	L.push('');
	L.push('| Model | base64 1024 px | https URL | base64 3072 px | two images |');
	L.push('|---|---|---|---|---|');
	for (const m of models) {
		const p = meta.probes?.[m];
		if (!p) continue;
		const f = (x) => (x ? `${x.ok ? 'ok' : `fail ${x.status ?? ''}`.trim()} ${fmtMs(x.latencyMs)}: ${cell(x.reply)}` : 'n/a');
		L.push(`| ${m} | ${f(p.base64_1024)} | ${f(p.url)} | ${f(p.base64_3072)} | ${f(p.two_images)} |`);
	}
	L.push('');
	if (meta.unavailable && Object.keys(meta.unavailable).length) {
		L.push('### Candidates that could not be scored');
		L.push('');
		L.push('| Model | Why |');
		L.push('|---|---|');
		for (const [m, why] of Object.entries(meta.unavailable)) L.push(`| \`${CANDIDATES.find((c) => c.id === m)?.model || m}\` | ${cell(why)} |`);
		L.push('');
	}
	const think = rows.filter((r) => r.rawHadThink).length;
	const throttled = rows.reduce((a, r) => a + (r.throttled || 0), 0);
	L.push(`Replies that carried inline \`<think>\` text before stripping: ${think}. Rate-limit retries during the run: ${throttled}.`);
	L.push('');
	L.push('### Misses');
	L.push('');
	L.push('Every incorrect reply from the current first rung and the overall winner, with the scorer\'s reason.');
	L.push('');
	const best = [...models].sort((a, b) => stats[b].all.accuracy - stats[a].all.accuracy)[0];
	for (const m of [...new Set([CANDIDATES.find((c) => c.current).id, best])].filter((m) => models.includes(m))) {
		const miss = rows.filter((r) => r.model === m && !r.correct);
		L.push(`<details><summary>${m}: ${miss.length} misses</summary>`);
		L.push('');
		L.push('| Item | Task | Reason | Reply |');
		L.push('|---|---|---|---|');
		for (const r of miss) L.push(`| ${r.item} | ${r.task} | ${cell(r.detail)} | ${cell((r.text || '').slice(0, 140))} |`);
		L.push('');
		L.push('</details>');
		L.push('');
	}
	return { body: L.join('\n'), stats, picks };
}

function writeReport(date, body) {
	mkdirSync(REPORT_DIR, { recursive: true });
	const file = join(REPORT_DIR, `vision-${date}.md`);
	const begin = '<!-- eval:begin -->';
	const end = '<!-- eval:end -->';
	const block = `${begin}\n${body}\n${end}`;
	let doc;
	if (existsSync(file)) {
		const cur = readFileSync(file, 'utf8');
		doc = cur.includes(begin) && cur.includes(end) ? cur.slice(0, cur.indexOf(begin)) + block + cur.slice(cur.indexOf(end) + end.length) : `${cur.trimEnd()}\n\n${block}\n`;
	} else {
		doc = `# Vision eval, ${date}\n\n## Results\n\n${block}\n`;
	}
	writeFileSync(file, doc);
	return file;
}

async function main() {
	const { values } = parseArgs({
		options: {
			date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
			models: { type: 'string' },
			tasks: { type: 'string' },
			'report-only': { type: 'boolean', default: false },
		},
	});
	const date = values.date;
	const manifest = JSON.parse(readFileSync(join(SET_DIR, 'manifest.json'), 'utf8'));
	mkdirSync(RUNS_DIR, { recursive: true });
	const rowsFile = join(RUNS_DIR, `vision-${date}.jsonl`);
	const metaFile = join(RUNS_DIR, `vision-${date}.meta.json`);
	const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : { probes: {}, unavailable: {} };
	// A run killed mid-append can leave one torn line; that reply is simply
	// collected again on resume.
	const readRows = () => (existsSync(rowsFile) ? readFileSync(rowsFile, 'utf8').split('\n').flatMap((l) => {
		try {
			return l.trim() ? [JSON.parse(l)] : [];
		} catch {
			return [];
		}
	}) : []);

	if (!values['report-only']) {
		const wantModels = values.models ? new Set(values.models.split(',')) : null;
		const wantTasks = values.tasks ? new Set(values.tasks.split(',')) : null;
		const done = new Set(readRows().map((r) => `${r.model}|${r.item}|${r.task}`));
		const gates = Object.fromEntries(Object.entries(HOSTS).map(([h, cfg]) => [h, makeGate(cfg)]));
		const lanes = {};

		for (const c of CANDIDATES) {
			if (wantModels && !wantModels.has(c.id)) continue;
			const lane = laneFor(c);
			if (!lane) {
				meta.unavailable[c.id] = `not configured: no ${c.host === 'nim' ? 'NVIDIA_API_KEY' : 'CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_API_TOKEN'} in the environment`;
				continue;
			}
			// Availability: a model the host cannot serve with one real image twice
			// in a row (not served, no image support, or no reply in the eval
			// timeout) is recorded with the reason and not run over the whole set.
			// A 200 with empty content IS served (a reasoning model that spent the
			// token cap thinking); those replies are scored as misses, task by task.
			let probe;
			for (let i = 0; i < 2; i++) {
				probe = await gates[c.host](() => ask(lane, [{ type: 'text', text: ALT_TEXT_PROMPT }, imagePart(loadImage('r-alarm-clock'))], 60));
				if (probe.ok) break;
			}
			if (!probe.ok) {
				meta.unavailable[c.id] = `${probe.status ?? ''} ${probe.error}`.trim();
				console.log(`${c.id}: unavailable (${meta.unavailable[c.id]})`);
				continue;
			}
			delete meta.unavailable[c.id];
			lanes[c.id] = lane;
			if (!meta.probes[c.id]) meta.probes[c.id] = await gates[c.host](() => inputProbes(lane));
			writeFileSync(metaFile, `${JSON.stringify(meta, null, '\t')}\n`);
			console.log(`${c.id}: available (${probe.latencyMs} ms)`);
		}
		writeFileSync(metaFile, `${JSON.stringify(meta, null, '\t')}\n`);

		const jobs = [];
		for (const item of manifest.items) {
			for (const [task, exp] of Object.entries(item.tasks)) {
				if (wantTasks && !wantTasks.has(task)) continue;
				for (const c of CANDIDATES) {
					if (!lanes[c.id] || done.has(`${c.id}|${item.id}|${task}`)) continue;
					jobs.push({ c, item, task, exp });
				}
			}
		}
		console.log(`${jobs.length} replies to collect`);
		let finished = 0;
		await Promise.all(
			jobs.map(({ c, item, task, exp }) =>
				gates[c.host](async () => {
					const spec = TASKS[task];
					const reply = await ask(lanes[c.id], [{ type: 'text', text: spec.prompt(exp, item) }, imagePart(loadImage(item.id))], spec.maxTokens);
					const s = scoreRow(task, exp, reply);
					const row = {
						model: c.id,
						item: item.id,
						task,
						ok: reply.ok,
						status: reply.status,
						latencyMs: reply.latencyMs,
						budgetMs: spec.budgetMs,
						schemaOk: s.schemaOk,
						correct: s.correct,
						detail: s.detail,
						text: reply.ok ? reply.text.slice(0, 4000) : null,
						rawHadThink: reply.rawHadThink || false,
						reasoningTokens: reply.reasoningTokens ?? null,
						throttled: reply.throttled,
					};
					appendFileSync(rowsFile, `${JSON.stringify(row)}\n`);
					finished++;
					if (finished % 25 === 0 || finished === jobs.length) console.log(`${finished}/${jobs.length}`);
				}),
			),
		);
	}

	// Rescore every stored reply with the current rules, so a scorer fix applies
	// to the whole run without asking the models again.
	const byId = new Map(manifest.items.map((i) => [i.id, i]));
	const rows = readRows().map((r) => {
		const exp = byId.get(r.item)?.tasks?.[r.task];
		if (!exp || !r.ok) return r;
		return { ...r, ...scoreRow(r.task, exp, { ok: true, text: r.text || '' }) };
	});
	if (!rows.length) {
		console.error(`no rows in ${rowsFile}; run without --report-only first`);
		process.exit(1);
	}
	const { body, stats } = buildReport({ date, rows, meta, manifest });
	const file = writeReport(date, body);
	console.log(`report: ${file}`);
	for (const [m, s] of Object.entries(stats)) {
		console.log(`${m.padEnd(16)} acc ${fmtPct(s.all.accuracy).padStart(6)}  inBudget ${fmtPct(s.all.inBudget).padStart(6)}  err ${fmtPct(s.all.errorRate).padStart(6)}  p50 ${fmtMs(s.all.p50)}  p95 ${fmtMs(s.all.p95)}`);
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
