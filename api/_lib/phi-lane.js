// The Phi brain lane: Microsoft Phi-4-mini-instruct, self-hosted on a Cloud Run
// L4 by workers/model-phi (vLLM, OpenAI-compatible). Dormant until
// PHI_WORKER_URL is set; then
//   - llm.js providerChain() leads with it for the internal task types the
//     evaluation passed (PHI_ROUTED_TASKS) or when a caller sets preferPhi,
//     and falls back to the platform chain on any error or timeout;
//   - the tool loop (llm-tool-chain.js) serves it as the catalog model
//     `microsoft/Phi-4-mini-instruct`, so an agent can pick it by name.
// Numbers, routing table and how to re-run the evaluation: docs/phi-brain-lane.md.

export const PHI_MODEL = 'microsoft/Phi-4-mini-instruct';

// Short on purpose: a warm worker answers a triage prompt in about a second, so
// anything slower is the scale-from-zero boot, and the platform chain behind
// the lane answers while the instance comes up.
export const PHI_DEFAULT_TIMEOUT_MS = 10_000;

// How long the lane sits out after it stalled or 5xx'd: about one GPU cold
// start, so calls during a boot go straight to the chain instead of each
// waiting out the timeout.
export const PHI_STALL_COOLDOWN_MS = 90_000;

// Internal task types routed to Phi when the worker is configured: the types
// that met the bar in the evaluation (docs/phi-brain-lane.md, within 5 points
// of the default chain and at least 95% parseable output). PHI_ROUTED_TASKS
// (comma-separated) overrides this list without a deploy.
export const PHI_ROUTED_TASKS = Object.freeze([]);

/**
 * Worker settings from the environment, or null while the lane is dormant.
 * PHI_WORKER_URL may be the service root or end in /v1. The bearer is
 * PHI_WORKER_KEY, else the GCP_RECONSTRUCTION_KEY every other worker shares.
 */
export function phiConfig() {
	const raw = String(process.env.PHI_WORKER_URL || '').trim();
	if (!raw) return null;
	const base = raw.replace(/\/+$/, '').replace(/\/v1$/, '');
	const timeout = Number(process.env.PHI_TIMEOUT_MS);
	return {
		base,
		chatUrl: `${base}/v1/chat/completions`,
		key: process.env.PHI_WORKER_KEY || process.env.GCP_RECONSTRUCTION_KEY || null,
		timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : PHI_DEFAULT_TIMEOUT_MS,
	};
}

function routedTasks() {
	const override = process.env.PHI_ROUTED_TASKS;
	if (override == null || override === '') return PHI_ROUTED_TASKS;
	return override.split(',').map((t) => t.trim()).filter(Boolean);
}

/** True when the lane is configured and `task` is one of the routed types. */
export function phiRoutesTask(task) {
	if (!task || !phiConfig()) return false;
	return routedTasks().includes(task);
}

/** An llm.js chain provider for the worker. */
export function phiProvider(cfg = phiConfig()) {
	if (!cfg) return null;
	return {
		name: 'phi',
		model: PHI_MODEL,
		url: cfg.chatUrl,
		timeoutMs: cfg.timeoutMs,
		headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) },
		buildBody: (system, user, maxTokens) => ({
			model: PHI_MODEL,
			max_tokens: maxTokens,
			// Classification and summaries want the model's single best reading.
			temperature: 0,
			messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
		}),
		extractText: (r) => r.choices?.[0]?.message?.content || '',
		extractUsage: (r) => ({ input: r.usage?.prompt_tokens ?? 0, output: r.usage?.completion_tokens ?? 0 }),
	};
}

/** A tool-loop rung (llm-tool-chain.js shape) for the worker, or null while dormant. */
export function phiToolRung(cfg = phiConfig()) {
	if (!cfg) return null;
	// The worker rejects unauthenticated calls, so no key means no rung.
	if (!cfg.key) return null;
	return { name: 'phi', url: cfg.chatUrl, key: cfg.key, model: PHI_MODEL, catalogModel: PHI_MODEL, connectTimeoutMs: cfg.timeoutMs };
}

// ── Tool calls that reach the client as text ─────────────────────────────────
// The worker's parser (workers/model-phi/phi_tool_parser.py) turns Phi's
// native `<|tool_call|>[...]` output into structured tool_calls. These helpers
// are the client-side net for the rare round where a call still arrives as
// content (a truncated end tag, the older `functools[...]` form).

const MARKERS = ['<|tool_call|>', 'functools'];

// The first complete JSON array starting at or after `from`, string-aware so a
// bracket inside an argument value does not end it early.
/**
 * Slice the JSON array or object opening at `text[start]`. With `lenient`, a
 * closer that does not match the open bracket is dropped instead of failing:
 * inside an otherwise well-formed call, Phi-4-mini's one slip is an extra `}`
 * before the closing `]`.
 */
function sliceJsonValue(text, start, lenient) {
	const stack = [];
	let kept = '';
	let inString = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			kept += ch;
			if (ch === '\\') kept += text[++i] ?? '';
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === '[') stack.push(']');
		else if (ch === '{') stack.push('}');
		else if (ch === ']' || ch === '}') {
			if (stack.at(-1) !== ch) {
				if (lenient && stack.length) continue;
				return null;
			}
			stack.pop();
			if (!stack.length) return kept + ch;
		}
		kept += ch;
	}
	return null;
}

/**
 * Where the call JSON starts after a marker, skipping what Phi-4-mini sometimes
 * writes first: a repeated marker, or an empty `[]` before the real object.
 */
function callStart(text, from) {
	let i = from;
	for (;;) {
		while (/\s/.test(text[i] || '')) i++;
		const marker = MARKERS.find((m) => text.startsWith(m, i));
		if (marker) { i += marker.length; continue; }
		if (text.startsWith('[]', i) && /^\s*[[{]/.test(text.slice(i + 2))) { i += 2; continue; }
		return i;
	}
}

function argsJson(value) {
	if (typeof value === 'string') {
		try {
			return JSON.stringify(JSON.parse(value));
		} catch {
			return null;
		}
	}
	return JSON.stringify(value && typeof value === 'object' ? value : {});
}

/**
 * Pull tool calls out of model text. Only calls naming an offered tool count,
 * so a JSON answer that happens to look like a call list is left as content.
 * @param {string} text
 * @param {Set<string>} toolNames
 * @returns {{ content: string, calls: Array<{ name: string, args: string }> }}
 */
export function parsePhiToolCalls(text, toolNames) {
	const source = String(text || '');
	let at = -1;
	let markerLen = 0;
	for (const m of MARKERS) {
		const i = source.indexOf(m);
		if (i >= 0 && (at < 0 || i < at)) { at = i; markerLen = m.length; }
	}
	const marked = at >= 0;
	if (!marked && source.trimStart().startsWith('[')) at = source.indexOf('[');
	if (at < 0) return { content: source, calls: [] };
	const start = marked ? callStart(source, at + markerLen) : at;
	const block = '[{'.includes(source[start]) ? sliceJsonValue(source, start, marked) : null;
	let items;
	try {
		items = block ? JSON.parse(block) : null;
	} catch {
		items = null;
	}
	if (items && !Array.isArray(items) && typeof items === 'object') items = [items];
	if (!Array.isArray(items)) return { content: source, calls: [] };
	const calls = [];
	for (const item of items) {
		if (!item || typeof item.name !== 'string' || !toolNames.has(item.name)) continue;
		const args = argsJson(item.arguments ?? item.parameters ?? {});
		if (args != null) calls.push({ name: item.name, args });
	}
	if (!calls.length) return { content: source, calls: [] };
	return { content: source.slice(0, at).trim(), calls };
}

/** Tool names offered in an OpenAI `tools` array. */
export function offeredToolNames(tools) {
	return new Set((Array.isArray(tools) ? tools : []).map((t) => t?.function?.name).filter(Boolean));
}

/**
 * Normalize one streamed round from the worker: when it carries no structured
 * tool calls but its text holds one, return the calls as real tool calls.
 * @param {{ content: string, toolCalls: Array<{id:string,name:string,args:string}>, usage?: object }} round
 * @param {Set<string>} toolNames
 */
export function normalizePhiRound(round, toolNames) {
	if (round.toolCalls?.length || !toolNames.size) return round;
	const { content, calls } = parsePhiToolCalls(round.content, toolNames);
	if (!calls.length) return round;
	return { ...round, content, toolCalls: calls.map((c, i) => ({ id: `call_phi_${i}`, ...c })) };
}

/**
 * Holds back streamed text that might be the start of a tool call, so raw call
 * syntax never reaches the user while the round is still being read. Text that
 * clearly is not a call streams through unchanged.
 * @param {(delta: string) => void} [onContent]
 */
export function phiContentGate(onContent) {
	let held = '';
	let open = false;
	let closed = false;
	const couldBeMarker = (s) => {
		const t = s.trimStart();
		return t === '' || t.startsWith('[') || MARKERS.some((m) => m.startsWith(t) || t.startsWith(m));
	};
	// Longest tail of `s` that could still grow into a marker.
	const markerTail = (s) => {
		for (let n = Math.min(s.length, Math.max(...MARKERS.map((m) => m.length)) - 1); n > 0; n--) {
			const tail = s.slice(-n);
			if (MARKERS.some((m) => m.startsWith(tail))) return n;
		}
		return 0;
	};
	function push(delta) {
		if (closed || !onContent) return;
		held += delta;
		if (open) {
			const at = MARKERS.map((m) => held.indexOf(m)).filter((n) => n >= 0).sort((a, b) => a - b)[0];
			if (at != null) {
				if (at > 0) onContent(held.slice(0, at));
				held = '';
				closed = true;
				return;
			}
			const keep = markerTail(held);
			if (held.length > keep) onContent(held.slice(0, held.length - keep));
			held = held.slice(held.length - keep);
			return;
		}
		if (couldBeMarker(held) && held.length < 256) return;
		if (MARKERS.some((m) => held.trimStart().startsWith(m))) { closed = true; return; }
		open = true;
		const flush = held;
		held = '';
		push(flush);
	}
	return {
		push,
		// End of stream: release held text unless it parsed as a call.
		end(round) {
			if (!onContent || closed || !held) return;
			if (round.toolCalls?.length && !round.content) return;
			onContent(held);
		},
	};
}
