import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
