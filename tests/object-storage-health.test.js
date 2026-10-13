/**
 * Object storage (R2) health sensor, unit test.
 *
 * On 2026-09-07 the bucket credential stopped verifying and every signed
 * operation failed with `SignatureDoesNotMatch`: text→3D returned an error for
 * every user on both the website and the ChatGPT surface, and /cdn answered 502
 * for every avatar and thumbnail on the site. Production healthz reported the
 * forge as `ok` throughout, because no subsystem held a signal for "our storage
 * credential is rejected". This pins the sensor that now does, including the
 * distinction that decides the runbook: a rejected credential (a human has to
 * re-set it) versus an unreachable endpoint (it may clear itself).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyObjectStorageProbe, gatherObjectStorageHealth } from '../api/_lib/ops/object-storage-health.js';

const STORAGE_KEYS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_DOMAIN', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
let savedEnv;

beforeEach(() => {
	savedEnv = Object.fromEntries(STORAGE_KEYS.map((k) => [k, process.env[k]]));
	process.env.S3_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
	process.env.S3_BUCKET = 'three-ws';
	process.env.S3_PUBLIC_DOMAIN = 'https://pub-example.r2.dev';
	process.env.S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
	process.env.S3_SECRET_ACCESS_KEY = 'secret';
});

afterEach(() => {
	for (const k of STORAGE_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
});

describe('classifyObjectStorageProbe', () => {
	it('stays neutral when storage is not configured on the deployment', () => {
		const v = classifyObjectStorageProbe({ configured: false });
		expect(v.status).toBe('unknown');
	});

	it('reads ok on a fast signed list', () => {
		const v = classifyObjectStorageProbe({ configured: true, ok: true, latencyMs: 120 });
		expect(v.status).toBe('ok');
		expect(v.detail).toContain('120ms');
	});

	it('degrades on a slow but working bucket', () => {
		const v = classifyObjectStorageProbe({ configured: true, ok: true, latencyMs: 1500 });
		expect(v.status).toBe('degraded');
	});

	it('reports a rejected credential as down, and says the secret is wrong', () => {
		const v = classifyObjectStorageProbe({
			configured: true,
			ok: false,
			error: new Error('The request signature we calculated does not match the signature you provided. Check your secret access key and signing method.'),
		});
		expect(v.status).toBe('down');
		expect(v.detail).toMatch(/rejected our credential/);
		expect(v.hint).toMatch(/S3_SECRET_ACCESS_KEY/);
	});

	it('separates an unreachable endpoint from a rejected credential', () => {
		const v = classifyObjectStorageProbe({
			configured: true,
			ok: false,
			error: new Error('getaddrinfo ENOTFOUND acct.r2.cloudflarestorage.com'),
		});
		expect(v.status).toBe('down');
		expect(v.detail).toMatch(/unreachable/);
		expect(v.hint).toMatch(/S3_ENDPOINT/);
	});
});

describe('gatherObjectStorageHealth retry', () => {
	/**
	 * On 2026-10-11/12 row 36 traced the DEGRADED/DOWN flap to a single-probe
	 * sensor with no retry: a genuinely transient one-off network blip is
	 * indistinguishable from a sustained outage. This proves one retry absorbs
	 * the blip without masking a real, repeated failure.
	 */
	it('does not page DOWN on a single transient failure followed by a success', async () => {
		let calls = 0;
		const probe = async () => {
			calls += 1;
			if (calls === 1) throw new Error('getaddrinfo ENOTFOUND acct.r2.cloudflarestorage.com');
		};
		const result = await gatherObjectStorageHealth({ probe });
		expect(calls).toBe(2);
		expect(result.status).not.toBe('down');
		expect(result.status).toBe('ok');
		expect(result.metrics.retried).toBe(true);
	});

	it('still classifies down on two consecutive failures', async () => {
		let calls = 0;
		const probe = async () => {
			calls += 1;
			throw new Error('getaddrinfo ENOTFOUND acct.r2.cloudflarestorage.com');
		};
		const result = await gatherObjectStorageHealth({ probe });
		expect(calls).toBe(2);
		expect(result.status).toBe('down');
		expect(result.detail).toMatch(/unreachable/);
		expect(result.metrics.retried).toBe(true);
	});

	it('does not retry on a first-try success', async () => {
		let calls = 0;
		const probe = async () => {
			calls += 1;
		};
		const result = await gatherObjectStorageHealth({ probe });
		expect(calls).toBe(1);
		expect(result.status).toBe('ok');
		expect(result.metrics.retried).toBeUndefined();
	});
});
