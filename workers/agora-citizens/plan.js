// Planning: a short ordered list of intentions drawn from the citizen's
// reflections and recent memories. Bounded in length so a verbose model cannot
// bloat the passport or the stored document.

export const MAX_PLAN_STEPS = 5;
export const PLAN_STEP_MAX = 120;

export function planPrompt({ name, profession, memories, reflection }) {
	const lines = memories.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
	return {
		system:
			'You plan the next stretch of a citizen of a small on-chain town. Reply with a JSON array of 2 to 5 short imperative steps (each under 120 characters) the citizen will take next, in order. Only actions inside the town: seek work, post a bounty, vouch for a peer, rest, wander. No markdown, no extra text.',
		user: `You are ${name}, a ${profession || 'citizen'}.\n${reflection ? `Latest reflection: ${reflection}\n` : ''}Relevant memories:\n${lines}\n\nWhat will you do next?`,
	};
}

/** Parse a model reply into 1..MAX_PLAN_STEPS trimmed steps (empty on garbage). */
export function parsePlan(text) {
	const raw = String(text || '').trim();
	const start = raw.indexOf('[');
	const end = raw.lastIndexOf(']');
	if (start < 0 || end <= start) return [];
	let list;
	try {
		list = JSON.parse(raw.slice(start, end + 1));
	} catch {
		return [];
	}
	if (!Array.isArray(list)) return [];
	return list
		.filter((x) => typeof x === 'string')
		.map((x) => x.replace(/\s+/g, ' ').trim().slice(0, PLAN_STEP_MAX))
		.filter(Boolean)
		.slice(0, MAX_PLAN_STEPS);
}

/** Make a plan. Returns {steps, at} or null when the model gave nothing usable. */
export async function makePlan({ name, profession, stream, reflection, llm, now = Date.now() }) {
	const memories = stream.retrieve(`${profession || ''} ${reflection || ''}`, { k: 8, now });
	if (!memories.length) return null;
	const { system, user } = planPrompt({ name, profession, memories, reflection });
	const reply = await llm({ system, user, maxTokens: 400 });
	const steps = parsePlan(reply?.text);
	return steps.length ? { steps, at: now } : null;
}
