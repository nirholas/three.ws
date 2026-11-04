// Task sequencer + narration source for the on-demand caster pool.
//
// Two concerns, deliberately split so the orchestration is unit-testable without
// a browser:
//
//   1. runTaskSteps() — the pure sequencer. For every step it calls, in order:
//        executor.narrate(line, step)   ← the words, a beat BEFORE the action
//        executor.perform(step)         ← the real Playwright action
//        executor.shot(step, result)    ← the picture, AFTER the action
//      That ordering is the whole "it feels like it's thinking" effect, and the
//      test pins it by injecting a recording executor (no Chromium needed).
//
//   2. generateNarration() — asks the real LLM router (/api/brain/chat) to write
//      the lead line for each step so the words match the page, with the task's
//      own declarative narration as a guaranteed fallback when the brain is
//      unavailable. Cached per task id so a task's plan costs one brain call.

// Module-level cache: task.id → Promise<{ stepId: line }>. "Cache the plan per
// task run" — same task reuses its narration across runs and across the agents
// the pool casts, so the brain is hit at most once per task per process.
const _narrationCache = new Map();

// Build the fallback map straight from the task's declarative narration. Always
// complete, always real (it describes the real step) — used verbatim when the
// brain is absent and as the backstop for any step the brain omitted.
function fallbackNarration(task) {
	const map = {};
	for (const step of task.steps) map[step.id] = step.narration;
	return map;
}

// Ask /api/brain/chat to author the lead narration. Uses the free, anon-allowed
// default provider so the pool needs no API key of its own; any failure (no
// network, malformed stream, bad JSON) resolves to the fallback rather than
// throwing into the cast loop.
export function generateNarration(task, { baseUrl, fetchImpl = fetch, provider = 'gpt-oss-120b' } = {}) {
	if (_narrationCache.has(task.id)) return _narrationCache.get(task.id);

	const promise = (async () => {
		const fallback = fallbackNarration(task);
		if (!baseUrl) return fallback;

		const stepList = task.steps
			.map((s) => `- ${s.id} (${s.kind}): ${s.narration}`)
			.join('\n');

		const system =
			'You narrate, in plain present tense, what a web-browsing agent is about to ' +
			'do at each step of a task. Keep each line under 8 words, action-first, no ' +
			'emoji, no quotes. Respond with ONLY a compact JSON object mapping each step ' +
			'id to its narration line. No markdown, no prose.';
		const user =
			`Task: ${task.title} (researching ${task.topic}).\nSteps:\n${stepList}\n\n` +
			'Return JSON like {"open":"…","type":"…"}.';

		try {
			const res = await fetchImpl(`${baseUrl}/api/brain/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ provider, system, messages: [{ role: 'user', content: user }], maxTokens: 400 }),
				signal: AbortSignal.timeout(20_000),
			});
			if (!res.ok || !res.body) return fallback;

			const text = await drainBrainStream(res.body);
			const parsed = parseNarrationJson(text);
			if (!parsed) return fallback;

			// Merge over the fallback so a step the model skipped still has a real line.
			const merged = { ...fallback };
			for (const step of task.steps) {
				const line = parsed[step.id];
				if (typeof line === 'string' && line.trim()) merged[step.id] = line.trim().slice(0, 80);
			}
			return merged;
		} catch {
			return fallback;
		}
	})();

	_narrationCache.set(task.id, promise);
	return promise;
}

// /api/brain/chat streams SSE: `data: <json-encoded-text-chunk>` lines plus
// event lines (meta/first/done/error). Concatenate the data chunks into the full
// model output.
export async function drainBrainStream(body) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let out = '';
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const lines = buf.split('\n');
		buf = lines.pop() || '';
		for (const line of lines) {
			if (!line.startsWith('data:')) continue;
			const raw = line.slice(5).trim();
			if (!raw || raw === '[DONE]') continue;
			try {
				const chunk = JSON.parse(raw);
				if (typeof chunk === 'string') out += chunk;
			} catch { /* event payload, not a text chunk — skip */ }
		}
	}
	return out;
}

// Pull the first balanced JSON object out of the model's text (it may wrap the
// object in stray prose or a code fence despite instructions).
export function parseNarrationJson(text) {
	if (!text) return null;
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end <= start) return null;
	try {
		const obj = JSON.parse(text.slice(start, end + 1));
		return obj && typeof obj === 'object' ? obj : null;
	} catch {
		return null;
	}
}

// The pure sequencer. Walks the task's steps in order, leading every action with
// its narration and following it with a screenshot. Honors an AbortSignal so the
// pool can stop a run the instant nobody is watching the agent anymore. Never
// throws on a single step failure — a failed step narrates the real error and the
// run continues, matching the "errors handled, recover gracefully" bar.
export async function runTaskSteps({ task, narration, executor, signal }) {
	for (const step of task.steps) {
		if (signal?.aborted) return { aborted: true };

		const line = (narration && narration[step.id]) || step.narration;
		await executor.narrate(line, step);

		if (signal?.aborted) return { aborted: true };

		let result = null;
		try {
			result = await executor.perform(step);
		} catch (err) {
			await executor.fail(step, err);
			continue;
		}

		if (signal?.aborted) return { aborted: true };
		await executor.shot(step, result);
	}

	if (signal?.aborted) return { aborted: true };
	await executor.done(task);
	return { aborted: false };
}
