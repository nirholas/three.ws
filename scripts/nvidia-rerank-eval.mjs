#!/usr/bin/env node
// Knowledge-retrieval rerank eval: does the NVIDIA cross-encoder stage in
// api/_lib/rerank.js measurably improve what retrieval hands the model, and
// what latency does it add?
//
// Pipeline under test is the production one: docs are chunked with the
// production chunker (api/_lib/knowledge-chunker.js), embedded with the
// production NIM embedder (api/_lib/embeddings.js, NIM_EMBED_TAG), the top
// SEARCH_POOL chunks by cosine form the candidate pool (as in
// api/_lib/agent-knowledge.js searchKnowledge), and that pool is reordered by
// the real rerankPassages(). Metrics compare the cosine order with the
// reranked order of the same pool.
//
// Modes:
//   corpus    print the corpus the labels are pinned to (chunk ids, headings)
//   draft     draft one paraphrased question per sampled chunk with Nemotron
//             (stdout only; drafts are reviewed by hand into questions.json)
//   run       run the eval, write data/evals/rerank/results-<date>.json
//
// Usage: NVIDIA_API_KEY=... node scripts/nvidia-rerank-eval.mjs run [--repeat 2] [--timeout 20000]

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chunkDocument } from '../api/_lib/knowledge-chunker.js';
import { NIM_EMBED_TAG, cosine, embedWith } from '../api/_lib/embeddings.js';
import { rerankModel, rerankPassages } from '../api/_lib/rerank.js';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'data/evals/rerank');
const QUESTIONS = join(DIR, 'questions.json');
const SEARCH_POOL = 12; // api/_lib/agent-knowledge.js
const CHAT_TOP_K = 4; // api/_lib/agent-knowledge.js
const EMBED_BATCH = 32;

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

async function nimChat(prompt) {
	const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
			messages: [{ role: 'user', content: prompt }],
			max_tokens: 400,
			temperature: 0.4,
		}),
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) throw new Error(`nim chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = await res.json();
	return String(data.choices?.[0]?.message?.content || '')
		.replace(/<think>[\s\S]*?<\/think>/g, '')
		.trim();
}

async function draft(commit, count) {
	const corpus = buildCorpus(commit);
	const perFile = new Map();
	const picks = corpus
		.filter((c) => c.token_count >= 120)
		.sort((a, b) => sha(a.id).localeCompare(sha(b.id)))
		.filter((c) => {
			const n = perFile.get(c.file) || 0;
			if (n >= 2) return false;
			perFile.set(c.file, n + 1);
			return true;
		})
		.slice(0, count);
	for (const c of picks) {
		const q = await nimChat(
			'You write evaluation questions for a document search system.\n' +
				'Write ONE question a user of the three.ws platform would type, which the passage below answers.\n' +
				'Rules: paraphrase; do not copy headings or distinctive phrases from the passage; under 25 words; ' +
				'the passage alone must answer it. Output only the question.\n\n' +
				`Passage (${c.heading}):\n${c.text.slice(0, 2500)}`,
		);
		console.log(JSON.stringify({ id: c.id, heading: c.heading, draft: q.split('\n')[0] }));
	}
}

async function embedCorpus(corpus) {
	const key = sha(NIM_EMBED_TAG + corpus.map((c) => c.id + sha(c.text)).join('|')).slice(0, 16);
	const cache = join(tmpdir(), `three-ws-rerank-eval-${key}.json`);
	if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8')).map((v) => Float64Array.from(v));
	const vectors = [];
	for (let i = 0; i < corpus.length; i += EMBED_BATCH) {
		const batch = corpus.slice(i, i + EMBED_BATCH).map((c) => c.text);
		vectors.push(...(await embedWith(NIM_EMBED_TAG, batch, 'passage')));
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
	const latencies = [];
	let failures = 0;
	for (const q of queries) {
		const [qv] = await embedWith(NIM_EMBED_TAG, [q.q], 'query');
		const pool = corpus
			.map((c, i) => ({ id: c.id, text: c.text, score: cosine(qv, vectors[i]) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, SEARCH_POOL);
		const relevant = new Set(q.relevant);
		const cosineIds = pool.map((p) => p.id);

		let order = null;
		for (let r = 0; r < repeat; r++) {
			const t0 = performance.now();
			const o = await rerankPassages(q.q, pool.map((p) => p.text), { timeoutMs });
			const ms = performance.now() - t0;
			if (o) {
				latencies.push(ms);
				order ??= o;
			} else failures++;
		}
		const rerankIds = order ? order.map((i) => pool[i].id) : cosineIds;
		const score = (ids) => ({
			ndcg5: ndcgAt(ids, relevant, 5),
			hit1: hitAt(ids, relevant, 1),
			hit4: hitAt(ids, relevant, CHAT_TOP_K),
			hit5: hitAt(ids, relevant, 5),
			gold_rank: ids.findIndex((id) => relevant.has(id)) + 1 || null,
		});
		rows.push({ id: q.id, in_pool: cosineIds.some((id) => relevant.has(id)), reranked: !!order, cosine: score(cosineIds), rerank: score(rerankIds) });
		process.stderr.write(`${q.id} cos#${rows.at(-1).cosine.gold_rank ?? '-'} rr#${rows.at(-1).rerank.gold_rank ?? '-'}\n`);
	}

	const date = new Date().toISOString().slice(0, 10);
	const cos = metrics(rows, 'cosine');
	const rr = metrics(rows, 'rerank');
	const result = {
		date,
		model: rerankModel(),
		embedder: NIM_EMBED_TAG,
		corpus_commit: commit,
		corpus_chunks: corpus.length,
		corpus_docs: new Set(corpus.map((c) => c.file)).size,
		queries: queries.length,
		pool: SEARCH_POOL,
		gold_in_pool: rows.filter((r) => r.in_pool).length,
		rerank_calls: queries.length * repeat,
		rerank_failures: failures,
		cosine: cos,
		rerank: rr,
		delta: Object.fromEntries(Object.keys(cos).map((k) => [k, r3(rr[k] - cos[k])])),
		latency_ms: {
			samples: latencies.length,
			p50: Math.round(pct(latencies, 50)),
			p95: Math.round(pct(latencies, 95)),
			max: Math.round(Math.max(0, ...latencies)),
		},
		per_query: rows,
	};
	const out = join(DIR, `results-${date}.json`);
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
} else if (mode === 'draft') await draft(commitArg(), flag('count', 60));
else if (mode === 'run') await run({ repeat: flag('repeat', 2), timeoutMs: flag('timeout', 20_000) });
else {
	console.error('usage: node scripts/nvidia-rerank-eval.mjs corpus [--commit sha] | draft [--commit sha] [--count 60] | run [--repeat 2] [--timeout 20000]');
	process.exit(2);
}
