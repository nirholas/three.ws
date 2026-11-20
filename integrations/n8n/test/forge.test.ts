import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ThreeWsApi } from '../credentials/ThreeWsApi.credentials';
import {
	callMcpTool,
	ForgeFailure,
	normalizeBaseUrl,
	pollForge,
	resolveForge,
	submitForge,
	viewerUrl,
	type HttpRequest,
} from '../nodes/ThreeWs/forge';

// Fixtures are real production responses (see integrations/raycast/test/record-fixture.mjs).
const load = (name: string) =>
	JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as Record<string, any>;
const text = load('forge-draft-text.json');
const cached = load('forge-draft-cached.json');
const mcp = load('mcp-search-catalog.json');

function replay(bodies: unknown[]) {
	const urls: string[] = [];
	let i = 0;
	const http: HttpRequest = async (options) => {
		urls.push(options.url);
		return bodies[Math.min(i++, bodies.length - 1)];
	};
	return { http, urls };
}
const noSleep = async () => undefined;

describe('Forge helpers against recorded production responses', () => {
	it('submits and reads the job id', async () => {
		const { http } = replay([text.submit]);
		const sub = await submitForge(http, 'https://three.ws', 'h', 'a small wooden chair', 'draft');
		expect(sub.job_id).toBe(text.submit.job_id);
	});

	it('polls the recorded sequence until the GLB is done', async () => {
		const { http, urls } = replay(text.polls);
		const job = await pollForge(http, 'https://three.ws', 'h', text.submit.job_id, 600000, noSleep);
		expect(job.glb_url).toBe(text.polls[text.polls.length - 1].glb_url);
		expect(urls.length).toBe(text.polls.length);
	});

	it('resolves a cache hit from the submit response without polling', async () => {
		const { http, urls } = replay([cached.submit]);
		const sub = await submitForge(http, 'https://three.ws', 'h', 'a small wooden chair', 'draft');
		const job = await resolveForge(http, 'https://three.ws', 'h', sub, 600000, noSleep);
		expect(job.glb_url).toBe(cached.submit.glb_url);
		expect(urls.length).toBe(1);
	});

	it('rejects a too-short prompt before any request', async () => {
		const { http, urls } = replay([{}]);
		await expect(submitForge(http, 'https://three.ws', 'h', 'ab', 'draft')).rejects.toBeInstanceOf(ForgeFailure);
		expect(urls.length).toBe(0);
	});

	it('times out when the job never finishes', async () => {
		const { http } = replay([{ status: 'queued' }]);
		let clock = 0;
		await expect(
			pollForge(http, 'https://three.ws', 'h', 'j', 1000, async () => void (clock += 2000), () => clock),
		).rejects.toMatchObject({ code: 'timeout' });
	});

	it('builds the viewer link and normalises the base URL', () => {
		expect(viewerUrl('https://three.ws', 'https://x/y.glb')).toBe('https://three.ws/viewer?src=https%3A%2F%2Fx%2Fy.glb');
		expect(normalizeBaseUrl(' https://example.com// ')).toBe('https://example.com');
		expect(normalizeBaseUrl(undefined)).toBe('https://three.ws');
	});

	it('returns the MCP tool result from a recorded search_catalog call', async () => {
		const { http, urls } = replay([mcp]);
		const result = await callMcpTool(http, 'https://three.ws', 'search_catalog', { q: 'chair', kind: 'object' });
		expect(urls[0]).toBe('https://three.ws/api/mcp-studio');
		expect(result.content?.[0].text).toContain('chair');
	});
});

// Making a model on three.ws needs an account (api/_lib/creator-account.js): an
// anonymous POST /api/forge answers 401 sign_in_required, and an anonymous
// forge_free or rig_mesh call on the studio answers structuredContent.status
// sign_in_required. The node shipped with no credential, so every generation
// would fail with a bare "401" once the gate is live.
describe('three.ws account', () => {
	const signInBody = {
		error: 'sign_in_required',
		message: 'Sign in to generate a 3D model. A three.ws account is free.',
		sign_in_url: '/login',
		api_keys_url: '/dashboard/api-keys',
	};
	const rejecting = (error: unknown): HttpRequest => async () => {
		throw error;
	};

	it('declares an API key credential that sends a bearer and tests it against the studio', () => {
		const cred = new ThreeWsApi();
		expect(cred.name).toBe('threeWsApi');
		const key = cred.properties.find((p) => p.name === 'apiKey');
		expect(key?.typeOptions?.password).toBe(true);
		expect(key?.required).toBe(true);
		expect(cred.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
		});
		expect(cred.test.request.url).toBe('/api/mcp-studio');
		expect(cred.test.request.method).toBe('POST');
	});

	it('wires the credential into the package and the node', () => {
		const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
		expect(pkg.n8n.credentials).toEqual(['dist/credentials/ThreeWsApi.credentials.js']);
		const node = readFileSync(join(__dirname, '..', 'nodes/ThreeWs/ThreeWs.node.ts'), 'utf8');
		expect(node).toMatch(/credentials: \[\{ name: 'threeWsApi', required: true \}\]/);
		expect(node).toContain("httpRequestWithAuthentication.call(this, 'threeWsApi'");
	});

	it('turns a 401 from Forge into an actionable sign_in_required failure', async () => {
		const error = Object.assign(new Error('Request failed with status code 401'), {
			httpCode: '401',
			response: { status: 401, data: signInBody },
		});
		const failure = await submitForge(rejecting(error), 'https://three.ws', 'h', 'a small wooden chair', 'draft').catch(
			(e) => e,
		);
		expect(failure).toBeInstanceOf(ForgeFailure);
		expect(failure.code).toBe('sign_in_required');
		expect(failure.message).toContain('https://three.ws/dashboard/api-keys');
	});

	it('treats a 401 while polling as sign_in_required, not a retryable poll error', async () => {
		const error = Object.assign(new Error('401'), { response: { status: 401 } });
		await expect(pollForge(rejecting(error), 'https://three.ws', 'h', 'j', 60000, noSleep)).rejects.toMatchObject({
			code: 'sign_in_required',
		});
	});

	it('turns a studio sign_in_required tool result into the same failure', async () => {
		const { http } = replay([
			{
				jsonrpc: '2.0',
				id: 1,
				result: {
					isError: true,
					content: [{ type: 'text', text: 'Sign in to make a 3D model.' }],
					structuredContent: { status: 'sign_in_required', sign_in_url: 'https://three.ws/login' },
				},
			},
		]);
		await expect(callMcpTool(http, 'https://three.ws', 'forge_free', { prompt: 'a chair' })).rejects.toMatchObject({
			code: 'sign_in_required',
		});
	});

	it('turns a transport 401 from the studio (a key that does not verify) into sign_in_required', async () => {
		const error = Object.assign(new Error('Request failed with status code 401'), { statusCode: 401 });
		await expect(callMcpTool(rejecting(error), 'https://three.ws', 'search_catalog', {})).rejects.toMatchObject({
			code: 'sign_in_required',
		});
	});
});
