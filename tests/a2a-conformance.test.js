/**
 * A2A conformance: the three.ws endpoint judged against the specification's own
 * JSON Schema, plus the streaming and cancel behavior Microsoft's agent
 * platforms (Copilot Studio, Foundry Agent Service, Agent Framework) rely on.
 *
 * The 0.3 schema is vendored at tests/fixtures/a2a/a2a-0.3.0.schema.json from
 * https://raw.githubusercontent.com/a2aproject/A2A/v0.3.0/specification/json/a2a.json
 * and every 0.3 response body and SSE frame is validated against its
 * SendMessageResponse, GetTaskResponse, CancelTaskResponse,
 * SendStreamingMessageResponse and JSONRPCErrorResponse definitions. 1.0 ships
 * as a protobuf (specification/a2a.proto), not JSON Schema, so its wire shape
 * (StreamResponse oneof, TASK_STATE_* enums, untagged parts) is asserted field
 * by field.
 *
 * Only the network edges are replaced (forge lane, upstream job poll); the
 * dispatcher, protocol translation, task store and SSE framing are real.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import Ajv from 'ajv';

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		originFromReq: () => 'https://three.ws',
		startForge: vi.fn(async () => ({ status: 'pending', job_id: 'f1.conformance.handle', eta_seconds: 40 })),
	};
});

const { default: handler } = await import('../api/agents/a2a-paid.js');

const schema = JSON.parse(readFileSync(new URL('./fixtures/a2a/a2a-0.3.0.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema, 'a2a');
const conforms = (definition, value) => {
	const validate = ajv.getSchema(`a2a#/definitions/${definition}`);
	const ok = validate(value);
	return ok ? null : ajv.errorsText(validate.errors);
};

function makeReq(body, headers = {}) {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]);
	req.method = 'POST';
	req.url = '/api/agents/a2a-paid';
	req.headers = { 'content-type': 'application/json', origin: 'https://three.ws', ...headers };
	return req;
}

function makeRes() {
	return {
		statusCode: 200,
		_chunks: [],
		_ended: false,
		_headers: {},
		setHeader(k, v) { this._headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this._headers[String(k).toLowerCase()]; },
		flushHeaders() {},
		write(chunk) { this._chunks.push(String(chunk)); return true; },
		end(chunk) { if (chunk) this._chunks.push(String(chunk)); this._ended = true; return this; },
		get _body() { return this._chunks.join(''); },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
		get frames() {
			return this._body
				.split('\n\n')
				.filter((f) => f.startsWith('data: '))
				.map((f) => JSON.parse(f.slice(6)));
		},
	};
}

let seq = 0;
async function rpc(method, params, headers) {
	const res = makeRes();
	await handler(makeReq({ jsonrpc: '2.0', id: ++seq, method, params }, headers), res);
	return res;
}

const textMsg = (text, extra = {}) => ({ role: 'user', messageId: `c-${++seq}`, parts: [{ kind: 'text', text }], ...extra });
const v1Msg = (text, extra = {}) => ({ role: 'ROLE_USER', messageId: `c-${++seq}`, parts: [{ text }], ...extra });
const PROMPT = 'Generate a 3D model of a small ceramic robot figurine';

// Upstream job poll: `working` for the first `workingPolls` calls, then done.
function stubForgePolls(workingPolls) {
	let n = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url) => {
			expect(String(url)).toBe('https://three.ws/api/gpt-forge?job=f1.conformance.handle');
			n += 1;
			const body = n <= workingPolls ? { status: 'running' } : { status: 'done', glb_url: 'https://three.ws/cdn/forge/robot.glb' };
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		}),
	);
}

beforeAll(() => {
	process.env.A2A_STREAM_POLL_MS = '10';
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('0.3 responses match the vendored specification schema', () => {
	it('message/send (a task and a direct message)', async () => {
		const task = await rpc('message/send', { message: textMsg(PROMPT) });
		expect(conforms('SendMessageResponse', task.json)).toBeNull();
		const msg = await rpc('message/send', { message: textMsg('hello there') });
		expect(conforms('SendMessageResponse', msg.json)).toBeNull();
	});

	it('tasks/get and tasks/cancel', async () => {
		const sent = await rpc('message/send', { message: textMsg('validate', { metadata: { skillId: 'validate-model' } }) });
		const id = sent.json.result.id;
		expect(conforms('GetTaskResponse', (await rpc('tasks/get', { id })).json)).toBeNull();
		expect(conforms('CancelTaskResponse', (await rpc('tasks/cancel', { id })).json)).toBeNull();
	});

	it('error responses carry the spec codes and validate as JSONRPCErrorResponse', async () => {
		const cases = [
			[await rpc('tasks/get', { id: 'nope' }), -32001],
			[await rpc('tasks/pushNotificationConfig/set', {}), -32003],
			[await rpc('no/such/method', {}), -32601],
			[await rpc('message/send', { message: textMsg('x', { metadata: { skillId: 'bogus' } }) }), -32602],
			[await rpc('message/send', { message: { role: 'user', parts: [] } }), -32602],
			[await rpc('agent/getAuthenticatedExtendedCard', {}), -32007],
		];
		for (const [res, code] of cases) {
			expect(res.json.error.code).toBe(code);
			expect(conforms('JSONRPCErrorResponse', res.json)).toBeNull();
		}
	});

	it('a finished generation carries the GLB as a file part with a URL', async () => {
		const sent = await rpc('message/send', { message: textMsg(PROMPT) });
		stubForgePolls(0);
		const got = await rpc('tasks/get', { id: sent.json.result.id });
		expect(conforms('GetTaskResponse', got.json)).toBeNull();
		const file = got.json.result.artifacts[0].parts[0];
		expect(file).toMatchObject({ kind: 'file', file: { uri: 'https://three.ws/cdn/forge/robot.glb', mimeType: 'model/gltf-binary' } });
	});
});

describe('message/stream (0.3)', () => {
	it('streams the task, working updates, the GLB artifact and a final status', async () => {
		stubForgePolls(2);
		const res = await rpc('message/stream', { message: textMsg(PROMPT) });
		expect(res._headers['content-type']).toMatch(/^text\/event-stream/);
		expect(res._ended).toBe(true);
		const frames = res.frames;
		for (const f of frames) expect(conforms('SendStreamingMessageResponse', f)).toBeNull();
		expect(frames[0].result.kind).toBe('task');
		expect(frames[0].result.status.state).toBe('working');
		const kinds = frames.slice(1).map((f) => f.result.kind);
		expect(kinds).toContain('artifact-update');
		const last = frames.at(-1).result;
		expect(last).toMatchObject({ kind: 'status-update', final: true, status: { state: 'completed' } });
		const artifact = frames.find((f) => f.result.kind === 'artifact-update').result.artifact;
		expect(artifact.parts[0].file.uri).toBe('https://three.ws/cdn/forge/robot.glb');
		// Intermediate updates are working and not final.
		const working = frames.filter((f) => f.result.kind === 'status-update' && !f.result.final);
		expect(working.length).toBeGreaterThanOrEqual(1);
		// The stored task agrees with what was streamed.
		const got = await rpc('tasks/get', { id: frames[0].result.id });
		expect(got.json.result.status.state).toBe('completed');
	});

	it('a task that finishes at once is one task frame and the stream closes', async () => {
		const res = await rpc('message/stream', { message: textMsg('List the paid service catalog') });
		expect(res.frames).toHaveLength(1);
		expect(conforms('SendStreamingMessageResponse', res.frames[0])).toBeNull();
		expect(res.frames[0].result.status.state).toBe('completed');
	});

	it('a direct reply streams as one message frame', async () => {
		const res = await rpc('message/stream', { message: textMsg('hello there') });
		expect(res.frames).toHaveLength(1);
		expect(res.frames[0].result.kind).toBe('message');
	});

	it('a request error before the stream opens is a plain JSON-RPC error', async () => {
		const res = await rpc('message/stream', { message: { role: 'user', parts: [] } });
		expect(res._headers['content-type']).toMatch(/^application\/json/);
		expect(res.json.error.code).toBe(-32602);
	});

	it('tasks/resubscribe picks a working task back up and finishes it', async () => {
		const sent = await rpc('message/send', { message: textMsg(PROMPT) });
		const id = sent.json.result.id;
		stubForgePolls(1);
		const res = await rpc('tasks/resubscribe', { id });
		const frames = res.frames;
		for (const f of frames) expect(conforms('SendStreamingMessageResponse', f)).toBeNull();
		expect(frames[0].result.kind).toBe('task');
		expect(frames.at(-1).result).toMatchObject({ final: true, status: { state: 'completed' } });
	});

	it('resubscribe to a finished or unknown task is a spec error', async () => {
		const done = await rpc('message/send', { message: textMsg('List the paid service catalog') });
		expect((await rpc('tasks/resubscribe', { id: done.json.result.id })).json.error.code).toBe(-32004);
		expect((await rpc('tasks/resubscribe', { id: 'missing' })).json.error.code).toBe(-32001);
	});
});

describe('SendStreamingMessage (1.0)', () => {
	it('wraps each frame in the StreamResponse oneof with TASK_STATE_* enums', async () => {
		stubForgePolls(1);
		const res = await rpc('SendStreamingMessage', { message: v1Msg(PROMPT) }, { 'a2a-version': '1.0' });
		const frames = res.frames.map((f) => f.result);
		expect(frames[0].task.status.state).toBe('TASK_STATE_WORKING');
		expect(frames[0].task.kind).toBeUndefined();
		const artifact = frames.find((f) => f.artifactUpdate)?.artifactUpdate;
		expect(artifact.artifact.parts[0]).toMatchObject({ url: 'https://three.ws/cdn/forge/robot.glb', mediaType: 'model/gltf-binary' });
		expect(artifact.lastChunk).toBe(true);
		const updates = frames.filter((f) => f.statusUpdate).map((f) => f.statusUpdate);
		expect(updates.at(-1).status.state).toBe('TASK_STATE_COMPLETED');
		expect(updates.at(-1).final).toBeUndefined();
		expect(updates[0]).toMatchObject({ taskId: frames[0].task.id, contextId: frames[0].task.contextId });
	});

	it('SubscribeToTask resumes a working task', async () => {
		const sent = await rpc('SendMessage', { message: v1Msg(PROMPT) });
		stubForgePolls(0);
		const res = await rpc('SubscribeToTask', { id: sent.json.result.task.id }, { 'a2a-version': '1.0' });
		expect(res.frames.at(-1).result.statusUpdate.status.state).toBe('TASK_STATE_COMPLETED');
	});
});

describe('cancel', () => {
	it('cancels a working generation: the task stops, GetTask stays canceled, resubscribe refuses', async () => {
		const sent = await rpc('message/send', { message: textMsg(PROMPT) });
		const id = sent.json.result.id;
		expect(sent.json.result.status.state).toBe('working');
		const canceled = await rpc('tasks/cancel', { id });
		expect(conforms('CancelTaskResponse', canceled.json)).toBeNull();
		expect(canceled.json.result.status.state).toBe('canceled');
		// A later poll must not resurrect it, even if the lane finishes the job.
		stubForgePolls(0);
		const got = await rpc('tasks/get', { id });
		expect(got.json.result.status.state).toBe('canceled');
		expect((await rpc('tasks/resubscribe', { id })).json.error.code).toBe(-32004);
		expect((await rpc('tasks/cancel', { id })).json.error.code).toBe(-32002);
	});

	it('a cancel that lands during a stream ends it with the canceled state', async () => {
		let polls = 0;
		const sent = await rpc('message/send', { message: textMsg(PROMPT) });
		const id = sent.json.result.id;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				polls += 1;
				if (polls === 2) await rpc('tasks/cancel', { id });
				return new Response(JSON.stringify({ status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
			}),
		);
		const res = await rpc('tasks/resubscribe', { id });
		expect(res.frames.at(-1).result).toMatchObject({ final: true, status: { state: 'canceled' } });
	});
});

describe('auth', () => {
	it('an invalid X-API-Key is a 401, never a silent anonymous call', async () => {
		const res = await rpc('message/send', { message: textMsg('catalog') }, { 'x-api-key': 'not-a-real-key' });
		expect(res.statusCode).toBe(401);
		expect(res._headers['www-authenticate']).toMatch(/invalid_token/);
	});
});
