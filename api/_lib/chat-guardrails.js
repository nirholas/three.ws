// Agent chat guardrails: NVIDIA NemoGuard checks an agent's owner turns on.
//
// Three checks, each one an owner setting on the agent (agent_identities.meta
// .guardrails), all OFF by default:
//
//   jailbreak  NemoGuard jailbreak detection on each visitor turn
//   safety     NemoGuard content safety (Nemotron Safety Guard 8B v3) on each
//              visitor turn AND on the agent's reply, screened as it streams
//   topics     NemoGuard topic control: the owner lists allowed topics in plain
//              language and an off-topic turn gets a polite redirect instead
//              of an answer
//
// Why opt-in: the platform itself still screens nothing a visitor may ask
// (owner directive 2026-08-07, see publish-safety.js). These are tools a
// business owner chooses for the agent they embed on their own site, the same
// way they choose its persona. The measured true and false positive rates and
// latencies that set every constant below are in
// docs/nvidia/evals/guardrails-2026-11-16.md (`npm run nvidia:guard-eval`).
//
// Timing. Input checks start in parallel with the model call and are awaited
// only before the first byte of the reply goes out, so a check that finishes
// before the model's first token adds no latency. Output screening holds text
// in a sentence buffer, releases each buffer only once it has been judged
// safe, and on an unsafe verdict stops the stream and replaces the reply.
//
// Fail modes (from the eval's measured error rates, per check):
//   every check fails OPEN. A timeout, a 4xx/5xx or an unreadable verdict lets
//   the turn through and is counted as "unchecked" in the owner's stats, so a
//   guard outage is visible rather than silent. Failing closed would turn any
//   NVIDIA hosted-API incident into a full outage of every guarded agent (the
//   topic-control model itself was down for every call on 2026-11-16).
//
// No message text is stored. The owner's stats come from a `guard` summary on
// the chat usage row: which checks ran, which one blocked, which failed open.

import { z } from 'zod';
import { LIMITS, refusalFor, topicRedirect } from './guardrail-copy.js';

export { LIMITS, refusalFor, topicRedirect };

const NIM_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const JAILBREAK_URL = 'https://ai.api.nvidia.com/v1/security/nvidia/nemoguard-jailbreak-detect';

/** The models each check calls, in fallback order where there is one. */
export const GUARD_MODELS = Object.freeze({
	contentSafety: 'nvidia/llama-3.1-nemotron-safety-guard-8b-v3',
	jailbreak: 'nvidia/nemoguard-jailbreak-detect',
	topicControl: 'nvidia/llama-3.1-nemoguard-8b-topic-control',
	// Same topic-control prompt contract, used when the dedicated model errors.
	topicFallback: 'nvidia/nemotron-3.5-lightning-30b-a3b',
});

/** The check ids, in the priority a block is reported when several fire. */
export const CHECK_IDS = Object.freeze(['jailbreak', 'input_safety', 'topic', 'output_safety']);

// Budgets. The eval measured p95 latency per check; each per-call timeout
// sits above that p95 and the input budget bounds the slowest one, so a
// stalled lane fails open quickly instead of holding the reply.
export const INPUT_BUDGET_MS = 2000;
export const OUTPUT_CHECK_TIMEOUT_MS = 2500;
// The jailbreak classifier scores a turn in roughly [-1, 1]; positive is a
// jailbreak. The eval's threshold sweep is in the report.
export const JAILBREAK_THRESHOLD = 0;

const MAX_CHECK_CHARS = 4000;
const TOPIC_HISTORY_TURNS = 4;


// ── Settings ─────────────────────────────────────────────────────────────────

const topicsSchema = z.object({
	enabled: z.boolean().default(false),
	allowed: z
		.array(z.string().trim().min(1).max(LIMITS.topicChars))
		.max(LIMITS.topics)
		.default([]),
	redirect: z.string().trim().max(LIMITS.redirectChars).default(''),
});

export const guardrailsSchema = z.object({
	jailbreak: z.boolean().default(false),
	safety: z.boolean().default(false),
	topics: topicsSchema.default({ enabled: false, allowed: [], redirect: '' }),
});

/** The agent's guardrail settings, defaults filled in. Never throws. */
export function normalizeGuardrails(raw) {
	const parsed = guardrailsSchema.safeParse(raw && typeof raw === 'object' ? raw : {});
	const g = parsed.success ? parsed.data : guardrailsSchema.parse({});
	const allowed = [...new Set(g.topics.allowed)];
	return {
		jailbreak: g.jailbreak,
		safety: g.safety,
		// Topic control with an empty topic list has nothing to enforce.
		topics: { enabled: g.topics.enabled && allowed.length > 0, allowed, redirect: g.topics.redirect },
	};
}

/** Whether any check is on for these settings. */
export function guardrailsActive(settings) {
	return Boolean(settings && (settings.jailbreak || settings.safety || settings.topics?.enabled));
}

/** The checks the settings turn on, by id. */
export function enabledChecks(settings) {
	if (!settings) return [];
	const out = [];
	if (settings.jailbreak) out.push('jailbreak');
	if (settings.safety) out.push('input_safety', 'output_safety');
	if (settings.topics?.enabled) out.push('topic');
	return out;
}

// ── What the visitor sees: api/_lib/guardrail-copy.js ──────────────────────

// ── Classifier calls ─────────────────────────────────────────────────────────

/** The NVIDIA key, or null. */
export function guardKey(env = process.env) {
	return env.NVIDIA_API_KEY?.trim() || null;
}

function clip(text) {
	return String(text ?? '').slice(0, MAX_CHECK_CHARS);
}

/** A per-call signal that aborts at `ms` or when the caller's signal does. */
function deadline(ms, signal) {
	const own = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([own, signal]) : own;
}

class GuardCallError extends Error {
	constructor(message, status = null) {
		super(message);
		this.name = 'GuardCallError';
		this.status = status;
	}
}

async function postJson(url, body, { key, timeoutMs, signal, fetchImpl = fetch }) {
	let res;
	try {
		res = await fetchImpl(url, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(body),
			signal: deadline(timeoutMs, signal),
		});
	} catch (err) {
		const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
		throw new GuardCallError(timedOut ? 'timeout' : `network: ${err?.message || err}`);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new GuardCallError(`http ${res.status}: ${text.slice(0, 160)}`, res.status);
	}
	try {
		return await res.json();
	} catch {
		throw new GuardCallError('unparseable response');
	}
}

/**
 * Parse a NemoGuard content-safety reply. `role` picks the verdict field:
 * 'user' reads "User Safety", 'response' reads "Response Safety". Returns null
 * for a reply that carries no verdict for that role (the caller fails open).
 */
export function parseSafetyVerdict(content, role = 'user') {
	const raw = String(content ?? '').trim();
	if (!raw) return null;
	let j;
	try {
		j = JSON.parse(raw);
	} catch {
		const m = raw.match(/\{[\s\S]*\}/);
		if (!m) return null;
		try {
			j = JSON.parse(m[0]);
		} catch {
			return null;
		}
	}
	const field = role === 'response' ? 'Response Safety' : 'User Safety';
	const verdict = String(j[field] ?? '').trim().toLowerCase();
	if (verdict !== 'safe' && verdict !== 'unsafe') return null;
	const categories = String(j['Safety Categories'] ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return { unsafe: verdict === 'unsafe', categories: verdict === 'unsafe' ? categories : [] };
}

/** Parse a topic-control reply: true on-topic, false off-topic, null unreadable. */
export function parseTopicVerdict(content) {
	const t = String(content ?? '').trim().toLowerCase();
	if (/\boff[\s-]?topic\b/.test(t)) return false;
	if (/\bon[\s-]?topic\b/.test(t)) return true;
	return null;
}

/**
 * Content safety on a visitor turn (`assistant` omitted) or on the agent's
 * reply to it. Throws GuardCallError on any call failure.
 */
export async function classifyContentSafety({ user, assistant }, opts) {
	const messages = [{ role: 'user', content: clip(user) }];
	const role = assistant == null ? 'user' : 'response';
	if (role === 'response') messages.push({ role: 'assistant', content: clip(assistant) });
	const started = Date.now();
	const data = await postJson(
		NIM_CHAT_URL,
		{ model: GUARD_MODELS.contentSafety, messages, max_tokens: 64, temperature: 0 },
		opts,
	);
	const verdict = parseSafetyVerdict(data?.choices?.[0]?.message?.content, role);
	if (!verdict) throw new GuardCallError('no verdict in reply');
	return {
		flagged: verdict.unsafe,
		categories: verdict.categories,
		model: GUARD_MODELS.contentSafety,
		latencyMs: Date.now() - started,
	};
}

/** NemoGuard jailbreak detection on one visitor turn. Throws GuardCallError on failure. */
export async function classifyJailbreak(text, opts) {
	const started = Date.now();
	const data = await postJson(JAILBREAK_URL, { input: clip(text) }, opts);
	const score = Number(data?.score);
	if (typeof data?.jailbreak !== 'boolean' && !Number.isFinite(score)) {
		throw new GuardCallError('no verdict in reply');
	}
	const threshold = opts?.threshold ?? JAILBREAK_THRESHOLD;
	const flagged = Number.isFinite(score) ? score > threshold : data.jailbreak === true;
	return { flagged, score: Number.isFinite(score) ? score : null, model: GUARD_MODELS.jailbreak, latencyMs: Date.now() - started };
}

/**
 * The system prompt the topic-control model is trained on: the role, the
 * guidelines, then the fixed on-topic / off-topic instruction.
 */
export function topicSystemPrompt(allowed, agentName) {
	const who = agentName ? `the assistant "${agentName}"` : 'an assistant';
	return [
		`You are ${who} on a business website. Follow these guidelines:`,
		`- Only help with these topics: ${allowed.map((t) => t.replace(/[.\s]+$/, '')).join('; ')}.`,
		'- Greetings, thanks, small talk that opens or closes the conversation, and questions about what you can help with are allowed.',
		'- Requests about anything else, including writing code, homework, or general knowledge unrelated to the topics, are not allowed.',
		'',
		'If any of the above conditions are violated, please respond with "off-topic". Otherwise, respond with "on-topic". You must respond with "on-topic" or "off-topic".',
	].join('\n');
}

function topicMessages({ user, history = [], allowed, agentName }) {
	const recent = history
		.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
		.slice(-TOPIC_HISTORY_TURNS)
		.map((m) => ({ role: m.role, content: clip(m.content) }));
	return [{ role: 'system', content: topicSystemPrompt(allowed, agentName) }, ...recent, { role: 'user', content: clip(user) }];
}

/**
 * Topic control on one visitor turn. The NemoGuard topic-control model leads;
 * when it errors, the same prompt goes to the fallback Nemotron model so a
 * dead lane degrades to a slightly different judge, not to no judge. Throws
 * GuardCallError only when both fail.
 */
export async function classifyTopic({ user, history, allowed, agentName }, opts) {
	const messages = topicMessages({ user, history, allowed, agentName });
	const started = Date.now();
	let lastErr = null;
	for (const model of [GUARD_MODELS.topicControl, GUARD_MODELS.topicFallback]) {
		try {
			const body = { model, messages, max_tokens: 16, temperature: 0 };
			if (model === GUARD_MODELS.topicFallback) body.chat_template_kwargs = { enable_thinking: false };
			const data = await postJson(NIM_CHAT_URL, body, opts);
			const onTopic = parseTopicVerdict(data?.choices?.[0]?.message?.content);
			if (onTopic === null) throw new GuardCallError('no verdict in reply');
			return { flagged: !onTopic, model, latencyMs: Date.now() - started };
		} catch (err) {
			lastErr = err;
			// A caller abort or a spent budget is not a reason to try the next model.
			if (opts?.signal?.aborted || err?.message === 'timeout') break;
		}
	}
	throw lastErr || new GuardCallError('topic control unavailable');
}

// ── Input checks ─────────────────────────────────────────────────────────────

/**
 * Run every input check the settings turn on, in parallel, inside one budget.
 * Resolves as soon as any check flags (the rest are aborted) or when all have
 * answered. Never rejects: a failed check is recorded and fails open.
 *
 * @returns {Promise<{
 *   blocked: null | { check: string, reply: string, categories?: string[], model?: string },
 *   results: Array<{ check: string, ok: boolean, flagged: boolean, latencyMs: number, model?: string, error?: string, score?: number }>,
 *   latencyMs: number,
 * }>}
 */
export async function runInputChecks(settings, { message, history = [], agentName = null }, options = {}) {
	const env = options.env || process.env;
	const key = options.key ?? guardKey(env);
	const budgetMs = options.budgetMs ?? INPUT_BUDGET_MS;
	const fetchImpl = options.fetchImpl || fetch;
	const started = Date.now();
	const text = String(message ?? '').trim();
	const wanted = enabledChecks(settings).filter((c) => c !== 'output_safety');
	if (!wanted.length || !text) return { blocked: null, results: [], latencyMs: 0 };
	if (!key) {
		return {
			blocked: null,
			results: wanted.map((check) => ({ check, ok: false, flagged: false, latencyMs: 0, error: 'not configured' })),
			latencyMs: 0,
		};
	}

	const abort = new AbortController();
	const callOpts = { key, timeoutMs: budgetMs, signal: abort.signal, fetchImpl };
	const runners = {
		jailbreak: () => classifyJailbreak(text, callOpts),
		input_safety: () => classifyContentSafety({ user: text }, callOpts),
		topic: () => classifyTopic({ user: text, history, allowed: settings.topics.allowed, agentName }, callOpts),
	};

	const results = [];
	let firstFlag = null;
	await new Promise((resolve) => {
		let remaining = wanted.length;
		for (const check of wanted) {
			runners[check]()
				.then((r) => {
					results.push({ check, ok: true, ...r });
					if (r.flagged && !firstFlag) {
						firstFlag = check;
						resolve();
					}
				})
				.catch((err) => {
					results.push({ check, ok: false, flagged: false, latencyMs: Date.now() - started, error: err?.message || String(err) });
				})
				.finally(() => {
					if (--remaining === 0) resolve();
				});
		}
	});
	abort.abort();

	// Several checks can flag in the same tick; report the highest-priority one.
	const flaggedIds = results.filter((r) => r.flagged).map((r) => r.check);
	const check = CHECK_IDS.find((id) => flaggedIds.includes(id)) || null;
	// Checks still in flight when a block resolved were cut short, not failed.
	for (const id of wanted) {
		if (!results.some((r) => r.check === id)) results.push({ check: id, ok: false, flagged: false, latencyMs: Date.now() - started, error: 'skipped' });
	}
	const hit = check ? results.find((r) => r.check === check) : null;
	return {
		blocked: check
			? { check, reply: refusalFor(check, settings), ...(hit.categories?.length ? { categories: hit.categories } : {}), model: hit.model }
			: null,
		results,
		latencyMs: Date.now() - started,
	};
}

// ── Output screening ─────────────────────────────────────────────────────────

// A buffer is cut at the last sentence end once it holds at least this much
// text: short enough that the first release is quick, long enough that a
// verdict has a full thought to judge.
const MIN_SEGMENT_CHARS = 40;
// A sentence end and the whitespace after it, so the next buffer starts clean.
const SENTENCE_END = /[.!?…]["')\]]*\s+|\n+/g;

function lastSentenceEnd(text) {
	let cut = -1;
	SENTENCE_END.lastIndex = 0;
	let m;
	while ((m = SENTENCE_END.exec(text))) cut = m.index + m[0].length;
	return cut;
}

/**
 * Screen a streaming reply before it reaches the visitor.
 *
 * Text goes in with `text()`, any other ordered stream item (a tool event, an
 * SSE frame the transport passes through) with `raw()`. Nothing is emitted
 * until every earlier piece of text has been judged safe, so ordering is kept
 * and unsafe text is never sent. Each check judges the reply so far (up to the
 * end of its buffer), in the context of the visitor's turn. While a check is in
 * flight new text keeps buffering, so a slow classifier means fewer, larger
 * buffers rather than a growing queue of calls.
 *
 * On an unsafe verdict the gate stops: nothing further is emitted and
 * `onBlock(verdict)` fires once so the transport can stop the upstream and
 * send the replacement. A failed check fails open for that buffer.
 *
 * @param {object} o
 * @param {string} o.userMessage
 * @param {(text: string) => void} o.emitText
 * @param {(item: any) => void} [o.emitRaw]
 * @param {(verdict: object) => void} [o.onBlock]
 * @param {(input: {user: string, assistant: string}) => Promise<{flagged: boolean, categories?: string[], model?: string}>} [o.classify]
 * @param {number} [o.maxInFlight]
 */
export function createOutputGate({ userMessage, emitText, emitRaw = () => {}, onBlock = () => {}, classify, maxInFlight = 2 }) {
	const queue = []; // { kind: 'text', text, state: 'pending'|'safe'|'unsafe', verdict } | { kind: 'raw', item }
	let pending = '';
	let screened = ''; // reply text already cut into segments, in order
	let released = '';
	let inFlight = 0;
	let blocked = null;
	let finished = false;
	let checks = 0;
	let unchecked = 0;
	let waiters = [];

	function settleWaiters() {
		if (blocked || (finished && !queue.length && !pending)) {
			for (const w of waiters) w();
			waiters = [];
		}
	}

	function pump() {
		while (queue.length && !blocked) {
			const head = queue[0];
			if (head.kind === 'raw') {
				queue.shift();
				emitRaw(head.item);
				continue;
			}
			if (head.state === 'pending') break;
			queue.shift();
			if (head.state === 'unsafe') {
				blocked = { check: 'output_safety', categories: head.verdict?.categories || [], model: head.verdict?.model };
				queue.length = 0;
				pending = '';
				onBlock(blocked);
				break;
			}
			released += head.text;
			emitText(head.text);
		}
		settleWaiters();
	}

	/** Move `text` from the buffer into the queue and send it to the classifier. */
	function judge(text) {
		screened += text;
		const seg = { kind: 'text', text, state: 'pending', verdict: null };
		queue.push(seg);
		inFlight++;
		checks++;
		classify({ user: userMessage, assistant: screened })
			.then((v) => {
				seg.verdict = v;
				seg.state = v?.flagged ? 'unsafe' : 'safe';
			})
			.catch(() => {
				unchecked++;
				seg.state = 'safe';
			})
			.finally(() => {
				inFlight--;
				pump();
				startSegment(finished);
			});
	}

	function startSegment(force) {
		if (blocked || inFlight >= maxInFlight || !pending) return;
		let cut = force ? pending.length : lastSentenceEnd(pending);
		if (!force && (cut < 0 || cut < Math.min(MIN_SEGMENT_CHARS, pending.length))) {
			if (pending.length < MIN_SEGMENT_CHARS * 8) return;
			cut = pending.length; // a long run with no sentence end still gets judged
		}
		const text = pending.slice(0, cut);
		pending = pending.slice(cut);
		judge(text);
	}

	return {
		text(chunk) {
			if (blocked || !chunk) return;
			pending += chunk;
			startSegment(false);
		},
		raw(item) {
			if (blocked) return;
			// Anything queued behind unscreened text must wait for that text.
			if (pending) {
				const text = pending;
				pending = '';
				judge(text);
			}
			queue.push({ kind: 'raw', item });
			pump();
		},
		/** The upstream ended: judge what is left and wait for every verdict. */
		async finish() {
			finished = true;
			startSegment(true);
			pump();
			if (!blocked && (queue.length || pending)) {
				await new Promise((resolve) => waiters.push(resolve));
			}
			return { blocked, released, checks, unchecked };
		},
		get blocked() {
			return blocked;
		},
		get released() {
			return released;
		},
	};
}

/** The production output classifier, bound to a key and timeout. */
export function outputClassifier({ key, fetchImpl = fetch, timeoutMs = OUTPUT_CHECK_TIMEOUT_MS, signal } = {}) {
	return ({ user, assistant }) => classifyContentSafety({ user, assistant }, { key, timeoutMs, fetchImpl, signal });
}

// ── Observability ────────────────────────────────────────────────────────────

/**
 * The `guard` summary stamped on the chat usage row. Ids only: which checks
 * were on, which one blocked, which failed open. Never any message text.
 */
export function guardSummary(settings, { input = null, output = null } = {}) {
	const on = enabledChecks(settings);
	if (!on.length) return null;
	const unchecked = [];
	for (const r of input?.results || []) if (!r.ok && r.error !== 'skipped') unchecked.push(r.check);
	if (output?.unchecked) unchecked.push('output_safety');
	return {
		on,
		blocked: input?.blocked?.check || output?.blocked?.check || null,
		unchecked,
		input_ms: input?.latencyMs ?? null,
		output_checks: output?.checks ?? 0,
	};
}

/**
 * An embed's guardrail settings. The embed proxy is addressed by agent id or
 * by the agent's avatar id, so both resolve here. Null for an id with no
 * agent behind it (a bare public avatar has no owner to set guardrails).
 */
export async function loadAgentGuardrails(sql, id) {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''))) return null;
	const [row] = await sql`
		SELECT id, name, avatar_id, meta->'guardrails' AS guardrails
		FROM agent_identities
		WHERE (id = ${id} OR avatar_id = ${id}) AND deleted_at IS NULL
		ORDER BY (id = ${id}) DESC
		LIMIT 1
	`;
	if (!row) return null;
	return { agentId: row.id, avatarId: row.avatar_id, name: row.name, settings: normalizeGuardrails(row.guardrails) };
}

/**
 * Block counts per check for one agent over the last `days`, from the guard
 * summaries on its usage rows: chat turns are keyed by the agent id, embed
 * turns by whichever id the embed used (the agent's or its avatar's).
 */
export async function guardStats(sql, ids, days = 30) {
	const keys = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
	const rows = await sql`
		SELECT meta->'guard'->>'blocked' AS blocked,
		       count(*)::int AS turns,
		       count(*) FILTER (WHERE jsonb_array_length(COALESCE(meta->'guard'->'unchecked', '[]'::jsonb)) > 0)::int AS unchecked
		FROM usage_events
		WHERE agent_id = ANY(${keys}::uuid[])
		  AND created_at > now() - make_interval(days => ${days})
		  AND meta ? 'guard'
		GROUP BY 1
	`;
	const blocked = Object.fromEntries(CHECK_IDS.map((id) => [id, 0]));
	let turns = 0;
	let unchecked = 0;
	for (const r of rows) {
		turns += r.turns;
		unchecked += r.unchecked;
		if (r.blocked && r.blocked in blocked) blocked[r.blocked] += r.turns;
	}
	return { days, turns, blocked, unchecked };
}
