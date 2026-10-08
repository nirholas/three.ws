// Guided MCP prompts (api/_mcp/prompts.js): every prompt the spec requires is
// offered somewhere, and every prompt a server lists renders with every tool
// and resource it names actually published by that server's tools/list.

import { describe, it, expect } from 'vitest';

const { PROMPTS, promptsFor, renderPrompt, handlePromptMethod } = await import('../api/_mcp/prompts.js');
const { TOOL_CATALOG: mainCatalog } = await import('../api/_mcp/catalog.js');
const { TOOL_CATALOG: agentCatalog } = await import('../api/_mcpagent/catalog.js');
const { TOOL_CATALOG: studioCatalog } = await import('../api/_mcp3d/catalog.js');
const { TOOL_CATALOG: bazaarCatalog } = await import('../api/_mcpbazaar/catalog.js');

const { toolCatalogFor, dispatch: studioDispatch } = await import('../api/_mcp-studio/dispatch.js');
const { isAccountTool } = await import('../api/_mcp-studio/account-tools.js');

const SERVERS = { mcp: mainCatalog, 'mcp-agent': agentCatalog, 'mcp-3d': studioCatalog, 'mcp-bazaar': bazaarCatalog };

// The studio surfaces (x-grok order 031). /api/mcp-grok lists the account's
// agent tools on top of the studio for a signed-in caller, so it renders twice.
const freeStudio = toolCatalogFor('full');
const grokAnon = toolCatalogFor('grok');
const grokSignedIn = [...grokAnon, ...mainCatalog.filter((t) => isAccountTool(t.name))];
const AGENT_SURFACES = [
	['mcp-studio', 'mcp-studio', freeStudio],
	['mcp-grok', 'mcp-grok', grokAnon],
	['mcp-grok signed in', 'mcp-grok', grokSignedIn],
];
const AGENT_PROMPTS = ['agent-get-started', 'daily-3d-brief', 'asset-pack', 'avatar-from-photo', 'agent-report'];
const GENERATION_PROMPTS = ['daily-3d-brief', 'asset-pack', 'avatar-from-photo'];

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
		prompt.arguments.map((a) => [
			a.name,
			a.name === 'agentId' ? AGENT : a.name === 'token' ? 'THREEsynthetic1111' : a.name === 'image_url' ? 'https://three.ws/og.png' : `sample ${a.name}`,
		]),
	);
}

// Every backticked snake_case identifier in a rendered prompt is a tool name,
// a resource field or an argument; the ones that match a tool on ANY server
// must be tools on THIS server.
const ALL_TOOL_NAMES = new Set([...Object.values(SERVERS), grokSignedIn].flatMap((c) => c.map((t) => t.name)));
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

describe('agent prompts render against every surface that lists them', () => {
	for (const [label, server, catalog] of AGENT_SURFACES) {
		const toolNames = new Set(catalog.map((t) => t.name));
		for (const prompt of promptsFor(server, catalog)) {
			it(`${label} ${prompt.name}`, () => {
				const out = renderPrompt(server, catalog, prompt.name, sampleArgs(prompt));
				const text = out.messages[0].content.text;
				expect(out.tools.length).toBeGreaterThan(0);
				for (const t of out.tools) expect(toolNames, `${prompt.name} names ${t}`).toContain(t);
				for (const t of backtickedTools(text)) expect(toolNames, `${prompt.name} text names ${t}`).toContain(t);
				expect(text).not.toMatch(BANNED_DASHES);
			});
		}
	}
});

describe('agent prompts for an unattended agent (x-grok order 031)', () => {
	const names = (server, catalog) => promptsFor(server, catalog).map((p) => p.name);

	it('lists them on the right surfaces', () => {
		expect(names('mcp-studio', freeStudio)).toEqual(['agent-get-started', 'daily-3d-brief', 'asset-pack', 'avatar-from-photo']);
		expect(names('mcp-grok', grokAnon)).toEqual(['agent-get-started', 'daily-3d-brief', 'asset-pack', 'avatar-from-photo']);
		expect(names('mcp-grok', grokSignedIn)).toEqual(AGENT_PROMPTS);
		// The core server holds the account tools and no free generation.
		expect(names('mcp', mainCatalog)).toEqual(expect.arrayContaining(['agent-get-started', 'agent-report']));
		for (const name of GENERATION_PROMPTS) expect(names('mcp', mainCatalog)).not.toContain(name);
	});

	it('keeps the human prompts off the studio surfaces', () => {
		for (const [, server, catalog] of AGENT_SURFACES) {
			for (const name of names(server, catalog)) expect(AGENT_PROMPTS, `${server} lists ${name}`).toContain(name);
		}
	});

	it('keys every generation call with an idempotency_key', () => {
		for (const name of GENERATION_PROMPTS) {
			const def = PROMPTS.find((p) => p.name === name);
			const text = renderPrompt('mcp-grok', grokAnon, name, sampleArgs(def)).messages[0].content.text;
			const calls = [...text.matchAll(/`(forge_free|forge_avatar|refine_model|rig_mesh|mesh_forge|text_to_avatar)` with `(\{[^`]*\})`/g)];
			expect(calls.length, name).toBeGreaterThan(0);
			for (const [, tool, json] of calls) expect(JSON.parse(json), `${name} ${tool}`).toHaveProperty('idempotency_key');
		}
	});

	it('spells out argument objects that validate against each tool schema', () => {
		const byName = new Map(grokSignedIn.map((t) => [t.name, t]));
		for (const name of AGENT_PROMPTS) {
			const def = PROMPTS.find((p) => p.name === name);
			const text = renderPrompt('mcp-grok', grokSignedIn, name, sampleArgs(def)).messages[0].content.text;
			for (const [, tool, json] of text.matchAll(/`([a-z_]+)` with `(\{[^`]*\})`/g)) {
				const props = byName.get(tool).inputSchema.properties;
				for (const key of Object.keys(JSON.parse(json))) expect(props, `${name}: ${tool}.${key}`).toHaveProperty(key);
			}
		}
	});

	it('a renamed tool or argument breaks the render instead of shipping a dead call', () => {
		const renamed = freeStudio.map((t) => (t.name === 'forge_free' ? { ...t, name: 'forge_model' } : t));
		expect(names('mcp-studio', renamed)).not.toContain('daily-3d-brief');
		expect(() => renderPrompt('mcp-studio', renamed, 'daily-3d-brief', {})).toThrow(expect.objectContaining({ code: -32602 }));

		const noKey = freeStudio.map((t) => {
			if (t.name !== 'forge_free') return t;
			const { idempotency_key: _gone, ...properties } = t.inputSchema.properties;
			return { ...t, inputSchema: { ...t.inputSchema, properties } };
		});
		expect(() => renderPrompt('mcp-studio', noKey, 'daily-3d-brief', {})).toThrow(/idempotency_key/);
	});

	it('daily-3d-brief picks a trending topic itself unless given one', () => {
		const trending = renderPrompt('mcp-studio', freeStudio, 'daily-3d-brief', {}).messages[0].content.text;
		expect(trending).toMatch(/most talked-about topic/);
		const given = renderPrompt('mcp-studio', freeStudio, 'daily-3d-brief', { topic: 'the solar eclipse' }).messages[0].content.text;
		expect(given).toContain('the solar eclipse');
		expect(given).toContain('poster_png_url');
	});

	it('asset-pack clamps its count and searches before it generates', () => {
		const text = renderPrompt('mcp-studio', freeStudio, 'asset-pack', { theme: 'retro arcade', count: '40' }).messages[0].content.text;
		expect(text).toContain('a pack of 12 3D assets');
		expect(text.indexOf('`search_catalog`')).toBeLessThan(text.indexOf('`forge_free`'));
	});

	it('avatar-from-photo returns a pose studio link', () => {
		const text = renderPrompt('mcp-grok', grokAnon, 'avatar-from-photo', { image_url: 'https://three.ws/og.png' }).messages[0].content.text;
		expect(text).toContain('https://three.ws/pose?src=');
		expect(text).toContain('"image_url":"https://three.ws/og.png"');
	});
});

describe('studio dispatcher prompts/*', () => {
	const call = (surface, method, params = {}) => studioDispatch({ jsonrpc: '2.0', id: 1, method, params }, null, { headers: {} }, { surface });

	it('serves the agent prompts on the free studio and none on ChatGPT', async () => {
		const full = await call('full', 'prompts/list');
		expect(full.result.prompts.map((p) => p.name)).toEqual(['agent-get-started', 'daily-3d-brief', 'asset-pack', 'avatar-from-photo']);
		expect((await call('chatgpt', 'prompts/list')).result.prompts).toEqual([]);
		expect((await call('full', 'initialize')).result.capabilities.prompts).toEqual({ listChanged: false });
		expect((await call('chatgpt', 'initialize')).result.capabilities.prompts).toBeUndefined();
	});

	it('renders prompts/get and refuses a missing required argument', async () => {
		const got = await call('full', 'prompts/get', { name: 'asset-pack', arguments: { theme: 'space station', count: '3' } });
		expect(got.result.messages[0].content.text).toContain('a pack of 3 3D assets for the theme "space station"');
		const missing = await call('full', 'prompts/get', { name: 'avatar-from-photo', arguments: {} });
		expect(missing.error.code).toBe(-32602);
	});
});

describe('venue prompts switch on when their tools exist', () => {
	// A synthetic catalog entry stands in for a venue tool a later build adds;
	// the prompt must name it, and name the confirm flag its schema declares.
	const withVenue = (...tools) => [...mainCatalog, ...tools];
	const tool = (name, props = {}) => ({ name, description: name, inputSchema: { type: 'object', properties: props } });

	it('trade uses swap_quote then swap_execute with its confirm flag', () => {
		const catalog = withVenue(tool('swap_quote'), tool('swap_execute', { quote_id: { type: 'string' }, confirm_swap: { type: 'boolean' } }));
		const out = renderPrompt('mcp', catalog, 'trade', { agentId: AGENT, token: 'THREEsynthetic1111' });
		expect(out.tools).toEqual(expect.arrayContaining(['swap_quote', 'swap_execute']));
		expect(out.messages[0].content.text).toContain('`confirm_swap: true`');
	});

	it('trade without swap tools says execution is not enabled and points at the wallet page', () => {
		const text = renderPrompt('mcp', mainCatalog, 'trade', { agentId: AGENT, token: 'x' }).messages[0].content.text;
		expect(text).toMatch(/not enabled on this MCP server yet/);
		expect(text).toContain(`/agents/${AGENT}/wallet#trade`);
	});

	it('perps, lending and predictions name their venue tools once present', () => {
		const catalog = withVenue(
			tool('perps_markets'),
			tool('perps_order_preview'),
			tool('perps_order_execute', { confirm_trade: { type: 'boolean' } }),
			tool('lend_markets'),
			tool('lend_deposit', { confirm_deposit: { type: 'boolean' } }),
			tool('predictions_events'),
			tool('predictions_open', { confirm_trade: { type: 'boolean' } }),
		);
		expect(renderPrompt('mcp', catalog, 'perps', { agentId: AGENT }).tools).toContain('perps_order_execute');
		expect(renderPrompt('mcp', catalog, 'earn-yield', { agentId: AGENT }).messages[0].content.text).toContain('`confirm_deposit: true`');
		expect(renderPrompt('mcp', catalog, 'predictions', { agentId: AGENT }).tools).toContain('predictions_open');
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
