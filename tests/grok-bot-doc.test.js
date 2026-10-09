// docs/grok-bot.md is the reference a Grok Bot integrator copies from: tool
// calls, prompt names, limit numbers and the troubleshooting table for the
// connector probe. Each of those has a source of truth in code, and this test
// fails when the doc and the code disagree, so a renamed tool, a retuned limit
// or a new probe failure breaks the build instead of the integration.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

process.env.PUBLIC_APP_ORIGIN ||= 'https://three.ws';

const { toolCatalogFor } = await import('../api/_mcp-studio/dispatch.js');
const { GROK_ACCOUNT_TOOLS } = await import('../api/_mcp-studio/account-tools.js');
const { PROMPTS } = await import('../api/_mcp/prompts.js');
const { STUDIO_LIMITS } = await import('../api/_lib/rate-limit.js');
const { GROK_ENDPOINT, slugForEndpoint } = await import('../src/grok-connector.js');

const ROOT = path.resolve(import.meta.dirname, '..');
const doc = fs.readFileSync(path.join(ROOT, 'docs/grok-bot.md'), 'utf8');
const bashBlocks = [...doc.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);

const STUDIO = new Map(toolCatalogFor('grok').map((t) => [t.name, t]));
const SERVED = new Set([...STUDIO.keys(), ...GROK_ACCOUNT_TOOLS]);
// The one sample that calls a tool on purpose to show it is not served.
const REFUSED_SAMPLE = 'agent_card_create';

// Every JSON-RPC body a sample sends with -d '...'.
const sentBodies = bashBlocks.flatMap((src) => [...src.matchAll(/-d '(\{"jsonrpc"[^']*)'/g)].map((m) => JSON.parse(m[1])));

describe('docs/grok-bot.md samples call what /api/mcp-grok serves', () => {
	it('has runnable samples for every contract the doc covers', () => {
		const methods = sentBodies.map((b) => (b.method === 'tools/call' ? b.params.name : b.method));
		expect(methods).toEqual(expect.arrayContaining(['initialize', 'tools/list', 'prompts/list', 'prompts/get', 'search_catalog', 'forge_free']));
		expect(bashBlocks.some((src) => src.includes('name:"get_job"'))).toBe(true);
		expect(bashBlocks.some((src) => src.includes('/api/mcp-studio/install'))).toBe(true);
	});

	it('every tools/call names a served tool with arguments its inputSchema accepts', () => {
		for (const body of sentBodies.filter((b) => b.method === 'tools/call')) {
			const { name, arguments: args = {} } = body.params;
			if (name === REFUSED_SAMPLE) continue;
			const tool = STUDIO.get(name);
			expect(tool, name).toBeTruthy();
			const props = Object.keys(tool.inputSchema?.properties || {});
			expect(Object.keys(args).filter((k) => !props.includes(k)), name).toEqual([]);
			expect((tool.inputSchema?.required || []).filter((k) => !(k in args)), name).toEqual([]);
		}
	});

	it('the refused-tool sample really is refused on this surface', () => {
		expect(sentBodies.some((b) => b.params?.name === REFUSED_SAMPLE)).toBe(true);
		expect(SERVED.has(REFUSED_SAMPLE)).toBe(false);
	});

	it('every generation sample carries an idempotency_key', () => {
		for (const body of sentBodies.filter((b) => b.params?.name === 'forge_free')) {
			expect(body.params.arguments.idempotency_key).toBeTruthy();
		}
	});
});

describe('docs/grok-bot.md matches the code it describes', () => {
	it('lists exactly the account tools a signed-in connector can get', () => {
		const section = doc.slice(doc.indexOf('**On `/api/mcp-grok`, value-moving tools do not exist.**'), doc.indexOf('**On every other hosted server**'));
		const named = new Set([...section.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => n !== REFUSED_SAMPLE));
		expect([...named].sort()).toEqual([...GROK_ACCOUNT_TOOLS].sort());
	});

	it('the prompts table is every agent prompt', () => {
		const table = doc.slice(doc.indexOf('| Prompt | Arguments | Listed |'));
		const rows = [...table.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
		expect(rows.sort()).toEqual(PROMPTS.filter((p) => p.agent).map((p) => p.name).sort());
	});

	it('the limits table states the enforced numbers', () => {
		const row = (label) => doc.match(new RegExp(`^\\| ${label} \\| ([0-9]+) `, 'm'))?.[1];
		expect(Number(row('Generation burst'))).toBe(STUDIO_LIMITS.genBurst.limit);
		expect(Number(row('Generation hourly'))).toBe(STUDIO_LIMITS.genHourly.limit);
		expect(Number(row('Per-IP pool'))).toBe(STUDIO_LIMITS.genPoolHourly.limit);
		expect(Number(row('Transport'))).toBe(STUDIO_LIMITS.transport.limit);
		expect(Number(row('Platform breaker'))).toBe(STUDIO_LIMITS.genGlobal.limit);
		expect(Number(row('Install token minting'))).toBe(STUDIO_LIMITS.installMint.limit);
	});

	it('uses the connector name the CLI and /connect use', () => {
		const slug = slugForEndpoint(GROK_ENDPOINT);
		expect(doc).toContain(`called ${slug} at ${GROK_ENDPOINT}`);
		expect(doc).toContain(`| Name | \`${slug}\` |`);
	});
});

describe('troubleshooting covers every failure the connector probe reports', () => {
	// The static start of each message scripts/mcp-client-probe.mjs can print.
	const probe = fs.readFileSync(path.join(ROOT, 'scripts/mcp-client-probe.mjs'), 'utf8');
	const messages = [
		...probe.matchAll(/failures\.push\(\s*[`'](.*?)[`']\s*\)/g),
		...probe.matchAll(/return '([A-Z][^']+)';/g),
		...probe.matchAll(/: '(GET [^']+)'/g),
		...probe.matchAll(/return `(GET [^`]+)`/g),
	].map((m) => m[1].split('${')[0].replace(/\.trim\(\)$/, '').trim());

	it('finds the probe messages', () => {
		expect(messages.length).toBeGreaterThanOrEqual(22);
	});

	it('has a row for each one', () => {
		const table = doc.slice(doc.indexOf('| Probe says |'), doc.indexOf('### Errors a connected Grok Bot can see'));
		expect(messages.filter((m) => m && !table.includes(m))).toEqual([]);
	});
});
