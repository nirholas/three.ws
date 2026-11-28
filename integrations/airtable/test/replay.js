// Replays test/fixtures/forge-exchange.json, a real exchange recorded from production
// Forge by test/record-fixture.mjs, as a fetch implementation. Every request is logged
// so tests can check what the extension actually sent.
import exchange from './fixtures/forge-exchange.json';
import { AbortedError } from '../frontend/forge-client.js';

export { exchange };

function response(status, body, headers = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (name) => headers[name.toLowerCase()] ?? null },
		text: async () => JSON.stringify(body),
	};
}

export function replayFetch({ cached = false, script = null } = {}) {
	const calls = [];
	let poll = 0;
	const fetchImpl = async (url, init = {}) => {
		calls.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
		if (init.signal?.aborted) {
			const error = new Error('aborted');
			error.name = 'AbortError';
			throw error;
		}
		if (script) {
			const next = script.shift();
			if (next) return response(next.status, next.body, next.headers);
		}
		if (!init.headers?.authorization) return response(exchange.unauthorized.status, exchange.unauthorized.body);
		if ((init.method || 'GET') === 'POST') {
			const src = cached ? exchange.cached : exchange.submit;
			return response(src.status, src.body);
		}
		const answer = exchange.polls[Math.min(poll, exchange.polls.length - 1)];
		poll++;
		return response(answer.status, answer.body);
	};
	return { fetchImpl, calls };
}

export const instantSleep = (ms, signal) => (signal?.aborted ? Promise.reject(new AbortedError()) : Promise.resolve());
