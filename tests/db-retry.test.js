// Unit tests for the DB connection-retry helper. Pure logic — `withDbRetry`
// takes a thunk, so no DB or network mocking is needed.

import { describe, it, expect, vi } from 'vitest';
import { withDbRetry, withDbTimeout, DbTimeoutError } from '../api/_lib/db-retry.js';

function never() {
	return new Promise(() => {}); // a stalled connection: never settles
}

function transientError() {
	// Shape Neon's HTTP driver produces on a cold-start / network blip.
	return new Error('NeonDbError: Error connecting to database: fetch failed');
}

function constraintError() {
	// A real SQL error carries a Postgres SQLSTATE and a deterministic message.
	return Object.assign(new Error('duplicate key value violates unique constraint "agent_identities_pkey"'), {
		code: '23505',
	});
}

describe('withDbRetry', () => {
	it('returns the result without retrying when the operation succeeds', async () => {
		const run = vi.fn().mockResolvedValue('ok');
		await expect(withDbRetry(run)).resolves.toBe('ok');
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('retries a transient connection error and succeeds on the next attempt', async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(transientError())
			.mockResolvedValueOnce('recovered');
		await expect(withDbRetry(run)).resolves.toBe('recovered');
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('does NOT retry a SQL/constraint error — it fails fast', async () => {
		const err = constraintError();
		const run = vi.fn().mockRejectedValue(err);
		await expect(withDbRetry(run)).rejects.toBe(err);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('gives up after the attempt cap on a persistent transient failure', async () => {
		const run = vi.fn().mockRejectedValue(transientError());
		await expect(withDbRetry(run)).rejects.toThrow(/fetch failed/);
		expect(run).toHaveBeenCalledTimes(3); // MAX_DB_ATTEMPTS
	});

	it('unwraps a transient cause carried on sourceError', async () => {
		// NeonDbError nests the underlying fetch failure on `sourceError`.
		const wrapped = Object.assign(new Error('query failed'), {
			sourceError: new Error('fetch failed'),
		});
		const run = vi.fn().mockRejectedValueOnce(wrapped).mockResolvedValueOnce('ok');
		await expect(withDbRetry(run)).resolves.toBe('ok');
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('aborts a stalled query once the total deadline elapses', async () => {
		const run = vi.fn().mockImplementation(never);
		const err = await withDbRetry(run, { timeoutMs: 30 }).catch((e) => e);
		expect(err).toBeInstanceOf(DbTimeoutError);
		expect(err.code).toBe('DB_TIMEOUT');
		// A timeout consumes the whole budget, so a merely-slow query is not retried.
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('does not retry past the deadline when transient errors keep failing fast', async () => {
		// Transient errors reject immediately, so all 3 attempts fit inside a
		// generous budget — the budget only stops *slow* queries, not fast ones.
		const run = vi.fn().mockRejectedValue(transientError());
		await expect(withDbRetry(run, { timeoutMs: 5_000 })).rejects.toThrow(/fetch failed/);
		expect(run).toHaveBeenCalledTimes(3);
	});

	it('with the bound disabled, a fast query still resolves normally', async () => {
		const run = vi.fn().mockResolvedValue('ok');
		await expect(withDbRetry(run, { timeoutMs: 0 })).resolves.toBe('ok');
		expect(run).toHaveBeenCalledTimes(1);
	});
});

describe('withDbTimeout', () => {
	it('resolves a query that beats the deadline', async () => {
		await expect(withDbTimeout(() => Promise.resolve(42), 1_000)).resolves.toBe(42);
	});

	it('rejects with DbTimeoutError when the query stalls', async () => {
		const err = await withDbTimeout(never, 20).catch((e) => e);
		expect(err).toBeInstanceOf(DbTimeoutError);
		expect(err.code).toBe('DB_TIMEOUT');
	});

	it('surfaces the query error unchanged when it rejects before the deadline', async () => {
		const boom = new Error('boom');
		await expect(withDbTimeout(() => Promise.reject(boom), 1_000)).rejects.toBe(boom);
	});

	it('runs the thunk without a timer when the bound is disabled', async () => {
		await expect(withDbTimeout(() => Promise.resolve('ok'), 0)).resolves.toBe('ok');
		await expect(withDbTimeout(() => Promise.resolve('ok'), Infinity)).resolves.toBe('ok');
	});
});

// The deadline error names the caller's budget, not the slice an attempt had
// left. Each attempt raced only the remaining time, so a retried call that
// wedged reported a shrunken figure ("exceeded 140ms deadline" on a 300ms
// budget), and under load even a first attempt printed 2497ms for a 2500ms
// budget (tests/usage-direct-insert-timeout.test.js failed on exactly that).
describe('withDbRetry deadline message', () => {
	it('reports the whole timeoutMs budget when a retried attempt wedges', async () => {
		let calls = 0;
		const run = () => {
			calls++;
			return calls === 1 ? new Promise((_, reject) => setTimeout(() => reject(transientError()), 60)) : never();
		};
		const err = await withDbRetry(run, { timeoutMs: 300 }).catch((e) => e);
		expect(calls).toBe(2);
		expect(err).toBeInstanceOf(DbTimeoutError);
		expect(err.message).toBe('db query exceeded 300ms deadline');
	});
});
