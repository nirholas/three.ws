// The memory nudge on the hosted side.
//
// The text and cadence live in @three-ws/agent-runtime (utils/memoryNudge.js)
// so the hosted loop and the local runtime (@three-ws/agent) share one module.
// The model-facing operating skill publishes the same text to MCP clients
// (community-skills/skills/three-ws-mcp/SKILL.md, between the memory-nudge
// markers); extractNudge() reads that block so a test can prove the two match.

import {
	MEMORY_NUDGE,
	DEFAULT_NUDGE_EVERY_TURNS,
	countUserTurns,
	shouldNudge,
	memoryNudgeMessage,
} from '@three-ws/agent-runtime';

export { MEMORY_NUDGE, DEFAULT_NUDGE_EVERY_TURNS, countUserTurns, shouldNudge, memoryNudgeMessage };

const START = '<!-- memory-nudge:start -->';
const END = '<!-- memory-nudge:end -->';

/** Extract the nudge from a SKILL.md body. Throws when the markers are missing. */
export function extractNudge(markdown) {
	const text = String(markdown || '');
	const a = text.indexOf(START);
	const b = text.indexOf(END);
	if (a === -1 || b === -1 || b <= a) throw new Error('memory nudge markers not found');
	return text.slice(a + START.length, b).replace(/\s+/g, ' ').trim();
}

/** The nudge text. */
export function memoryNudge() {
	return MEMORY_NUDGE;
}
