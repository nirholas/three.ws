/**
 * What the Rig button says while it waits, and which answers it retries
 * (src/forge-rig-status.js).
 *
 * Measured on production 2026-11-27: a hound took 205 seconds on the non-human
 * rigger, yet the page gave up after four minutes, so a creature on a cold
 * worker failed in the browser while the job was still running. The page also
 * offered "Try again" on a refusal that would only repeat itself.
 */
import { describe, it, expect } from 'vitest';
import {
	RIG_LONG_WAIT_MS,
	RIG_POLL_BUDGET_MS,
	formatElapsed,
	isRigRefusal,
	rigWaitMessage,
} from '../src/forge-rig-status.js';

describe('the Rig wait budget', () => {
	it('outlasts the slowest measured creature on a cold worker', () => {
		// 205 s measured warm, plus a cold start of a few minutes.
		expect(RIG_POLL_BUDGET_MS).toBeGreaterThanOrEqual(15 * 60 * 1000);
		// The server kills a job at 45 min; the page must never outwait it.
		expect(RIG_POLL_BUDGET_MS).toBeLessThan(45 * 60 * 1000);
	});
});

describe('isRigRefusal', () => {
	it.each([
		[422, 'rig_not_riggable'],
		[422, 'rig_multiple_pieces'],
		[413, 'rig_too_large'],
		[413, 'rig_too_complex'],
		[422, 'rig_invalid_model'],
		[400, 'invalid_glb_url'],
		[422, 'rig_fetch_failed'],
	])('treats %i %s as a refusal with no retry', (status, error) => {
		expect(isRigRefusal(status, { error })).toBe(true);
	});

	it.each([
		[502, 'rig_fetch_failed'],
		[429, 'rig_too_large'],
		[503, 'storage_unavailable'],
		[500, 'rig_failed'],
		[409, 'already_rigged'],
		[401, 'unauthorized'],
	])('lets %i %s be retried or handled elsewhere', (status, error) => {
		expect(isRigRefusal(status, { error })).toBe(false);
	});

	it('copes with an empty body', () => {
		expect(isRigRefusal(422, null)).toBe(false);
	});
});

describe('formatElapsed', () => {
	it.each([
		[0, '0:00'],
		[7_400, '0:07'],
		[205_000, '3:25'],
		[RIG_POLL_BUDGET_MS, '20:00'],
		[-50, '0:00'],
	])('%i ms reads %s', (ms, text) => {
		expect(formatElapsed(ms)).toBe(text);
	});
});

describe('rigWaitMessage', () => {
	it('names the check before the job and the check after it', () => {
		expect(rigWaitMessage({ phase: 'checking' })).toMatch(/before it goes to the rigger/);
		expect(rigWaitMessage({ phase: 'verifying' })).toMatch(/test animation/);
	});

	it('says a worker may be starting while the job is queued', () => {
		expect(rigWaitMessage({ phase: 'queued' })).toMatch(/one is starting now/);
	});

	it('sets a creature apart from a figure, since it takes minutes, not seconds', () => {
		expect(rigWaitMessage({ phase: 'running', subject: 'creature' })).toMatch(/three to four minutes/);
		expect(rigWaitMessage({ phase: 'running', subject: 'humanoid' })).toMatch(/under a minute/);
		expect(rigWaitMessage({ phase: 'running' })).toMatch(/under a minute/);
	});

	it('says plainly that a long wait is a long wait, and how long the page keeps going', () => {
		for (const phase of ['queued', 'running']) {
			const text = rigWaitMessage({ phase, subject: 'creature', elapsedMs: RIG_LONG_WAIT_MS });
			expect(text).toMatch(/^Still working/);
			expect(text).toMatch(/20 minutes/);
		}
	});

	it('keeps the check phases on their own copy however long they run', () => {
		expect(rigWaitMessage({ phase: 'verifying', elapsedMs: RIG_LONG_WAIT_MS * 2 })).toMatch(/test animation/);
	});
});
