#!/usr/bin/env node
// PDF extraction eval: does layout-aware extraction with NVIDIA NeMo Retriever
// models (api/_lib/pdf-extract.js) let an agent answer table, chart and
// scanned-page questions that the text extractors cannot?
//
// The set (data/evals/pdf-extraction/set.json) is three CC BY 4.0 arXiv papers
// pinned by version and sha1, plus an image-only copy of one of them that this
// script builds (each page rendered to a JPEG and wrapped in a PDF with no text
// layer), standing in for a scanned upload. Answers were read off the rendered
// page images by a person.
//
// Every document goes through three extraction conditions, each exactly as
// production would run it:
//   markitdown  the MarkItDown converter + chunkDocument(kind 'pdf'): the path
//               knowledge uploads used before this change (workers/markitdown);
//   text-layer  pdf.js text per page + chunkDocument: the fallback when neither
//               MarkItDown nor the layout models are available;
//   nemotron    extractPage per page + chunkPdfBlocks: the new default.
// Then, per question: chunks are embedded with the production ingest embedder,
// retrieved like searchKnowledge/retrieveForChat (cosine pool, min score,
// NVIDIA rerank when configured, top 4, char cap), put in the system prompt
// with knowledgePromptBlock, and answered by one fixed chat model at
// temperature 0. Grading is deterministic (set.json "about").
//
//   npm run nvidia:pdf-eval                    # run (extraction is cached) and write the report
//   npm run nvidia:pdf-eval -- --report-only   # rebuild the report from the last results file
//   npm run nvidia:pdf-eval -- --docs mixtral --conditions nemotron
//
// Needs NVIDIA_API_KEY (layout models, embedder, reranker, answer model) and
// the MarkItDown CLI (MARKITDOWN_BIN, `pip install 'markitdown[pdf]'`). A
// condition whose tool is missing is recorded as "not run", never faked.
//
// Source PDFs and extraction output are cached in PDF_EVAL_CACHE (default
// ~/.cache/three-ws-pdf-eval) so a rerun only repeats retrieval and answering.
// Per-question rows go to data/evals/pdf-extraction/runs/results-<date>.json and
// the report to docs/nvidia/evals/pdf-extraction-<date>.md between the
// eval:begin / eval:end markers; prose outside the markers is kept.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { openPdf, closePdf, renderPage, pdfPageTexts } from '../api/_lib/pdf-render.js';
import { extractPage } from '../api/_lib/pdf-extract.js';
import { MODELS } from '../api/_lib/nvidia-doc-extract.js';
import { chunkDocument, chunkPdfBlocks } from '../api/_lib/knowledge-chunker.js';
import { defaultIngestEmbedderTag, embedPassagesEach, embedQuery, cosine } from '../api/_lib/embeddings.js';
import { rerankConfigured, rerankPassages, rerankModel } from '../api/_lib/rerank.js';
import { knowledgePromptBlock } from '../api/_lib/agent-knowledge.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SET_DIR = join(ROOT, 'data/evals/pdf-extraction');
const RUNS_DIR = join(SET_DIR, 'runs');
const REPORT_DIR = join(ROOT, 'docs/nvidia/evals');
const CACHE = process.env.PDF_EVAL_CACHE || join(homedir(), '.cache/three-ws-pdf-eval');
const MARKITDOWN_BIN = process.env.MARKITDOWN_BIN || join(homedir(), '.cache/pdfx-venv/bin/markitdown');
const CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const ANSWER_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

// Mirrors api/_lib/agent-knowledge.js (searchKnowledge + retrieveForChat).
const SEARCH_POOL = 12;
const CHAT_TOP_K = 4;
const CHAT_MIN_SCORE = 0.2;
const CHAT_MAX_CHARS = 6_000;
const EMBED_BATCH = 16;
const PAGE_CONCURRENCY = 3;
const BACKOFF_MS = [10_000, 30_000, 60_000];

export const CONDITIONS = ['markitdown', 'text-layer', 'nemotron'];
const BEFORE = 'markitdown';
const AFTER = 'nemotron';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

// ---- grading -------------------------------------------------------------

export function numbersIn(text) {
	return [...String(text || '').replace(/(\d),(\d{3})/g, '$1$2').matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

export function grade(question, reply) {
	if (question.match) return new RegExp(question.match, 'i').test(String(reply || ''));
	const tol = question.tol ?? 1e-6;
	return numbersIn(reply).some((n) => Math.abs(n - question.number) <= tol);
}

// Whether the retrieved context holds the exact gold value: only meaningful
// for printed values (tables and screenshots), not chart estimates.
export function contextHasValue(question, context) {
	if (question.number == null || question.tol) return null;
	return numbersIn(context).some((n) => Math.abs(n - question.number) <= 1e-6);
}

// ---- scanned copy ----------------------------------------------------------

/** A PDF whose pages are JPEG images only (DCTDecode XObjects, no text layer). */
export function imageOnlyPdf(pages) {
	const objects = [];
	const add = (body) => objects.push(body) && objects.length;
	const catalog = add(null);
	const pagesObj = add(null);
	const kids = [];
	for (const p of pages) {
		const img = add(
			Buffer.concat([
				Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`),
				p.bytes,
				Buffer.from('\nendstream'),
			]),
		);
		const draw = Buffer.from(`q ${p.ptWidth} 0 0 ${p.ptHeight} 0 0 cm /Im0 Do Q`);
		const content = add(Buffer.concat([Buffer.from(`<< /Length ${draw.length} >>\nstream\n`), draw, Buffer.from('\nendstream')]));
		kids.push(
			add(
				Buffer.from(
					`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${p.ptWidth} ${p.ptHeight}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`,
				),
			),
		);
	}
	objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
	objects[pagesObj - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);

	const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
	let offset = parts[0].length;
	const offsets = [];
	objects.forEach((body, i) => {
		offsets.push(offset);
		const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
		parts.push(chunk);
		offset += chunk.length;
	});
	const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
	parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
	return Buffer.concat(parts);
}

async function buildScan(sourceBytes) {
	const doc = await openPdf(sourceBytes);
	try {
		const pages = [];
		for (let p = 1; p <= doc.numPages; p++) {
			const page = await doc.getPage(p);
			const { width, height } = page.getViewport({ scale: 1 });
			// 150 dpi, a typical office scanner setting.
			const r = await renderPage(doc, p, { scale: 150 / 72, quality: 80 });
			pages.push({ bytes: r.bytes, width: r.width, height: r.height, ptWidth: Math.round(width), ptHeight: Math.round(height) });
		}
		return imageOnlyPdf(pages);
	} finally {
		await closePdf(doc);
	}
}

// ---- documents -------------------------------------------------------------

async function loadDocument(d, byId) {
	mkdirSync(CACHE, { recursive: true });
	const path = join(CACHE, `${d.id}.pdf`);
	if (!existsSync(path)) {
		let bytes;
		if (d.scanOf) bytes = await buildScan(await loadDocument(byId[d.scanOf], byId));
		else {
			const res = await fetch(`https://arxiv.org/pdf/${d.arxiv}`, { headers: { 'User-Agent': 'three.ws-pdf-eval' } });
			if (!res.ok) throw new Error(`arXiv ${d.arxiv}: HTTP ${res.status}`);
			bytes = Buffer.from(await res.arrayBuffer());
		}
		writeFileSync(path, bytes);
	}
	const bytes = readFileSync(path);
	if (d.sha1 && sha1(bytes) !== d.sha1) throw new Error(`${d.id}: sha1 ${sha1(bytes)} does not match the pinned ${d.sha1}`);
	return bytes;
}

function markitdownAvailable() {
	try {
		execFileSync(MARKITDOWN_BIN, ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

async function withRetry(label, fn) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (attempt >= BACKOFF_MS.length) throw err;
			console.warn(`[pdf-eval] ${label} failed (${err?.message}); retrying in ${BACKOFF_MS[attempt] / 1000}s`);
			await sleep(BACKOFF_MS[attempt]);
		}
	}
}

async function extractNemotron(bytes, label) {
	const doc = await openPdf(bytes);
	try {
		const pages = Array.from({ length: doc.numPages }, (_, i) => i + 1);
		const results = new Array(pages.length);
		let next = 0;
		await Promise.all(
			Array.from({ length: PAGE_CONCURRENCY }, async () => {
				while (next < pages.length) {
					const i = next++;
					results[i] = await withRetry(`${label} p${pages[i]}`, () => extractPage(doc, pages[i]));
					const r = results[i];
					console.log(`[pdf-eval] ${label} p${r.page}: ${r.blocks.length} blocks${r.scanned ? ' (scanned)' : ''}, ${(r.timings.total_ms / 1000).toFixed(1)}s`);
				}
			}),
		);
		const blocks = results.flatMap((r) => r.blocks);
		return {
			chunks: chunkPdfBlocks(blocks),
			stats: {
				pages: results.length,
				scanned_pages: results.filter((r) => r.scanned).length,
				tables: blocks.filter((b) => b.type === 'table').length,
				charts: blocks.filter((b) => b.type === 'chart').length,
				chart_reads_failed: blocks.filter((b) => b.type === 'chart' && b.read_error).length,
				page_ms: results.map((r) => r.timings.total_ms),
			},
		};
	} finally {
		await closePdf(doc);
	}
}

async function extract(condition, d, bytes, calls) {
	const cachePath = join(CACHE, `${d.id}.${condition}.json`);
	if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));
	const t0 = Date.now();
	let out;
	if (condition === 'markitdown') {
		const markdown = execFileSync(MARKITDOWN_BIN, [join(CACHE, `${d.id}.pdf`)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
		out = { chunks: chunkDocument(markdown, { kind: 'pdf', title: d.name }), stats: {} };
	} else if (condition === 'text-layer') {
		out = { chunks: chunkDocument((await pdfPageTexts(bytes)).join('\f'), { kind: 'pdf', title: d.name }), stats: {} };
	} else {
		const before = snapshot(calls);
		out = await extractNemotron(bytes, d.id);
		out.stats.model_calls = diff(snapshot(calls), before);
	}
	out.stats.extract_ms = Date.now() - t0;
	out.stats.chunks = out.chunks.length;
	writeFileSync(cachePath, JSON.stringify(out));
	return out;
}

function snapshot(calls) {
	return Object.fromEntries(Object.entries(calls).filter(([k]) => k !== '__extracting').map(([k, v]) => [k, { calls: v.calls, failed: v.failed, ms: [...v.ms] }]));
}

function diff(after, before) {
	return Object.fromEntries(
		Object.entries(after).map(([k, v]) => {
			const b = before[k] || { calls: 0, failed: 0, ms: [] };
			return [k, { calls: v.calls - b.calls, failed: v.failed - b.failed, ms: v.ms.slice(b.ms.length) }];
		}),
	);
}

function mergeCalls(extraction) {
	const out = {};
	for (const byCondition of Object.values(extraction)) {
		for (const [model, m] of Object.entries(byCondition.nemotron?.model_calls || {})) {
			const o = (out[model] ||= { calls: 0, failed: 0, ms: [] });
			o.calls += m.calls;
			o.failed += m.failed;
			o.ms.push(...m.ms);
		}
	}
	return out;
}

// ---- retrieval and answering ----------------------------------------------

async function embedChunks(chunks) {
	const tag = defaultIngestEmbedderTag();
	const out = [];
	for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
		const slice = chunks.slice(i, i + EMBED_BATCH).map((c) => c.embed_text || c.content);
		out.push(...(await withRetry('embed', () => embedPassagesEach(tag, slice))));
	}
	return chunks.map((c, i) => ({ ...c, tag: out[i].tag, vector: out[i].vector }));
}

async function retrieve(indexed, name, query) {
	const queryVecs = new Map();
	const pool = [];
	for (const c of indexed) {
		if (!queryVecs.has(c.tag)) queryVecs.set(c.tag, await withRetry('embed query', () => embedQuery(c.tag, query)));
		pool.push({ ...c, name, score: cosine(queryVecs.get(c.tag), c.vector) });
	}
	const candidates = pool.filter((r) => r.score >= CHAT_MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, SEARCH_POOL);
	let top = candidates.slice(0, CHAT_TOP_K);
	if (rerankConfigured() && candidates.length > 1) {
		const order = await rerankPassages(query, candidates.map((r) => String(r.content)));
		if (order) top = order.slice(0, CHAT_TOP_K).map((i) => candidates[i]);
	}
	const out = [];
	let total = 0;
	for (const r of top) {
		if (total + r.content.length > CHAT_MAX_CHARS && out.length) break;
		out.push(r);
		total += r.content.length;
	}
	return out;
}

async function answer(results, question) {
	const system = [
		'You are an AI agent answering questions from the documents your owner uploaded.',
		knowledgePromptBlock(results) || 'No excerpts from your documents matched this question.',
	].join('\n\n');
	const body = {
		model: ANSWER_MODEL,
		temperature: 0,
		max_tokens: 120,
		chat_template_kwargs: { enable_thinking: false },
		messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: `${question}\nAnswer with the value or name only. If the excerpts do not contain it, answer "not found".` },
		],
	};
	return withRetry('answer', async () => {
		const res = await fetch(CHAT_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(60_000),
		});
		if (!res.ok) throw new Error(`answer model HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
		const json = await res.json();
		return String(json?.choices?.[0]?.message?.content || '').trim();
	});
}

// ---- report ----------------------------------------------------------------

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

function tally(rows) {
	const out = { n: rows.length, pass: rows.filter((r) => r.pass).length };
	const recall = rows.filter((r) => r.context_has_value !== null);
	out.recall_n = recall.length;
	out.recall = recall.filter((r) => r.context_has_value).length;
	return out;
}

function percentile(list, p) {
	if (!list.length) return 0;
	const s = [...list].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

export function renderReport(results) {
	const { rows, documents, extraction, meta } = results;
	const ran = CONDITIONS.filter((c) => rows.some((r) => r.condition === c));
	const slices = [
		['All questions', () => true],
		['Tables (born-digital)', (r) => r.kind === 'table' && !r.scanned],
		['Charts (born-digital)', (r) => r.kind === 'chart' && !r.scanned],
		['Screenshot of a table (image, no text layer)', (r) => r.kind === 'image' && !r.scanned],
		['Scanned copy (every page an image)', (r) => r.scanned],
	];
	const lines = [];
	lines.push(`Run ${meta.date}: ${meta.questions} questions over ${documents.length} documents (${meta.pages} pages). Answer model \`${meta.answer_model}\` at temperature 0; embedder \`${meta.embedder}\`; reranker ${meta.reranker ? `\`${meta.reranker}\`` : 'off'}.`);
	lines.push('');
	lines.push('### Answer accuracy');
	lines.push('');
	lines.push(`| Slice | n | ${ran.map((c) => `${c}${c === BEFORE ? ' (before)' : c === AFTER ? ' (after)' : ''}`).join(' | ')} |`);
	lines.push(`|---|---:|${ran.map(() => '---:').join('|')}|`);
	for (const [label, keep] of slices) {
		const n = rows.filter((r) => r.condition === ran[0] && keep(r)).length;
		if (!n) continue;
		const cells = ran.map((c) => {
			const t = tally(rows.filter((r) => r.condition === c && keep(r)));
			return `${pct(t.pass, t.n)} (${t.pass}/${t.n})`;
		});
		lines.push(`| ${label} | ${n} | ${cells.join(' | ')} |`);
	}
	lines.push('');
	lines.push('### Retrieval: the exact printed value reached the prompt');
	lines.push('');
	lines.push('Tables and the screenshot only (a chart estimate has no exact value to look for). This separates "the extractor lost the number" from "the model misread it".');
	lines.push('');
	lines.push(`| Slice | ${ran.join(' | ')} |`);
	lines.push(`|---|${ran.map(() => '---:').join('|')}|`);
	for (const [label, keep] of slices) {
		const cells = ran.map((c) => {
			const t = tally(rows.filter((r) => r.condition === c && keep(r)));
			return t.recall_n ? `${pct(t.recall, t.recall_n)} (${t.recall}/${t.recall_n})` : null;
		});
		if (cells.every((x) => x === null)) continue;
		lines.push(`| ${label} | ${cells.map((x) => x ?? 'n/a').join(' | ')} |`);
	}
	lines.push('');
	lines.push('### Extraction');
	lines.push('');
	lines.push('| Document | Pages | Condition | Chunks | Tables | Charts | Seconds per page (median / p90) | Wall time |');
	lines.push('|---|---:|---|---:|---:|---:|---|---:|');
	for (const d of documents) {
		for (const c of ran) {
			const s = extraction[d.id]?.[c];
			if (!s) continue;
			const perPage = s.page_ms?.length ? `${(percentile(s.page_ms, 0.5) / 1000).toFixed(1)} / ${(percentile(s.page_ms, 0.9) / 1000).toFixed(1)}` : 'n/a';
			lines.push(`| ${d.name} | ${d.pages} | ${c} | ${s.chunks} | ${s.tables ?? 'n/a'} | ${s.charts ?? 'n/a'} | ${perPage} | ${(s.extract_ms / 1000).toFixed(1)}s |`);
		}
	}
	lines.push('');
	lines.push('### Models called by the nemotron condition');
	lines.push('');
	lines.push('| Model | Calls | Failed | Median latency |');
	lines.push('|---|---:|---:|---:|');
	for (const [model, m] of Object.entries(meta.model_calls || {})) {
		lines.push(`| \`${model}\` | ${m.calls} | ${m.failed} | ${(percentile(m.ms, 0.5) / 1000).toFixed(2)}s |`);
	}
	lines.push('');
	lines.push('### Every question');
	lines.push('');
	lines.push(`| Doc | Kind | Question | Gold | ${ran.join(' | ')} |`);
	lines.push(`|---|---|---|---|${ran.map(() => '---').join('|')}|`);
	const byKey = new Map();
	for (const r of rows) {
		const key = `${r.doc}|${r.q}`;
		if (!byKey.has(key)) byKey.set(key, { r, by: {} });
		byKey.get(key).by[r.condition] = r;
	}
	const cell = (x) => String(x ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 40);
	for (const { r, by } of byKey.values()) {
		const gold = r.match ? `/${r.match}/` : `${r.number}${r.tol ? ` ±${r.tol}` : ''}`;
		lines.push(`| ${r.doc} | ${r.kind} | ${r.q.replace(/\|/g, '/')} | ${gold.replace(/\|/g, '/')} | ${ran.map((c) => (by[c] ? `${by[c].pass ? 'pass' : 'fail'}: ${cell(by[c].reply)}` : 'n/a')).join(' | ')} |`);
	}
	return lines.join('\n');
}

function writeReport(results) {
	mkdirSync(REPORT_DIR, { recursive: true });
	const path = join(REPORT_DIR, `pdf-extraction-${results.meta.date}.md`);
	const block = `<!-- eval:begin -->\n${renderReport(results)}\n<!-- eval:end -->`;
	let doc = existsSync(path) ? readFileSync(path, 'utf8') : `# PDF extraction eval, ${results.meta.date}\n\n${block}\n`;
	doc = doc.includes('<!-- eval:begin -->') ? doc.replace(/<!-- eval:begin -->[\s\S]*<!-- eval:end -->/, block) : `${doc.trimEnd()}\n\n${block}\n`;
	writeFileSync(path, doc);
	return path;
}

// ---- main ------------------------------------------------------------------

function countModelCalls() {
	const calls = {};
	const known = new Set(Object.values(MODELS));
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const u = String(url);
		let model = null;
		const cv = u.match(/\/v1\/cv\/(nvidia\/[^/?]+)/);
		if (cv) model = cv[1];
		else if (u.includes('/chat/completions') && init?.body) {
			try {
				const m = JSON.parse(init.body).model;
				if (known.has(m) && calls.__extracting) model = m;
			} catch {
				model = null;
			}
		}
		if (!model) return original(url, init);
		const t0 = Date.now();
		const rec = (calls[model] ||= { calls: 0, failed: 0, ms: [] });
		rec.calls++;
		try {
			const res = await original(url, init);
			if (!res.ok) rec.failed++;
			rec.ms.push(Date.now() - t0);
			return res;
		} catch (err) {
			rec.failed++;
			throw err;
		}
	};
	return calls;
}

async function main() {
	const { values } = parseArgs({
		options: {
			'report-only': { type: 'boolean', default: false },
			docs: { type: 'string' },
			conditions: { type: 'string' },
			date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
		},
	});
	const resultsPath = join(RUNS_DIR, `results-${values.date}.json`);
	if (values['report-only']) {
		console.log(`[pdf-eval] report: ${writeReport(JSON.parse(readFileSync(resultsPath, 'utf8')))}`);
		return;
	}
	if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is required (layout models, embedder, reranker and answer model).');

	const set = JSON.parse(readFileSync(join(SET_DIR, 'set.json'), 'utf8'));
	const byId = Object.fromEntries(set.documents.map((d) => [d.id, d]));
	const wantDocs = values.docs ? new Set(values.docs.split(',')) : null;
	const documents = set.documents.filter((d) => !wantDocs || wantDocs.has(d.id));
	const conditions = (values.conditions ? values.conditions.split(',') : CONDITIONS).filter((c) => CONDITIONS.includes(c));
	const haveMarkitdown = markitdownAvailable();
	if (!haveMarkitdown) console.warn(`[pdf-eval] MarkItDown not found at ${MARKITDOWN_BIN}: the markitdown condition is not run`);

	const questions = [
		...set.questions,
		...set.questions.filter((q) => q.doc === set.scanQuestionsFrom).map((q) => ({ ...q, doc: `${q.doc}-scan`, scanned: true })),
	].filter((q) => documents.some((d) => d.id === q.doc));

	const modelCalls = countModelCalls();
	const extraction = {};
	const rows = [];
	for (const d of documents) {
		const bytes = await loadDocument(d, byId);
		extraction[d.id] = {};
		for (const condition of conditions) {
			if (condition === 'markitdown' && !haveMarkitdown) continue;
			modelCalls.__extracting = condition === 'nemotron';
			const { chunks, stats } = await extract(condition, d, bytes, modelCalls);
			modelCalls.__extracting = false;
			extraction[d.id][condition] = stats;
			console.log(`[pdf-eval] ${d.id} ${condition}: ${chunks.length} chunks`);
			const indexed = chunks.length ? await embedChunks(chunks) : [];
			for (const q of questions.filter((x) => x.doc === d.id)) {
				const results = indexed.length ? await retrieve(indexed, d.name, q.q) : [];
				const context = results.map((r) => r.content).join('\n');
				const reply = await answer(results, q.q);
				const pass = grade(q, reply);
				rows.push({
					...q,
					scanned: !!q.scanned,
					condition,
					reply,
					pass,
					context_has_value: contextHasValue(q, context),
					retrieved: results.map((r) => ({ heading: r.heading || null, locator: r.locator || null, score: Math.round(r.score * 1000) / 1000 })),
				});
				console.log(`[pdf-eval]   ${pass ? 'pass' : 'FAIL'} ${condition} ${q.q} -> ${reply.slice(0, 60)}`);
			}
		}
	}

	// A partial run (--docs / --conditions) replaces only the pairs it ran and
	// keeps every other row and extraction record from the same day's results.
	if ((wantDocs || values.conditions) && existsSync(resultsPath)) {
		const prev = JSON.parse(readFileSync(resultsPath, 'utf8'));
		const ran = (doc, condition) => documents.some((d) => d.id === doc) && conditions.includes(condition);
		rows.unshift(...prev.rows.filter((r) => !ran(r.doc, r.condition)));
		for (const [doc, byCondition] of Object.entries(prev.extraction || {})) {
			for (const [condition, stats] of Object.entries(byCondition)) {
				if (!ran(doc, condition)) (extraction[doc] ||= {})[condition] = stats;
			}
		}
		for (const d of prev.documents || []) if (!documents.some((x) => x.id === d.id)) documents.push(d);
		questions.splice(0, questions.length, ...new Map([...prev.rows, ...rows].map((r) => [`${r.doc}|${r.q}`, r])).values());
		const order = set.documents.map((d) => d.id);
		documents.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
		rows.sort((a, b) => order.indexOf(a.doc) - order.indexOf(b.doc) || questions.findIndex((q) => q.doc === a.doc && q.q === a.q) - questions.findIndex((q) => q.doc === b.doc && q.q === b.q));
	}

	const results = {
		meta: {
			date: values.date,
			answer_model: ANSWER_MODEL,
			embedder: defaultIngestEmbedderTag(),
			reranker: rerankConfigured() ? rerankModel() : null,
			questions: questions.length,
			pages: documents.reduce((s, d) => s + d.pages, 0),
			model_calls: mergeCalls(extraction),
		},
		documents,
		extraction,
		rows,
	};
	mkdirSync(RUNS_DIR, { recursive: true });
	writeFileSync(resultsPath, `${JSON.stringify(results, null, '\t')}\n`);
	console.log(`[pdf-eval] results: ${resultsPath}`);
	console.log(`[pdf-eval] report: ${writeReport(results)}`);
	for (const c of [...new Set(rows.map((r) => r.condition))]) {
		const t = tally(rows.filter((r) => r.condition === c));
		console.log(`[pdf-eval] ${c}: ${t.pass}/${t.n} (${pct(t.pass, t.n)})`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error('[pdf-eval]', err?.stack || err);
		process.exit(1);
	});
}
