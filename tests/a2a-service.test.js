/**
 * POST /api/agents/a2a-paid: the A2A JSON-RPC service behind the public card.
 *
 * The card used to advertise ten skills and tasks/get while the endpoint
 * answered only `message/send` for the paid inspector, and refused every caller
 * that had not activated the payment extension. These tests pin the contract the
 * card now states: both protocol dialects (1.0 SendMessage/GetTask/CancelTask,
 * 0.3 message/send/tasks/get/tasks/cancel), every card skill reachable, tasks
 * readable back by id, and the spec error codes for what is not offered.
 *
 * Only the network and database edges are replaced (the avatar query, the model
 * fetch, the forge lane); the dispatcher, the protocol translation, the task
 * store, the safety gate, the limiters and the paid a2a-x402 first leg are real.
 * The live run against a local server is in docs/a2a-payments.md.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../api/_lib/avatars.js', () => ({
	searchPublicAvatars: vi.fn(async ({ q, limit }) => ({
		avatars: [
			{
				id: '7f0c2a6e-0000-4000-8000-000000000001',
				name: `Robot ${q}`,
				description: 'A test robot',
				tags: ['robot'],
				model_url: 'https://three.ws/cdn/avatars/robot.glb',
				thumbnail_url: null,
			},
		].slice(0, limit),
	})),
}));

vi.mock('../api/3d/inspect.js', () => ({
	inspectModelUrl: vi.fn(async (url) => ({
		url,
		valid: true,
		stats: { triangles: 1200, meshes: 2, materials: 1 },
		sizeBytes: 4096,
		recommendations: [],
		// The real report shape (api/3d/inspect.js runValidator): counts are num*.
		validation: {
			valid: true,
			validatorVersion: '2.0.0-dev.3.10',
			numErrors: 0,
			numWarnings: 15,
			numInfos: 2,
			numHints: 0,
			issues: [],
			truncated: false,
		},
		ts: new Date().toISOString(),
	})),
}));

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		originFromReq: () => 'https://three.ws',
		startForge: vi.fn(async () => ({ status: 'pending', job_id: 'f1.testjob.handle', eta_seconds: 40 })),
	};
});

const { searchPublicAvatars } = await import('../api/_lib/avatars.js');
const { startForge } = await import('../api/_mcp-studio/gpt-forge-client.js');
const { A2A_SKILLS } = await import('../api/_lib/a2a/skills.js');
const { default: handler } = await import('../api/agents/a2a-paid.js');

const X402_URI = 'https://github.com/google-a2a/a2a-x402/v0.1';

function makeReq(body, headers = {}, { raw = null, method = 'POST' } = {}) {
	const payload = raw != null ? raw : JSON.stringify(body);
	const req = Readable.from([Buffer.from(payload)]);
	req.method = method;
	req.url = '/api/agents/a2a-paid';
	req.headers = { 'content-type': 'application/json', origin: 'https://three.ws', ...headers };
	return req;
}

function makeRes() {
	return {
		statusCode: 200,
		_body: '',
		_headers: {},
		setHeader(k, v) { this._headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this._headers[String(k).toLowerCase()]; },
		removeHeader(k) { delete this._headers[String(k).toLowerCase()]; },
		writeHead(code) { this.statusCode = code; return this; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		end(chunk) { this._body = chunk ? String(chunk) : ''; return this; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

let seq = 0;
async function rpc(method, params, headers) {
	const res = makeRes();
	await handler(makeReq({ jsonrpc: '2.0', id: ++seq, method, params }, headers), res);
	return res;
}

const textMsg = (text, extra = {}) => ({ role: 'user', messageId: `m-${++seq}`, parts: [{ kind: 'text', text }], ...extra });
const v1Msg = (parts, extra = {}) => ({ role: 'ROLE_USER', messageId: `m-${++seq}`, parts, ...extra });

beforeAll(() => {
	// The paid first leg needs one payable network to quote. Synthetic values:
	// the quote is built, never settled, in these tests.
	process.env.X402_PAY_TO_SOLANA = 'THREEsynthetic1111111111111111111111111111';
	process.env.X402_FEE_PAYER_SOLANA = 'THREEsynthetic2222222222222222222222222222';
	process.env.X402_ASSET_MINT_SOLANA = 'THREEsynthetic3333333333333333333333333333';
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('A2A service: 0.3 dialect', () => {
	it('message/send routes the catalog skill and completes with live counts', async () => {
		const res = await rpc('message/send', { message: textMsg('List the paid service catalog') });
		const task = res.json.result;
		expect(task.kind).toBe('task');
		expect(task.status.state).toBe('completed');
		const data = task.artifacts[0].parts[0].data;
		expect(data.total).toBeGreaterThanOrEqual(40);
		expect(data.discovery).toBe('https://three.ws/.well-known/x402.json');
	});

	it('message/send routes avatar search, then tasks/get reads the task back', async () => {
		const sent = await rpc('message/send', { message: textMsg('Find avatars matching "robot"') });
		const task = sent.json.result;
		expect(task.status.state).toBe('completed');
		expect(searchPublicAvatars).toHaveBeenLastCalledWith({ q: 'robot', tag: undefined, limit: 10 });
		expect(task.artifacts[0].parts[0].data.avatars[0].pageUrl).toMatch(/^https:\/\/three\.ws\/avatars\//);

		const got = await rpc('tasks/get', { id: task.id });
		expect(got.json.result.id).toBe(task.id);
		expect(got.json.result.kind).toBe('task');
		expect(got.json.result.status.state).toBe('completed');
		expect(got.json.result.history.length).toBeGreaterThanOrEqual(2);
	});

	it('answers with the skill list as a message when no skill can be identified', async () => {
		const res = await rpc('message/send', { message: textMsg('hello there') });
		expect(res.json.result.kind).toBe('message');
		expect(res.json.result.role).toBe('agent');
		for (const s of A2A_SKILLS) expect(res.json.result.parts[0].text).toContain(s.id);
	});
});

describe('A2A service: 1.0 dialect', () => {
	it('SendMessage routes validate-model from a data part and wraps the task', async () => {
		const res = await rpc(
			'SendMessage',
			{ message: v1Msg([{ data: { url: 'https://three.ws/avatars/default.glb' } }]) },
			{ 'a2a-version': '1.0' },
		);
		const { task } = res.json.result;
		expect(task.kind).toBeUndefined();
		expect(task.status.state).toBe('TASK_STATE_COMPLETED');
		expect(task.status.message.role).toBe('ROLE_AGENT');
		expect(task.status.message.parts[0].text).toMatch(/^Valid glTF/);
		// The summary reports the validator's counts; it must not claim the
		// validator was unavailable when the report carries its result.
		expect(task.status.message.parts[0].text).toContain('Validator: 0 errors, 15 warnings, 2 infos, 0 hints.');
		expect(task.status.message.parts[0].text).not.toMatch(/unavailable/);
		expect(task.artifacts[0].parts[0].data.validation.numErrors).toBe(0);

		const got = await rpc('GetTask', { id: task.id, historyLength: 1 }, { 'a2a-version': '1.0' });
		expect(got.json.result.id).toBe(task.id);
		expect(got.json.result.status.state).toBe('TASK_STATE_COMPLETED');
		expect(got.json.result.history).toHaveLength(1);
	});

	it('generate-3d-model starts working and GetTask completes it with the GLB as a url part', async () => {
		const res = await rpc('SendMessage', {
			message: v1Msg([{ text: 'Generate a 3D model of a small ceramic robot figurine' }]),
		});
		const { task } = res.json.result;
		expect(task.status.state).toBe('TASK_STATE_WORKING');
		expect(startForge).toHaveBeenCalled();
		expect(task.status.message.parts[1].data.watchUrl).toMatch(/\/watch\?job=f1\.testjob\.handle/);

		vi.stubGlobal(
			'fetch',
			vi.fn(async (url) => {
				expect(String(url)).toBe('https://three.ws/api/gpt-forge?job=f1.testjob.handle');
				return new Response(JSON.stringify({ status: 'done', glb_url: 'https://three.ws/cdn/forge/robot.glb' }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}),
		);
		const got = await rpc('GetTask', { id: task.id });
		const done = got.json.result;
		expect(done.status.state).toBe('TASK_STATE_COMPLETED');
		const file = done.artifacts[0].parts[0];
		expect(file).toMatchObject({ url: 'https://three.ws/cdn/forge/robot.glb', mediaType: 'model/gltf-binary' });
		expect(done.artifacts[0].parts[1].data.viewerUrl).toMatch(/^https:\/\/three\.ws\/viewer\?src=/);
	});

	it('rejects an unsafe generation prompt before any GPU work', async () => {
		startForge.mockClear();
		const res = await rpc('SendMessage', {
			message: v1Msg([{ data: { skillId: 'generate-3d-model', prompt: 'a nude figure' } }]),
		});
		expect(res.json.result.task.status.state).toBe('TASK_STATE_REJECTED');
		expect(startForge).not.toHaveBeenCalled();
	});

	it('CancelTask cancels a task waiting on input and refuses a finished one', async () => {
		const waiting = await rpc('SendMessage', {
			message: v1Msg([{ text: 'validate this' }], { metadata: { skillId: 'validate-model' } }),
		});
		expect(waiting.json.result.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
		const id = waiting.json.result.task.id;
		const canceled = await rpc('CancelTask', { id });
		expect(canceled.json.result.status.state).toBe('TASK_STATE_CANCELED');
		const again = await rpc('CancelTask', { id });
		expect(again.json.error.code).toBe(-32002);
	});

	it('continues an input-required task with a follow-up message on the same taskId', async () => {
		const first = await rpc('message/send', { message: textMsg('validate', { metadata: { skillId: 'validate-model' } }) });
		expect(first.json.result.status.state).toBe('input-required');
		const next = await rpc('message/send', {
			message: textMsg('https://three.ws/avatars/default.glb', { taskId: first.json.result.id }),
		});
		expect(next.json.result.id).toBe(first.json.result.id);
		expect(next.json.result.status.state).toBe('completed');
	});
});

describe('A2A service: errors and unsupported operations', () => {
	it('GetTask on an unknown id is TaskNotFound (-32001)', async () => {
		const res = await rpc('GetTask', { id: '00000000-0000-4000-8000-000000000000' });
		expect(res.json.error.code).toBe(-32001);
	});

	it('a send on an unknown taskId is TaskNotFound, not a silent new task', async () => {
		const res = await rpc('SendMessage', { message: v1Msg([{ text: 'hi' }], { taskId: 'no-such-task' }) });
		expect(res.json.error.code).toBe(-32001);
	});

	it('an unsupported A2A-Version is VersionNotSupported (-32009)', async () => {
		const res = await rpc('SendMessage', { message: v1Msg([{ text: 'catalog' }]) }, { 'a2a-version': '2.0' });
		expect(res.json.error.code).toBe(-32009);
	});

	it('an unknown explicit skill is InvalidParams (-32602)', async () => {
		const res = await rpc('message/send', { message: textMsg('x', { metadata: { skillId: 'list-avatars' } }) });
		expect(res.json.error.code).toBe(-32602);
	});

	it('streaming, list and push methods answer with their spec codes', async () => {
		expect((await rpc('SendStreamingMessage', { message: v1Msg([{ text: 'x' }]) })).json.error.code).toBe(-32004);
		expect((await rpc('ListTasks', {})).json.error.code).toBe(-32004);
		expect((await rpc('tasks/pushNotificationConfig/set', {})).json.error.code).toBe(-32003);
		expect((await rpc('GetExtendedAgentCard', {})).json.error.code).toBe(-32007);
	});

	it('an invalid bearer credential is a 401, never a silent anonymous call', async () => {
		const res = await rpc('message/send', { message: textMsg('catalog') }, { authorization: 'Bearer not-a-real-token' });
		expect(res.statusCode).toBe(401);
		expect(res._headers['www-authenticate']).toMatch(/invalid_token/);
	});
});

describe('A2A service: the paid skill', () => {
	it('quotes payment on the first leg when the caller activates the extension with the 1.0 header', async () => {
		const res = await rpc(
			'SendMessage',
			{ message: v1Msg([{ text: 'Inspect https://three.ws/avatars/default.glb' }]) },
			{ 'a2a-extensions': X402_URI },
		);
		const { task } = res.json.result;
		expect(task.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
		expect(task.status.message.metadata['x402.payment.status']).toBe('payment-required');
		expect(task.status.message.metadata['x402.payment.required'].accepts.length).toBeGreaterThan(0);
		expect(res._headers['a2a-extensions']).toBe(X402_URI);
		expect(res._headers['x-a2a-extensions']).toBe(X402_URI);

		const got = await rpc('GetTask', { id: task.id });
		expect(got.json.result.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
	});

	it('keeps the 0.3 shape for the existing X-A2A-Extensions clients', async () => {
		const res = await rpc('message/send', { message: textMsg('Inspect https://three.ws/avatars/default.glb') }, { 'x-a2a-extensions': X402_URI });
		expect(res.json.result.kind).toBe('task');
		expect(res.json.result.status.state).toBe('input-required');
	});

	it('the same URL without the extension runs the free validator instead', async () => {
		const res = await rpc('message/send', { message: textMsg('Inspect https://three.ws/avatars/default.glb') });
		expect(res.json.result.status.state).toBe('completed');
		expect(res.json.result.artifacts[0].name).toBe('gltf-validation.json');
	});
});

describe('A2A service: every card skill is reachable', () => {
	for (const skill of A2A_SKILLS) {
		it(`routes ${skill.id}`, async () => {
			const res = await rpc('message/send', {
				message: textMsg(skill.examples[0], { metadata: { skillId: skill.id } }),
			});
			expect(res.json.error).toBeUndefined();
			expect(res.json.result.kind).toBe('task');
			expect(['completed', 'working', 'input-required', 'failed']).toContain(res.json.result.status.state);
		});
	}
});

describe('A2A service: GET returns the card fragment', () => {
	it('advertises the endpoint, the optional extension and every registry skill', async () => {
		const res = makeRes();
		await handler(makeReq(null, {}, { raw: '', method: 'GET' }), res);
		expect(res.json.capabilities.extensions[0].required).toBe(false);
		expect(res.json.skills.map((s) => s.id)).toEqual(A2A_SKILLS.map((s) => s.id));
	});
});
