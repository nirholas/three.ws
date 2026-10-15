import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeStore } from '../src/store.js';
import { main } from '../src/cli.js';
import { isImportUrl } from '../src/commands/skills.js';

const ORIGIN = 'https://three.ws';
const KEY = 'sk_live_cli_skills_test_key_00000000';

function tempEnv() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-skills-'));
	return { home, platform: process.platform, cwd: home, vars: { THREE_WS_NO_BROWSER: '1' } };
}

function reply(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function run(argv, env) {
	let out = '';
	const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		out += String(chunk);
		return true;
	});
	const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	try {
		const code = await main(argv, env);
		return { code, out, json: argv.includes('--json') && out ? JSON.parse(out) : null };
	} finally {
		write.mockRestore();
		err.mockRestore();
	}
}

describe('isImportUrl', () => {
	it('tells a community slug apart from a spec URL or a bare owner/repo', () => {
		expect(isImportUrl('risk-manager')).toBe(false);
		expect(isImportUrl('dca-planner')).toBe(false);
		expect(isImportUrl('https://petstore3.swagger.io/api/v3/openapi.json')).toBe(true);
		expect(isImportUrl('http://example.com/spec.yaml')).toBe(true);
		expect(isImportUrl('sindresorhus/is-up')).toBe(true);
	});
});

describe('three-ws skills import <url>', () => {
	let env;
	let fetchMock;
	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	const DRAFT = {
		id: 'd1',
		kind: 'openapi',
		enabled: false,
		sourceUrl: 'https://petstore3.swagger.io/api/v3/openapi.json',
		bundleUri: '/api/skills/import/d1/',
		manifest: { provides: { tools: ['getPetById', 'findPetsByStatus'] } },
	};

	it('posts the url to /api/skills/import and returns the generated draft as --json', async () => {
		fetchMock.mockResolvedValueOnce(reply(201, { data: DRAFT }));
		const { code, json } = await run(
			['skills', 'import', 'https://petstore3.swagger.io/api/v3/openapi.json', '--json', '--origin', ORIGIN],
			env,
		);
		expect(code).toBe(0);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${ORIGIN}/api/skills/import`);
		expect(init.method).toBe('POST');
		expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
		expect(JSON.parse(init.body)).toEqual({ url: 'https://petstore3.swagger.io/api/v3/openapi.json' });
		expect(json.id).toBe('d1');
	});

	it('reports the generated draft in plain text, never implying it is live', async () => {
		fetchMock.mockResolvedValueOnce(reply(201, { data: DRAFT }));
		const { code, out } = await run(
			['skills', 'import', 'https://petstore3.swagger.io/api/v3/openapi.json', '--origin', ORIGIN],
			env,
		);
		expect(code).toBe(0);
		expect(out).toContain('2 tools generated');
		expect(out).toContain('disabled; it never runs until you enable it');
	});

	it('routes a bare owner/repo the same way as a full URL', async () => {
		fetchMock.mockResolvedValueOnce(
			reply(201, {
				data: {
					id: 'd2',
					kind: 'declarative',
					enabled: false,
					sourceUrl: 'https://github.com/sindresorhus/is-up',
					bundleUri: '/api/skills/import/d2/',
					manifest: { provides: { tools: [] } },
				},
			}),
		);
		const { code } = await run(['skills', 'import', 'sindresorhus/is-up', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: 'sindresorhus/is-up' });
	});

	it('still imports a community skill by slug onto an agent, unaffected by the url branch', async () => {
		fetchMock.mockResolvedValueOnce(
			reply(201, {
				data: {
					skill: { id: 's1', slug: 'risk-manager', name: 'Risk Manager', injected: true },
					budget: { used_tokens: 10, cap_tokens: 1000 },
				},
			}),
		);
		const agent = '11111111-1111-4111-8111-111111111111';
		const { code } = await run(['skills', 'import', 'risk-manager', '--agent', agent, '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		const [url] = fetchMock.mock.calls[0];
		expect(url).toBe(`${ORIGIN}/api/agents/${agent}/custom-skills`);
	});
});

describe('three-ws skills drafts', () => {
	let env;
	let fetchMock;
	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('lists drafts with their enabled state', async () => {
		fetchMock.mockResolvedValueOnce(
			reply(200, {
				data: [{ id: 'd1', kind: 'openapi', enabled: false, sourceUrl: 'https://petstore3.swagger.io/api/v3/openapi.json' }],
			}),
		);
		const { code, out } = await run(['skills', 'drafts', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		expect(out).toContain('disabled');
		expect(out).toContain('petstore3.swagger.io');
	});

	it('tells an empty account how to create its first draft', async () => {
		fetchMock.mockResolvedValueOnce(reply(200, { data: [] }));
		const { out } = await run(['skills', 'drafts', '--origin', ORIGIN], env);
		expect(out).toContain('three-ws skills import');
	});
});
