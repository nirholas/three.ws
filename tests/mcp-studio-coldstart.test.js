// A pending studio job whose GPU worker is still BOOTING must say so.
//
// The MCP surfaces (ChatGPT and any other client) see only poll frames after
// submit, so they are the surfaces most dependent on the poll payload telling
// the truth, and they were the ones it did not reach: /api/gpt-forge computed
// `cold_start` inside a closure in its submit handler only, so a queued job on a
// scale-to-zero worker polled back as a plain "still rendering". A caller was
// told to retry in the render ETA while the real wait was a container spin-up,
// and nothing in the response distinguished a 75s Hunyuan3D boot from a slow
// model. api/forge.js already hoisted the same helper to module scope for
// exactly this reason; these tests pin the clone's behaviour to it.
//
// Every number asserted here comes off the poll payload. Nothing is timed
// locally, so a job collected after a client reconnect reports the JOB's age.

import { describe, it, expect, vi } from 'vitest';

const poll = vi.fn();

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		generate: vi.fn(async () => ({ status: 'queued', _timedOut: true, job_id: 'job-cold' })),
		pollOnce: (...args) => poll(...args),
		directPrompt: vi.fn(async () => null),
	};
});

import { dispatch } from '../api/_mcp-studio/dispatch.js';

const req = { headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } };

async function checkJob(frame) {
	poll.mockResolvedValueOnce(frame);
	const res = await dispatch(
		{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_job', arguments: { job_id: 'job-cold' } } },
		{},
		req,
	);
	return res.result;
}

describe('studio cold-start honesty', () => {
	it('names the boot and counts the remaining spin-up from the payload', async () => {
		const r = await checkJob({
			status: 'queued',
			cold_start: true,
			cold_start_seconds: 75,
			elapsed_seconds: 20,
			eta_remaining_seconds: 180,
		});
		expect(r.isError).toBeFalsy();
		expect(r.structuredContent.status).toBe('pending');
		expect(r.structuredContent.coldStart).toBe(true);
		expect(r.structuredContent.coldStartSeconds).toBe(75);
		// 75s budget minus 20s already elapsed, straight from the frame.
		expect(r.structuredContent.coldStartRemainingSeconds).toBe(55);
		expect(r.content[0].text).toContain('waking up');
		expect(r.content[0].text).toContain('55s of boot left');
		// The retry hint tracks the BOOT, not the render ETA: telling a caller to
		// come back in 180s when the worker answers in 55 wastes two minutes.
		expect(r.content[0].text).toContain('in ~55s');
	});

	it('a boot past its budget says so instead of counting into negatives', async () => {
		const r = await checkJob({
			status: 'queued',
			cold_start: true,
			cold_start_seconds: 75,
			elapsed_seconds: 200,
			eta_remaining_seconds: 60,
		});
		expect(r.content[0].text).toContain('past its usual 75s boot');
		expect(r.content[0].text).not.toMatch(/-\d+s/);
		expect(r.structuredContent.coldStartRemainingSeconds).toBeUndefined();
	});

	it('a cold lane with no stated budget names the state and promises no number', async () => {
		const r = await checkJob({ status: 'queued', cold_start: true });
		expect(r.content[0].text).toContain('waking up');
		expect(r.content[0].text).not.toMatch(/\d+s of boot/);
		expect(r.structuredContent.coldStart).toBe(true);
		expect(r.structuredContent.coldStartSeconds).toBeUndefined();
		// No elapsed in the frame must not become "0s in": Number(null) is 0.
		expect(r.structuredContent.elapsedSeconds).toBeUndefined();
	});

	it('a warm job keeps the plain rendering copy and carries no cold flag', async () => {
		const r = await checkJob({ status: 'running', elapsed_seconds: 40, eta_remaining_seconds: 75 });
		expect(r.content[0].text).toContain('still rendering');
		expect(r.content[0].text).not.toContain('waking up');
		expect(r.structuredContent.coldStart).toBeUndefined();
		expect(r.structuredContent.etaRemainingSeconds).toBe(75);
	});
});
