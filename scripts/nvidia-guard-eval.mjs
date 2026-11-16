#!/usr/bin/env node
// Agent chat guardrail eval: how well does each guard catch what it should,
// how often does it stop an ordinary visitor, and how long does it take?
//
// Every check runs through the production code in api/_lib/chat-guardrails.js
// (and api/_lib/granite-guardian.js for the self-hosted Granite Guardian lane),
// so the numbers describe exactly what an agent with guardrails on would do.
//
// Public held-out sets, fetched from the Hugging Face datasets-server API:
//   Aegis 2.0 test split (nvidia/Aegis-AI-Content-Safety-Dataset-2.0)
//     prompts labelled safe / unsafe, and prompt+response pairs labelled by
//     response safety (the output check)
//   jailbreak-classification test split (jackhhao/jailbreak-classification)
//     jailbreak prompts vs benign prompts
//   XSTest (Paul/XSTest), the "safe" half: prompts that sound dangerous but
//     are fine ("how do I kill a Python process"), the classic false-positive
//     trap for an over-eager screen
//   Alpaca (tatsu-lab/alpaca): ordinary everyday requests
//   CantTalkAboutThis test split (nvidia/CantTalkAboutThis-Topic-Control-Dataset):
//     a business bot's topic instruction with on-topic user turns and
//     off-topic distractors (topic control)
//
// Results are cached per (check, item) under .cache/guard-eval/ so a rerun or
// a resumed run does not repeat calls. Only aggregate numbers are written to
// the report; no dataset text is copied into the repo.
//
// Usage:
//   NVIDIA_API_KEY=... GRANITE_GUARDIAN_URL=... GCP_RECONSTRUCTION_KEY=... \
//     node scripts/nvidia-guard-eval.mjs [--date 2026-11-16] [--fresh]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
	GUARD_MODELS,
	classifyContentSafety,
	classifyJailbreak,
	classifyTopic,
	guardKey,
} from '../api/_lib/chat-guardrails.js';
import { assessRisk, guardianConfig, FLAG_THRESHOLD } from '../api/_lib/granite-guardian.js';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE_DIR = join(ROOT, '.cache/guard-eval');
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DATE = argVal('--date', new Date().toISOString().slice(0, 10));
const FRESH = args.includes('--fresh');
const REPORT = join(ROOT, `docs/nvidia/evals/guardrails-${DATE}.md`);
const RESULTS = join(ROOT, `data/evals/guardrails/results-${DATE}.json`);

// Sample sizes. Each sample is the first N rows of the split meeting the
// filter, in dataset order, so the run is reproducible.
const N = { aegisPromptsPerLabel: 100, aegisResponsesPerLabel: 50, jailbreak: 262, xstestSafe: 250, alpaca: 100 };

const key = guardKey();
if (!key) {
	console.error('NVIDIA_API_KEY is required (node scripts/read-service-env.mjs \'^NVIDIA_API_KEY$\' --raw).');
	process.exit(2);
}
const granite = guardianConfig();

// ── Dataset fetch ────────────────────────────────────────────────────────────

const HF = 'https://datasets-server.huggingface.co/rows';

async function hfRows(dataset, config, split, { limit, filter = () => true }) {
	const cacheFile = join(CACHE_DIR, 'data', `${dataset.replace('/', '__')}__${config}__${split}.json`);
	let all = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
	if (!all) {
		all = [];
		for (let offset = 0; ; offset += 100) {
			const url = `${HF}?dataset=${encodeURIComponent(dataset)}&config=${config}&split=${split}&offset=${offset}&length=100`;
			let res;
			for (let attempt = 0; attempt < 5; attempt++) {
				res = await fetch(url);
				if (res.status !== 429 && res.status < 500) break;
				await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
			}
			if (!res.ok) throw new Error(`${dataset} ${split} @${offset}: HTTP ${res.status}`);
			const page = await res.json();
			all.push(...page.rows.map((r) => r.row));
			// Large splits: stop once there is comfortably enough to sample from.
			if (page.rows.length < 100 || offset + 100 >= page.num_rows_total || all.length >= 3000) break;
		}
		mkdirSync(join(CACHE_DIR, 'data'), { recursive: true });
		writeFileSync(cacheFile, JSON.stringify(all));
	}
	return all.filter(filter).slice(0, limit);
}

async function loadSets() {
	const aegisAll = await hfRows('nvidia/Aegis-AI-Content-Safety-Dataset-2.0', 'default', 'test', { limit: Infinity });
	const aegisPrompt = (label) =>
		aegisAll.filter((r) => r.prompt && r.prompt !== 'REDACTED' && r.prompt_label === label).slice(0, N.aegisPromptsPerLabel);
	const aegisResp = (label) =>
		aegisAll
			.filter((r) => r.prompt && r.prompt !== 'REDACTED' && r.response && r.response_label === label)
			.slice(0, N.aegisResponsesPerLabel);
	const jb = await hfRows('jackhhao/jailbreak-classification', 'default', 'test', { limit: N.jailbreak });
	const xs = await hfRows('Paul/XSTest', 'default', 'train', { limit: N.xstestSafe, filter: (r) => r.label === 'safe' });
	const alpaca = await hfRows('tatsu-lab/alpaca', 'default', 'train', {
		limit: N.alpaca,
		filter: (r) => r.instruction && !r.input,
	});
	const topicRows = await hfRows('nvidia/CantTalkAboutThis-Topic-Control-Dataset', 'mixtral', 'test', { limit: Infinity });

	const topic = [];
	for (const [i, row] of topicRows.entries()) {
		const conv = Array.isArray(row.conversation) ? row.conversation : [];
		const userTurns = conv.filter((t) => /user/i.test(t.role || t.from || '')).map((t) => t.content || t.value || '');
		for (const text of userTurns.filter(Boolean).slice(1, 4)) topic.push({ row: i, text, offTopic: false });
		const distractors = Array.isArray(row.distractors) ? row.distractors : [];
		for (const d of distractors) {
			const text = d.distractor || d.user_turn || '';
			if (text) topic.push({ row: i, text, offTopic: true });
		}
	}

	return {
		aegisPrompts: [...aegisPrompt('unsafe').map((r) => ({ text: r.prompt, positive: true })), ...aegisPrompt('safe').map((r) => ({ text: r.prompt, positive: false }))],
		aegisResponses: [
			...aegisResp('unsafe').map((r) => ({ user: r.prompt, assistant: r.response, positive: true })),
			...aegisResp('safe').map((r) => ({ user: r.prompt, assistant: r.response, positive: false })),
		],
		jailbreak: jb.map((r) => ({ text: r.prompt, positive: r.type === 'jailbreak' })),
		benign: [...xs.map((r) => ({ text: r.prompt, positive: false, src: 'xstest' })), ...alpaca.map((r) => ({ text: r.instruction, positive: false, src: 'alpaca' }))],
		topic,
		topicInstructions: topicRows.map((r) => r.system_instruction || ''),
	};
}

// ── Checks ───────────────────────────────────────────────────────────────────

function hash(...parts) {
	return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24);
}

function cacheGet(check, id) {
	const f = join(CACHE_DIR, 'results', check, `${id}.json`);
	if (FRESH || !existsSync(f)) return null;
	const hit = JSON.parse(readFileSync(f, 'utf8'));
	// A failed call is retried on the next run instead of being replayed.
	return hit.ok ? hit : null;
}

function cachePut(check, id, value) {
	const dir = join(CACHE_DIR, 'results', check);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${id}.json`), JSON.stringify(value));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A rate-limited call is retried with backoff (an eval artefact, not a guard
// failure); any other error is recorded as an error, which is what the
// production fail-open path would see.
async function withRetry(fn) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (err?.status === 429 && attempt < 6) {
				await sleep(1500 * 2 ** attempt);
				continue;
			}
			throw err;
		}
	}
}

const NIM_OPTS = { key, timeoutMs: 20_000 };

const CHECKS = {
	nv_jailbreak: {
		label: 'NemoGuard jailbreak detect',
		model: GUARD_MODELS.jailbreak,
		run: async (it) => {
			const r = await withRetry(() => classifyJailbreak(it.text, NIM_OPTS));
			return { flagged: r.flagged, score: r.score, latencyMs: r.latencyMs };
		},
	},
	nv_safety_input: {
		label: 'Nemotron Safety Guard 8B v3 (user turn)',
		model: GUARD_MODELS.contentSafety,
		run: async (it) => {
			const r = await withRetry(() => classifyContentSafety({ user: it.text }, NIM_OPTS));
			return { flagged: r.flagged, latencyMs: r.latencyMs };
		},
	},
	nv_safety_output: {
		label: 'Nemotron Safety Guard 8B v3 (reply)',
		model: GUARD_MODELS.contentSafety,
		run: async (it) => {
			const r = await withRetry(() => classifyContentSafety({ user: it.user, assistant: it.assistant }, NIM_OPTS));
			return { flagged: r.flagged, latencyMs: r.latencyMs };
		},
	},
	gg_jailbreak: {
		label: 'Granite Guardian 3.3 8B jailbreak (self-hosted)',
		model: 'ibm-granite/granite-guardian-3.3-8b',
		needs: () => granite.configured,
		run: async (it) => {
			const t = Date.now();
			const v = await assessRisk(granite, { risk: 'jailbreak', input: it.text });
			return { flagged: v.flagged && (v.probability ?? 1) >= FLAG_THRESHOLD, latencyMs: Date.now() - t };
		},
	},
	gg_harm: {
		label: 'Granite Guardian 3.3 8B harm (self-hosted)',
		model: 'ibm-granite/granite-guardian-3.3-8b',
		needs: () => granite.configured,
		run: async (it) => {
			const t = Date.now();
			const v = await assessRisk(granite, { risk: 'harm', input: it.text });
			return { flagged: v.flagged && (v.probability ?? 1) >= FLAG_THRESHOLD, latencyMs: Date.now() - t };
		},
	},
	topic_production: {
		label: 'Topic control, production path (NemoGuard topic-control, Nemotron 3.5 Lightning fallback)',
		model: `${GUARD_MODELS.topicControl} -> ${GUARD_MODELS.topicFallback}`,
		run: async (it) => {
			const r = await withRetry(() => classifyTopic({ user: it.text, allowed: it.allowed }, NIM_OPTS));
			return { flagged: r.flagged, latencyMs: r.latencyMs, model: r.model };
		},
	},
};

async function runCheck(checkId, items, concurrency) {
	const check = CHECKS[checkId];
	if (check.needs && !check.needs()) return { skipped: 'lane not configured', rows: [] };
	const rows = new Array(items.length);
	let next = 0;
	let done = 0;
	async function worker() {
		while (next < items.length) {
			const i = next++;
			const it = items[i];
			const id = hash(checkId, it.text ?? '', it.user ?? '', it.assistant ?? '', (it.allowed || []).join('|'));
			let r = cacheGet(checkId, id);
			if (!r) {
				try {
					r = { ok: true, ...(await check.run(it)) };
				} catch (err) {
					r = { ok: false, error: String(err?.message || err).slice(0, 200), status: err?.status ?? null };
				}
				cachePut(checkId, id, r);
			}
			rows[i] = { ...r, positive: it.positive, src: it.src };
			if (++done % 25 === 0) process.stderr.write(`  ${checkId}: ${done}/${items.length}\n`);
		}
	}
	await Promise.all(Array.from({ length: concurrency }, worker));
	return { rows };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

function pct(n, d) {
	return d ? (100 * n) / d : null;
}

function quantile(sorted, q) {
	if (!sorted.length) return null;
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function metrics(rows, flaggedOf = (r) => r.flagged) {
	const ok = rows.filter((r) => r.ok);
	const pos = ok.filter((r) => r.positive);
	const neg = ok.filter((r) => !r.positive);
	const tp = pos.filter(flaggedOf).length;
	const fp = neg.filter(flaggedOf).length;
	const lat = ok.map((r) => r.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
	return {
		n: rows.length,
		errors: rows.length - ok.length,
		errorRate: pct(rows.length - ok.length, rows.length),
		tpr: pct(tp, pos.length),
		fpr: pct(fp, neg.length),
		positives: pos.length,
		negatives: neg.length,
		p50: quantile(lat, 0.5),
		p95: quantile(lat, 0.95),
	};
}

/** Combine two checks over the same items: flagged if either flags. Errors count as not flagged (fail open). */
function either(a, b) {
	return a.map((r, i) => ({
		ok: true,
		positive: r.positive,
		flagged: Boolean((r.ok && r.flagged) || (b[i]?.ok && b[i].flagged)),
		latencyMs: Math.max(r.latencyMs ?? 0, b[i]?.latencyMs ?? 0),
	}));
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
	mkdirSync(CACHE_DIR, { recursive: true });
	console.error('loading datasets...');
	const sets = await loadSets();
	console.error(
		`sets: aegis prompts ${sets.aegisPrompts.length}, aegis responses ${sets.aegisResponses.length}, jailbreak ${sets.jailbreak.length}, benign ${sets.benign.length}, topic ${sets.topic.length}`,
	);

	const inputItems = [...sets.aegisPrompts.map((x) => ({ ...x, set: 'aegis' }))];
	const jbItems = sets.jailbreak;
	const benign = sets.benign;
	const topicItems = sets.topic.map((t) => ({
		text: t.text,
		positive: t.offTopic,
		// The topic list an owner would type, taken from the dataset's own bot
		// instruction for that conversation.
		allowed: [sets.topicInstructions[t.row].replace(/\s+/g, ' ').slice(0, 600)],
	}));

	const R = {};
	const run = async (name, checkId, items, conc) => {
		console.error(`running ${name} (${items.length})`);
		R[name] = await runCheck(checkId, items, conc);
	};

	await run('jb.nv_jailbreak', 'nv_jailbreak', jbItems, 6);
	await run('jb.gg_jailbreak', 'gg_jailbreak', jbItems, 4);
	await run('jb.nv_safety', 'nv_safety_input', jbItems, 6);
	await run('aegis.nv_safety', 'nv_safety_input', inputItems, 6);
	await run('aegis.gg_harm', 'gg_harm', inputItems, 4);
	await run('aegis.nv_jailbreak', 'nv_jailbreak', inputItems, 6);
	await run('resp.nv_safety', 'nv_safety_output', sets.aegisResponses, 6);
	await run('benign.nv_jailbreak', 'nv_jailbreak', benign, 6);
	await run('benign.nv_safety', 'nv_safety_input', benign, 6);
	await run('benign.gg_jailbreak', 'gg_jailbreak', benign, 4);
	await run('benign.gg_harm', 'gg_harm', benign, 4);
	await run('topic.production', 'topic_production', topicItems, 4);

	const M = {};
	for (const [k, v] of Object.entries(R)) M[k] = v.skipped ? { skipped: v.skipped } : metrics(v.rows);

	// Jailbreak threshold sweep for the NVIDIA detector's raw score.
	const sweep = [];
	const jbRows = R['jb.nv_jailbreak'].rows;
	const bnRows = R['benign.nv_jailbreak'].rows;
	for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
		const f = (r) => r.score != null && r.score > t;
		sweep.push({ threshold: t, tpr: metrics(jbRows, f).tpr, fpr: metrics(jbRows, f).fpr, benignFpr: metrics(bnRows, f).fpr });
	}

	// Combined jailbreak candidates.
	if (!R['jb.gg_jailbreak'].skipped) {
		M['jb.either'] = metrics(either(R['jb.nv_jailbreak'].rows, R['jb.gg_jailbreak'].rows));
		M['benign.either_jb'] = metrics(either(R['benign.nv_jailbreak'].rows, R['benign.gg_jailbreak'].rows));
	}
	M['jb.nv_or_safety'] = metrics(either(R['jb.nv_jailbreak'].rows, R['jb.nv_safety'].rows));
	M['benign.nv_jb_or_safety'] = metrics(either(R['benign.nv_jailbreak'].rows, R['benign.nv_safety'].rows));

	// The benign pool mixes XSTest (safe prompts built to look unsafe) with
	// ordinary Alpaca instructions; report each so the false-positive cost on
	// everyday traffic is visible apart from the adversarial set.
	for (const name of ['benign.nv_jailbreak', 'benign.nv_safety', 'benign.gg_jailbreak', 'benign.gg_harm']) {
		if (R[name].skipped) continue;
		for (const src of ['xstest', 'alpaca']) M[`${name}.${src}`] = metrics(R[name].rows.filter((r) => r.src === src));
	}

	// Which lane answered topic control.
	const topicModels = {};
	for (const r of R['topic.production'].rows.filter((x) => x.ok)) topicModels[r.model] = (topicModels[r.model] || 0) + 1;

	mkdirSync(join(ROOT, 'data/evals/guardrails'), { recursive: true });
	writeFileSync(
		RESULTS,
		`${JSON.stringify({ date: DATE, sizes: N, models: GUARD_MODELS, metrics: M, jailbreakSweep: sweep, topicModels }, null, '\t')}\n`,
	);
	console.error(`wrote ${RESULTS}`);
	console.log(JSON.stringify({ metrics: M, sweep, topicModels }, null, 2));
	console.error(`report target: ${REPORT}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
