// examples/grok-curl/run.sh against a local server standing in for api.x.ai and
// the three.ws REST base (XAI_BASE_URL, THREE_WS_API). Guards two regressions:
// the script must print xAI's own message on any error answer and exit 1, and
// it must be able to read a successful answer at all (it once piped its own
// "> POST ..." log line into jq and died on every 200).

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'grok-curl', 'run.sh');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SCHEMA_MESSAGE =
	'Invalid tool schema for MCP server three-ws, tool pano_capture_start: input_schema does not support oneOf, allOf, or anyOf at the top level';

let server;
let origin;
let workdir;
let xaiAnswer;
const xaiRequests = [];

beforeAll(async () => {
	workdir = mkdtempSync(join(tmpdir(), 'grok-curl-test-'));
	server = createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost');
		if (req.method === 'GET' && url.pathname === '/api/catalog') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ items: [{ title: 'Arm Chair 01', url: `${origin}/objects/ArmChair_01.glb` }] }));
			return;
		}
		if (req.method === 'GET' && url.pathname === '/api/render/glb') {
			res.writeHead(200, { 'content-type': 'image/png' });
			res.end(PNG);
			return;
		}
		if (req.method === 'POST' && url.pathname === '/v1/responses') {
			let body = '';
			req.on('data', (d) => (body += d));
			req.on('end', () => {
				xaiRequests.push({ authorization: req.headers.authorization, body: JSON.parse(body) });
				res.writeHead(xaiAnswer.status, { 'content-type': xaiAnswer.type || 'application/json' });
				res.end(typeof xaiAnswer.body === 'string' ? xaiAnswer.body : JSON.stringify(xaiAnswer.body));
			});
			return;
		}
		res.writeHead(404).end();
	});
	await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
	origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
	await new Promise((closed) => server.close(closed));
	rmSync(workdir, { recursive: true, force: true });
});

function runScript(answer, extraEnv = {}) {
	xaiAnswer = answer;
	xaiRequests.length = 0;
	const env = {
		PATH: process.env.PATH,
		HOME: workdir,
		XAI_API_KEY: 'xai-test-key',
		XAI_BASE_URL: `${origin}/v1`,
		THREE_WS_API: origin,
		THREE_WS_MCP_URL: `${origin}/api/mcp-studio`,
		OUT: join(workdir, 'model.png'),
		...extraEnv,
	};
	return new Promise((done) => {
		execFile('bash', [SCRIPT], { env, timeout: 30_000 }, (err, stdout, stderr) => {
			done({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
		});
	});
}

describe('examples/grok-curl/run.sh and xAI answers', () => {
	it("prints xAI's message and exits 1 on the documented HTTP 400 error body", async () => {
		const r = await runScript({ status: 400, body: { code: 'invalid_client_tool_schema', error: SCHEMA_MESSAGE } });
		expect(r.stderr).not.toMatch(/jq: /);
		expect(r.stderr.split('\n')).toContain(`error    xAI answered HTTP 400: ${SCHEMA_MESSAGE}`);
		expect(r.code).toBe(1);
	});

	it('reads the message from an OpenAI-style error object', async () => {
		const r = await runScript({ status: 401, body: { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } } });
		expect(r.stderr.split('\n')).toContain('error    xAI answered HTTP 401: Incorrect API key provided.');
		expect(r.code).toBe(1);
	});

	it('treats a 200 answer that carries an error as a failure, not as output', async () => {
		const r = await runScript({
			status: 200,
			body: { id: 'resp_1', status: 'failed', error: { code: 'server_error', message: 'The MCP server did not answer.' }, output: [] },
		});
		expect(r.stderr).not.toMatch(/jq: /);
		expect(r.stderr.split('\n')).toContain('error    xAI answered HTTP 200: The MCP server did not answer.');
		expect(r.code).toBe(1);
	});

	it('prints the start of a body that is not JSON instead of crashing in jq', async () => {
		const r = await runScript({ status: 502, type: 'text/html', body: '<html><body>\n<h1>502 Bad Gateway</h1>\n</body></html>' });
		expect(r.stderr).not.toMatch(/jq: /);
		expect(r.stderr).toMatch(/^error {4}xAI answered HTTP 502: <html><body> <h1>502 Bad Gateway<\/h1>/m);
		expect(r.code).toBe(1);
	});

	it('reads a successful answer: prints the tool call and the GLB, then renders it', async () => {
		const glb = 'https://example.invalid/objects/ArmChair_01.glb';
		const r = await runScript({
			status: 200,
			body: {
				id: 'resp_ok',
				status: 'completed',
				error: null,
				output: [
					{ type: 'reasoning', summary: [] },
					{ type: 'mcp_call', name: 'search_catalog', server_label: 'three-ws', error: '', arguments: '{"q":"chair"}', output: '{}' },
					{ type: 'message', content: [{ type: 'output_text', text: `GLB: ${glb}\nViewer: https://three.ws/viewer?src=x` }] },
				],
			},
		});
		expect(r.stderr).not.toMatch(/jq: /);
		expect(r.stdout).toMatch(/^tool {5}search_catalog \{"q":"chair"\}$/m);
		expect(r.stdout).toMatch(new RegExp(`^glb {6}${glb.replaceAll('.', '\\.')}$`, 'm'));
		expect(r.stdout).toMatch(/^png {6}\S+model\.png \(16 bytes\)$/m);
		expect(r.code).toBe(0);
		expect(readFileSync(join(workdir, 'model.png')).equals(PNG)).toBe(true);
	});

	it('sends the key as a bearer token and never prints it or a null authorization', async () => {
		const r = await runScript({ status: 400, body: { code: 'invalid-argument', error: 'Incorrect API key provided.' } });
		expect(xaiRequests).toHaveLength(1);
		expect(xaiRequests[0].authorization).toBe('Bearer xai-test-key');
		expect(xaiRequests[0].body.tools[0]).not.toHaveProperty('authorization');
		expect(r.stdout + r.stderr).not.toContain('xai-test-key');
		expect(r.stdout + r.stderr).not.toContain('"authorization": null');

		const withKey = await runScript({ status: 400, body: { code: 'invalid-argument', error: 'Incorrect API key provided.' } }, { THREE_WS_API_KEY: 'sk_test_three_ws' });
		expect(xaiRequests[0].body.tools[0].authorization).toBe('sk_test_three_ws');
		expect(withKey.stdout + withKey.stderr).toContain('"authorization": "<THREE_WS_API_KEY>"');
		expect(withKey.stdout + withKey.stderr).not.toContain('sk_test_three_ws');
	});
});
