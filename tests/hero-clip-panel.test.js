// The hero clip panel's failure mapping (src/hero-clip-panel.js): what a
// creator reads when a request to /api/v1/models/hero-clip goes wrong.
import { describe, it, expect } from 'vitest';
import { failureFrom } from '../src/hero-clip-panel.js';

describe('failureFrom', () => {
	it('uses the server copy and code when the answer carries them', () => {
		const f = failureFrom(
			{ status: 429 },
			{ error: 'rate_limited', message: 'Too many hero clips started at once.', retry: true, retry_after: 42 },
		);
		expect(f).toEqual({ status: 429, code: 'rate_limited', message: 'Too many hero clips started at once.', retry: true, retryAfter: 42 });
	});

	it('calls a missing response a lost connection', () => {
		const f = failureFrom(null, null);
		expect(f.code).toBe('network_error');
		expect(f.status).toBe(0);
		expect(f.message).toMatch(/could not be reached/);
	});

	// A 200 without the expected body means this page is older than the
	// service (a deploy landed while it was open), not that the network failed.
	it('treats an answer the page cannot read as an out-of-date page, not a lost connection', () => {
		const f = failureFrom({ status: 200 }, { data: { available: false } });
		expect(f.code).toBe('unexpected_response');
		expect(f.message).not.toMatch(/answered 200/);
		expect(f.message).toMatch(/reload/i);
	});

	it('keeps the status for an error answer without a body', () => {
		const f = failureFrom({ status: 502 }, null);
		expect(f.code).toBe('unexpected_response');
		expect(f.status).toBe(502);
	});
});
