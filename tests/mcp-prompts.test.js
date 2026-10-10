// Guided MCP prompts (api/_mcp/prompts.js): every prompt the spec requires is
// offered somewhere, and every prompt a server lists renders with every tool
// and resource it names actually published by that server's tools/list.

import { describe, it, expect } from 'vitest';

const { PROMPTS, promptsFor, renderPrompt, handlePromptMethod } = await import('../api/_mcp/prompts.js');
const { TOOL_CATALOG: mainCatalog } = await import('../api/_mcp/catalog.js');
const { TOOL_CATALOG: agentCatalog } = await import('../api/_mcpagent/catalog.js');
const { TOOL_CATALOG: studioCatalog } = await import('../api/_mcp3d/catalog.js');
const { TOOL_CATALOG: bazaarCatalog } = await import('../api/_mcpbazaar/catalog.js');

const SERVERS = { mcp: mainCatalog, 'mcp-agent': agentCatalog, 'mcp-3d': studioCatalog, 'mcp-bazaar': bazaarCatalog };

const REQUIRED = [
	'get-started', 'create-agent', 'setup-wallet', 'trade', 'launch-token', 'hire-agent', 'sell-a-skill',
	'review-costs', 'setup-automations', 'setup-dca', 'explore-marketplace', 'explore-x402', 'earn-yield',
	'perps', 'predictions', 'embed-avatar', 'generate-3d',
];

// The repo bans the en dash and em dash (U+2013, U+2014) in all copy.
const BANNED_DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const AGENT = '33333333-3333-4333-8333-333333333333';

function sampleArgs(prompt) {
	return Object.fromEntries(
		prompt.arguments.map((a) => [a.name, a.name === 'agentId' ? AGENT : a.name === 'token' ? 'THREEsynthetic1111' : `sample ${a.name}`]),
	);
}

// Every backticked snake_case identifier in a rendered prompt is a tool name,
// a resource field or an argument; the ones that match a tool on ANY server
// must be tools on THIS server.
const ALL_TOOL_NAMES = new Set(Object.values(SERVERS).flatMap((c) => c.map((t) => t.name)));
function backtickedTools(text) {
	return [...text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]).filter((n) => ALL_TOOL_NAMES.has(n));
}

describe('prompt catalog', () => {
	it('defines every required prompt with unique names', () => {
		const names = PROMPTS.map((p) => p.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of REQUIRED) expect(names, name).toContain(name);
	});

	it('offers every required prompt on at least one hosted server', () => {
		const offered = new Set(Object.entries(SERVERS).flatMap(([s, c]) => promptsFor(s, c).map((p) => p.name)));
		for (const name of REQUIRED) expect(offered, name).toContain(name);
	});

	it('offers get-started on every server', () => {
		for (const [server, catalog] of Object.entries(SERVERS)) {
			expect(promptsFor(server, catalog).map((p) => p.name), server).toContain('get-started');
		}
	});
});

describe('every listed prompt renders against its server', () => {
	for (const [server, catalog] of Object.entries(SERVERS)) {
		const toolNames = new Set(catalog.map((t) => t.name));
		for (const prompt of promptsFor(server, catalog)) {
			it(`${server} ${prompt.name}`, () => {
				const out = renderPrompt(server, catalog, prompt.name, sampleArgs(prompt));
				const text = out.messages[0].content.text;
				expect(out.messages[0].role).toBe('user');
				expect(text.length).toBeGreaterThan(80);
				expect(out.tools.length).toBeGreaterThan(0);
				for (const t of out.tools) expect(toolNames, `${prompt.name} names ${t}`).toContain(t);
				for (const t of backtickedTools(text)) expect(toolNames, `${prompt.name} text names ${t}`).toContain(t);
				expect(text).not.toMatch(BANNED_DASHES);
			});
		}
	}
});

describe('venue prompts run on the tools that exist and hand signing to the page that owns it', () => {
	it('trade researches with live tools and hands the swap to the wallet page', () => {
		const out = renderPrompt('mcp', mainCatalog, 'trade', { agentId: AGENT, token: 'THREEsynthetic1111' });
		expect(out.tools).toEqual(expect.arrayContaining(['token_snapshot', 'read_resource']));
		expect(out.messages[0].content.text).toContain(`/agents/${AGENT}/wallet#trade`);
	});

	it('launch-token compares the live launch lanes and sends signing to /launch', () => {
		const out = renderPrompt('mcp', mainCatalog, 'launch-token', { agentId: AGENT, name: 'Synthetic', symbol: 'SYN' });
		expect(out.tools).toContain('launch_lanes');
		expect(out.messages[0].content.text).toContain('https://three.ws/launch');
	});

	it('lending stays research-only and never names an execution tool', () => {
		const out = renderPrompt('mcp', mainCatalog, 'earn-yield', { agentId: AGENT });
		expect(out.tools).toEqual(expect.arrayContaining(['crypto_data', 'read_resource']));
		expect(out.messages[0].content.text).toMatch(/do not move funds from here/i);
	});

	it('perps preview then execute with the confirm flag on mcp-agent, and point there from mcp', () => {
		const out = renderPrompt('mcp-agent', agentCatalog, 'perps', { agentId: AGENT, market: 'SOL' });
		expect(out.tools).toEqual(expect.arrayContaining(['perps_account', 'perps_markets', 'perps_order_preview', 'perps_order_execute']));
		const text = out.messages[0].content.text;
		expect(text).toContain('`confirm_trade: true`');
		expect(text.indexOf('perps_order_preview')).toBeLessThan(text.indexOf('perps_order_execute'));
		const main = renderPrompt('mcp', mainCatalog, 'perps', { agentId: AGENT });
		expect(main.tools).toEqual(expect.arrayContaining(['crypto_data', 'read_resource']));
		expect(main.messages[0].content.text).toContain('https://three.ws/api/mcp-agent');
		expect(main.messages[0].content.text).not.toContain('perps_order_execute');
		expect(main.messages[0].content.text).toMatch(/do not open positions from here/i);
	});

	it('predictions preview then place with the confirm flag on mcp-agent, and point there from mcp', () => {
		const out = renderPrompt('mcp-agent', agentCatalog, 'predictions', { agentId: AGENT, topic: 'synthetic event' });
		expect(out.tools).toEqual(expect.arrayContaining(['predictions_events', 'predictions_open_preview', 'predictions_open']));
		expect(out.messages[0].content.text).toContain('`confirm_trade: true`');
		const main = renderPrompt('mcp', mainCatalog, 'predictions', { agentId: AGENT }).messages[0].content.text;
		expect(main).toContain('https://three.ws/api/mcp-agent');
		expect(main).not.toContain('predictions_open');
	});
});

describe('prompts/* methods', () => {
	it('lists prompts with arguments', () => {
		const out = handlePromptMethod('mcp-agent', agentCatalog, 'prompts/list', {});
		const wallet = out.prompts.find((p) => p.name === 'setup-wallet');
		expect(wallet.arguments).toEqual([{ name: 'agentId', description: expect.any(String), required: true }]);
	});

	it('rejects a missing required argument and an unknown prompt with -32602', () => {
		expect(() => handlePromptMethod('mcp-agent', agentCatalog, 'prompts/get', { name: 'setup-wallet' })).toThrow(
			expect.objectContaining({ code: -32602 }),
		);
		expect(() => handlePromptMethod('mcp-bazaar', bazaarCatalog, 'prompts/get', { name: 'create-agent', arguments: { name: 'x' } })).toThrow(
			expect.objectContaining({ code: -32602 }),
		);
	});

	it('ignores methods it does not own', () => {
		expect(handlePromptMethod('mcp', mainCatalog, 'tools/list', {})).toBeUndefined();
	});
});
