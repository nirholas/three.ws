/**
 * http.js error boundary: object-storage-unavailable degradation.
 *
 * An R2 outage (disabled bucket, rotated keys, unreachable endpoint) makes every
 * putObject/getObjectBuffer/headObject call reject. Like a DB outage this is
 * infrastructure, not a code bug, so the shared boundaries must answer a clean
 * 503 (wrap/serverError) or a 200 skip (wrapCron) with a throttled warn and no
 * Sentry capture, instead of a raw 500 plus an `unhandled 5xx` alert per request.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wrap, serverError, wrapCron } from '../api/_lib/http.js';
import { captureException } from '../api/_lib/sentry.js';

vi.mock('../api/_lib/alerts.js', () => ({
	sendOpsAlert: async () => {},
}));
vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: async () => null,
	cacheSet: async () => {},
}));
vi.mock('../api/_lib/sentry.js', () => ({
	captureException: vi.fn(),
}));

function fakeRes() {
	const headers = {};
	return {
		statusCode: 0,
		body: undefined,
		ended: false,
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return headers[String(k).toLowerCase()]; },
		end(b) { this.body = b; this.ended = true; this.writableEnded = true; },
		_headers: headers,
	};
}

function storageDownError() {
	// The exact message production's disabled R2 account returns.
	return new Error('Please enable R2 through the Cloudflare Dashboard.');
}

function storageSigError() {
	return Object.assign(
		new Error('The request signature we calculated does not match the signature you provided.'),
		{ name: 'SignatureDoesNotMatch' },
	);
}

let errSpy, warnSpy;
beforeEach(() => {
	errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	captureException.mockClear();
});
afterEach(() => {
	errSpy.mockRestore();
	warnSpy.mockRestore();
});

const unhandledLogged = () => errSpy.mock.calls.some((c) => String(c[0]).includes('[api] unhandled'));

describe('wrap() under an object-storage outage', () => {
	for (const [label, make] of [['disabled R2 account', storageDownError], ['SignatureDoesNotMatch', storageSigError]]) {
		it(`returns 503 + Retry-After without unhandled log or Sentry capture (${label})`, async () => {
			const handler = wrap(async () => { throw make(); });
			const res = fakeRes();
			await handler({ method: 'POST', url: '/api/avatars/upload', headers: {} }, res);

			expect(res.statusCode).toBe(503);
			expect(res.getHeader('retry-after')).toBe('30');
			const body = JSON.parse(res.body);
			expect(body.error).toBe('service_unavailable');
			expect(body.error_description).toMatch(/storage/);
			expect(unhandledLogged()).toBe(false);
			expect(captureException).not.toHaveBeenCalled();
		});
	}

	it('still logs, captures and 500s a genuine handler bug', async () => {
		const handler = wrap(async () => { throw new Error('boom'); });
		const res = fakeRes();
		await handler({ method: 'POST', url: '/api/whatever', headers: {} }, res);

		expect(res.statusCode).toBe(500);
		expect(unhandledLogged()).toBe(true);
		expect(captureException).toHaveBeenCalledTimes(1);
	});

	it('does not reclassify a deliberate 4xx whose message happens to match the storage pattern', async () => {
		const handler = wrap(async () => {
			throw Object.assign(new Error('unauthorized'), { status: 401 });
		});
		const res = fakeRes();
		await handler({ method: 'GET', url: '/api/me', headers: {} }, res);

		expect(res.statusCode).toBe(401);
		expect(res.getHeader('retry-after')).toBeUndefined();
	});
});

describe('wrapCron() under an object-storage outage', () => {
	it('skips the tick with 200 storage_unavailable', async () => {
		const handler = wrapCron(async () => { throw storageDownError(); }, { maxDurationMs: 30_000 });
		const res = fakeRes();
		await handler({ method: 'GET', url: '/api/cron/some-job', headers: {} }, res);

		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toMatchObject({ ok: false, reason: 'storage_unavailable' });
		expect(unhandledLogged()).toBe(false);
		expect(captureException).not.toHaveBeenCalled();
	});

	it('still surfaces a genuine cron bug as a 500', async () => {
		const handler = wrapCron(async () => { throw new Error('boom'); }, { maxDurationMs: 30_000 });
		const res = fakeRes();
		await handler({ method: 'GET', url: '/api/cron/some-job', headers: {} }, res);

		expect(res.statusCode).toBe(500);
		expect(unhandledLogged()).toBe(true);
	});
});

describe('serverError() under an object-storage outage', () => {
	it('coerces a storage fault to 503 + Retry-After regardless of the nominal status', () => {
		const res = fakeRes();
		serverError(res, 500, 'upload_failed', storageDownError());

		expect(res.statusCode).toBe(503);
		expect(res.getHeader('retry-after')).toBe('30');
		expect(JSON.parse(res.body).error).toBe('service_unavailable');
		expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[server-error'))).toBe(false);
		expect(captureException).not.toHaveBeenCalled();
	});

	it('keeps a genuine 5xx as-is with the [server-error] log line', () => {
		const res = fakeRes();
		serverError(res, 502, 'pulse_failed', new Error('upstream exploded'));

		expect(res.statusCode).toBe(502);
		expect(JSON.parse(res.body).error).toBe('pulse_failed');
		expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[server-error'))).toBe(true);
	});
});
