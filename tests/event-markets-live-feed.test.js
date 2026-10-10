/**
 * Event Markets live feed: move rule, stream hub (coalescing, resume, caps,
 * backpressure, privacy) and the browser client (dedupe, backoff, polling).
 * Only the database source and the EventSource are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notableMoves, normalizeShares, moveBucket } from '../api/_lib/event-markets/moves.js';
import { createHub, coalesce, frame } from '../api/_lib/event-markets/hub.js';
import { createLiveFeed, applyOdds } from '../src/event-markets/live-feed.js';

const CFG = { pollIntervalMs: 250, coalesceMs: 1000, heartbeatMs: 15000, maxConnectionMs: 270000, retryMs: 2000, maxConnectionsPerIp: 2, maxConnectionsPerProcess: 5, replayLimit: 500, retentionHours: 48 };

describe('move rule', () => {
	it('fires at the threshold and not below it', () => {
		const base = new Map([['a', 0.4], ['b', 0.6]]);
		const hit = notableMoves(base, [{ outcome_id: 'a', share: 0.45 }, { outcome_id: 'b', share: 0.55 }], 5);
		expect(hit.map((m) => m.outcome_id)).toEqual(['a', 'b']);
		expect(hit[0].delta_points).toBe(5);
		expect(notableMoves(base, [{ outcome_id: 'a', share: 0.44 }], 5)).toEqual([]);
	});
	it('ignores outcomes with no baseline', () => {
		expect(notableMoves(new Map(), [{ outcome_id: 'x', share: 0.9 }], 5)).toEqual([]);
	});
	it('normalizes fractions and percents to the same shares', () => {
		const a = normalizeShares([{ share: 0.25 }, { share: 0.75 }]).map((r) => r.share);
		const b = normalizeShares([{ share: 25 }, { share: 75 }]).map((r) => r.share);
		expect(a).toEqual(b);
		expect(normalizeShares([{ share: 0 }, { share: 0 }]).map((r) => r.share)).toEqual([0.5, 0.5]);
	});
	it('buckets timestamps by window', () => {
		expect(moveBucket(0, 600)).toBe(moveBucket(599_999, 600));
		expect(moveBucket(600_000, 600)).toBe(moveBucket(0, 600) + 1);
	});
});

describe('coalesce', () => {
	it('keeps the last odds per market, a pick count, and every lock', () => {
		const out = coalesce([
			{ id: 1, kind: 'odds', slug: 'm', n: 1 }, { id: 2, kind: 'pick', slug: 'm' },
			{ id: 3, kind: 'pick', slug: 'm' }, { id: 4, kind: 'odds', slug: 'm', n: 2 }, { id: 5, kind: 'lock', slug: 'm' },
		]);
		expect(out.map((e) => e.id)).toEqual([3, 4, 5]);
		expect(out[0].batched).toBe(2);
	});
	it('never leaks who picked', () => {
		const wire = frame({ id: 3, kind: 'pick', slug: 'm', outcome_id: 'o' });
		expect(wire).toContain('event: pick');
		expect(wire).not.toMatch(/user|account|wallet/i);
	});
});

function makeSource() {
	const log = [];
	return {
		log,
		push(kind, slug, extra = {}) { log.push({ id: log.length + 1, kind, slug, ...extra }); },
		eventsSince: async (after, limit) => log.filter((r) => r.id > after).slice(0, limit),
		latestId: async () => log.length,
		oldestId: async () => (log[0]?.id ?? 0),
		snapshot: async (slug) => ({ markets: [{ slug: slug ?? 'all' }] }),
		process: async () => {},
	};
}
function listener(hub, opts = {}) {
	const out = [];
	let ended = false;
	return hub.attach({ write: (s) => out.push(s), end: () => { ended = true; }, backlog: () => 0, ip: '1.1.1.1', ...opts }).then((detach) => ({ out, detach, get ended() { return ended; } }));
}
const ids = (out) => out.join('').match(/^id: (\d+)$/gm)?.map((l) => Number(l.slice(4))) ?? [];

describe('stream hub', () => {
	let t, source, hub;
	beforeEach(() => { t = 1_000_000; source = makeSource(); hub = createHub({ source, config: CFG, now: () => t }); });
	afterEach(() => hub.shutdown());

	it('opens with a snapshot, then delivers new rows', async () => {
		const a = await listener(hub);
		expect(a.out[0]).toContain('event: snapshot');
		source.push('lock', 'm');
		await hub.tick();
		expect(a.out.join('')).toContain('event: lock');
	});

	it('filters to one market when asked', async () => {
		const a = await listener(hub, { slug: 'm1' });
		source.push('lock', 'm2'); source.push('lock', 'm1');
		await hub.tick();
		const wire = a.out.join('');
		expect(wire).toContain('"slug":"m1"');
		expect(wire).not.toContain('"slug":"m2"');
	});

	it('sends at most one odds frame per market per second and flushes the held one without an id', async () => {
		const a = await listener(hub);
		source.push('odds', 'm', { n: 1 }); await hub.tick();
		source.push('odds', 'm', { n: 2 }); await hub.tick();
		expect(a.out.filter((s) => s.includes('event: odds'))).toHaveLength(1);
		t += 1100; await hub.tick();
		const odds = a.out.filter((s) => s.includes('event: odds'));
		expect(odds).toHaveLength(2);
		expect(odds[1]).not.toMatch(/^id:/);
		expect(odds[1]).toContain('"n":2');
	});

	it('resumes from Last-Event-ID with exactly the missed events', async () => {
		const a = await listener(hub);
		source.push('lock', 'm'); await hub.tick();
		const seen = ids(a.out).pop();
		a.detach();
		source.push('resolve', 'm'); source.push('open', 'n');
		await hub.tick();
		const b = await listener(hub, { lastEventId: seen });
		expect(b.out[0]).toContain('event: resume');
		const wire = b.out.join('');
		expect(wire).toContain('event: resolve');
		expect(wire).not.toContain('event: lock');
	});

	it('falls back to a resync snapshot when the gap predates the log', async () => {
		for (let i = 0; i < 5; i++) source.push('lock', `m${i}`);
		source.log.splice(0, 3);
		const b = await listener(hub, { lastEventId: 1 });
		expect(b.out[0]).toContain('event: resync');
	});

	it('caps connections per IP and per process', async () => {
		await listener(hub, { ip: '9.9.9.9' }); await listener(hub, { ip: '9.9.9.9' });
		expect(hub.admit('9.9.9.9')).toEqual({ ok: false, reason: 'too_many_connections' });
		expect(hub.admit('8.8.8.8').ok).toBe(true);
	});

	it('cuts loose a listener that cannot keep up', async () => {
		let backlog = 0;
		const slow = await listener(hub, { backlog: () => backlog });
		backlog = 10_000_000;
		source.push('lock', 'm'); await hub.tick();
		expect(slow.ended).toBe(true);
		expect(hub.size).toBe(0);
	});
});

class FakeES {
	static all = [];
	constructor(url) { this.url = url; this.l = {}; FakeES.all.push(this); }
	addEventListener(t, fn) { this.l[t] = fn; }
	close() { this.closed = true; }
	emit(t, data, lastEventId = '') { this.l[t]?.({ data: JSON.stringify(data), lastEventId: String(lastEventId) }); }
}

describe('live client', () => {
	let timers, queue, events, statuses;
	const env = (extra = {}) => ({ EventSource: FakeES, document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: { addEventListener() {}, removeEventListener() {} }, timers, random: () => 0.5, online: () => true, ...extra });
	beforeEach(() => {
		FakeES.all = []; events = []; statuses = []; queue = [];
		timers = { setTimeout: (fn, ms) => { const h = { fn, ms }; queue.push(h); return h; }, clearTimeout: (h) => { queue = queue.filter((x) => x !== h); }, setInterval: (fn, ms) => { const h = { fn, ms, every: true }; queue.push(h); return h; }, clearInterval: (h) => { queue = queue.filter((x) => x !== h); } };
	});
	const run = (pred) => { const h = queue.find(pred); queue = queue.filter((x) => x !== h); return h.fn(); };

	it('drops duplicate seqs and stale odds', () => {
		const f = createLiveFeed({ onEvent: (e) => events.push(e), onStatus: (s) => statuses.push(s), env: env() });
		f.start();
		const es = FakeES.all[0];
		es.emit('snapshot', { seq: 5, markets: [] }, 5);
		es.emit('pick', { seq: 6, slug: 'm' }, 6); es.emit('pick', { seq: 6, slug: 'm' }, 6);
		es.emit('odds', { seq: 8, slug: 'm' }, 8); es.emit('odds', { seq: 7, slug: 'm' });
		expect(events.map((e) => `${e.type}${e.seq}`)).toEqual(['snapshot5', 'pick6', 'odds8']);
		expect(statuses).toContain('live');
	});

	it('reconnects with the last event id, so nothing is replayed twice', () => {
		const f = createLiveFeed({ slug: 'm', onEvent: (e) => events.push(e), env: env() });
		f.start();
		FakeES.all[0].emit('lock', { seq: 12, slug: 'm' }, 12);
		FakeES.all[0].onerror();
		run((h) => !h.every);
		expect(FakeES.all[1].url).toBe('/api/event-markets/stream?slug=m&lastEventId=12');
		FakeES.all[1].emit('resume', { from: 12, to: 14, replayed: 1 });
		FakeES.all[1].emit('lock', { seq: 12, slug: 'm' }, 12);
		expect(events.filter((e) => e.type === 'lock')).toHaveLength(1);
	});

	it('falls back to REST polling after repeated failures and says so', async () => {
		const poll = vi.fn(async () => ({ markets: [{ slug: 'm', outcomes: [] }] }));
		const f = createLiveFeed({ onEvent: (e) => events.push(e), onStatus: (s) => statuses.push(s), poll, env: env() });
		f.start();
		for (let i = 0; i < 3; i++) { FakeES.all.at(-1).onerror(); if (i < 2) run((h) => !h.every); }
		await Promise.resolve(); await Promise.resolve();
		expect(statuses.at(-1)).toBe('polling');
		expect(poll).toHaveBeenCalled();
		expect(events.at(-1)).toMatchObject({ type: 'snapshot', polled: true });
	});

	it('reports offline when the browser has no network', () => {
		const f = createLiveFeed({ onEvent() {}, onStatus: (s) => statuses.push(s), env: env({ online: () => false }) });
		f.start();
		expect(statuses).toEqual(['offline']);
		expect(FakeES.all).toHaveLength(0);
	});

	it('treats silence as a dead connection', () => {
		const f = createLiveFeed({ onEvent() {}, onStatus: (s) => statuses.push(s), env: env() });
		f.start();
		FakeES.all[0].emit('ping', {});
		run((h) => h.ms > 30000 && h.ms < 40000);
		expect(FakeES.all[0].closed).toBe(true);
		expect(statuses.at(-1)).toBe('reconnecting');
	});
});

describe('applyOdds', () => {
	it('patches percents and counts in place', () => {
		const m = { pick_count: 1, outcomes: [{ id: 'a', percent: 50, picks: 1 }, { id: 'b', percent: 50, picks: 0 }] };
		applyOdds(m, { pick_count: 3, outcomes: [{ id: 'a', percent: 70, picks: 2 }, { id: 'b', percent: 30, picks: 1 }] });
		expect(m.outcomes.map((o) => o.percent)).toEqual([70, 30]);
		expect(m.pick_count).toBe(3);
	});
});
