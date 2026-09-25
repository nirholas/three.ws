// The memory nudge: the reminder an agent runtime hands the model at the end
// of a run and every N turns of a conversation, asking it to persist anything
// worth keeping through its memory tools.
//
// One module, two runtimes: the hosted loop (api/agent/run.js, agent runs and
// the chat copilot on three.ws) and the local runtime (@three-ws/agent) both
// import it from here, so the text and the cadence cannot drift between them.
// The same text is published to connected MCP clients in the operating skill
// (community-skills/skills/three-ws-mcp/SKILL.md, between the memory-nudge
// markers); tests/agent-learning.test.js fails if the two ever differ.

export const MEMORY_NUDGE =
	'Before you finish: is there anything from this exchange worth remembering next time? Save only what is durable and specific: a preference the person stated or showed (kind preference), a fact about their situation or goals (kind user-model, with a section), a correction to something you believed, or the steps of a task that worked (kind procedure). One idea per memory, written so it makes sense with no other context. Skip small talk, one-off details, anything already in memory, and secrets such as keys, passwords or seed phrases. If nothing qualifies, save nothing and do not mention memory.';

/** Default cadence: a nudge every this many user turns. */
export const DEFAULT_NUDGE_EVERY_TURNS = 6;

/** How many user messages a transcript holds (the current one included). */
export function countUserTurns(messages) {
	let n = 0;
	for (const m of messages || []) if (m && m.role === 'user') n++;
	return n;
}

/**
 * Whether a conversation turn should carry the nudge: every `every` user
 * turns, counting the current one. Turn 1 never does (nothing learned yet).
 */
export function shouldNudge(userTurns, every = DEFAULT_NUDGE_EVERY_TURNS) {
	const n = Number(userTurns) || 0;
	const k = Math.max(2, Number(every) || DEFAULT_NUDGE_EVERY_TURNS);
	return n >= k && n % k === 0;
}

/**
 * The nudge as a system message, or null when this turn should not carry it.
 * `final: true` is the end-of-run nudge and always fires.
 *
 * @param {{ messages?: Array<{role:string}>, every?: number, final?: boolean }} o
 * @returns {{ role: 'system', content: string } | null}
 */
export function memoryNudgeMessage({ messages = [], every = DEFAULT_NUDGE_EVERY_TURNS, final = false } = {}) {
	if (!final && !shouldNudge(countUserTurns(messages), every)) return null;
	return { role: 'system', content: MEMORY_NUDGE };
}
