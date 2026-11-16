#!/usr/bin/env node
// Knowledge-retrieval rerank eval: does the NVIDIA cross-encoder stage in
// api/_lib/rerank.js measurably improve what retrieval hands the model, and
// what latency does it add?
//
// Pipeline under test is the production one: docs are chunked with the
// production chunker (api/_lib/knowledge-chunker.js), embedded with the
// production NIM embedder (api/_lib/embeddings.js; pinned below), the top
// SEARCH_POOL chunks by cosine form the candidate pool (as in
// api/_lib/agent-knowledge.js searchKnowledge), and that pool is reordered by
// the real rerankPassages(). Metrics compare the cosine order with the
// reranked order of the same pool.
//
// Modes:
//   corpus    print the corpus the labels are pinned to (chunk ids, headings)
//   run       run the eval, write data/evals/rerank/results-<date>.json
//
// Usage: NVIDIA_API_KEY=... node scripts/nvidia-rerank-eval.mjs run [--repeat 2] [--timeout 20000]

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chunkDocument } from '../api/_lib/knowledge-chunker.js';
import { cosine, embedWith } from '../api/_lib/embeddings.js';
import { rerankModel, rerankPassages } from '../api/_lib/rerank.js';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'data/evals/rerank');
const QUESTIONS = join(DIR, 'questions.json');
const SEARCH_POOL = 12; // api/_lib/agent-knowledge.js
const CHAT_TOP_K = 4; // api/_lib/agent-knowledge.js
const EMBED_BATCH = 32;
// The first-stage embedder is pinned so a later embedder change does not move
// the cosine baseline under the labels. This is the production NIM embedder at
// the time of labelling; --embedder <tag> re-runs against another one.
const DEFAULT_EMBEDDER = 'nvidia/nemotron-3-embed-1b@2048';
let EMBEDDER = DEFAULT_EMBEDDER;

// The corpus is pinned to a git commit (questions.json `corpus_commit`) and
// rebuilt from that commit at run time, so later doc edits never shift the
// chunk ids the labels point at, and no doc text is duplicated into the repo.
// Selection rule: every 12th top-level docs/*.md in sorted order at that
// commit, kept when 2 KB to 60 KB (drops stubs and the 490 KB API reference,
// which would otherwise be most of the corpus).
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function buildCorpus(commit) {
	const listing = git('ls-tree', '-l', commit, 'docs/')
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [meta, path] = line.split('\t');
			return { path, size: Number(meta.trim().split(/\s+/)[3]) };
		})
		.filter((f) => f.path.endsWith('.md'))
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const files = listing.filter((_, i) => i % 12 === 0).filter((f) => f.size >= 2_000 && f.size <= 60_000);
	const rows = [];
	for (const { path } of files) {
		const chunks = chunkDocument(git('show', `${commit}:${path}`), { kind: 'docx', title: path });
		for (const c of chunks) rows.push({ id: `${path}#${c.chunk_index}`, file: path, heading: c.heading, token_count: c.token_count, text: c.content });
	}
	return rows;
}

function loadQuestions() {
	return JSON.parse(readFileSync(QUESTIONS, 'utf8'));
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function embedCorpus(corpus) {
	const key = sha(EMBEDDER + corpus.map((c) => c.id + sha(c.text)).join('|')).slice(0, 16);
	const cache = join(tmpdir(), `three-ws-rerank-eval-${key}.json`);
	if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8')).map((v) => Float64Array.from(v));
	const vectors = [];
	for (let i = 0; i < corpus.length; i += EMBED_BATCH) {
		const batch = corpus.slice(i, i + EMBED_BATCH).map((c) => c.text);
		vectors.push(...(await embedWith(EMBEDDER, batch, 'passage')));
		process.stderr.write(`embedded ${Math.min(i + EMBED_BATCH, corpus.length)}/${corpus.length}\r`);
	}
	process.stderr.write('\n');
	writeFileSync(cache, JSON.stringify(vectors.map((v) => Array.from(v))));
	return vectors;
}

function ndcgAt(ranked, relevant, k) {
	let dcg = 0;
	ranked.slice(0, k).forEach((id, i) => {
		if (relevant.has(id)) dcg += 1 / Math.log2(i + 2);
	});
	let idcg = 0;
	for (let i = 0; i < Math.min(relevant.size, k); i++) idcg += 1 / Math.log2(i + 2);
	return idcg ? dcg / idcg : 0;
}

const hitAt = (ranked, relevant, k) => (ranked.slice(0, k).some((id) => relevant.has(id)) ? 1 : 0);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
function pct(xs, p) {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0;
}
const r3 = (x) => Math.round(x * 1000) / 1000;

function metrics(rows, key) {
	return {
		ndcg_at_5: r3(mean(rows.map((r) => r[key].ndcg5))),
		hit_at_1: r3(mean(rows.map((r) => r[key].hit1))),
		hit_at_4_chat: r3(mean(rows.map((r) => r[key].hit4))),
		hit_at_5: r3(mean(rows.map((r) => r[key].hit5))),
	};
}

async function run({ repeat, timeoutMs }) {
	if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is required');
	const { corpus_commit: commit, queries } = loadQuestions();
	const corpus = buildCorpus(commit);
	const byId = new Map(corpus.map((c, i) => [c.id, i]));
	for (const q of queries) for (const id of q.relevant) if (!byId.has(id)) throw new Error(`${q.id}: unknown chunk ${id}`);

	const vectors = await embedCorpus(corpus);
	const rows = [];
	const allMs = [];
	const answeredMs = [];
	let failures = 0;
	let hedgedCalls = 0;
	let splitCalls = 0;
	for (const q of queries) {
		const [qv] = await embedWith(EMBEDDER, [q.q], 'query');
		const pool = corpus
			.map((c, i) => ({ id: c.id, text: c.text, score: cosine(qv, vectors[i]) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, SEARCH_POOL);
		const relevant = new Set(q.relevant);
		const cosineIds = pool.map((p) => p.id);
		const score = (ids) => ({
			ndcg5: ndcgAt(ids, relevant, 5),
			hit1: hitAt(ids, relevant, 1),
			hit4: hitAt(ids, relevant, CHAT_TOP_K),
			hit5: hitAt(ids, relevant, 5),
			gold_rank: ids.findIndex((id) => relevant.has(id)) + 1 || null,
		});

		// Every call is scored on its own, as production makes exactly one per
		// retrieval: a failed call serves the cosine order (fail-open) and its
		// wall time still counts as added latency.
		const calls = [];
		for (let r = 0; r < repeat; r++) {
			const t0 = performance.now();
			const trace = {};
			const o = await rerankPassages(q.q, pool.map((p) => p.text), { timeoutMs, trace });
			const ms = performance.now() - t0;
			allMs.push(ms);
			if (trace.hedged) hedgedCalls++;
			if (trace.path === 'split') splitCalls++;
			if (o) answeredMs.push(ms);
			else failures++;
			calls.push({ ms: Math.round(ms), answered: !!o, path: trace.path, hedged: !!trace.hedged, served: score(o ? o.map((i) => pool[i].id) : cosineIds) });
		}
		const firstAnswer = calls.find((c) => c.answered);
		const served = Object.fromEntries(['ndcg5', 'hit1', 'hit4', 'hit5'].map((k) => [k, mean(calls.map((c) => c.served[k]))]));
		rows.push({
			id: q.id,
			in_pool: cosineIds.some((id) => relevant.has(id)),
			cosine: score(cosineIds),
			model: firstAnswer ? firstAnswer.served : null,
			served,
			calls: calls.map(({ served: _s, ...c }) => c),
		});
		process.stderr.write(`${q.id} cos#${rows.at(-1).cosine.gold_rank ?? '-'} rr#${firstAnswer?.served.gold_rank ?? '-'} answered ${calls.filter((c) => c.answered).length}/${repeat}\n`);
	}

	const date = new Date().toISOString().slice(0, 10);
	const cos = metrics(rows, 'cosine');
	const srv = metrics(rows, 'served');
	const answered = rows.filter((r) => r.model);
	const lat = (xs) => ({ samples: xs.length, p50: Math.round(pct(xs, 50)), p95: Math.round(pct(xs, 95)), max: Math.round(Math.max(0, ...xs)) });
	const result = {
		date,
		model: rerankModel(),
		embedder: EMBEDDER,
		corpus_commit: commit,
		corpus_chunks: corpus.length,
		corpus_docs: new Set(corpus.map((c) => c.file)).size,
		queries: queries.length,
		pool: SEARCH_POOL,
		gold_in_pool: rows.filter((r) => r.in_pool).length,
		rerank_timeout_ms: timeoutMs,
		rerank_calls: queries.length * repeat,
		rerank_failures: failures,
		hedged_calls: hedgedCalls,
		safety_split_calls: splitCalls,
		cosine: cos,
		// What a user gets: every call scored, failed calls on the cosine order.
		rerank_served: srv,
		delta_served: Object.fromEntries(Object.keys(cos).map((k) => [k, r3(srv[k] - cos[k])])),
		// What the model can do: queries where at least one call answered,
		// against cosine on the same queries.
		rerank_model: { queries: answered.length, ...metrics(answered, 'model') },
		cosine_same_queries: metrics(answered, 'cosine'),
		added_latency_ms_all_calls: lat(allMs),
		latency_ms_answered_calls: lat(answeredMs),
		per_query: rows,
	};
	const out = join(DIR, `results-${date}-t${timeoutMs}.json`);
	writeFileSync(out, JSON.stringify(result, null, '\t') + '\n');
	const { per_query: _omit, ...summary } = result;
	console.log(JSON.stringify(summary, null, 2));
	console.log(`-> ${out}`);
}

const [mode, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => {
	const i = rest.indexOf(`--${name}`);
	return i >= 0 ? Number(rest[i + 1]) : dflt;
};
const commitArg = () => {
	const i = rest.indexOf('--commit');
	return i >= 0 ? rest[i + 1] : existsSync(QUESTIONS) ? loadQuestions().corpus_commit : 'HEAD';
};
if (mode === 'corpus') {
	const corpus = buildCorpus(commitArg());
	for (const c of corpus) console.log(`${c.id}\t${c.token_count}\t${c.heading}`);
	console.error(`${corpus.length} chunks from ${new Set(corpus.map((c) => c.file)).size} docs at ${commitArg()}`);
} else if (mode === 'run') {
	const i = rest.indexOf('--embedder');
	if (i >= 0) EMBEDDER = rest[i + 1];
	await run({ repeat: flag('repeat', 2), timeoutMs: flag('timeout', 20_000) });
} else {
	console.error('usage: node scripts/nvidia-rerank-eval.mjs corpus [--commit sha] | run [--repeat 2] [--timeout 20000] [--embedder tag]');
	process.exit(2);
}
