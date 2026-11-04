#!/usr/bin/env node
// Long-term memory benchmark: LoCoMo and LongMemEval, scored before and after
// temporal validity + provenance.
//
//   baseline  recall as it worked before: BM25 top-k memories in relevance
//             order, no dates, no validity, no provenance.
//   temporal  the same top-k, stamped with valid_from and source, reconciled so
//             a later memory closes the interval of the earlier one it replaces
//             (packages/agent-memory supersede()), rendered oldest to newest
//             with current/superseded labels, answered as of the question date.
//
// Both modes use the same retriever, the same answer model and the same judge,
// so the only difference is what the memory layer knows about time.
//
// Datasets are downloaded from their public repositories and cached in
// .cache/memory-bench/:
//   LoCoMo       github.com/snap-research/locomo        data/locomo10.json
//   LongMemEval  huggingface.co/datasets/xiaowu0162/longmemeval-cleaned, file named longmemeval_s_cleaned (about 277 MB)
//
// The model is the platform's own chain (api/_lib/llm.js llmComplete), the same
// one agents use, so credentials come from .env (or: node scripts/read-service-env.mjs).
// The grader is that model too, not GPT-4o, so scores are comparable between
// runs of this harness and not with published GPT-4o-judged numbers.
//
// Usage:
//   node --env-file=.env scripts/memory-bench.mjs --subset 50
//   node --env-file=.env scripts/memory-bench.mjs --dataset locomo --subset 20 --modes baseline,temporal
//   node --env-file=.env scripts/memory-bench.mjs --subset 50 --write-doc
//
// Flags: --dataset locomo|longmemeval|all (all)  --subset N (50 per dataset)
//        --modes baseline,temporal (both)  --top-k N (12)  --concurrency N (3)
//        --seed N (7)  --resume FILE (continue a run file: finished questions are reused)
//        --write-doc (append the run to docs/research/memory-bench-results.md)

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { llmComplete } from '../api/_lib/llm.js';
import {
	normalizeLocomo,
	normalizeLongMemEval,
	pickSubset,
	buildIndex,
	renderBaselineContext,
	renderTemporalContext,
	reconcilePrompt,
	parseReconcile,
	applySupersession,
	factsAsOf,
	answerPrompt,
	judgePrompt,
	parseVerdict,
	summarize,
} from './lib/memory-bench-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'memory-bench');
const RUNS = path.join(ROOT, 'data', '_generated', 'memory-bench');
const DOC = path.join(ROOT, 'docs', 'research', 'memory-bench-results.md');

const SOURCES = {
	locomo: {
		file: 'locomo10.json',
		url: 'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json',
		normalize: normalizeLocomo,
		label: 'LoCoMo (10 conversations, categories 1-4)',
	},
	longmemeval: {
		file: 'longmemeval_s_cleaned.json',
		url: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json',
		normalize: normalizeLongMemEval,
		label: 'LongMemEval-S (cleaned, 500 questions)',
	},
};

function parseArgs(argv) {
	const args = { dataset: 'all', subset: 50, modes: ['baseline', 'temporal'], topK: 12, concurrency: 3, seed: 7, resume: null, writeDoc: false };
	for (let i = 0; i < argv.length; i++) {
		const [flag, inline] = argv[i].split('=');
		const next = () => (inline !== undefined ? inline : argv[++i]);
		switch (flag) {
			case '--dataset': args.dataset = next(); break;
			case '--subset': args.subset = Number(next()); break;
			case '--modes': args.modes = next().split(',').map((s) => s.trim()).filter(Boolean); break;
			case '--top-k': args.topK = Number(next()); break;
			case '--concurrency': args.concurrency = Number(next()); break;
			case '--seed': args.seed = Number(next()); break;
			case '--resume': args.resume = next(); break;
			case '--write-doc': args.writeDoc = true; break;
			default: fail(`unknown flag ${flag}`);
		}
	}
	if (!['all', ...Object.keys(SOURCES)].includes(args.dataset)) fail(`--dataset must be locomo, longmemeval or all`);
	if (!Number.isInteger(args.subset) || args.subset < 1) fail('--subset must be a positive integer');
	if (!args.modes.length || args.modes.some((m) => !['baseline', 'temporal'].includes(m))) fail('--modes takes baseline and/or temporal');
	return args;
}

function fail(msg) {
	console.error(`memory-bench: ${msg}`);
	process.exit(2);
}

async function loadDataset(name) {
	const src = SOURCES[name];
	await mkdir(CACHE, { recursive: true });
	const file = path.join(CACHE, src.file);
	if (!existsSync(file)) {
		console.error(`downloading ${src.url}`);
		const res = await fetch(src.url, { redirect: 'follow' });
		if (!res.ok) fail(`download failed for ${name}: HTTP ${res.status}`);
		await writeFile(file, Buffer.from(await res.arrayBuffer()));
	}
	return src.normalize(JSON.parse(await readFile(file, 'utf8')));
}

async function ask(prompt, { maxTokens = 400, attempts = 6 } = {}) {
	let lastErr;
	for (let i = 0; i < attempts; i++) {
		try {
			const out = await llmComplete({ system: prompt.system, user: prompt.user, maxTokens, timeoutMs: 90_000 });
			const text = String(out?.text || '').trim();
			if (text) return { text, model: `${out.provider}/${out.model}` };
			lastErr = new Error('empty completion');
		} catch (err) {
			lastErr = err;
		}
		await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** i)));
	}
	throw lastErr;
}

async function runCase(c, index, args, models) {
	const hits = index.search(c.question, args.topK);
	const modes = {};
	for (const mode of args.modes) {
		let context;
		if (mode === 'baseline') {
			context = renderBaselineContext(hits);
		} else {
			const visible = factsAsOf(hits, c.questionDate);
			let facts = visible;
			if (visible.length > 1) {
				const rec = await ask(reconcilePrompt(visible), { maxTokens: 500 });
				models.add(rec.model);
				facts = applySupersession(visible, parseReconcile(rec.text, visible));
			}
			context = renderTemporalContext(facts);
		}
		const answer = await ask(answerPrompt({ question: c.question, context, questionDate: c.questionDate, temporal: mode === 'temporal' }), { maxTokens: 300 });
		models.add(answer.model);
		const verdictRes = await ask(judgePrompt({ question: c.question, gold: c.answer, answer: answer.text, type: c.type, abstention: c.abstention }), { maxTokens: 20 });
		models.add(verdictRes.model);
		modes[mode] = { answer: answer.text, correct: parseVerdict(verdictRes.text) };
	}
	return { id: c.id, dataset: c.dataset, type: c.type, question: c.question, gold: c.answer, retrieved: hits.map((h) => h.id), modes };
}

async function pool(items, concurrency, worker) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await worker(items[i], i);
			}
		}),
	);
	return out;
}

function pct(x) {
	return x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}

function table(name, summary, modes) {
	const types = [...new Set(modes.flatMap((m) => Object.keys(summary[m].byType)))].sort();
	const lines = [`| ${name} | ${modes.join(' | ')} |`, `|---|${modes.map(() => '---').join('|')}|`];
	lines.push(`| overall | ${modes.map((m) => `${pct(summary[m].accuracy)} (${summary[m].correct}/${summary[m].graded})`).join(' | ')} |`);
	for (const t of types) {
		lines.push(`| ${t} | ${modes.map((m) => { const b = summary[m].byType[t]; return b ? `${pct(b.accuracy)} (${b.correct}/${b.graded})` : 'n/a'; }).join(' | ')} |`);
	}
	return lines.join('\n');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const names = args.dataset === 'all' ? Object.keys(SOURCES) : [args.dataset];
	const started = new Date();
	const models = new Set();
	const report = { startedAt: started.toISOString(), args, datasets: {} };
	await mkdir(RUNS, { recursive: true });
	let runFile = path.join(RUNS, `${started.toISOString().replace(/[:.]/g, '-')}.json`);
	const finished = new Map();
	if (args.resume) {
		runFile = path.resolve(args.resume);
		const prior = JSON.parse(await readFile(runFile, 'utf8'));
		for (const d of Object.values(prior.datasets || {})) for (const r of d.results.filter(Boolean)) finished.set(`${r.dataset}:${r.id}`, r);
		for (const m of prior.models || []) models.add(m);
		console.error(`resuming ${path.relative(ROOT, runFile)}: ${finished.size} questions already graded`);
	}

	for (const name of names) {
		const all = await loadDataset(name);
		const cases = pickSubset(all, args.subset, args.seed);
		const indexes = new Map();
		const indexFor = (c) => {
			if (!indexes.has(c.poolKey)) indexes.set(c.poolKey, buildIndex(c.memories));
			return indexes.get(c.poolKey);
		};
		console.error(`${name}: ${cases.length} of ${all.length} questions, modes ${args.modes.join(',')}`);
		let done = 0;
		const partial = [];
		const results = await pool(cases, args.concurrency, async (c) => {
			const reused = finished.get(`${c.dataset}:${c.id}`);
			if (reused && args.modes.every((m) => reused.modes[m])) {
				partial.push(reused);
				done++;
				return reused;
			}
			const r = await runCase(c, indexFor(c), args, models);
			partial.push(r);
			console.error(`  ${name} ${++done}/${cases.length} ${c.type}: ${args.modes.map((m) => `${m}=${r.modes[m].correct}`).join(' ')}`);
			report.datasets[name] = { label: SOURCES[name].label, questions: cases.length, available: all.length, results: partial };
			await writeFile(runFile, JSON.stringify({ ...report, models: [...models] }, null, 1));
			return r;
		});
		report.datasets[name] = { label: SOURCES[name].label, questions: cases.length, available: all.length, summary: summarize(results, args.modes), results };
		await writeFile(runFile, JSON.stringify({ ...report, models: [...models] }, null, 1));
	}

	report.models = [...models];
	await writeFile(runFile, JSON.stringify(report, null, 1));

	const md = [];
	for (const name of names) {
		const d = report.datasets[name];
		md.push(`### ${d.label}, ${d.questions} of ${d.available} questions\n`, table('question type', d.summary, args.modes), '');
	}
	const text = md.join('\n');
	console.log(`\nMemory benchmark ${started.toISOString()} (top-k ${args.topK}, seed ${args.seed})\nmodels: ${report.models.join(', ')}\n\n${text}\nrun file: ${path.relative(ROOT, runFile)}`);

	if (args.writeDoc) {
		const block = `\n## Run ${started.toISOString().slice(0, 16).replace('T', ' ')} UTC\n\nSubset ${args.subset} per dataset, top-k ${args.topK}, seed ${args.seed}, modes ${args.modes.join(' vs ')}. Answer and grader model chain: ${report.models.join(', ')}. Raw per-question results: \`${path.relative(ROOT, runFile)}\`.\n\n${text}\n`;
		await appendFile(DOC, block);
		console.error(`appended to ${path.relative(ROOT, DOC)}`);
	}
}

main().catch((err) => {
	console.error(`memory-bench failed: ${err?.stack || err}`);
	process.exit(1);
});
