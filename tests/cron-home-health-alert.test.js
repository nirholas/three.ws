// The three home alerts, actually fired (api/cron/home-health-alert.js).
//
// This cron is the only thing that pages a human about the smart-home lane, and
// until this file existed nothing anywhere invoked it. Every property below was
// therefore live in production on the strength of a code read alone, including
// the one that matters most: an unlock that executed with nobody's yes on record
// pages on a single row, with no threshold and no dedup that could swallow it.
//
// The split this file pins is the lane's whole alerting thesis: a per-tenant
// failure NEVER pages (one unplugged router, one expired token), and a
// correlated one always does. Both halves are asserted, because an alert that
// cannot stay quiet is as broken as one that cannot fire.
import { test, expect, vi, beforeEach } from 'vitest';

const sent = [];
const cache = new Map();
let signals = null;
let leakInstances = [];

vi.mock('../api/_lib/alerts.js', () => ({
	sendOpsAlert: async (title, detail, opts) => { sent.push({ title, detail, opts }); },
}));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));
vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: async (k) => (cache.has(k) ? cache.get(k) : null),
	cacheSet: async (k, v) => { cache.set(k, v); },
}));
// importOriginal, never a hand-listed export map: the thresholds this cron reads
// (HANDSHAKE_DOWN, MIN_HOMES_FOR_A_VERDICT, WINDOW_MINUTES) must be the real
// shipped numbers, and only the two IO functions are replaced.
vi.mock('../api/_lib/ops/home-health.js', async (importOriginal) => ({
	...(await importOriginal()),
	readHomeSignals: async () => signals,
	readLeakInstances: async () => leakInstances,
}));

const handler = (await import('../api/cron/home-health-alert.js')).default;
const { HANDSHAKE_DOWN, MIN_HOMES_FOR_A_VERDICT, WINDOW_MINUTES } = await import('../api/_lib/ops/home-health.js');

function makeRes() {
	return {
		statusCode: 0,
		body: null,
		headersSent: false,
		writableEnded: false,
		setHeader() {}, getHeader() {},
		status(code) { this.statusCode = code; return this; },
		end(payload) {
			this.writableEnded = true;
			if (payload && this.body === null) {
				try { this.body = JSON.parse(payload); } catch { this.body = payload; }
			}
			return this;
		},
		json(payload) { this.body = payload; return this; },
	};
}

/** A house that is entirely healthy: every alert must stay silent on this. */
function quiet(overrides = {}) {
	return {
		windowMinutes: WINDOW_MINUTES,
		homes: { live: 40, connected: 39, unreachable: 1, authFailed: 0 },
		handshakes: { attempts: 40, failed: 0, rate: 1 },
		actions: { total: 100, failed: 1, p95LatencyMs: 900 },
		confirmations: { offered: 10, redeemed: 8, expired: 2 },
		integrity: { violations: 0, lastAt: null, grantBacked: 0, grantBackedWithoutGrant: 0, confirmationScrubbed: 0 },
		...overrides,
	};
}

async function tick() {
	const res = makeRes();
	await handler({ method: 'GET', headers: {}, url: '/api/cron/home-health-alert' }, res);
	return res;
}

beforeEach(() => {
	sent.length = 0;
	cache.clear();
	leakInstances = [];
	signals = quiet();
});

test('a healthy lane fires nothing at all', async () => {
	const res = await tick();
	expect(res.statusCode).toBe(200);
	expect(res.body.ok).toBe(true);
	expect(res.body.fired).toEqual([]);
	expect(sent).toEqual([]);
});

test('alert 2 fires on a SINGLE unconfirmed guarded action, at critical', async () => {
	signals = quiet({ integrity: { violations: 1, lastAt: '2026-09-09T18:04:11.000Z', grantBacked: 0, grantBackedWithoutGrant: 0, confirmationScrubbed: 0 } });

	const res = await tick();

	expect(res.body.fired).toContain('confirmation_integrity');
	expect(sent).toHaveLength(1);
	const [alert] = sent;
	expect(alert.opts.severity).toBe('critical');
	// The word the operator has to see, and the query that finds the rows.
	expect(alert.title).toMatch(/guarded home action\(s\) executed with no confirmation/);
	expect(alert.detail).toContain('2026-09-09T18:04:11.000Z');
	expect(alert.detail).toContain("where guarded = true and confirmed_by is null and outcome = 'ok'");
	expect(alert.detail).toContain('docs/ops/home-operations.md');
});

test('alert 2 has no dedup window a second incident could fall into', async () => {
	signals = quiet({ integrity: { violations: 1, lastAt: '2026-09-09T18:04:11.000Z', grantBacked: 0, grantBackedWithoutGrant: 0, confirmationScrubbed: 0 } });
	await tick();
	const first = sent[0].opts.signature;

	// An hour later, a second door opens. The signature carries the newest
	// violation's timestamp precisely so this cannot be swallowed as a repeat.
	signals = quiet({ integrity: { violations: 2, lastAt: '2026-09-09T19:11:02.000Z', grantBacked: 0, grantBackedWithoutGrant: 0, confirmationScrubbed: 0 } });
	await tick();

	expect(sent).toHaveLength(2);
	expect(sent[1].opts.signature).not.toBe(first);
	expect(sent[1].opts.signature).toContain('2026-09-09T19:11:02.000Z');
});

test('alert 1 stays silent for one person unplugging their router', async () => {
	// Three homes, all three down: a 0% rate, far under the threshold, and still
	// nobody is paged because three houses cannot be a verdict about us.
	const attempts = MIN_HOMES_FOR_A_VERDICT - 1;
	signals = quiet({
		homes: { live: attempts, connected: 0, unreachable: attempts, authFailed: 0 },
		handshakes: { attempts, failed: attempts, rate: 0 },
	});

	const res = await tick();

	expect(res.body.fired).toEqual([]);
	expect(sent).toEqual([]);
});

test('alert 1 fires when enough distinct homes fail at once, then re-escalates hourly rather than every tick', async () => {
	const attempts = MIN_HOMES_FOR_A_VERDICT + 12;
	const failed = Math.ceil(attempts * 0.9);
	const down = () => quiet({
		homes: { live: attempts, connected: attempts - failed, unreachable: failed, authFailed: 0 },
		handshakes: { attempts, failed, rate: 1 - failed / attempts },
	});
	expect(1 - failed / attempts).toBeLessThan(HANDSHAKE_DOWN);

	signals = down();
	const first = await tick();
	expect(first.body.fired).toContain('correlated_unreachability');
	expect(sent).toHaveLength(1);
	expect(sent[0].opts.severity).toBe('critical');
	expect(sent[0].title).toMatch(/Home handshakes failing across tenants/);
	expect(sent[0].detail).toContain('curl -s https://three.ws/api/version');

	// Ticks 2 through 11 are the same outage: page once, not every five minutes.
	for (let i = 0; i < 10; i += 1) await tick();
	expect(sent).toHaveLength(1);

	// The twelfth tick is an hour in and re-escalates.
	await tick();
	expect(sent).toHaveLength(2);
	expect(sent[1].detail).toContain('Still failing after 12 consecutive checks');
});

test('alert 1 sends a recovery notice, at info, once the houses come back', async () => {
	const attempts = MIN_HOMES_FOR_A_VERDICT + 12;
	signals = quiet({
		homes: { live: attempts, connected: 0, unreachable: attempts, authFailed: 0 },
		handshakes: { attempts, failed: attempts, rate: 0 },
	});
	await tick();
	sent.length = 0;

	signals = quiet({ handshakes: { attempts, failed: 0, rate: 1 } });
	const res = await tick();

	expect(res.body.fired).toContain('correlated_unreachability_recovered');
	expect(sent).toHaveLength(1);
	expect(sent[0].opts.severity).toBe('info');
	expect(sent[0].title).toMatch(/Recovered/);
	// And it recovers exactly once: a quiet lane is not a recovery every 5 minutes.
	sent.length = 0;
	await tick();
	expect(sent).toEqual([]);
});

test('alert 3 fires per leaking instance and names the climbing samples', async () => {
	leakInstances = [
		{ instanceId: 'api-00420-a', leaking: true, samples: [40, 91, 173] },
		{ instanceId: 'api-00420-b', leaking: false, samples: [4, 4, 5] },
	];

	const res = await tick();

	expect(res.body.fired).toContain('subscriber_leak');
	expect(sent).toHaveLength(1);
	expect(sent[0].opts.severity).toBe('critical');
	expect(sent[0].title).toBe('Home subscriber leak on 1 instance(s)');
	expect(sent[0].detail).toContain('api-00420-a: subscribers climbed 40 then 91 then 173');
	expect(sent[0].detail).not.toContain('api-00420-b');
	expect(sent[0].opts.signature).toBe('home:leak:api-00420-a');
});

test('all three fire together on one tick without any of them swallowing another', async () => {
	const attempts = MIN_HOMES_FOR_A_VERDICT + 5;
	signals = quiet({
		homes: { live: attempts, connected: 0, unreachable: attempts, authFailed: 0 },
		handshakes: { attempts, failed: attempts, rate: 0 },
		integrity: { violations: 4, lastAt: '2026-09-09T18:04:11.000Z', grantBacked: 0, grantBackedWithoutGrant: 0, confirmationScrubbed: 0 },
	});
	leakInstances = [{ instanceId: 'api-00420-a', leaking: true, samples: [40, 91, 173] }];

	const res = await tick();

	expect(res.body.fired).toEqual(['confirmation_integrity', 'correlated_unreachability', 'subscriber_leak']);
	expect(sent).toHaveLength(3);
	expect(new Set(sent.map((s) => s.opts.signature)).size).toBe(3);
	// The integrity page is first out of the door, ahead of the noisier two.
	expect(sent[0].title).toMatch(/no confirmation/);
});

test('a grant the user revoked afterwards reports but never pages', async () => {
	// The live database carries exactly this shape: a lawful grant-backed unlock
	// whose grant row was hard-deleted by a later grant.revoke. It must not page.
	signals = quiet({
		integrity: { violations: 0, lastAt: null, grantBacked: 2, grantBackedWithoutGrant: 1, confirmationScrubbed: 0 },
	});

	const res = await tick();

	expect(res.body.fired).toEqual([]);
	expect(sent).toEqual([]);
	expect(res.body.signals.integrity.grantBackedWithoutGrant).toBe(1);
});
