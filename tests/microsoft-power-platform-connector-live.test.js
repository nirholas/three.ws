/**
 * Live contract test for the three.ws Power Platform connector.
 *
 * Calls every connector action against production exactly the way the connector
 * runtime builds the request from apiDefinition.swagger.json, then checks the
 * response against the schema the swagger declares. A field the handler returns
 * as null that the swagger types as a plain string, a renamed key, or a new
 * required input fails here before a flow does.
 *
 * Opt-in because it spends real generation capacity:
 *   PP_LIVE=1 PP_LIVE_BEARER=<three.ws API key or OAuth access token> \
 *     npx vitest run tests/microsoft-power-platform-connector-live.test.js
 * PP_LIVE_ORIGIN overrides https://three.ws (for a staging service).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefinition, buildRequest, validateResponse, operations } from '../scripts/power-platform-contract.mjs';

const LIVE = process.env.PP_LIVE === '1';
const BEARER = process.env.PP_LIVE_BEARER || '';
const ORIGIN = (process.env.PP_LIVE_ORIGIN || '').replace(/\/$/, '');
const def = loadDefinition();

async function invoke(operationId, inputs) {
	const req = buildRequest(def, operationId, inputs);
	const url = ORIGIN ? req.url.replace(`https://${def.host}`, ORIGIN) : req.url;
	const res = await fetch(url, {
		method: req.method,
		headers: {
			accept: 'application/json',
			...(req.body ? { 'content-type': 'application/json' } : {}),
			...(BEARER ? { authorization: `Bearer ${BEARER}` } : {}),
			'user-agent': 'three.ws-power-platform-contract-test',
		},
		body: req.body ? JSON.stringify(req.body) : undefined,
	});
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { status: res.status, body };
}

function expectContract(operationId, { status, body }) {
	const declared = operations(def).get(operationId).op.responses[String(status)];
	expect(declared, `${operationId} answered ${status}, which the swagger does not declare: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
	expect(status, `${operationId} answered ${status}: ${JSON.stringify(body).slice(0, 300)}`).toBe(200);
	const result = validateResponse(def, operationId, status, body);
	expect(result.errors, `${operationId} response does not match its declared schema`).toEqual([]);
}

describe.skipIf(!LIVE)('Power Platform connector against production', () => {
	let myAgents = [];
	let job = null;

	beforeAll(() => {
		if (!BEARER) throw new Error('PP_LIVE_BEARER is required: the agent actions sign in like the connector does.');
	});

	it('Search public agents (popular, newest, live) matches the declared schema', async () => {
		for (const inputs of [{ q: 'agent', limit: 5 }, { sort: 'newest', limit: 5, avatar: '1' }, { sort: 'live', limit: 3 }]) {
			const res = await invoke('SearchAgents', inputs);
			expectContract('SearchAgents', res);
			expect(Array.isArray(res.body.agents)).toBe(true);
		}
	});

	it('List my agents matches the declared schema', async () => {
		const res = await invoke('ListMyAgents', {});
		expectContract('ListMyAgents', res);
		myAgents = res.body.agents;
		expect(myAgents.length, 'the test account needs at least one agent').toBeGreaterThan(0);
	});

	it('Send a message to one of my agents matches the declared schema', async () => {
		expect(myAgents.length).toBeGreaterThan(0);
		const res = await invoke('SendAgentMessage', {
			agentId: myAgents[0].id,
			message: 'In one sentence, what can you help me with?',
		});
		expectContract('SendAgentMessage', res);
		expect(res.body.ok).toBe(true);
		expect(res.body.response.length).toBeGreaterThan(0);
	}, 90_000);

	it('Generate a 3D model from text matches the declared schema', async () => {
		const res = await invoke('GenerateModel', { prompt: 'a small ceramic robot figurine', tier: 'draft' });
		expectContract('GenerateModel', res);
		expect(['done', 'pending']).toContain(res.body.status);
		job = res.body.job ?? null;
		if (res.body.status === 'done') expect(res.body.glbUrl).toMatch(/^https:\/\//);
	}, 120_000);

	it('Get generation job matches the declared schema', async () => {
		if (!job) {
			// A draft that finished inside the first call leaves nothing to poll. The
			// high tier always runs on the async lanes, so it yields a real job.
			const submit = await invoke('GenerateModel', { prompt: 'a small ceramic robot figurine', tier: 'high' });
			expectContract('GenerateModel', submit);
			job = submit.body.job;
		}
		expect(job, 'Generate a 3D model returned no job id to poll').toBeTruthy();
		const res = await invoke('GetGenerationJob', { job, title: 'a small ceramic robot figurine' });
		expectContract('GetGenerationJob', res);
		expect(['done', 'pending', 'error']).toContain(res.body.status);
	}, 60_000);
});
