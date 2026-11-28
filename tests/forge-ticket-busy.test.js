/**
 * A ticketed submit that the generator refused as busy (a 429 from
 * /api/gpt-forge, e.g. the reference-image step running out of its budget).
 *
 * Bug (reproduced 2026-11-28 with scripts/grok-connector-review-check.mjs
 * --server /api/mcp-studio): the ticket recorded that 429 and every later poll
 * reported "Generation failed: Your generation is queued behind a few others:
 * retry in ~39s to pick it up. Start a new generation." Nothing was in line,
 * the wait was dropped, and the agent was told the job itself had failed.
 *
 * A busy refusal must read as "nothing started, start again in about N
 * seconds", carry that wait through the poll and the MCP envelope, and give an
 * idempotency key back so the same call can run again.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveTicket } from '../api/_lib/forge-submit-ticket.js';
import { collectJob } from '../api/_mcp-studio/tools.js';

const BUSY_RECORD = {
	status: 429,
	body: {
		error: 'rate_limited',
		queued: true,
		message: 'Your generation is queued behind a few others: retry in ~39s to pick it up.',
		retry_after: 39,
	},
};

describe('resolveTicket on a busy refusal', () => {
	it('says nothing started and when to start again, not that a place is held', () => {
		const out = resolveTicket(BUSY_RECORD);
		expect(out.kind).toBe('failed');
		expect(out.busy).toBe(true);
		expect(out.retryAfter).toBe(39);
		expect(out.message).not.toMatch(/queued behind|pick it up/i);
		expect(out.message).toMatch(/about 39s/);
	});

	it('still answers a busy refusal that stated no wait', () => {
		const out = resolveTicket({ status: 429, body: { error: 'rate_limited' } });
		expect(out.kind).toBe('failed');
		expect(out.busy).toBe(true);
		expect(out.retryAfter).toBe(null);
		expect(out.message).toMatch(/start a new generation/i);
	});

	it('leaves other refusals as plain failures', () => {
		const out = resolveTicket({ status: 400, body: { message: 'That prompt is not allowed.' } });
		expect(out).toEqual({ kind: 'failed', message: 'That prompt is not allowed. Start a new generation.' });
	});
});

describe('collectJob on a ticket the generator refused as busy', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('reports reason busy with the wait instead of a failed generation', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify({ job_id: 't1.abcdefabcdefabcdef', status: 'failed', error: resolveTicket(BUSY_RECORD).message, reason: 'busy', retry_after: 39 }),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			),
		);
		const out = await collectJob('https://three.ws', 't1.abcdefabcdefabcdef');
		const sc = out.structuredContent;
		expect(out.isError).toBe(true);
		expect(sc.reason).toBe('busy');
		expect(sc.retry_after).toBe(39);
		const text = out.content[0].text;
		expect(text).not.toMatch(/Generation failed/);
		expect(text).not.toMatch(/queued behind/);
		expect(text).toMatch(/about 39s/);
	});
});
