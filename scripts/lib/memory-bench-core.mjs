// Pure core of scripts/memory-bench.mjs: dataset normalization, retrieval,
// supersession, prompt rendering and score aggregation for the LoCoMo and
// LongMemEval long-term-memory benchmarks. No network and no model calls here,
// so every function is unit-tested (tests/memory-bench-core.test.js). The
// runner supplies the model.

import { supersede } from '../../packages/agent-memory/src/temporal.js';

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Parse the date strings both datasets use into epoch ms (UTC):
 *   LoCoMo        "1:56 pm on 8 May, 2023"
 *   LongMemEval   "2023/05/20 (Sat) 02:21"
 * Returns null for anything else rather than guessing.
 */
export function parseBenchDate(text) {
	const s = String(text || '').trim();
	let m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s*\([A-Za-z]+\))?(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
	if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
	m = /^(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/i.exec(s);
	if (m) {
		const month = MONTHS.indexOf(m[5].toLowerCase());
		if (month < 0) return null;
		let hour = +m[1] % 12;
		if (m[3].toLowerCase() === 'pm') hour += 12;
		return Date.UTC(+m[6], month, +m[4], hour, +m[2]);
	}
	return null;
}

export function formatDay(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}

// ── Dataset normalization ───────────────────────────────────────────────────

/**
 * LoCoMo: every dialogue turn becomes one memory stamped with its session date.
 * Category 5 (adversarial, no ground-truth answer) is excluded, as published
 * LoCoMo results conventionally do.
 */
export function normalizeLocomo(raw) {
	const cases = [];
	for (const conv of raw) {
		const c = conv.conversation;
		const memories = [];
		const sessionKeys = Object.keys(c)
			.filter((k) => /^session_\d+$/.test(k))
			.sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
		for (const key of sessionKeys) {
			const at = parseBenchDate(c[`${key}_date_time`]);
			c[key].forEach((turn, i) => {
				const text = [turn.text, turn.blip_caption ? `[shared a photo: ${turn.blip_caption}]` : ''].filter(Boolean).join(' ');
				memories.push({
					id: turn.dia_id || `${key}:${i}`,
					content: `${turn.speaker}: ${text}`,
					validFrom: at,
					validTo: null,
					sourceRef: `locomo:${conv.sample_id}:${turn.dia_id || `${key}:${i}`}`,
				});
			});
		}
		const lastAt = Math.max(0, ...memories.map((m) => m.validFrom || 0));
		conv.qa.forEach((qa, i) => {
			if (qa.category === 5 || qa.answer === undefined || qa.answer === null) return;
			cases.push({
				dataset: 'locomo',
				id: `${conv.sample_id}#${i}`,
				type: LOCOMO_CATEGORIES[qa.category] || `category-${qa.category}`,
				question: qa.question,
				answer: String(qa.answer),
				questionDate: lastAt,
				memories,
				poolKey: conv.sample_id,
			});
		});
	}
	return cases;
}

export const LOCOMO_CATEGORIES = { 1: 'multi-hop', 2: 'temporal', 3: 'open-domain', 4: 'single-hop' };

/**
 * LongMemEval: each haystack session turn pair becomes one memory stamped with
 * the session date. The question carries its own "today" (question_date).
 */
export function normalizeLongMemEval(raw) {
	return raw.map((q) => {
		const memories = [];
		q.haystack_sessions.forEach((session, si) => {
			const at = parseBenchDate(q.haystack_dates[si]);
			const sid = q.haystack_session_ids[si];
			for (let t = 0; t < session.length; t++) {
				const turn = session[t];
				if (turn.role !== 'user') continue;
				const reply = session[t + 1]?.role === 'assistant' ? session[t + 1].content : '';
				memories.push({
					id: `${sid}:${t}`,
					content: reply ? `user: ${turn.content}\nassistant: ${reply}` : `user: ${turn.content}`,
					validFrom: at,
					validTo: null,
					sourceRef: `longmemeval:${sid}:turn:${t}`,
				});
			}
		});
		return {
			dataset: 'longmemeval',
			id: q.question_id,
			type: q.question_type,
			abstention: String(q.question_id).endsWith('_abs'),
			question: q.question,
			answer: String(q.answer),
			questionDate: parseBenchDate(q.question_date),
			memories,
			poolKey: q.question_id,
		};
	});
}

/** Deterministic stratified subset: round-robin over question types, seeded shuffle within each. */
export function pickSubset(cases, n, seed = 7) {
	if (!n || n >= cases.length) return cases;
	let state = seed >>> 0 || 1;
	const rand = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
	const groups = new Map();
	for (const c of cases) {
		if (!groups.has(c.type)) groups.set(c.type, []);
		groups.get(c.type).push(c);
	}
	const lists = [...groups.keys()].sort().map((k) => {
		const list = groups.get(k).slice();
		for (let i = list.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[list[i], list[j]] = [list[j], list[i]];
		}
		return list;
	});
	const out = [];
	for (let round = 0; out.length < n; round++) {
		let took = false;
		for (const list of lists) {
			if (round < list.length && out.length < n) {
				out.push(list[round]);
				took = true;
			}
		}
		if (!took) break;
	}
	return out;
}

// ── Retrieval: BM25 over memories ───────────────────────────────────────────

const STOP = new Set('a an and are as at be but by for from had has have he her his i if in is it its me my of on or our she so that the their them they this to was we were what when where which who why will with you your do does did how about'.split(' '));

export function tokenize(text) {
	return String(text || '')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((t) => t.length > 1 && !STOP.has(t));
}

/** Build a BM25 index once per memory pool. */
export function buildIndex(memories, { k1 = 1.5, b = 0.75 } = {}) {
	const docs = memories.map((m) => {
		const terms = tokenize(m.content);
		const tf = new Map();
		for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
		return { m, tf, len: terms.length };
	});
	const df = new Map();
	for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
	const avg = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1) || 1;
	const N = docs.length;
	return {
		search(query, k) {
			const q = [...new Set(tokenize(query))];
			const scored = [];
			for (const d of docs) {
				let score = 0;
				for (const t of q) {
					const f = d.tf.get(t);
					if (!f) continue;
					const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
					score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg));
				}
				if (score > 0) scored.push({ m: d.m, score });
			}
			scored.sort((a, b2) => b2.score - a.score);
			return scored.slice(0, k).map((s) => s.m);
		},
	};
}

// ── Prompts ─────────────────────────────────────────────────────────────────

/** Baseline context: what recall returned before temporal validity existed. Relevance order, no dates. */
export function renderBaselineContext(hits) {
	return hits.map((m, i) => `[${i + 1}] ${m.content}`).join('\n\n');
}

/** Temporal context: oldest to newest, each fact with its validity interval and source. */
export function renderTemporalContext(facts) {
	return [...facts]
		.sort((a, b) => (a.validFrom || 0) - (b.validFrom || 0))
		.map((f) => {
			const until = f.validTo == null ? 'current' : `superseded ${formatDay(f.validTo)}`;
			return `[${formatDay(f.validFrom)} -> ${until}] (source ${f.sourceRef}) ${f.content}`;
		})
		.join('\n\n');
}

export function reconcilePrompt(hits) {
	const system =
		'You maintain an agent memory. Given dated memories, find pairs where a LATER memory states a changed value for the SAME attribute as an EARLIER one (a new address, job, plan, preference, count, status). Mere repetition or an additional unrelated fact is not a change. Reply with JSON only: {"supersedes":[{"old":"<id>","new":"<id>"}]}. Use an empty list when nothing changed.';
	const user = hits
		.slice()
		.sort((a, b) => (a.validFrom || 0) - (b.validFrom || 0))
		.map((m) => `id=${m.id} date=${formatDay(m.validFrom)}\n${m.content.slice(0, 600)}`)
		.join('\n---\n');
	return { system, user };
}

/** Parse the reconcile reply; unknown ids and malformed items are dropped, never guessed. */
export function parseReconcile(text, hits) {
	const ids = new Set(hits.map((h) => h.id));
	const m = /\{[\s\S]*\}/.exec(String(text || ''));
	if (!m) return [];
	let parsed;
	try {
		parsed = JSON.parse(m[0]);
	} catch {
		return [];
	}
	const out = [];
	for (const p of Array.isArray(parsed?.supersedes) ? parsed.supersedes : []) {
		if (p && ids.has(String(p.old)) && ids.has(String(p.new)) && String(p.old) !== String(p.new)) {
			out.push({ old: String(p.old), new: String(p.new) });
		}
	}
	return out;
}

/**
 * Apply reconcile pairs through the SDK's supersede(): the older memory's
 * interval closes at the newer one's validFrom. A pair whose "old" is not
 * actually older, or is already closed, is skipped.
 */
export function applySupersession(hits, pairs) {
	let facts = hits.map((h) => ({ ...h }));
	for (const p of pairs) {
		const oldF = facts.find((f) => f.id === p.old);
		const newer = facts.find((f) => f.id === p.new);
		if (!oldF || !newer || oldF.validTo != null) continue;
		if ((oldF.validFrom || 0) >= (newer.validFrom || 0)) continue;
		const [closed] = supersede([oldF], { id: newer.id, content: newer.content, validFrom: newer.validFrom, sourceRef: newer.sourceRef, supersedes: [oldF.id] });
		facts = facts.map((f) => (f.id === oldF.id ? closed : f));
	}
	return facts;
}

/**
 * The facts a question can see: everything stamped on or before the question
 * date, with intervals that end after it reopened. A memory superseded by
 * something that has not happened yet (relative to the question) was still
 * current then.
 */
export function factsAsOf(facts, questionDate) {
	return facts
		.filter((f) => (f.validFrom || 0) <= questionDate)
		.map((f) => (f.validTo != null && f.validTo > questionDate ? { ...f, validTo: null, supersededBy: null } : f));
}

export function answerPrompt({ question, context, questionDate, temporal }) {
	const system = temporal
		? 'You answer questions from an agent memory. Each memory shows when it became true, whether it is still current or was superseded, and its source. Prefer current facts over superseded ones, use the dates to resolve relative times such as "last week", and answer concisely. If the memories do not contain the answer, say you do not know.'
		: 'You answer questions from an agent memory. Answer concisely from the memories. If the memories do not contain the answer, say you do not know.';
	const user = `Today is ${formatDay(questionDate)}.\n\nMemories:\n${context || '(none)'}\n\nQuestion: ${question}\nAnswer:`;
	return { system, user };
}

export function judgePrompt({ question, gold, answer, type, abstention }) {
	const system =
		'You are a strict grader. Reply with exactly one word: CORRECT or WRONG. ' +
		(abstention
			? 'The question is unanswerable from the conversation; the response is CORRECT only if it says the information is unknown or was not mentioned.'
			: type === 'temporal' || type === 'temporal-reasoning'
				? 'The response is CORRECT if it names the same date or time span as the gold answer; allow equivalent formats and an off-by-one day for relative dates, but not a different date.'
				: type === 'knowledge-update'
					? 'The response is CORRECT if it gives the UPDATED (latest) answer from the gold answer; giving only an outdated value is WRONG.'
					: 'The response is CORRECT if it contains the information in the gold answer; extra detail is fine, a contradiction or a missing key fact is WRONG.');
	const user = `Question: ${question}\nGold answer: ${gold}\nResponse: ${answer}\nGrade:`;
	return { system, user };
}

export function parseVerdict(text) {
	const t = String(text || '').toUpperCase();
	const c = t.lastIndexOf('CORRECT');
	const w = t.lastIndexOf('WRONG');
	if (c < 0 && w < 0) return null;
	if (t.includes('INCORRECT')) return false;
	return c > w;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Aggregate per-question results into overall and per-type accuracy for each mode.
 * Questions the grader could not grade (verdict null) are counted separately and
 * excluded from accuracy, never scored as wrong.
 */
export function summarize(results, modes) {
	const out = {};
	for (const mode of modes) {
		const byType = {};
		let correct = 0;
		let graded = 0;
		let ungraded = 0;
		for (const r of results) {
			const v = r.modes[mode]?.correct;
			if (v === null || v === undefined) {
				ungraded++;
				continue;
			}
			graded++;
			if (v) correct++;
			const t = (byType[r.type] ||= { correct: 0, graded: 0 });
			t.graded++;
			if (v) t.correct++;
		}
		out[mode] = {
			accuracy: graded ? correct / graded : null,
			correct,
			graded,
			ungraded,
			byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { ...v, accuracy: v.correct / v.graded }])),
		};
	}
	return out;
}
