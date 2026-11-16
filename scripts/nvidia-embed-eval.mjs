#!/usr/bin/env node
// Retrieval eval for the NVIDIA NIM embedders: the model agent memory and
// knowledge retrieval run on today versus the newer Nemotron embedders in the
// catalog, on two kinds of data:
//
//   three-ws-docs  44 hand-written questions labelled against specific sections
//                  of 29 three.ws docs (data/evals/nvidia-embed/three-ws-docs-qrels.json);
//                  every section of every file is a candidate.
//   BEIR           public test sets (SciFact, NFCorpus), downloaded once from the
//                  BEIR mirror into .cache/beir and scored with their own qrels.
//
// Metrics per model and dimension: recall@5, recall@10, nDCG@10, plus
// single-query embedding latency (p50/p95, sequential, interleaved across
// models so time-of-day load hits every model equally).
//
// Reduced dimensions are computed from the full vector by Matryoshka truncation
// and renormalization, which equals NIM's own `dimensions` output for the
// nemotron-3.5 embedders (verified live, cosine 1.000000), so each model is
// embedded once.
//
// Vectors cache under .cache/nvidia-embed-eval/ keyed by model, input type and
// text hash, so a run interrupted by a rate limit resumes where it stopped.
//
// Usage:
//   npm run nvidia:embed-eval -- [--datasets docs,scifact,nfcorpus] [--latency-n 20] [--out file.json]
// Needs NVIDIA_API_KEY (environment, .env.local or .env).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
	splitSections,
	chunkSection,
	reduceDim,
	normalize,
	rankIds,
	recallAt,
	ndcgAt,
	percentile,
} from './lib/embed-eval-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'nvidia-embed-eval');
const BEIR_CACHE = join(ROOT, '.cache', 'beir');
const NIM_URL = 'https://integrate.api.nvidia.com/v1/embeddings';

// Same passage budget production chunks to (about 512 tokens at 4 chars per
// token), applied to every model so no model is judged on longer inputs.
const MAX_PASSAGE_CHARS = 2048;
const BATCH = 64;
// Measured 2026-11-16: the hosted nemotron-3.5-embed-1b answers 500 "service
// inference failed" for any request carrying two or more non-trivial inputs
// (2 x 400 words fails, 1 x 1500 words succeeds), so it is driven one input per
// request, several requests in flight. The other two take 64 x 400 words.
const MODEL_LANE = { 'nvidia/nemotron-3.5-embed-1b': { batch: 1, parallel: 6 } };

export const CONFIGS = [
	{ label: 'nemotron-3-embed-1b@2048 (current)', model: 'nvidia/nemotron-3-embed-1b', dim: 2048 },
	{ label: 'nemotron-3.5-embed-1b@2048', model: 'nvidia/nemotron-3.5-embed-1b', dim: 2048 },
	{ label: 'nemotron-3.5-embed-1b@1024', model: 'nvidia/nemotron-3.5-embed-1b', dim: 1024 },
	{ label: 'nemotron-3.5-embed-1b@512', model: 'nvidia/nemotron-3.5-embed-1b', dim: 512 },
	{ label: 'nemotron-3.5-embed-8b@4096', model: 'nvidia/nemotron-3.5-embed-8b', dim: 4096 },
	{ label: 'nemotron-3.5-embed-8b@2048', model: 'nvidia/nemotron-3.5-embed-8b', dim: 2048 },
	{ label: 'nemotron-3.5-embed-8b@1024', model: 'nvidia/nemotron-3.5-embed-8b', dim: 1024 },
];

const BEIR = {
	scifact: 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip',
	nfcorpus: 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/nfcorpus.zip',
};

function loadEnv() {
	for (const f of ['.env.local', '.env']) {
		let raw;
		try {
			raw = readFileSync(join(ROOT, f), 'utf8');
		} catch {
			continue;
		}
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
			if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
}

function parseArgs(argv) {
	const args = { datasets: ['docs', 'scifact', 'nfcorpus'], latencyN: 20, out: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--datasets') args.datasets = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
		else if (a === '--latency-n') args.latencyN = Math.max(0, Number(argv[++i]) || 0);
		else if (a === '--out') args.out = argv[++i];
		else throw new Error(`unknown argument: ${a}`);
	}
	for (const d of args.datasets) {
		if (d !== 'docs' && !BEIR[d]) throw new Error(`unknown dataset: ${d} (docs, ${Object.keys(BEIR).join(', ')})`);
	}
	return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 429 is a rate limit: wait and retry patiently. A 5xx gets two quick retries
// and is then thrown as `upstream_5xx`, so the caller can split the batch: the
// nemotron-3.5 lane intermittently fails a small batch whose inputs each embed
// fine on their own.
async function nimEmbed(model, texts, inputType) {
	for (let attempt = 0; ; attempt++) {
		let res;
		try {
			res = await fetch(NIM_URL, {
				method: 'POST',
				headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ model, input: texts, input_type: inputType }),
				signal: AbortSignal.timeout(120_000),
			});
		} catch (err) {
			if (attempt >= 4) throw err;
			await sleep(2000 * 2 ** attempt);
			continue;
		}
		if (res.ok) {
			const data = await res.json();
			const rows = (data.data || []).sort((a, b) => a.index - b.index);
			if (rows.length !== texts.length) throw new Error(`${model}: expected ${texts.length} vectors, got ${rows.length}`);
			return rows.map((r) => Float32Array.from(r.embedding));
		}
		const body = await res.text().catch(() => '');
		if (res.status === 422 && /content safety/i.test(body)) {
			throw Object.assign(new Error(`${model}: input rejected by content safety screening`), { code: 'content_safety' });
		}
		if (res.status === 429 && attempt < 8) {
			await sleep(2000 * 2 ** Math.min(attempt, 5));
			continue;
		}
		if (res.status >= 500 && attempt < 2) {
			await sleep(1500 * (attempt + 1));
			continue;
		}
		throw Object.assign(new Error(`${model} ${res.status}: ${body.slice(0, 200)}`), {
			code: res.status >= 500 ? 'upstream_5xx' : 'upstream_error',
		});
	}
}

const hashText = (t) => createHash('sha256').update(t).digest('hex').slice(0, 24);

/** Disk-backed vector cache for one model + input type (resumable). */
function openCache(model, inputType) {
	const dir = join(CACHE, model.replace(/[^a-z0-9.-]+/gi, '_'));
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${inputType}.jsonl`);
	const map = new Map();
	if (existsSync(file)) {
		for (const line of readFileSync(file, 'utf8').split('\n')) {
			if (!line) continue;
			const { h, v } = JSON.parse(line);
			map.set(h, v === null ? null : Float32Array.from(v));
		}
	}
	return {
		has: (h) => map.has(h),
		get: (h) => map.get(h),
		put(h, vec) {
			map.set(h, vec);
			appendFileSync(file, `${JSON.stringify({ h, v: vec ? Array.from(vec, (x) => +x.toFixed(6)) : null })}\n`);
		},
	};
}

// The nemotron-3.5 lane screens inputs and refuses a whole batch with a 422
// when one input trips the filter, and intermittently 500s on batches. Bisect
// down to the offending inputs, which come back null (counted as refusals,
// never retrieved), so one bad input costs only itself, as in production.
export const rejections = new Map();

async function embedScreened(model, texts, inputType) {
	try {
		return await nimEmbed(model, texts, inputType);
	} catch (err) {
		if (err?.code !== 'content_safety' && err?.code !== 'upstream_5xx') throw err;
		if (texts.length === 1) {
			const key = `${model} ${inputType} ${err.code}`;
			rejections.set(key, [...(rejections.get(key) || []), texts[0].slice(0, 160)]);
			// A refusal is a property of the input and is cached (null); a 5xx is
			// transient, so it is not cached (undefined) and a rerun retries it.
			return [err.code === 'content_safety' ? null : undefined];
		}
		const mid = Math.ceil(texts.length / 2);
		return [
			...(await embedScreened(model, texts.slice(0, mid), inputType)),
			...(await embedScreened(model, texts.slice(mid), inputType)),
		];
	}
}

async function embedAll(model, texts, inputType, tag) {
	const cache = openCache(model, inputType);
	const clipped = texts.map((t) => t.slice(0, MAX_PASSAGE_CHARS));
	const hashes = clipped.map(hashText);
	const firstIndex = new Map();
	hashes.forEach((h, i) => {
		if (!cache.has(h) && !firstIndex.has(h)) firstIndex.set(h, i);
	});
	const missing = [...firstIndex.values()];
	const { batch, parallel } = MODEL_LANE[model] || { batch: BATCH, parallel: 1 };
	const step = batch * parallel;
	for (let i = 0; i < missing.length; i += step) {
		const groups = [];
		for (let g = i; g < Math.min(i + step, missing.length); g += batch) groups.push(missing.slice(g, g + batch));
		const results = await Promise.all(groups.map((idx) => embedScreened(model, idx.map((j) => clipped[j]), inputType)));
		groups.forEach((idx, gi) => {
			idx.forEach((j, k) => {
				if (results[gi][k] !== undefined) cache.put(hashes[j], results[gi][k]);
			});
		});
		process.stderr.write(`\r  ${tag} ${model} ${inputType}: ${Math.min(i + step, missing.length)}/${missing.length} new`);
	}
	if (missing.length) process.stderr.write('\n');
	return hashes.map((h) => cache.get(h));
}

function loadDocsDataset() {
	const spec = JSON.parse(readFileSync(join(ROOT, 'data/evals/nvidia-embed/three-ws-docs-qrels.json'), 'utf8'));
	const passages = [];
	const passageIds = [];
	const sectionIds = new Set();
	for (const path of spec.corpus_files) {
		for (const section of splitSections(path, readFileSync(join(ROOT, path), 'utf8'))) {
			sectionIds.add(section.id);
			for (const p of chunkSection(section, MAX_PASSAGE_CHARS)) {
				passages.push(p);
				passageIds.push(section.id);
			}
		}
	}
	const queries = spec.queries.map((q) => {
		for (const id of q.relevant) {
			if (!sectionIds.has(id)) throw new Error(`label ${q.id} names unknown section ${id}`);
		}
		return { id: q.id, text: q.q, qrel: Object.fromEntries(q.relevant.map((id) => [id, 1])) };
	});
	return { name: 'three-ws-docs', passages, passageIds, docCount: sectionIds.size, queries };
}

async function fetchBeir(name) {
	const dir = join(BEIR_CACHE, name);
	if (existsSync(join(dir, name, 'corpus.jsonl'))) return join(dir, name);
	mkdirSync(dir, { recursive: true });
	const zip = join(dir, `${name}.zip`);
	process.stderr.write(`  downloading BEIR ${name}\n`);
	const res = await fetch(BEIR[name], { signal: AbortSignal.timeout(300_000) });
	if (!res.ok) throw new Error(`BEIR ${name} download ${res.status}`);
	await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
	execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
	return join(dir, name);
}

async function loadBeirDataset(name) {
	const dir = await fetchBeir(name);
	const readJsonl = (f) =>
		readFileSync(join(dir, f), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l));
	const qrels = {};
	for (const line of readFileSync(join(dir, 'qrels', 'test.tsv'), 'utf8').split('\n').slice(1)) {
		const [qid, did, score] = line.split('\t');
		if (!qid || !did) continue;
		(qrels[qid] ||= {})[did] = Number(score);
	}
	const corpus = readJsonl('corpus.jsonl');
	const queryText = new Map(readJsonl('queries.jsonl').map((q) => [String(q._id), q.text]));
	const queries = Object.keys(qrels)
		.filter((qid) => queryText.has(qid) && Object.values(qrels[qid]).some((g) => g > 0))
		.map((qid) => ({ id: qid, text: queryText.get(qid), qrel: qrels[qid] }));
	return {
		name: `beir-${name}`,
		passages: corpus.map((d) => (d.title ? `${d.title}\n${d.text}` : d.text)),
		passageIds: corpus.map((d) => String(d._id)),
		docCount: corpus.length,
		queries,
	};
}

function score(dataset, docVecs, queryVecs, dim) {
	const fit = (v) => (dim === v.length ? normalize(v) : reduceDim(v, dim));
	// A passage or query the provider refused (content safety) has no vector:
	// the passage can never be retrieved and the query finds nothing, which is
	// what production would see.
	const keep = docVecs.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
	const docs = keep.map((i) => fit(docVecs[i]));
	const ids = keep.map((i) => dataset.passageIds[i]);
	let r5 = 0;
	let r10 = 0;
	let n10 = 0;
	let refusedQueries = 0;
	dataset.queries.forEach((q, i) => {
		if (!queryVecs[i]) {
			refusedQueries++;
			return;
		}
		const ranked = rankIds(fit(queryVecs[i]), docs, ids, 10);
		r5 += recallAt(ranked, q.qrel, 5);
		r10 += recallAt(ranked, q.qrel, 10);
		n10 += ndcgAt(ranked, q.qrel, 10);
	});
	const n = dataset.queries.length;
	return {
		recall5: r5 / n,
		recall10: r10 / n,
		ndcg10: n10 / n,
		refused_passages: docVecs.length - keep.length,
		refused_queries: refusedQueries,
	};
}

async function measureLatency(models, queries, n) {
	const samples = Object.fromEntries(models.map((m) => [m, []]));
	for (let i = 0; i < Math.min(n, queries.length); i++) {
		for (const m of models) {
			const t0 = performance.now();
			await nimEmbed(m, [queries[i]], 'query');
			samples[m].push(performance.now() - t0);
		}
	}
	return Object.fromEntries(
		models.map((m) => [m, { n: samples[m].length, p50_ms: Math.round(percentile(samples[m], 50)), p95_ms: Math.round(percentile(samples[m], 95)) }]),
	);
}

const pct = (x) => (x * 100).toFixed(1);

export function markdownTables(result) {
	const lines = [];
	for (const ds of result.datasets) {
		lines.push(`### ${ds.name} (${ds.queries} queries, ${ds.docs} documents, ${ds.passages} passages)`, '');
		lines.push('| Model @ dim | recall@5 | recall@10 | nDCG@10 | refused passages / queries |', '|---|---:|---:|---:|---:|');
		for (const r of ds.results) {
			lines.push(`| ${r.label} | ${pct(r.recall5)} | ${pct(r.recall10)} | ${pct(r.ndcg10)} | ${r.refused_passages} / ${r.refused_queries} |`);
		}
		lines.push('');
	}
	if (result.latency) {
		lines.push(`### Single-query embedding latency (${Object.values(result.latency)[0]?.n ?? 0} sequential calls per model)`, '');
		lines.push('| Model | p50 ms | p95 ms |', '|---|---:|---:|');
		for (const [m, l] of Object.entries(result.latency)) lines.push(`| ${m} | ${l.p50_ms} | ${l.p95_ms} |`);
		lines.push('');
	}
	return lines.join('\n');
}

async function main() {
	loadEnv();
	const args = parseArgs(process.argv.slice(2));
	if (!process.env.NVIDIA_API_KEY) {
		throw new Error('NVIDIA_API_KEY is not set (read it with: node scripts/read-service-env.mjs ^NVIDIA_API_KEY$ --raw)');
	}
	const models = [...new Set(CONFIGS.map((c) => c.model))];
	const result = { generated_at: new Date().toISOString(), max_passage_chars: MAX_PASSAGE_CHARS, datasets: [], latency: null };

	for (const name of args.datasets) {
		const dataset = name === 'docs' ? loadDocsDataset() : await loadBeirDataset(name);
		process.stderr.write(`${dataset.name}: ${dataset.queries.length} queries, ${dataset.passages.length} passages\n`);
		const vecs = {};
		for (const m of models) {
			vecs[m] = {
				docs: await embedAll(m, dataset.passages, 'passage', dataset.name),
				queries: await embedAll(m, dataset.queries.map((q) => q.text), 'query', dataset.name),
			};
		}
		const results = CONFIGS.map((c) => ({ label: c.label, model: c.model, dim: c.dim, ...score(dataset, vecs[c.model].docs, vecs[c.model].queries, c.dim) }));
		result.datasets.push({ name: dataset.name, queries: dataset.queries.length, docs: dataset.docCount, passages: dataset.passages.length, results });
	}

	if (args.latencyN) {
		const docs = loadDocsDataset();
		result.latency = await measureLatency(models, docs.queries.map((q) => q.text), args.latencyN);
	}

	result.refusal_samples = Object.fromEntries(rejections);
	const md = markdownTables(result);
	process.stdout.write(`${md}\n`);
	if (args.out) {
		mkdirSync(dirname(resolve(args.out)), { recursive: true });
		writeFileSync(resolve(args.out), `${JSON.stringify(result, null, '\t')}\n`);
		process.stderr.write(`wrote ${args.out}\n`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err?.message || err);
		process.exit(1);
	});
}
