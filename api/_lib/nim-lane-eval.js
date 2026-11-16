// @ts-check
// Lane evaluation for a new NVIDIA NIM release: run the lane's versioned eval
// set (data/evals/<lane>/vN.json) against the new model AND the model the lane
// runs first today, then turn the two runs into a verdict, a markdown report,
// the exact config diff that would make the new model the lane's first rung,
// and a post draft in the format docs/nvidia-visibility-map.md asks for.
//
// This module only READS production config. The diff is text handed to a
// human (the ops alert, the admin board, the committed report); nothing here
// writes a source file, an env var or a database row of the live lanes, and
// tests/nim-release-eval.test.js holds that line. Production config changes
// only when someone applies the diff and deploys it.
//
// Callers: api/cron/nim-release-eval.js (the queued job) and
// scripts/nvidia-lane-eval.mjs (the CLI, which also writes the committed
// reports under docs/nvidia/evals/).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTwoFilesPatch } from 'diff';
import { parseVerdict, publishSafetyConfig } from './publish-safety.js';
import { NVIDIA_PINNED_MODELS } from './llm.js';
import { NVIDIA_VISION_MODELS } from './vision.js';
import { NIM_EMBED_TAG, embedderInfo } from './embeddings.js';
import { rerankModel } from './rerank.js';
import {
	chatText, classifyNimModel, embeddingVector, evalImageDataUrl, imageTurn, rerankOrder,
} from './nim-lanes.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EVALS_DIR = path.join(REPO_ROOT, 'data', 'evals');
const CONCURRENCY = 4;

/**
 * @typedef {{
 *   label: string,
 *   file: string,
 *   floor: number,
 *   metric: string,
 *   incumbent: () => string,
 *   incumbentCall?: () => Record<string, any>,
 *   does: string,
 *   clip: string,
 * }} LaneSpec
 */

/**
 * The lanes a release can be evaluated for. `incumbent` reads the pin the lane
 * runs first today from the lane's own module, so the baseline is always the
 * live config, never a restated id. `file` is where the rung config lives and
 * is what the generated diff patches.
 * @type {Record<string, LaneSpec>}
 */
export const LANES = Object.freeze({
	chat: {
		label: 'Chat',
		file: 'api/_lib/llm.js',
		floor: 0.7,
		metric: 'accuracy',
		incumbent: () => NVIDIA_PINNED_MODELS[0],
		does: 'answers on the free NVIDIA rung of the three.ws chat chain behind agent chat and embedded widgets',
		clip: 'an agent page answering a question, with the network panel showing the NIM model id',
	},
	vision: {
		label: 'Vision',
		file: 'api/_lib/vision.js',
		floor: 0.7,
		metric: 'accuracy',
		incumbent: () => NVIDIA_VISION_MODELS[0].model,
		does: 'is how three.ws sees images: it screens Forge photo uploads, checks generated models and writes avatar alt text',
		clip: 'a Forge photo upload getting its pre-check verdict',
	},
	embeddings: {
		label: 'Embeddings',
		file: 'api/_lib/embeddings.js',
		floor: 0.7,
		metric: 'recall@1',
		incumbent: () => NIM_EMBED_TAG.split('@')[0],
		// Production asks a Matryoshka embedder for the tag's dimension; the
		// baseline is measured the same way.
		incumbentCall: () => (embedderInfo(NIM_EMBED_TAG)?.matryoshka ? { dimensions: embedderInfo(NIM_EMBED_TAG).dim } : {}),
		does: 'now embeds agent memory and knowledge-widget retrieval on three.ws',
		clip: 'a knowledge widget answering from an uploaded document',
	},
	rerank: {
		label: 'Rerank',
		file: 'api/_lib/rerank.js',
		floor: 0.7,
		metric: 'top-1 accuracy',
		incumbent: () => rerankModel(),
		does: 'now ranks the passages three.ws knowledge widgets answer from',
		clip: 'a knowledge widget answer with its cited passage highlighted',
	},
	safety: {
		label: 'Safety',
		file: 'api/_lib/publish-safety.js',
		floor: 0.8,
		metric: 'verdict accuracy',
		incumbent: () => publishSafetyConfig({}).model,
		does: 'now screens what three.ws publishes outward before it leaves the platform',
		clip: 'the showcase publisher skipping a flagged prompt in the ops log',
	},
});

// ---------------------------------------------------------------------------
// Eval sets

/**
 * The newest version of a lane's eval set: data/evals/<lane>/v<N>.json.
 * @param {string} lane
 * @param {{ dir?: string }} [opts]
 */
export async function loadEvalSet(lane, { dir = EVALS_DIR } = {}) {
	const laneDir = path.join(dir, lane);
	const files = (await readdir(laneDir)).filter((f) => /^v\d+\.json$/.test(f));
	if (!files.length) throw new Error(`no eval set in ${path.relative(REPO_ROOT, laneDir)}`);
	const newest = files.sort((a, b) => Number(b.slice(1, -5)) - Number(a.slice(1, -5)))[0];
	const set = JSON.parse(await readFile(path.join(laneDir, newest), 'utf8'));
	return { ...set, path: path.relative(REPO_ROOT, path.join(laneDir, newest)) };
}

// ---------------------------------------------------------------------------
// Grading

/** Lowercase, trim, drop wrapping quotes/backticks/markdown emphasis and trailing punctuation. */
export function normalizeAnswer(s) {
	return String(s ?? '')
		.replace(/\*\*|__/g, '')
		.trim()
		.replace(/^["'`]+|["'`]+$/g, '')
		.replace(/[.!?;:,]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

const wordCount = (s) => normalizeAnswer(s).split(' ').filter(Boolean).length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parse JSON from a reply, tolerating code fences and surrounding prose. */
export function extractJson(text) {
	const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
	try { return JSON.parse(raw); } catch { /* fall through to the first balanced span */ }
	const m = raw.match(/[[{][\s\S]*[\]}]/);
	if (!m) return undefined;
	try { return JSON.parse(m[0]); } catch { return undefined; }
}

function looseEqual(a, b) {
	if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Quality: is the answer right? Lenient on formatting (a short sentence that
 * contains the exact answer as a whole word still counts); the format check
 * below is where the output contract is held strictly.
 * @param {any} expect
 * @param {string} text
 */
export function gradeExpect(expect, text) {
	const norm = normalizeAnswer(text);
	const shortHit = (v) => {
		const nv = normalizeAnswer(v);
		return norm === nv || (wordCount(text) <= 6 && new RegExp(`(^|[^a-z0-9])${escapeRe(nv)}([^a-z0-9]|$)`).test(norm));
	};
	switch (expect?.type) {
		case 'equals': return shortHit(expect.value);
		case 'equalsAny': return expect.values.some(shortHit);
		case 'containsAny': return expect.values.some((v) => norm.includes(String(v).toLowerCase()));
		case 'containsAll': return expect.values.every((v) => norm.includes(String(v).toLowerCase()));
		case 'json': {
			const j = extractJson(text);
			return !!j && typeof j === 'object' && !Array.isArray(j) && Object.entries(expect.keys).every(([k, v]) => looseEqual(j[k], v));
		}
		case 'jsonArray': {
			const j = extractJson(text);
			return Array.isArray(j) && looseEqual(j, expect.value);
		}
		default: throw new Error(`unknown expect type: ${expect?.type}`);
	}
}

/**
 * Format adherence: did the reply obey the stated output contract exactly?
 * Items without a contract count as adherent.
 * @param {any} format
 * @param {string} text
 */
export function gradeFormat(format, text) {
	if (!format) return true;
	const raw = String(text ?? '').trim();
	switch (format.type) {
		case 'maxWords': return raw.length > 0 && wordCount(raw) <= format.n;
		case 'lines': return raw.split('\n').map((l) => l.trim()).filter(Boolean).length === format.n;
		case 'regex': return new RegExp(format.pattern).test(raw);
		case 'json': try { JSON.parse(raw); return true; } catch { return false; }
		default: throw new Error(`unknown format type: ${format.type}`);
	}
}

// ---------------------------------------------------------------------------
// Running a set

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

/** Nearest-rank percentile of a list of numbers, or null when empty. */
export function percentile(values, p) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

const round3 = (n) => (n == null ? null : Math.round(n * 1000) / 1000);

/**
 * Collapse per-item results into the lane metrics.
 * @param {Array<{ ok: boolean, pass: boolean, format: boolean, ms: number }>} items
 * @param {Array<{ ok: boolean, ms: number }>} calls every upstream call made
 */
function summarize(items, calls) {
	const okMs = calls.filter((c) => c.ok).map((c) => c.ms);
	const answered = items.filter((i) => i.ok);
	return {
		items: items.length,
		calls: calls.length,
		errors: calls.filter((c) => !c.ok).length,
		errorRate: round3(calls.length ? calls.filter((c) => !c.ok).length / calls.length : 1),
		quality: round3(items.length ? items.filter((i) => i.pass).length / items.length : 0),
		formatAdherence: round3(answered.length ? answered.filter((i) => i.format).length / answered.length : 0),
		latencyMs: { p50: percentile(okMs, 50), p95: percentile(okMs, 95) },
	};
}

const clip = (s, n = 160) => (s == null ? null : String(s).slice(0, n));

/** @param {import('./nim-lanes.js').NimClient} client */
async function runChatLike(set, model, client, buildTurn) {
	const calls = [];
	const items = await mapLimit(set.items, CONCURRENCY, async (item) => {
		const call = await client.chat(model, await buildTurn(item), { maxTokens: 256 });
		calls.push(call);
		const text = call.ok ? chatText(call.body) : '';
		return {
			id: item.id, ok: call.ok, ms: call.ms,
			pass: call.ok && gradeExpect(item.expect, text),
			format: call.ok && gradeFormat(item.format, text),
			output: clip(call.ok ? text : null), error: call.error,
		};
	});
	return { ...summarize(items, calls), results: items };
}

/** @param {import('./nim-lanes.js').NimClient} client */
async function runSafety(set, model, client) {
	const calls = [];
	const items = await mapLimit(set.items, CONCURRENCY, async (item) => {
		const call = await client.chat(model, [{ role: 'user', content: item.text }], { maxTokens: 64 });
		calls.push(call);
		const text = call.ok ? chatText(call.body) : '';
		const v = parseVerdict(text);
		return {
			id: item.id, ok: call.ok, ms: call.ms,
			pass: call.ok && v.parsed && v.unsafe === item.unsafe,
			format: call.ok && v.parsed,
			output: clip(call.ok ? text : null), error: call.error,
		};
	});
	return { ...summarize(items, calls), results: items };
}

function cosine(a, b) {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
	return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** @param {import('./nim-lanes.js').NimClient} client */
async function runEmbeddings(set, model, client, callOpts = {}) {
	const calls = [];
	const embedOne = async (text, type) => {
		const call = await client.embed(model, [text], type, callOpts);
		calls.push(call);
		return call.ok ? embeddingVector(call.body) : null;
	};
	const passageVecs = await mapLimit(set.passages, CONCURRENCY, (p) => embedOne(p.text, 'passage'));
	const dims = new Set(passageVecs.filter(Boolean).map((v) => v.length));
	const dim = dims.size === 1 ? [...dims][0] : null;
	let reciprocal = 0;
	const items = await mapLimit(set.items, CONCURRENCY, async (item) => {
		const t0 = Date.now();
		const q = await embedOne(item.query, 'query');
		const ms = Date.now() - t0;
		if (!q) return { id: item.id, ok: false, ms, pass: false, format: false, output: null, error: calls[calls.length - 1]?.error || 'no vector' };
		const ranked = set.passages
			.map((p, i) => ({ id: p.id, score: passageVecs[i] && passageVecs[i].length === q.length ? cosine(q, passageVecs[i]) : -Infinity }))
			.sort((a, b) => b.score - a.score);
		const rank = ranked.findIndex((r) => r.id === item.relevant) + 1;
		if (rank > 0) reciprocal += 1 / rank;
		return {
			id: item.id, ok: true, ms, pass: rank === 1,
			format: dim != null && q.length === dim,
			output: `rank ${rank || 'none'} (top: ${ranked[0].id})`, error: null,
		};
	});
	return { ...summarize(items, calls), results: items, mrr: round3(reciprocal / set.items.length), dim };
}

/** @param {import('./nim-lanes.js').NimClient} client */
async function runRerank(set, model, client) {
	const calls = [];
	const items = await mapLimit(set.items, CONCURRENCY, async (item) => {
		const call = await client.rerank(model, item.query, item.passages);
		calls.push(call);
		const order = call.ok ? rerankOrder(call.body, item.passages.length) : null;
		return {
			id: item.id, ok: call.ok, ms: call.ms,
			pass: !!order && order[0] === item.relevant,
			format: !!order,
			output: order ? `order ${order.join(',')}` : null, error: call.error,
		};
	});
	return { ...summarize(items, calls), results: items };
}

/**
 * Run one lane's eval set against one model.
 * @param {{ lane: string, model: string, client: import('./nim-lanes.js').NimClient, set: any, callOpts?: Record<string, any> }} opts
 */
export async function runLaneEval({ lane, model, client, set, callOpts = {} }) {
	const started = Date.now();
	let result;
	switch (lane) {
		case 'chat':
			result = await runChatLike(set, model, client, (item) => [{ role: 'user', content: item.prompt }]);
			break;
		case 'vision':
			result = await runChatLike(set, model, client, async (item) => imageTurn(item.question, await evalImageDataUrl(item, set.size || 384)));
			break;
		case 'embeddings': result = await runEmbeddings(set, model, client, callOpts); break;
		case 'rerank': result = await runRerank(set, model, client); break;
		case 'safety': result = await runSafety(set, model, client); break;
		default: throw new Error(`no eval runner for lane ${lane}`);
	}
	return { model, ...(Object.keys(callOpts).length ? { callOpts } : {}), wallMs: Date.now() - started, ...result };
}

// ---------------------------------------------------------------------------
// Verdict

/**
 * adopt: wire it as the lane's first rung. hold: works, but not clearly better
 * than what runs today. reject: unreliable, off-contract, or worse.
 * When the incumbent itself is down (half its calls fail) the comparison is
 * moot: the candidate only has to clear the lane's floor.
 * @param {{ lane: string, candidate: any, incumbent: any|null }} opts
 * @returns {{ verdict: 'adopt'|'hold'|'reject', reasons: string[] }}
 */
export function decideVerdict({ lane, candidate, incumbent }) {
	const spec = LANES[lane];
	const pct = (n) => `${Math.round((n ?? 0) * 100)}%`;
	const reasons = [];
	if (candidate.errorRate > 0.2) return { verdict: 'reject', reasons: [`${pct(candidate.errorRate)} of calls to the candidate failed (limit 20%)`] };
	if (candidate.formatAdherence < 0.8) return { verdict: 'reject', reasons: [`format adherence ${pct(candidate.formatAdherence)} is under 80%`] };
	if (candidate.quality < spec.floor) return { verdict: 'reject', reasons: [`${spec.metric} ${pct(candidate.quality)} is under the lane floor of ${pct(spec.floor)}`] };

	if (!incumbent || incumbent.errorRate >= 0.5) {
		reasons.push(incumbent
			? `the model the lane runs first today failed ${pct(incumbent.errorRate)} of calls, so the lane is effectively down on NIM`
			: 'the lane has no NIM incumbent to compare against');
		reasons.push(`candidate clears the floor: ${spec.metric} ${pct(candidate.quality)}`);
		return { verdict: 'adopt', reasons };
	}

	const delta = candidate.quality - incumbent.quality;
	const cP50 = candidate.latencyMs.p50 ?? Infinity;
	const iP50 = incumbent.latencyMs.p50 ?? Infinity;
	reasons.push(`${spec.metric} ${pct(candidate.quality)} vs ${pct(incumbent.quality)} today (${delta >= 0 ? '+' : ''}${Math.round(delta * 100)} pts)`);
	reasons.push(`p50 ${cP50} ms vs ${iP50} ms`);
	if (delta >= 0.05) return { verdict: 'adopt', reasons };
	if (delta >= -0.02 && cP50 <= iP50 * 1.25) return { verdict: 'adopt', reasons: [...reasons, 'quality holds and latency is within 25%'] };
	if (delta >= -0.05) return { verdict: 'hold', reasons: [...reasons, 'comparable, not clearly better than what runs today'] };
	return { verdict: 'reject', reasons: [...reasons, 'worse than what runs today'] };
}

// ---------------------------------------------------------------------------
// Config diff (text only; never applied here)

/**
 * Replace the single match of `re` in `src`, or throw naming the anchor, so a
 * refactor of the target file yields a loud "apply by hand" instead of a
 * wrong diff.
 */
function replaceOnce(src, re, replacement, anchor) {
	const matches = src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
	if (!matches || matches.length !== 1) throw new Error(`anchor "${anchor}" ${matches ? 'is ambiguous' : 'not found'}`);
	return src.replace(re, replacement);
}

const LANE_PATCHERS = {
	/**
	 * The first NIM chat rung: whichever constant leads NVIDIA_PINNED_MODELS
	 * (the array the free chain and the lane probes treat as the default), so
	 * the patch follows a re-pin instead of hardcoding a constant name.
	 */
	chat: (src, { model }) => {
		const lead = src.match(/^export const NVIDIA_PINNED_MODELS = Object\.freeze\(\[\s*([A-Z_][A-Z0-9_]*)/m);
		if (!lead) throw new Error('anchor "export const NVIDIA_PINNED_MODELS" not found');
		const name = lead[1];
		return replaceOnce(src, new RegExp(`^((?:export )?const ${name} = )'[^']*';$`, 'm'), `$1'${model}';`, `const ${name}`);
	},
	/** New first NIM vision rung; the current one stays behind it. */
	vision: (src, { model }) => replaceOnce(
		src,
		/^export const NVIDIA_VISION_MODELS = \[\n/m,
		`export const NVIDIA_VISION_MODELS = [\n\t{ model: '${model}', extraBody: { chat_template_kwargs: { enable_thinking: false } } },\n`,
		'export const NVIDIA_VISION_MODELS = [',
	),
	/**
	 * New default embedder tag. The previous tag stays resolvable AND stays an
	 * ingest rung right behind the new one, because rows already written in its
	 * space must keep reading back (the module's model@dim tagging contract).
	 */
	embeddings: (src, { model, dim }) => {
		if (!dim) throw new Error('embedding dimension was not measured');
		// One re-pin at a time: while NIM_EMBED_TAG_PREVIOUS exists, rows in that
		// space are still being re-embedded, and a second re-pin would strand them.
		if (/^export const NIM_EMBED_TAG_PREVIOUS = /m.test(src)) {
			throw new Error('a previous re-pin is still in flight (NIM_EMBED_TAG_PREVIOUS is set); finish its re-embed and retire that tag first');
		}
		const tagLine = src.match(/^export const NIM_EMBED_TAG = '([^']*)';$/m);
		if (!tagLine) throw new Error('anchor "export const NIM_EMBED_TAG" not found');
		const prevTag = tagLine[1];
		const [prevModel, prevDim] = prevTag.split('@');
		let out = replaceOnce(src, /^export const NIM_EMBED_TAG = '[^']*';$/m,
			`export const NIM_EMBED_TAG = '${model}@${dim}';\n// The embedder this tag replaced: rows written before the re-pin carry it,\n// so it stays resolvable and stays the ingest rung behind the new one.\nexport const NIM_EMBED_TAG_PREVIOUS = '${prevTag}';`,
			'export const NIM_EMBED_TAG');
		out = replaceOnce(out,
			/(\t\[NIM_EMBED_TAG\]: Object\.freeze\(\{\n\t\ttag: NIM_EMBED_TAG,\n\t\tprovider: 'nim',\n)\t\tmodel: '[^']*',\n\t\tdim: \d+,\n([\s\S]*?\n\t\}\),\n)/,
			`$1\t\tmodel: '${model}',\n\t\tdim: ${dim},\n$2\t[NIM_EMBED_TAG_PREVIOUS]: Object.freeze({\n\t\ttag: NIM_EMBED_TAG_PREVIOUS,\n\t\tprovider: 'nim',\n\t\tmodel: '${prevModel}',\n\t\tdim: ${prevDim},\n\t\tfree: true,\n\t\tconfigured: () => !!process.env.NVIDIA_API_KEY,\n\t}),\n`,
			'[NIM_EMBED_TAG]: Object.freeze({');
		return replaceOnce(out, /\[NIM_EMBED_TAG, VERTEX_EMBED_TAG/, '[NIM_EMBED_TAG, NIM_EMBED_TAG_PREVIOUS, VERTEX_EMBED_TAG', 'INGEST_PREFERENCE');
	},
	/** The rerank pin; KNOWLEDGE_RERANK_MODEL still overrides it per deploy. */
	rerank: (src, { model }) => replaceOnce(src, /^export const DEFAULT_RERANK_MODEL = '[^']*';$/m, `export const DEFAULT_RERANK_MODEL = '${model}';`, 'export const DEFAULT_RERANK_MODEL'),
	/** The publish-safety default; PUBLISH_SAFETY_MODEL still overrides it per deploy. */
	safety: (src, { model }) => replaceOnce(src, /^const DEFAULT_MODEL = '[^']*';$/m, `const DEFAULT_MODEL = '${model}';`, 'const DEFAULT_MODEL'),
};

/**
 * The unified diff that would make `model` the lane's first rung, computed
 * against the file as it is on disk right now. Returns the patch text; never
 * writes anything.
 * @param {{ lane: string, model: string, dim?: number|null, read?: (p: string) => Promise<string> }} opts
 * @returns {Promise<{ file: string, patch: string|null, note: string|null }>}
 */
export async function buildConfigDiff({ lane, model, dim = null, read = (p) => readFile(path.join(REPO_ROOT, p), 'utf8') }) {
	const spec = LANES[lane];
	const src = await read(spec.file);
	if (spec.incumbent() === model) {
		return { file: spec.file, patch: null, note: `${model} is already the first ${lane} rung in ${spec.file}; nothing to apply.` };
	}
	try {
		const next = LANE_PATCHERS[lane](src, { model, dim });
		const note = src.includes(`'${model}'`) ? `${model} already appears further down ${spec.file}; this diff promotes it to the first rung.` : null;
		return { file: spec.file, patch: createTwoFilesPatch(`a/${spec.file}`, `b/${spec.file}`, src, next, '', '', { context: 3 }), note };
	} catch (err) {
		return { file: spec.file, patch: null, note: `Could not build the diff automatically (${/** @type {Error} */ (err).message}); wire ${model} by hand in ${spec.file}.` };
	}
}

// ---------------------------------------------------------------------------
// Post draft and report

const shortName = (id) => id.split('/').pop();
const pctText = (n) => `${Math.round((n ?? 0) * 100)}%`;

/**
 * Post draft in the visibility map's Day-0 format: what the model now does on
 * three.ws, one measured number, the clip to record, and the tags from its
 * tagging table (Nemotron/NIM content -> @NVIDIAAI, @NVIDIAAIDev).
 * Technical copy only.
 */
export function buildPostDraft({ modelId, ownedBy, lane, candidate, incumbent, setSize, day0 = true }) {
	const spec = LANES[lane];
	const isNvidia = (ownedBy || modelId.split('/')[0]) === 'nvidia';
	const name = isNvidia ? `NVIDIA ${shortName(modelId)}` : `${shortName(modelId)} on NVIDIA NIM`;
	const versus = incumbent && incumbent.errorRate < 0.5
		? ` vs ${pctText(incumbent.quality)} for ${shortName(incumbent.model)}, which ran first until now`
		: '';
	const lines = [
		`${day0 ? 'Live on three.ws the day it shipped' : 'Now live on three.ws'}: ${name} ${spec.does}.`,
		'',
		`${pctText(candidate.quality)} ${spec.metric} on our ${setSize}-task ${spec.label.toLowerCase()} eval${versus}, p50 ${candidate.latencyMs.p50} ms on the free NIM endpoint.`,
		'',
		`[10 to 15 second clip: ${spec.clip}]`,
		'',
		'@NVIDIAAI @NVIDIAAIDev #NVIDIAInception',
	];
	return lines.join('\n');
}

const oneLine = (v) => String(v).replace(/\s+/g, ' ').trim();

function metricsRow(label, r) {
	if (!r) return `| ${label} | n/a | n/a | n/a | n/a | n/a | n/a |`;
	return `| ${label} | \`${r.model}\` | ${pctText(r.quality)} | ${pctText(r.formatAdherence)} | ${pctText(r.errorRate)} | ${r.latencyMs.p50 ?? 'n/a'} / ${r.latencyMs.p95 ?? 'n/a'} | ${r.calls} |`;
}

/** Markdown report for one evaluated release. */
export function renderReportMarkdown(report) {
	const { modelId, classification: c, lane, verdict, reasons, candidate, incumbent, set, diff, postDraft, evaluatedAt } = report;
	const out = [
		`# NIM release eval: \`${modelId}\``,
		'',
		`Evaluated ${evaluatedAt} by the day-0 lane eval (api/_lib/nim-lane-eval.js, run by api/cron/nim-release-eval.js or scripts/nvidia-lane-eval.mjs). Production config was not changed; any diff below is a proposal.`,
		'',
		`**Verdict: ${verdict ? verdict.toUpperCase() : 'NOT EVALUATED'}**${lane ? ` for the ${LANES[lane].label.toLowerCase()} lane` : ''}`,
		'',
		...(reasons || []).map((r) => `- ${r}`),
		'',
		'## Classification',
		'',
		`- Lane: ${lane || 'none'} (${c.availability}); owner \`${c.ownedBy || 'unknown'}\``,
		`- How: ${c.reason}`,
		...Object.entries(c.probes).map(([k, p]) => `- Probe ${k}: ${p.ok ? 'ok' : 'failed'} HTTP ${p.status || 'ERR'} in ${p.ms} ms${p.sample ? `, "${oneLine(p.sample)}"` : ''}${p.error ? `, ${oneLine(p.error)}` : ''}`),
	];
	if (candidate) {
		out.push(
			'',
			'## Results',
			'',
			`Eval set: \`${set.path}\` (v${set.version}, ${set.items.length} items, ${set.licence}). Metric: ${LANES[lane].metric}.`,
			'',
			'| | Model | Quality | Format | Errors | p50 / p95 ms | Calls |',
			'|---|---|---|---|---|---|---|',
			metricsRow('Candidate', candidate),
			metricsRow('Today', incumbent),
		);
		if (incumbent?.callOpts) out.push('', `Today's model was called the way production calls it: ${JSON.stringify(incumbent.callOpts)}.`);
		if (candidate.mrr != null) out.push('', `MRR: candidate ${candidate.mrr}${incumbent?.mrr != null ? `, today ${incumbent.mrr}` : ''}. Dimension: candidate ${candidate.dim ?? 'n/a'}${incumbent?.dim ? `, today ${incumbent.dim}` : ''}.`);
		out.push('', '### Per item', '', '| Item | Candidate | Today |', '|---|---|---|');
		const byId = new Map((incumbent?.results || []).map((r) => [r.id, r]));
		const cell = (r) => (!r ? 'n/a' : !r.ok ? `error: ${String(r.error || '').replace(/\|/g, '/').slice(0, 60)}` : `${r.pass ? 'pass' : 'fail'}${r.format ? '' : ' (format)'}: ${String(r.output ?? '').replace(/\n/g, ' ').replace(/\|/g, '/').slice(0, 60)}`);
		for (const r of candidate.results) out.push(`| ${r.id} | ${cell(r)} | ${cell(byId.get(r.id))} |`);
	}
	if (diff) {
		out.push('', '## Config diff to apply', '', `Target: \`${diff.file}\`. Apply with \`git apply\`, run the lane's tests, deploy (owner gate), then verify on production before posting.`, '');
		out.push(diff.patch ? ['```diff', diff.patch.trimEnd(), '```'].join('\n') : `_${diff.note}_`);
	}
	if (postDraft) out.push('', '## Post draft', '', 'Post only after the diff is deployed and verified on production (owner approves and posts).', '', '```text', postDraft, '```');
	return `${out.join('\n')}\n`;
}

/**
 * Classify a release, evaluate it against the lane's incumbent, and assemble
 * the full proposal. Pure with respect to production: reads config, writes
 * nothing.
 * @param {{ modelId: string, ownedBy?: string|null, client: import('./nim-lanes.js').NimClient, lane?: string|null, day0?: boolean }} opts
 */
export async function evaluateRelease({ modelId, ownedBy = null, client, lane: forcedLane = null, day0 = true }) {
	const evaluatedAt = new Date().toISOString();
	const classification = await classifyNimModel({ id: modelId, ownedBy, client });
	const lane = forcedLane || classification.lane;
	if (!lane) {
		const report = { modelId, classification, lane: null, verdict: null, reasons: [classification.reason], candidate: null, incumbent: null, set: null, diff: null, postDraft: null, evaluatedAt };
		return { ...report, markdown: renderReportMarkdown(report) };
	}
	if (!LANES[lane]) throw new Error(`unknown lane ${lane}`);
	const set = await loadEvalSet(lane);
	const incumbentId = LANES[lane].incumbent();
	const incumbentCall = LANES[lane].incumbentCall?.() || {};
	// A baseline of the live rung is measured with production's call shape.
	const candidate = await runLaneEval({ lane, model: modelId, client, set, callOpts: incumbentId === modelId ? incumbentCall : {} });
	const incumbent = incumbentId && incumbentId !== modelId ? await runLaneEval({ lane, model: incumbentId, client, set, callOpts: incumbentCall }) : null;
	const decided = decideVerdict({ lane, candidate, incumbent });
	const { verdict } = decided;
	// Re-evaluating the model the lane already runs first is a production
	// baseline: it is scored against the lane floor, and a reject means the
	// live lane itself misses the bar.
	const reasons = incumbentId === modelId
		? [`${modelId} is already the first ${lane} rung, so this run is a baseline of production scored against the lane floor`, ...decided.reasons.filter((r) => !r.startsWith('the lane has no NIM incumbent'))]
		: decided.reasons;
	const diff = verdict === 'reject' ? null : await buildConfigDiff({ lane, model: modelId, dim: candidate.dim ?? classification.dim ?? null });
	const postDraft = verdict === 'reject' ? null : buildPostDraft({ modelId, ownedBy: classification.ownedBy, lane, candidate, incumbent, setSize: set.items.length, day0 });
	const report = {
		modelId, classification, lane, verdict, reasons, candidate, incumbent,
		set: { path: set.path, version: set.version, licence: set.licence, items: set.items, sources: set.sources },
		diff, postDraft, evaluatedAt,
	};
	return { ...report, markdown: renderReportMarkdown(report) };
}
