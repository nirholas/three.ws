// docs/mcp.md "Use cases" section: each guided prompt written as the ordered
// tool and resource calls it drives. This suite keeps that section true.
//
//   - Every prompt in api/_mcp/prompts.js has a section.
//   - Every `tool()` the section names is published by at least one hosted
//     server, so removing or renaming a tool turns this red.
//   - Every three:// resource it names is served by at least one hosted server.
//   - Every tool a prompt actually renders is named in that prompt's section,
//     so a new step added to a prompt cannot go undocumented.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const { PROMPTS, promptsFor, renderPrompt } = await import('../api/_mcp/prompts.js');
const { matchResource } = await import('../api/_mcp/resources.js');
const { TOOL_CATALOG: mainCatalog } = await import('../api/_mcp/catalog.js');
const { TOOL_CATALOG: agentCatalog } = await import('../api/_mcpagent/catalog.js');
const { TOOL_CATALOG: studioCatalog } = await import('../api/_mcp3d/catalog.js');
const { TOOL_CATALOG: bazaarCatalog } = await import('../api/_mcpbazaar/catalog.js');

const SERVERS = { mcp: mainCatalog, 'mcp-agent': agentCatalog, 'mcp-3d': studioCatalog, 'mcp-bazaar': bazaarCatalog };
const ALL_TOOLS = new Set(Object.values(SERVERS).flatMap((c) => c.map((t) => t.name)));
const AGENT = '33333333-3333-4333-8333-333333333333';

const doc = readFileSync(new URL('../docs/mcp.md', import.meta.url), 'utf8');

function useCaseSections() {
	const start = doc.indexOf('\n## Use cases\n');
	if (start < 0) return new Map();
	const rest = doc.slice(start + 1);
	const end = rest.indexOf('\n## ', 1);
	const body = end < 0 ? rest : rest.slice(0, end);
	const sections = new Map();
	for (const chunk of body.split(/\n### /).slice(1)) {
		const name = chunk.match(/^`([a-z0-9-]+)`/)?.[1];
		if (name) sections.set(name, chunk);
	}
	return sections;
}

const sections = useCaseSections();
const toolRefs = (text) => [...text.matchAll(/`([a-z][a-z0-9_]*)\(\)`/g)].map((m) => m[1]);
const resourceRefs = (text) => [...text.matchAll(/`(three:\/\/[^`\s]+)`/g)].map((m) => m[1]);

describe('docs/mcp.md use cases', () => {
	it('has a Use cases section', () => {
		expect(sections.size).toBeGreaterThan(0);
	});

	it('covers every guided prompt', () => {
		for (const p of PROMPTS) expect([...sections.keys()], p.name).toContain(p.name);
	});

	it('names only tools a hosted server publishes', () => {
		for (const [prompt, text] of sections) {
			for (const tool of toolRefs(text)) expect(ALL_TOOLS, `${prompt} names ${tool}()`).toContain(tool);
		}
	});

	it('names only resources a hosted server serves', () => {
		for (const [prompt, text] of sections) {
			for (const uri of resourceRefs(text)) {
				const concrete = uri.replace('{agentId}', AGENT).replace('{id}', AGENT);
				const served = Object.keys(SERVERS).some((s) => matchResource(s, concrete));
				expect(served, `${prompt} names ${uri}`).toBe(true);
			}
		}
	});

	it('names every tool its prompt renders', () => {
		for (const [server, catalog] of Object.entries(SERVERS)) {
			for (const prompt of promptsFor(server, catalog)) {
				const args = Object.fromEntries(prompt.arguments.map((a) => [a.name, a.name === 'agentId' ? AGENT : 'sample']));
				const used = renderPrompt(server, catalog, prompt.name, args).tools.filter((t) => t !== 'read_resource');
				const named = new Set(toolRefs(sections.get(prompt.name) || ''));
				for (const tool of used) expect(named, `${prompt.name} on ${server} drives ${tool}()`).toContain(tool);
			}
		}
	});
});
