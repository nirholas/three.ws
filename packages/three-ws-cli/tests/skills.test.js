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

describe('three-ws skills import <external slug>', () => {
	const agent = '11111111-1111-4111-8111-111111111111';
	const SHA = 'c'.repeat(40);
	const EXTERNAL = {
		slug: 'fixture-skill',
		name: 'Fixture Skill',
		origin: 'external',
		source: 'fixture-org/skills-repo',
		ref: SHA,
		license: 'MIT',
		tree_url: `https://github.com/fixture-org/skills-repo/tree/${SHA}/skills/fixture-skill`,
		import: { registry: `https://github.com/fixture-org/skills-repo/tree/${SHA}/skills`, skill: 'fixture-skill' },
	};
	const notFound = () => reply(404, { error: 'not_found', error_description: 'no community skill "fixture-skill"' });
	let env;
	let fetchMock;
	let ttyDescriptors;

	beforeEach(() => {
		env = tempEnv();
		writeStore({ origin: ORIGIN, auth: { type: 'apikey', key: KEY, prefix: KEY.slice(0, 12) } }, env);
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		ttyDescriptors = ['stdin', 'stderr'].map((n) => [n, Object.getOwnPropertyDescriptor(process[n], 'isTTY')]);
		for (const [n] of ttyDescriptors) Object.defineProperty(process[n], 'isTTY', { value: false, configurable: true });
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		for (const [n, d] of ttyDescriptors) {
			if (d) Object.defineProperty(process[n], 'isTTY', d);
			else delete process[n].isTTY;
		}
	});

	it('refuses without --yes in a non-interactive shell, printing source and commit, and installs nothing', async () => {
		fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(reply(200, { skill: EXTERNAL }));
		const { code, out } = await run(['skills', 'import', 'fixture-skill', '--agent', agent, '--origin', ORIGIN], env);
		expect(code).toBe(1);
		expect(out).toBe('');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.map(([u]) => u)).not.toContain(`${ORIGIN}/api/skill-imports/scan`);
	});

	it('prints the source, commit and license in the refusal text', async () => {
		fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(reply(200, { skill: EXTERNAL }));
		const { runSkills } = await import('../src/commands/skills.js');
		const result = await runSkills(['import', 'fixture-skill', '--agent', agent], { env, origin: ORIGIN });
		expect(result.code).toBe(1);
		expect(result.output).toContain('fixture-org/skills-repo');
		expect(result.output).toContain(SHA);
		expect(result.output).toContain('not reviewed by three.ws');
		expect(result.output).toContain('--yes');
	});

	it('with --yes scans at the pinned commit, then approves the scanned request', async () => {
		fetchMock
			.mockResolvedValueOnce(notFound())
			.mockResolvedValueOnce(reply(200, { skill: EXTERNAL }))
			.mockResolvedValueOnce(reply(201, { data: { request: { id: 'r1', status: 'pending', verdict: 'clean', gated: false } } }))
			.mockResolvedValueOnce(reply(200, { data: { skill: { id: 's9', slug: 'fixture-skill', injected: true }, budget: { used_tokens: 5, cap_tokens: 100 } } }));
		const { code } = await run(['skills', 'import', 'fixture-skill', '--agent', agent, '--yes', '--json', '--origin', ORIGIN], env);
		expect(code).toBe(0);
		const [scanUrl, scanInit] = fetchMock.mock.calls[2];
		expect(scanUrl).toBe(`${ORIGIN}/api/skill-imports/scan`);
		expect(JSON.parse(scanInit.body)).toEqual({ agent_id: agent, registry: EXTERNAL.import.registry, skill: 'fixture-skill' });
		const [approveUrl, approveInit] = fetchMock.mock.calls[3];
		expect(approveUrl).toBe(`${ORIGIN}/api/skill-imports/requests/r1`);
		expect(JSON.parse(approveInit.body)).toMatchObject({ decision: 'approve', acknowledge_gated: false, enabled: true });
	});

	it('does not approve a gated skill without --acknowledge-gated', async () => {
		fetchMock
			.mockResolvedValueOnce(notFound())
			.mockResolvedValueOnce(reply(200, { skill: EXTERNAL }))
			.mockResolvedValueOnce(reply(201, { data: { request: { id: 'r2', status: 'pending', verdict: 'caution', gated: true } } }));
		const { runSkills } = await import('../src/commands/skills.js');
		const result = await runSkills(['import', 'fixture-skill', '--agent', agent, '--yes'], { env, origin: ORIGIN });
		expect(result.code).toBe(1);
		expect(result.output).toContain('--acknowledge-gated');
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('reports a slug that is neither in-repo nor external as the original not-found error', async () => {
		fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(notFound());
		await expect(run(['skills', 'import', 'fixture-skill', '--agent', agent, '--yes', '--origin', ORIGIN], env)).rejects.toMatchObject({ status: 404, code: 'not_found' });
	});
});
