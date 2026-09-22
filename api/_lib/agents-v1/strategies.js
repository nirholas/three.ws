// Strategy presets (data/agent-strategies.json): named bundles of skills,
// persona text, a default tool allowlist for runs, and default automations.
//
// The file is validated when this module loads, so a malformed preset fails the
// server boot, `npm run check:api-imports` in the deploy gate, and the test
// suite, instead of failing the first user who picks it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_SKILLS } from '../../../src/studio/skills/skills-catalog.js';
import { AGENT_TOOLS } from '../agent-tools.js';
import { normalizeAutomation } from './automations.js';

const STRATEGIES_PATH = fileURLToPath(new URL('../../../data/agent-strategies.json', import.meta.url));
const SKILL_IDS = new Set(ALL_SKILLS.map((s) => s.id));
const NON_SPENDING_ACTIONS = new Set(['notify', 'agent_prompt']);

/**
 * Validate a parsed strategies document. Returns the list of problems; an
 * empty list means it is valid.
 * @param {any} doc
 * @returns {string[]}
 */
export function validateStrategies(doc) {
	const problems = [];
	if (!doc || doc.version !== 1 || !Array.isArray(doc.strategies)) return ['document must be { version: 1, strategies: [...] }'];
	const seen = new Set();
	for (const [i, s] of doc.strategies.entries()) {
		const at = `strategies[${i}]${s?.id ? ` (${s.id})` : ''}`;
		if (!s || typeof s.id !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(s.id)) problems.push(`${at}: id must be a lowercase slug`);
		else if (seen.has(s.id)) problems.push(`${at}: duplicate id`);
		else seen.add(s.id);
		for (const k of ['name', 'summary', 'persona']) {
			if (typeof s?.[k] !== 'string' || !s[k].trim()) problems.push(`${at}: ${k} is required`);
		}
		if (typeof s?.persona === 'string' && s.persona.length > 8000) problems.push(`${at}: persona exceeds 8000 characters`);
		if (!Array.isArray(s?.skills) || !s.skills.length) problems.push(`${at}: skills must be a non-empty array`);
		else for (const id of s.skills) if (!SKILL_IDS.has(id)) problems.push(`${at}: unknown skill "${id}"`);
		if (!Array.isArray(s?.toolsAllowed) || !s.toolsAllowed.length) problems.push(`${at}: toolsAllowed must be a non-empty array`);
		else for (const t of s.toolsAllowed) if (!AGENT_TOOLS[t]) problems.push(`${at}: unknown tool "${t}"`);
		if (typeof s?.temperature !== 'number' || s.temperature < 0 || s.temperature > 2) problems.push(`${at}: temperature must be 0..2`);
		if (!Array.isArray(s?.automations)) problems.push(`${at}: automations must be an array`);
		else {
			for (const [j, a] of s.automations.entries()) {
				try {
					const norm = normalizeAutomation(a);
					if (!NON_SPENDING_ACTIONS.has(norm.action.type)) problems.push(`${at}.automations[${j}]: default automations may only notify or prompt the agent`);
				} catch (err) {
					problems.push(`${at}.automations[${j}]: ${err.message}`);
				}
			}
		}
	}
	return problems;
}

function load() {
	const doc = JSON.parse(readFileSync(STRATEGIES_PATH, 'utf8'));
	const problems = validateStrategies(doc);
	if (problems.length) throw new Error(`data/agent-strategies.json is invalid:\n  ${problems.join('\n  ')}`);
	return doc.strategies;
}

const STRATEGIES = load();
const BY_ID = new Map(STRATEGIES.map((s) => [s.id, s]));

/** Every preset, in file order. */
export function listStrategies() {
	return STRATEGIES;
}

/** One preset by id, or null. */
export function getStrategy(id) {
	return typeof id === 'string' ? BY_ID.get(id) || null : null;
}
