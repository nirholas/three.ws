// Reflection: when enough has happened to a citizen, ask the model what it
// means. The answer is stored as a high-importance memory and surfaced in the
// /play passport. The model is injected (`llm`), so the slow path never imports
// a provider and tests drive it with a recorded response.

export const MAX_INSIGHTS = 3;
export const INSIGHT_MAX = 200;

/** Prompt pair for a reflection over the citizen's most salient recent memories. */
export function reflectionPrompt({ name, profession, memories }) {
	const lines = memories.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
	return {
		system:
			'You write the inner reflections of a citizen in a small on-chain town. Reply with a JSON array of 1 to 3 short first-person insights (each under 200 characters) that connect the memories into a lesson or a belief. No markdown, no extra text.',
		user: `You are ${name}, a ${profession || 'citizen'}.\nYour most important recent memories:\n${lines}\n\nWhat do these tell you about yourself and the town?`,
	};
}

/** Parse a model reply into at most MAX_INSIGHTS clean insights. */
export function parseInsights(text) {
	let list = null;
	const raw = String(text || '').trim();
	const start = raw.indexOf('[');
	const end = raw.lastIndexOf(']');
	if (start >= 0 && end > start) {
		try {
			list = JSON.parse(raw.slice(start, end + 1));
		} catch {
			list = null;
		}
	}
	if (!Array.isArray(list)) return [];
	return list
		.filter((x) => typeof x === 'string')
		.map((x) => x.replace(/\s+/g, ' ').trim().slice(0, INSIGHT_MAX))
		.filter(Boolean)
		.slice(0, MAX_INSIGHTS);
}

/**
 * Run one reflection. Returns {text, insights, at} or null when the model gave
 * nothing usable (the stream is then left to reflect again later).
 */
export async function reflect({ name, profession, stream, llm, now = Date.now() }) {
	const memories = stream.retrieve(`${profession || ''} ${name}`, { k: 10, now });
	if (!memories.length) return null;
	const { system, user } = reflectionPrompt({ name, profession, memories });
	const reply = await llm({ system, user, maxTokens: 400 });
	const insights = parseInsights(reply?.text);
	if (!insights.length) return null;
	for (const text of insights) stream.observe({ kind: 'reflection', text }, now);
	stream.markReflected();
	return { text: insights.join(' '), insights, at: now };
}
