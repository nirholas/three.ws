import { describe, it, expect } from 'vitest';
import { SignatureWallData, WallClientError } from '../src/game/signature-wall-data.js';

const sig = (no) => ({ id: `id${no}`, no, name: `n${no}`, line: '', ts: no, verified: false });
const reply = (status, body, headers = {}) => ({
	ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body,
});

function stub(handler) {
	const calls = [];
	const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
	return { fetchImpl, calls };
}

describe('SignatureWallData', () => {
	it('loads the newest page and tracks the newest number', async () => {
		const { fetchImpl } = stub(() => reply(200, { total: 3, signatures: [sig(3), sig(2), sig(1)] }));
		const d = new SignatureWallData({ fetchImpl });
		await d.load();
		expect(d.total).toBe(3);
		expect(d.newestNo).toBe(3);
	});

	it('refresh returns only unseen signatures and coalesces concurrent calls', async () => {
		let n = 0;
		const { fetchImpl, calls } = stub((url) => {
			if (url.includes('since=')) { n++; return reply(200, { total: 4, signatures: [sig(4)] }); }
			return reply(200, { total: 3, signatures: [sig(3), sig(2), sig(1)] });
		});
		const d = new SignatureWallData({ fetchImpl });
		await d.load();
		const [a, b] = await Promise.all([d.refresh({ minGapMs: 0 }), d.refresh({ minGapMs: 0 })]);
		expect(n).toBe(1);
		expect(a).toEqual(b);
		expect(a.map((s) => s.no)).toEqual([4]);
		expect(d.recent[0].no).toBe(4);
		expect(calls.some((c) => c.url.includes('since=3'))).toBe(true);
	});

	it('adopt does not advance the cursor, so a stranger with a lower number is still fetched', async () => {
		const { fetchImpl } = stub(() => reply(200, { total: 2, signatures: [sig(2), sig(1)] }));
		const d = new SignatureWallData({ fetchImpl });
		await d.load();
		d.adopt(sig(4), 4);
		expect(d.newestNo).toBe(2);
		expect(d.adopt(sig(4), 4)).toBe(false);
	});

	it('sign sends a guest session without a pass, and a pass without a session', async () => {
		const { fetchImpl, calls } = stub(() => reply(201, { ok: true, signature: sig(1), total: 1 }));
		const d = new SignatureWallData({ fetchImpl });
		await d.sign({ name: 'A', line: '' });
		expect(JSON.parse(calls[0].init.body).session).toBeTruthy();
		await d.sign({ name: 'A', line: '', playPass: 'tok' });
		const b = JSON.parse(calls[1].init.body);
		expect(b.playPass).toBe('tok');
		expect(b.session).toBeUndefined();
	});

	it('maps refusals to WallClientError with code, existing and retry-after', async () => {
		const ex = sig(9);
		const { fetchImpl } = stub(() => reply(409, { error: 'already_signed', error_description: 'You already signed.', existing: ex }));
		const err = await new SignatureWallData({ fetchImpl }).sign({ name: 'A' }).catch((e) => e);
		expect(err).toBeInstanceOf(WallClientError);
		expect(err.code).toBe('already_signed');
		expect(err.existing).toEqual(ex);

		const lim = stub(() => reply(429, { error: 'rate_limited', error_description: 'slow' }, { 'retry-after': '42' }));
		const e2 = await new SignatureWallData({ fetchImpl: lim.fetchImpl }).sign({ name: 'A' }).catch((e) => e);
		expect(e2.retryAfter).toBe(42);
	});

	it('reports a network failure as a designed error', async () => {
		const d = new SignatureWallData({ fetchImpl: async () => { throw new Error('down'); } });
		const err = await d.load().catch((e) => e);
		expect(err.code).toBe('network');
	});

	it('bounds the older-page cache', async () => {
		const { fetchImpl } = stub(() => reply(200, { total: 5000, signatures: [sig(1)] }));
		const d = new SignatureWallData({ fetchImpl });
		d.total = 5000;
		for (let p = 1; p <= 12; p++) await d.page(p);
		expect(d._old.size).toBeLessThanOrEqual(6);
	});
});
