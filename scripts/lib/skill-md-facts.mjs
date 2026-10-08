// The facts both generated skill files state: public/skill.md (every agent
// runtime) and public/grok-skill.md (Grok and Grok Bot). Each fact is read from
// the code or generated file that owns it, so a renamed tool, a moved server or a
// changed free limit reaches both files on the next build, and
// `npm run check:skills-pack` fails until it does.
//
// Templates reference facts by placeholder:
//
//   {{FREE_MCP}}           a scalar fact (the `values` of skillFacts() below)
//   {{tool:forge_free}}    a tool name; renders as the bare name, and the build
//                          fails if no studio surface or Grok account tool has it
//   {{prompt:asset-pack}}  an MCP prompt name; the build fails unless the Grok
//                          connector's directory entry lists it
//
// An unknown placeholder, or a tool or prompt that no longer exists, throws instead of
// shipping a file that tells an agent to call something that is not there.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

// The one $THREE mint (CLAUDE.md "The promoted coin").
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

function server(directory, name) {
	const entry = directory.servers.find((s) => s.name === name);
	if (!entry) throw new Error(`public/.well-known/mcp.json has no server named "${name}"`);
	return entry;
}

/**
 * Every fact the skill templates may name.
 * @returns {Promise<{ values: Record<string, string>, tools: Set<string>, prompts: Set<string> }>}
 */
export async function skillFacts() {
	const directory = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', '.well-known', 'mcp.json'), 'utf8'));
	const { toolCatalogFor, GROK_CALL_BUDGET_MS } = await import('../../api/_mcp-studio/dispatch.js');
	const { GROK_ACCOUNT_TOOLS } = await import('../../api/_mcp-studio/account-tools.js');
	const { STUDIO_LIMITS } = await import('../../api/_lib/rate-limit.js');
	const { POSTER_SIZE } = await import('../../api/_mcp-studio/asset-links.js');
	const { SPEND_BROWSER_URL } = await import('../../api/_lib/spend-scope.js');

	const studioTools = toolCatalogFor('full').map((t) => t.name);
	const grokTools = toolCatalogFor('grok').map((t) => t.name);
	const grok = server(directory, 'Grok');

	const values = {
		SITE: directory.website,
		MAIN_MCP: server(directory, 'three.ws').endpoint,
		FREE_MCP: server(directory, '3D Studio (free)').endpoint,
		GROK_MCP: grok.endpoint,
		GROK_MCP_SIGN_IN: grok.signIn,
		MCP_DIRECTORY: `${directory.website}/.well-known/mcp.json`,
		THREE_MINT,
		FREE_TOOL_COUNT: String(studioTools.length),
		FREE_GEN_PER_MINUTE: String(STUDIO_LIMITS.genBurst.limit),
		FREE_GEN_PER_HOUR: String(STUDIO_LIMITS.genHourly.limit),
		GROK_CALL_BUDGET_SECONDS: String(GROK_CALL_BUDGET_MS / 1000),
		POSTER_SIZE: String(POSTER_SIZE),
		SPEND_URL: SPEND_BROWSER_URL,
	};
	for (const [key, value] of Object.entries(values)) {
		if (!value || value === 'undefined' || value === 'NaN') throw new Error(`skill fact ${key} resolved to nothing`);
	}
	return {
		values,
		tools: new Set([...studioTools, ...grokTools, ...GROK_ACCOUNT_TOOLS]),
		prompts: new Set(grok.prompts || []),
	};
}

/**
 * Substitute every {{FACT}}, {{tool:name}} and {{prompt:name}} in a template.
 * @param {string} template
 * @param {{ values: Record<string, string>, tools: Set<string>, prompts: Set<string> }} facts
 * @param {string} label the template's path, for error messages
 */
export function renderFacts(template, facts, label) {
	return template.replace(/\{\{([A-Za-z0-9_:-]+)\}\}/g, (marker, key) => {
		if (key.startsWith('tool:')) {
			const name = key.slice(5);
			if (!facts.tools.has(name)) throw new Error(`${label}: ${marker} names a tool no studio surface serves`);
			return name;
		}
		if (key.startsWith('prompt:')) {
			const name = key.slice(7);
			if (!facts.prompts.has(name)) throw new Error(`${label}: ${marker} names a prompt the Grok connector does not list`);
			return name;
		}
		if (Object.hasOwn(facts.values, key)) return facts.values[key];
		// Generator-owned markers ({{SKILL_INDEX}}) are filled by the caller.
		if (key === 'SKILL_INDEX') return marker;
		throw new Error(`${label}: unknown placeholder ${marker}`);
	});
}
