// The shared idempotency store (api/_lib/idempotency.js) behind both the v1
// HTTP `Idempotency-Key` header and the MCP studio's idempotency_key. Runs over
// the real in-memory cache (no Redis in the test env).

import { describe, it, expect } from 'vitest';
import {
	claimIdempotent,
	fingerprint,
	IDEMPOTENCY_KEY_MAX,
	idempotencyStoreKey,
	normalizeIdempotencyKey,
	readIdempotent,
	releaseIdempotent,
	writeIdempotent,
} from '../api/_lib/idempotency.js';

describe('idempotency store', () => {
	it('normalizes keys and refuses one that is too long', () => {
		expect(normalizeIdempotencyKey('  task-1  ')).toBe('task-1');
		expect(normalizeIdempotencyKey('')).toBeNull();
		expect(normalizeIdempotencyKey(undefined)).toBeNull();
		expect(() => normalizeIdempotencyKey('x'.repeat(IDEMPOTENCY_KEY_MAX + 1))).toThrow(/at most/);
	});

	it('keys the store by caller, so two callers never share a record', () => {
		const a = idempotencyStoreKey('mcp-studio', 'caller-a', 'task-1');
		const b = idempotencyStoreKey('mcp-studio', 'caller-b', 'task-1');
		expect(a).not.toBe(b);
		expect(a).not.toContain('task-1');
	});

	it('keeps the v1 HTTP key layout', () => {
		expect(idempotencyStoreKey('v1', 'user-1:agents.create', 'k')).toMatch(/^v1:idem:user-1:agents\.create:[0-9a-f]{64}$/);
	});

	it('fingerprints arguments regardless of key order', () => {
		expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
		expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
	});

	it('lets exactly one claim win, then reads, replaces and releases the record', async () => {
		const key = idempotencyStoreKey('test', 'caller', `claim-${Date.now()}`);
		expect(await claimIdempotent(key, { state: 'running', n: 1 })).toBe(true);
		expect(await claimIdempotent(key, { state: 'running', n: 2 })).toBe(false);
		expect(await readIdempotent(key)).toEqual({ state: 'running', n: 1 });
		await writeIdempotent(key, { state: 'done', n: 1 });
		expect((await readIdempotent(key)).state).toBe('done');
		await releaseIdempotent(key);
		expect(await readIdempotent(key)).toBeNull();
		expect(await claimIdempotent(key, { state: 'running', n: 3 })).toBe(true);
	});
});
