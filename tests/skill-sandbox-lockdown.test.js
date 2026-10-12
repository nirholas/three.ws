import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Evaluate the real worker source against a stand-in worker global whose
// prototype chain carries the ambient-authority APIs a browser worker has.
function bootWorker() {
	const calls = [];
	const proto = {
		fetch(input, init) {
			calls.push({ input, init });
			return Promise.resolve({ ok: true });
		},
		XMLHttpRequest: class {},
		WebSocket: class {},
		Worker: class {},
		SharedWorker: class {},
		indexedDB: {},
		caches: {},
		BroadcastChannel: class {},
		importScripts() {},
	};
	const scope = Object.create(proto);
	scope.postMessage = () => {};
	scope.self = scope;
	// The worker source only touches its global through `self`, so run it with the
	// stand-in as `self` (a vm context hides the prototype chain being tested).
	new Function('self', 'Request', readFileSync('src/skills/sandbox-worker.js', 'utf8'))(scope, undefined);
	return { scope, calls, run: (code) => new Function('self', `return (${code.replace(/;?\s*$/, '')})`)(scope) };
}

describe('skill sandbox worker lockdown', () => {
	it('strips ambient network, storage and nested-worker capabilities', () => {
		const { run } = bootWorker();
		for (const name of ['XMLHttpRequest', 'WebSocket', 'Worker', 'SharedWorker', 'indexedDB', 'caches', 'BroadcastChannel', 'importScripts']) {
			expect(run(`typeof self.${name}`), name).toBe('undefined');
			expect(run(`typeof Object.getPrototypeOf(self).${name}`), `proto ${name}`).toBe('undefined');
		}
	});

	it('forces credential-less fetch even when the handler asks for credentials', async () => {
		const { calls, run } = bootWorker();
		await run(`self.fetch('/api/wallet', { credentials: 'include', method: 'POST' })`);
		expect(calls).toHaveLength(1);
		expect(calls[0].init.credentials).toBe('omit');
		expect(calls[0].init.method).toBe('POST');
	});

	it('cannot recover the original fetch from the prototype chain', () => {
		const { run } = bootWorker();
		expect(run(`typeof Object.getPrototypeOf(self).fetch`)).toBe('undefined');
	});
});
