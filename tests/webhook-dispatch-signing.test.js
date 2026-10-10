// Signing, backoff and URL rules of the developer webhook queue
// (api/_lib/webhook-dispatch.js). The signature check is written out per the
// Standard Webhooks spec (key = base64-decoded secret after "whsec_", base64
// HMAC-SHA256 over "{id}.{timestamp}.{body}") so a drift from what the
// official verifier libraries accept fails here, not on a customer's server.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../api/_lib/ssrf.js', () => ({
	validatePublicUrl: vi.fn((url) => new URL(url)),
	resolvePublicHost: vi.fn(async () => ['93.184.216.34']),
	pinnedAgent: vi.fn(() => undefined),
	SsrfError: class SsrfError extends Error {},
}));

const {
	newWebhookSecret, signatureHeader, backoffMs, webhookUrlProblem, RETRY_SCHEDULE_MS, MAX_ATTEMPTS,
} = await import('../api/_lib/webhook-dispatch.js');
const { hmacSha256 } = await import('../api/_lib/crypto.js');

function specSignature(secret, id, ts, body) {
	const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
	return createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

describe('newWebhookSecret', () => {
	it('issues whsec_ plus 24 bytes in the standard base64 alphabet the libraries decode', () => {
		const s = newWebhookSecret();
		expect(s).toMatch(/^whsec_[A-Za-z0-9+/]+={0,2}$/);
		expect(Buffer.from(s.slice(6), 'base64')).toHaveLength(24);
		expect(newWebhookSecret()).not.toBe(s);
	});
});

describe('signatureHeader', () => {
	const id = 'evt_run_finished_1';
	const ts = 1791613202;
	const body = JSON.stringify({ id, type: 'run.finished', data: { ok: true } });

	it('carries the spec signature first and the legacy three.ws signature second', async () => {
		const secret = newWebhookSecret();
		const header = await signatureHeader(secret, id, ts, body);
		const [spec, legacy] = header.split(' ');
		expect(spec).toBe(`v1,${specSignature(secret, id, ts, body)}`);
		expect(legacy).toBe(`v1,${await hmacSha256(secret, `${id}.${ts}.${body}`)}`);
	});

	it('still signs a pre-switch base64url secret so old receivers keep verifying', async () => {
		const old = 'whsec_q-_Zr9x2mN0pL4tY7wVb8cDe1fGh2iJk';
		const header = await signatureHeader(old, id, ts, body);
		const entries = header.split(' ');
		expect(entries).toHaveLength(2);
		expect(entries[1]).toBe(`v1,${await hmacSha256(old, `${id}.${ts}.${body}`)}`);
	});

	it('changes when any signed part changes', async () => {
		const secret = newWebhookSecret();
		const a = await signatureHeader(secret, id, ts, body);
		expect(await signatureHeader(secret, id, ts + 1, body)).not.toBe(a);
		expect(await signatureHeader(secret, `${id}x`, ts, body)).not.toBe(a);
		expect(await signatureHeader(secret, id, ts, `${body} `)).not.toBe(a);
	});
});

describe('retry schedule', () => {
	it('allows one more attempt than there are delays', () => {
		expect(MAX_ATTEMPTS).toBe(RETRY_SCHEDULE_MS.length + 1);
	});

	it('waits the scheduled delay plus at most 10% jitter after each failed attempt', () => {
		RETRY_SCHEDULE_MS.forEach((base, i) => {
			for (let k = 0; k < 20; k++) {
				const ms = backoffMs(i + 1);
				expect(ms).toBeGreaterThanOrEqual(base);
				expect(ms).toBeLessThanOrEqual(Math.round(base * 1.1));
			}
		});
	});

	it('holds at the last delay past the end of the schedule', () => {
		const last = RETRY_SCHEDULE_MS.at(-1);
		expect(backoffMs(RETRY_SCHEDULE_MS.length + 3)).toBeGreaterThanOrEqual(last);
	});
});

describe('webhookUrlProblem', () => {
	const env = { ...process.env };
	afterEach(() => {
		process.env.NODE_ENV = env.NODE_ENV;
		if (env.WEBHOOKS_ALLOW_PRIVATE_TARGETS === undefined) delete process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS;
		else process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS = env.WEBHOOKS_ALLOW_PRIVATE_TARGETS;
	});

	it('accepts a public https URL and refuses plain http', async () => {
		expect(await webhookUrlProblem('https://hooks.example.com/in')).toBeNull();
		expect(await webhookUrlProblem('http://hooks.example.com/in')).toBe('Webhook URL must use HTTPS');
	});

	it('admits a local http receiver only with the local-testing switch outside production', async () => {
		process.env.NODE_ENV = 'development';
		process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS = '1';
		for (const url of ['http://localhost:3042/hook', 'http://127.0.0.1:3042/hook', 'http://192.168.1.20/h', 'http://172.20.0.5/h', 'http://host.docker.internal:9000/h']) {
			expect(await webhookUrlProblem(url)).toBeNull();
		}
		// The switch never opens plain http to a public host.
		expect(await webhookUrlProblem('http://example.com/hook')).toBe('Webhook URL must use HTTPS');

		process.env.NODE_ENV = 'production';
		expect(await webhookUrlProblem('http://localhost:3042/hook')).toBe('Webhook URL must use HTTPS');
	});

	it('rejects junk input', async () => {
		expect(await webhookUrlProblem('')).toBe('url is required');
		expect(await webhookUrlProblem('not a url')).toBe('url is not a valid URL');
		expect(await webhookUrlProblem(`https://x.com/${'a'.repeat(2050)}`)).toBe('url exceeds 2048 characters');
	});
});
