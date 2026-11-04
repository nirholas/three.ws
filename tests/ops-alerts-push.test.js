// Ops alert push channels (api/_lib/alerts.js, api/_lib/alert-channels.js).
//
// The alerter takes its transports, cache and persistence as arguments, so
// every routing rule is exercised against real code paths with recording
// transports instead of the network:
//   critical  pushes on every configured channel, every time (only the
//             per-channel hourly ceiling can hold it back)
//   warn      Telegram once per dedup window; email collects it for the
//             hourly digest instead of sending one email per alert
//   info      dashboard only
// Each channel keeps its own dedup and hourly counters, so a throttled
// Telegram never silences email, and a transport that throws never reaches the
// caller.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	createOpsAlerter,
	buildWarnDigest,
	sendWarnDigest,
	GLOBAL_LIMIT_PER_HOUR,
} from '../api/_lib/alerts.js';
import { alertChannels, alertChannelGaps, parseAlertRecipients } from '../api/_lib/alert-channels.js';

const HOUR = 3_600_000;

function memoryCache() {
	const store = new Map();
	return {
		store,
		get: async (k) => (store.has(k) ? store.get(k) : null),
		set: async (k, v) => {
			store.set(k, v);
		},
	};
}

function recorder() {
	const calls = [];
	const fn = async (msg) => {
		calls.push(msg);
		return { ok: true };
	};
	fn.calls = calls;
	return fn;
}

function setup({ channels = ['telegram', 'email'], now = 10 * HOUR } = {}) {
	const transports = {};
	for (const c of channels) transports[c] = recorder();
	const persisted = [];
	const cache = memoryCache();
	const clock = { t: now };
	const alerter = createOpsAlerter({
		transports,
		cache,
		persist: async (row) => {
			persisted.push(row);
		},
		now: () => clock.t,
		environment: 'production',
	});
	return { alerter, transports, persisted, cache, clock };
}

// Fire-and-forget deliveries settle on the microtask queue.
const settle = () => new Promise((r) => setImmediate(r));

describe('severity routing', () => {
	it('pushes a critical alert to both channels, and again on a repeat inside the dedup window', async () => {
		const { alerter, transports } = setup();
		const first = await alerter.send('🚨 ring LEAK', 'funds left the set', { signature: 'leak' });
		await alerter.send('🚨 ring LEAK', 'funds left the set', { signature: 'leak' });
		await settle();
		expect(first.severity).toBe('critical');
		expect(first.pushed.sort()).toEqual(['email', 'telegram']);
		expect(transports.telegram.calls).toHaveLength(2);
		expect(transports.email.calls).toHaveLength(2);
		expect(transports.email.calls[0]).toMatchObject({ channel: 'email', severity: 'critical', kind: 'alert' });
		expect(transports.email.calls[0].subject).toMatch(/CRITICAL/);
		expect(transports.email.calls[0].text).toMatch(/funds left the set/);
	});

	it('pushes a warn alert to Telegram once per dedup window and holds it for the email digest', async () => {
		const { alerter, transports, clock } = setup();
		const r1 = await alerter.send('⛽ sponsor low on SOL', 'wallet below floor', { signature: 'sol' });
		const r2 = await alerter.send('⛽ sponsor low on SOL', 'wallet below floor', { signature: 'sol' });
		await settle();
		expect(r1.pushed).toEqual(['telegram']);
		expect(r1.held).toEqual({ email: 'digest' });
		expect(r2.suppressed).toEqual({ telegram: 'dedup' });
		expect(transports.telegram.calls).toHaveLength(1);
		expect(transports.email.calls).toHaveLength(0);

		clock.t += HOUR + 1; // the dedup window has passed
		const r3 = await alerter.send('⛽ sponsor low on SOL', 'wallet below floor', { signature: 'sol' });
		await settle();
		expect(r3.pushed).toEqual(['telegram']);
		expect(transports.telegram.calls).toHaveLength(2);
	});

	it('keeps an info alert on the dashboard only', async () => {
		const { alerter, transports, persisted } = setup();
		const r = await alerter.send('ℹ️ nightly rollup complete', '', {});
		await settle();
		expect(r.pushed).toEqual([]);
		expect(transports.telegram.calls).toHaveLength(0);
		expect(transports.email.calls).toHaveLength(0);
		expect(persisted).toHaveLength(1);
		expect(persisted[0].severity).toBe('info');
	});

	it('persists every alert whatever the channels do', async () => {
		const { alerter, persisted } = setup({ channels: [] });
		await alerter.send('🚨 signer compromised', 'x', {});
		await alerter.send('5xx in /api/chat', 'y', {});
		expect(persisted.map((p) => p.severity)).toEqual(['critical', 'warn']);
	});
});

describe('per-channel hourly ceiling', () => {
	it('throttles Telegram after the ceiling with one notice while email keeps delivering criticals', async () => {
		const { alerter, transports } = setup();
		// Fill Telegram's hour with distinct warn alerts (email holds these for the digest).
		for (let i = 0; i < GLOBAL_LIMIT_PER_HOUR; i++) await alerter.send(`warn ${i}`, '', { signature: `w${i}` });
		await settle();
		expect(transports.telegram.calls).toHaveLength(GLOBAL_LIMIT_PER_HOUR);
		expect(transports.email.calls).toHaveLength(0);

		const r = await alerter.send('🚨 payer halted', 'float empty', { signature: 'halt' });
		await alerter.send('🚨 payer halted again', 'float empty', { signature: 'halt2' });
		await settle();
		expect(r.pushed).toEqual(['email']);
		expect(r.suppressed).toEqual({ telegram: 'hourly_limit' });
		// Exactly one throttle notice on Telegram, then silence for the hour.
		const notices = transports.telegram.calls.filter((c) => c.kind === 'throttle');
		expect(notices).toHaveLength(1);
		expect(notices[0].text).toMatch(/throttled/);
		expect(transports.email.calls.map((c) => c.title)).toEqual(['🚨 payer halted', '🚨 payer halted again']);
	});

	it('resets the ceiling in the next hour', async () => {
		const { alerter, transports, clock } = setup({ channels: ['telegram'] });
		for (let i = 0; i <= GLOBAL_LIMIT_PER_HOUR; i++) await alerter.send(`🚨 c${i}`, '', { signature: `c${i}` });
		clock.t += HOUR;
		const r = await alerter.send('🚨 next hour', '', { signature: 'n' });
		await settle();
		expect(r.pushed).toEqual(['telegram']);
		expect(transports.telegram.calls.at(-1).title).toBe('🚨 next hour');
	});
});

describe('transport failures', () => {
	it('never throws into the caller, and the other channel still delivers', async () => {
		const persisted = [];
		const email = recorder();
		const alerter = createOpsAlerter({
			transports: {
				telegram: () => {
					throw new Error('sync boom');
				},
				email,
			},
			cache: memoryCache(),
			persist: async (row) => persisted.push(row),
			now: () => 5 * HOUR,
			environment: 'production',
		});
		await expect(alerter.send('🚨 critical thing', 'x', {})).resolves.toMatchObject({ severity: 'critical' });
		await settle();
		expect(email.calls).toHaveLength(1);
		expect(persisted).toHaveLength(1);
	});

	it('swallows a rejected delivery and a failing cache', async () => {
		const alerter = createOpsAlerter({
			transports: { telegram: async () => Promise.reject(new Error('502 from telegram')) },
			cache: {
				get: async () => {
					throw new Error('redis down');
				},
				set: async () => {
					throw new Error('redis down');
				},
			},
			persist: async () => {
				throw new Error('db down');
			},
			now: () => 5 * HOUR,
			environment: 'production',
		});
		await expect(alerter.send('🚨 critical', '', {})).resolves.toBeTruthy();
		await settle();
	});
});

describe('warn digest', () => {
	const now = Date.parse('2026-11-04T18:05:00Z');
	const rows = [
		{ signature: 'a1', title: '5xx in /api/chat', detail: 'TypeError: x\n at y', count: 4, first_seen: '2026-11-04T17:10:00Z', last_seen: '2026-11-04T17:55:00Z' },
		{ signature: 'a2', title: '5xx in /api/chat', detail: 'RangeError: z', count: 3, first_seen: '2026-11-04T17:20:00Z', last_seen: '2026-11-04T18:01:00Z' },
		{ signature: 'b1', title: '⛽ sponsor low on SOL', detail: 'wallet below floor', count: 9, first_seen: '2026-11-03T09:00:00Z', last_seen: '2026-11-04T17:40:00Z' },
		{ signature: 'c1', title: 'RPC lane demoted', detail: '', count: 1, first_seen: '2026-11-04T17:30:00Z', last_seen: '2026-11-04T17:30:00Z' },
	];
	const oldest = { title: '⛽ sponsor low on SOL', severity: 'warn', first_seen: '2026-11-03T09:00:00Z' };

	it('groups rows by title, sums counts, orders by volume and names the oldest unresolved item', () => {
		const d = buildWarnDigest(rows, { oldest, environment: 'production', now });
		expect(d.groups.map((g) => [g.title, g.count, g.signatures])).toEqual([
			['⛽ sponsor low on SOL', 9, 1],
			['5xx in /api/chat', 7, 2],
			['RPC lane demoted', 1, 1],
		]);
		expect(d.subject).toBe('three.ws ops digest [production]: 3 warn alerts, 17 occurrences');
		expect(d.text).toMatch(/Oldest unresolved: ⛽ sponsor low on SOL \(warn\), open since 2026-11-03T09:00:00\.000Z \(33h\)/);
		expect(d.text).toMatch(/5xx in \/api\/chat\n {2}7 occurrences across 2 signatures, last 2026-11-04T18:01:00\.000Z/);
		expect(d.text).toMatch(/latest: RangeError: z/);
		expect(d.html).toContain('5xx in /api/chat');
		expect(d.occurrences).toBe(17);
	});

	it('escapes HTML in titles and details', () => {
		const d = buildWarnDigest([{ ...rows[3], title: '<script>alert(1)</script>', detail: 'a & b' }], { oldest: null, environment: 'production', now });
		expect(d.html).not.toContain('<script>');
		expect(d.html).toContain('&lt;script&gt;');
		expect(d.html).toContain('a &amp; b');
		expect(d.text).toMatch(/Oldest unresolved: none/);
	});

	it('returns null when there is nothing to report', () => {
		expect(buildWarnDigest([], { oldest, environment: 'production', now })).toBeNull();
	});

	it('sends one digest per hour, retries after a failed send, and skips an empty hour', async () => {
		const cache = memoryCache();
		const sent = [];
		let fail = true;
		const transport = async (msg) => {
			if (fail) throw new Error('resend 500');
			sent.push(msg);
		};
		const load = async () => ({ rows, oldest });
		const first = await sendWarnDigest({ transport, load, cache, now: () => now, environment: 'production' });
		expect(first).toMatchObject({ sent: false, reason: 'send_failed' });
		fail = false;
		const second = await sendWarnDigest({ transport, load, cache, now: () => now, environment: 'production' });
		expect(second).toMatchObject({ sent: true, alerts: 3, occurrences: 17 });
		const third = await sendWarnDigest({ transport, load, cache, now: () => now + 60_000, environment: 'production' });
		expect(third).toMatchObject({ sent: false, reason: 'already_sent' });
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ channel: 'email', kind: 'digest' });

		const empty = await sendWarnDigest({ transport, load: async () => ({ rows: [], oldest: null }), cache, now: () => now + HOUR, environment: 'production' });
		expect(empty).toMatchObject({ sent: false, reason: 'no_warn_alerts' });
	});

	it('reports email_unconfigured without a transport', async () => {
		const r = await sendWarnDigest({ transport: null, load: async () => ({ rows, oldest }), cache: memoryCache(), now: () => now, environment: 'production' });
		expect(r).toMatchObject({ sent: false, reason: 'email_unconfigured' });
	});
});

describe('alert channel config', () => {
	const KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALERTS_CHAT_ID', 'OPS_ALERT_EMAILS', 'RESEND_API_KEY'];
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
		for (const k of KEYS) delete process.env[k];
	});
	afterEach(() => {
		for (const k of KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it('parses, lowercases and de-duplicates recipients, separating invalid ones', () => {
		expect(parseAlertRecipients(' Ops@Three.ws , ops@three.ws,, not-an-email , b@example.org')).toEqual({
			valid: ['ops@three.ws', 'b@example.org'],
			invalid: ['not-an-email'],
		});
	});

	it('reports only the dashboard with no env, and names every missing var', () => {
		expect(alertChannels()).toEqual({ dashboard: true, telegram: false, email: false });
		expect(alertChannelGaps()).toEqual({
			telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALERTS_CHAT_ID'],
			email: ['OPS_ALERT_EMAILS', 'RESEND_API_KEY'],
			invalidEmails: [],
		});
	});

	it('needs both a recipient and the Resend key for email', () => {
		process.env.OPS_ALERT_EMAILS = 'ops@three.ws';
		expect(alertChannels().email).toBe(false);
		expect(alertChannelGaps().email).toEqual(['RESEND_API_KEY']);
		process.env.RESEND_API_KEY = 're_test';
		expect(alertChannels()).toEqual({ dashboard: true, telegram: false, email: true });
	});

	it('does not count a list of only invalid addresses as configured', () => {
		process.env.OPS_ALERT_EMAILS = 'nope, also nope';
		process.env.RESEND_API_KEY = 're_test';
		expect(alertChannels().email).toBe(false);
		expect(alertChannelGaps()).toMatchObject({ email: ['OPS_ALERT_EMAILS'], invalidEmails: ['nope', 'also nope'] });
	});
});
