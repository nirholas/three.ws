// The "Use cases" section of docs/mcp.md writes every guided prompt
// (api/_mcp/prompts.js) out as the ordered tool and resource calls it drives.
// This suite holds that section to the live catalogs so it cannot drift:
//   - every prompt has a use case, and every server that offers a prompt is
//     covered by one of its "On `server`:" blocks;
//   - every tool a block names is published by that server's tools/list, and
//     every three:// resource it names is served there;
//   - a block names exactly the tools the prompt renders on that server, so a
//     prompt that starts calling a new tool forces the doc to follow;
//   - a step that calls a destructive (fund-moving) tool is marked
//     "Spends money.".
//
// Inside the numbered steps, backticks hold only tool names (snake_case),
// three:// resource URIs, and other literals with no snake_case shape (MCP
// method names, page paths), so the parser below can read them unambiguously.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

const { PROMPTS, promptsFor, renderPrompt, resourceHost } = await import('../api/_mcp/prompts.js');
const { matchResource } = await import('../api/_mcp/resources.js');
const { TOOL_CATALOG: mainCatalog } = await import('../api/_mcp/catalog.js');
const { TOOL_CATALOG: agentCatalog } = await import('../api/_mcpagent/catalog.js');
const { TOOL_CATALOG: studioCatalog } = await import('../api/_mcp3d/catalog.js');
const { TOOL_CATALOG: bazaarCatalog } = await import('../api/_mcpbazaar/catalog.js');

const { toolCatalogFor } = await import('../api/_mcp-studio/dispatch.js');
const { isAccountTool } = await import('../api/_mcp-studio/account-tools.js');

// The free studio and the Grok connector serve the prompts written for an
// unattended agent. Grok is audited as a signed-in connector sees it (the studio
// plus the account tools), the shape its use cases document.
const SERVERS = {
	mcp: mainCatalog,
	'mcp-agent': agentCatalog,
	'mcp-3d': studioCatalog,
	'mcp-bazaar': bazaarCatalog,
	'mcp-studio': toolCatalogFor('full'),
	'mcp-grok': [...toolCatalogFor('grok'), ...mainCatalog.filter((t) => isAccountTool(t.name))],
};

// Single-word tool names (remember, recall) have no snake_case shape, so a
// backticked word also counts as a tool when some server publishes it.
const KNOWN_TOOLS = new Set(Object.values(SERVERS).flatMap((c) => c.map((t) => t.name)));

const DOC = readFileSync(new URL('../docs/mcp.md', import.meta.url), 'utf8');

const SPEND_MARK = '**Spends money.**';
const TOOL_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** The text of the `## Use cases` section, up to the next top-level heading. */
function useCasesSection(doc) {
	const start = doc.indexOf('\n## Use cases\n');
	if (start === -1) return null;
	const rest = doc.slice(start + 1);
	const end = rest.indexOf('\n## ', 3);
	return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Parse the section into use cases:
 *   [{ prompt, blocks: [{ servers: [..], steps: [{ text, tools, resources, spends }] }] }]
 */
function parseUseCases(section) {
	const cases = [];
	for (const chunk of section.split(/\n### /).slice(1)) {
		const heading = chunk.split('\n', 1)[0];
		const prompt = heading.match(/\(`([a-z0-9-]+)`\)\s*$/)?.[1] ?? null;
		const blocks = [];
		let block = null;
		for (const line of chunk.split('\n').slice(1)) {
			const on = line.match(/^On ((?:`[a-z0-9-]+`(?:, | and )?)+)(?: \([^)]*\))?:$/);
			if (on) {
				block = { servers: [...on[1].matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]), steps: [] };
				blocks.push(block);
				continue;
			}
			const step = line.match(/^\d+\. (.*)$/);
			if (step && block) {
				const ticks = [...step[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
				block.steps.push({
					text: step[1],
					tools: ticks.filter((t) => TOOL_RE.test(t) || KNOWN_TOOLS.has(t)),
					resources: ticks.filter((t) => t.startsWith('three://')),
					spends: step[1].startsWith(SPEND_MARK),
				});
			}
		}
		cases.push({ heading, prompt, blocks });
	}
	return cases;
}

/** Sample arguments: every argument, or required ones only. */
function sampleArgs(prompt, { optional }) {
	const args = {};
	for (const a of prompt.arguments) {
		if (!a.required && !optional) continue;
		args[a.name] = a.name === 'agentId' ? '{agentId}' : a.name === 'token' ? 'THREEsynthetic1111' : `sample ${a.name}`;
	}
	return args;
}

/** Every tool and resource a prompt can name on a server, across its argument shapes. */
function renderedCalls(server, prompt) {
	const catalog = SERVERS[server];
	const tools = new Set();
	const resources = new Set();
	for (const optional of [true, false]) {
		const out = renderPrompt(server, catalog, prompt.name, sampleArgs(prompt, { optional }));
		out.tools.forEach((t) => tools.add(t));
		out.resources.forEach((r) => resources.add(r));
	}
	return { tools, resources };
}

/**
 * Check the parsed use cases against the live catalogs. Returns a list of
 * human-readable problems; empty means the section matches the code.
 */
function auditUseCases(cases, servers = SERVERS) {
	const problems = [];
	const byPrompt = new Map(cases.map((c) => [c.prompt, c]));
	for (const c of cases) {
		if (!c.prompt) problems.push(`use case "${c.heading}" does not name its prompt as (\`name\`)`);
		else if (!PROMPTS.some((p) => p.name === c.prompt)) problems.push(`use case names unknown prompt ${c.prompt}`);
	}
	for (const prompt of PROMPTS) {
		const c = byPrompt.get(prompt.name);
		if (!c) {
			problems.push(`prompt ${prompt.name} has no use case`);
			continue;
		}
		const offeredOn = Object.entries(servers)
			.filter(([s, catalog]) => promptsFor(s, catalog).some((p) => p.name === prompt.name))
			.map(([s]) => s);
		const documentedOn = new Set(c.blocks.flatMap((b) => b.servers));
		for (const s of offeredOn) {
			if (!documentedOn.has(s)) problems.push(`${prompt.name}: offered on ${s} but no "On \`${s}\`:" block`);
		}
		for (const block of c.blocks) {
			if (!block.steps.length) problems.push(`${prompt.name}: block for ${block.servers.join(', ')} has no steps`);
			const named = new Set(block.steps.flatMap((st) => st.tools));
			const namedResources = new Set(block.steps.flatMap((st) => st.resources));
			for (const server of block.servers) {
				const catalog = servers[server];
				if (!catalog) {
					problems.push(`${prompt.name}: unknown server ${server}`);
					continue;
				}
				const byName = new Map(catalog.map((t) => [t.name, t]));
				for (const tool of named) {
					if (!byName.has(tool)) problems.push(`${prompt.name} on ${server}: names tool ${tool}, which ${server} does not publish`);
				}
				for (const uri of namedResources) {
					if (!matchResource(resourceHost(server), uri)) problems.push(`${prompt.name} on ${server}: names resource ${uri}, which ${server} does not serve`);
				}
				if (!offeredOn.includes(server)) {
					problems.push(`${prompt.name}: documented on ${server}, which does not offer it`);
					continue;
				}
				const rendered = renderedCalls(server, prompt);
				for (const tool of rendered.tools) {
					if (!named.has(tool)) problems.push(`${prompt.name} on ${server}: the prompt calls ${tool}, which the use case does not name`);
				}
				for (const tool of named) {
					if (!rendered.tools.has(tool)) problems.push(`${prompt.name} on ${server}: the use case names ${tool}, which the prompt never calls`);
				}
				for (const uri of rendered.resources) {
					if (!namedResources.has(uri)) problems.push(`${prompt.name} on ${server}: the prompt reads ${uri}, which the use case does not name`);
				}
				for (const step of block.steps) {
					for (const tool of step.tools) {
						if (byName.get(tool)?.annotations?.destructiveHint === true && !step.spends) {
							problems.push(`${prompt.name} on ${server}: step calling ${tool} moves funds but is not marked ${SPEND_MARK}`);
						}
					}
				}
			}
		}
	}
	return problems;
}

const section = useCasesSection(DOC);

describe('docs/mcp.md use cases', () => {
	it('has a Use cases section', () => {
		expect(section).toBeTruthy();
	});

	const cases = parseUseCases(section || '');

	it('covers every guided prompt, in prompt-catalog order', () => {
		expect(cases.map((c) => c.prompt)).toEqual(PROMPTS.map((p) => p.name));
	});

	it('names only live tools and resources, and exactly the ones each prompt calls', () => {
		expect(auditUseCases(cases)).toEqual([]);
	});

	it('marks at least one spending step, and every spending step says what moves', () => {
		const spends = cases.flatMap((c) => c.blocks.flatMap((b) => b.steps.filter((s) => s.spends)));
		expect(spends.length).toBeGreaterThan(0);
		for (const s of spends) expect(s.text.length).toBeGreaterThan(SPEND_MARK.length + 20);
	});

	it('fails when a tool the section names disappears from its server', () => {
		// The drift this suite exists for: drop pay_and_call from mcp-agent and the
		// audit must name it, not pass silently.
		const without = { ...SERVERS, 'mcp-agent': agentCatalog.filter((t) => t.name !== 'pay_and_call') };
		const problems = auditUseCases(cases, without);
		expect(problems.some((p) => p.includes('pay_and_call'))).toBe(true);
	});
});
