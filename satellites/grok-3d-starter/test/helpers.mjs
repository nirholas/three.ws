// Shared test helpers: fixture loading and fake upstreams built from those
// fixtures. Captured fixtures replay a real answer byte for byte; documented
// ones say so in their `_fixture` header.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function fixture(path) {
	return JSON.parse(readFileSync(join(FIXTURES, path), 'utf8'));
}

/** The MCP result ({ content, structuredContent, isError }) inside a captured JSON-RPC answer. */
export function capturedResult(path) {
	return fixture(path).response.result;
}

export const TEST_KEYS = Object.freeze({ XAI_API_KEY: 'xai-test-key-for-unit-tests', THREE_WS_API_KEY: 'sk_test_unit' });

export function testConfig(overrides = {}) {
	return loadConfig({ ...TEST_KEYS, ...overrides });
}

/** xAI's wire format for one round: data-only SSE lines, then data: [DONE]. */
export function sseText(events) {
	return `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`;
}

/** A Response whose body arrives in small, uneven chunks, the way a real stream does. */
export function streamingResponse(text, { status = 200, headers = { 'content-type': 'text/event-stream' }, chunk = 37 } = {}) {
	const bytes = new TextEncoder().encode(text);
	const body = new ReadableStream({
		start(controller) {
			for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
			controller.close();
		},
	});
	return new Response(body, { status, headers });
}

export function jsonResponse(value, status = 200, headers = {}) {
	return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * A fetch that answers xAI requests with the given rounds (one SSE stream per
 * request) and MCP requests with the given JSON-RPC answers, in order, and
 * records every request it saw.
 */
export function fakeUpstreams({ config, xaiRounds = [], mcpAnswers = [] }) {
	const requests = [];
	const rounds = [...xaiRounds];
	const answers = [...mcpAnswers];
	async function fetchImpl(url, init = {}) {
		const body = init.body ? JSON.parse(init.body) : null;
		requests.push({ url: String(url), headers: init.headers || {}, body });
		if (String(url) === config.xaiUrl) {
			const next = rounds.shift();
			if (!next) throw new Error('unexpected extra xAI request');
			if (next instanceof Response) return next;
			return streamingResponse(sseText(next));
		}
		if (String(url) === config.mcpUrl) {
			const next = answers.shift();
			if (!next) throw new Error('unexpected extra MCP request');
			if (next instanceof Error) throw next;
			if (next instanceof Response) return next;
			return jsonResponse({ ...next, id: body.id });
		}
		throw new Error(`unexpected request to ${url}`);
	}
	return { fetchImpl, requests, remaining: () => ({ xai: rounds.length, mcp: answers.length }) };
}

/** Collects emitted events as [name, data] pairs. */
export function recorder() {
	const events = [];
	const emit = (name, data) => events.push([name, data]);
	return { events, emit, names: () => events.map(([name]) => name), of: (name) => events.filter(([n]) => n === name).map(([, d]) => d) };
}

export const noSleep = async () => {};
