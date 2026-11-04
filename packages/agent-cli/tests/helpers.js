// Test helpers: a throwaway home directory, and local HTTP servers that speak
// the real wire formats (OpenAI streaming chat completions, the three.ws
// /api/v1 envelope, the Telegram Bot API) so the code under test runs its
// real network path against a socket on 127.0.0.1.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { saveConfig } from '../src/config.js';
import { systemEnv } from '../src/paths.js';
import { createAgentContext } from '../src/session.js';

export function tempEnv(vars = {}) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-agent-test-'));
	const cwd = path.join(home, 'work');
	fs.mkdirSync(cwd, { recursive: true });
	const env = systemEnv({
		home,
		cwd,
		vars: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), THREE_WS_AGENT_HOME: path.join(home, 'data'), ...vars },
	});
	return { env, home, cwd, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

export function listen(handler) {
	return new Promise((resolve) => {
		const server = http.createServer(handler);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolve({
				server,
				url: `http://127.0.0.1:${port}`,
				close: () =>
					new Promise((r) => {
						server.closeAllConnections?.();
						server.close(() => r());
					}),
			});
		});
	});
}

export async function readBody(req) {
	const chunks = [];
	for await (const c of req) chunks.push(c);
	const text = Buffer.concat(chunks).toString('utf8');
	return text ? JSON.parse(text) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A local OpenAI-compatible endpoint. `reply(body, n)` decides each round:
 *   { content: 'text' }                          stream text
 *   { toolCalls: [{ name, args }] }               ask for tool calls
 *   { content, chunkDelayMs, hold: Promise }      stream slowly / wait before finishing
 * Every request body is recorded in `requests`; `peak` is the most requests in flight at once.
 */
export async function modelServer(reply) {
	const state = { requests: [], inFlight: 0, peak: 0 };
	const srv = await listen(async (req, res) => {
		if (req.method === 'GET' && req.url === '/v1/models') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model', owned_by: 'local' }] }));
			return;
		}
		if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
			res.writeHead(404).end();
			return;
		}
		const body = await readBody(req);
		const n = state.requests.push(body);
		state.inFlight++;
		state.peak = Math.max(state.peak, state.inFlight);
		let closed = false;
		res.on('close', () => {
			closed = true;
		});
		try {
			const r = await reply(body, n);
			res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
			const send = (obj) => !closed && res.write(`data: ${JSON.stringify(obj)}\n\n`);
			if (r.content) {
				const words = r.content.match(/\S+\s*/g) || [r.content];
				for (const w of words) {
					send({ choices: [{ index: 0, delta: { content: w } }] });
					if (r.chunkDelayMs) await sleep(r.chunkDelayMs);
					if (closed) return;
				}
			}
			if (r.hold) await r.hold;
			(r.toolCalls || []).forEach((tc, index) => {
				send({ choices: [{ index: 0, delta: { tool_calls: [{ index, id: `call_${n}_${index}`, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }] } }] });
			});
			send({ choices: [{ index: 0, delta: {}, finish_reason: r.toolCalls?.length ? 'tool_calls' : 'stop' }] });
			send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
			if (!closed) res.end('data: [DONE]\n\n');
		} finally {
			state.inFlight--;
		}
	});
	return { ...srv, ...state, get requests() { return state.requests; }, get peak() { return state.peak; }, baseUrl: `${srv.url}/v1` };
}

/** A context wired to a local model server, without MCP. */
export function testContext(env, baseUrl, extra = {}) {
	saveConfig({ model: { provider: 'openai', baseUrl, model: 'test-model' }, ...extra }, env);
	return createAgentContext({ env, mcp: false });
}

export async function waitFor(fn, { timeoutMs = 5000, stepMs = 10 } = {}) {
	const start = Date.now();
	for (;;) {
		const v = await fn();
		if (v) return v;
		if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
		await sleep(stepMs);
	}
}
