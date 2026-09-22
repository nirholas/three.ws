// The memory nudge: a short reminder the runtime hands the agent at the end of
// a run and every N turns of a conversation, asking it to persist anything
// worth keeping.
//
// The text itself lives in the model-facing operating skill
// (community-skills/skills/three-ws-mcp/SKILL.md, between the memory-nudge
// markers) so the reminder a runtime injects and the guidance a connected MCP
// client reads are one document that cannot drift apart. It is read once per
// process.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILL_PATH = fileURLToPath(new URL('../../../community-skills/skills/three-ws-mcp/SKILL.md', import.meta.url));
const START = '<!-- memory-nudge:start -->';
const END = '<!-- memory-nudge:end -->';

/** Extract the nudge from a SKILL.md body. Throws when the markers are missing. */
export function extractNudge(markdown) {
	const text = String(markdown || '');
	const a = text.indexOf(START);
	const b = text.indexOf(END);
	if (a === -1 || b === -1 || b <= a) {
		throw new Error(`memory nudge markers not found in ${SKILL_PATH}`);
	}
	return text.slice(a + START.length, b).replace(/\s+/g, ' ').trim();
}

let cached = null;

/** The nudge text, loaded from the operating skill on first use. */
export function memoryNudge() {
	if (cached == null) cached = extractNudge(readFileSync(SKILL_PATH, 'utf8'));
	return cached;
}

/**
 * Whether a conversation turn should carry the nudge: every `every` user
 * turns, counting the current one. Turn 1 never does (nothing learned yet).
 */
export function shouldNudge(userTurns, every) {
	const n = Number(userTurns) || 0;
	const k = Math.max(2, Number(every) || 6);
	return n >= k && n % k === 0;
}
