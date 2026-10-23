import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let queue = [];
const sqlMock = vi.fn((strings, ...values) => {
	calls.push({ text: strings.join('?').toLowerCase(), values });
	return Promise.resolve(queue.length ? queue.shift() : []);
});
vi.mock('../api/_lib/db.js', () => ({
	sql: sqlMock,
	sqlValues: () => {},
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const { recordDecision, linkOutcomeToMemories } = await import('../api/_lib/reasoning-ledger.js');

const AGENT = '22222222-2222-2222-2222-222222222222';
const MEM_A = '33333333-3333-3333-3333-333333333333';
const MEM_B = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
	calls.length = 0;
	queue = [];
	sqlMock.mockClear();
});

describe('decision to memory outcome link', () => {
	it('stores recall ids beside the decision, deduped, ignoring non-uuids', async () => {
		queue.push([]); // idempotency lookup: nothing yet
		queue.push([]); // chain head: none
		queue.push([{ id: 'dec-1', seq: 1, entry_hash: 'h' }]); // insert
		await recordDecision({
			agentId: AGENT, kind: 'snipe', subjectRef: 'mint', actionRef: 'pos',
			recallIds: [MEM_A, MEM_A, 'not-a-uuid', MEM_B],
		});
		const link = calls.find((c) => c.text.includes('insert into decision_recalls'));
		expect(link).toBeTruthy();
		expect(link.values).toContainEqual([MEM_A, MEM_B]);
		expect(link.values).toContain('dec-1');
	});

	it('does not touch decision_recalls when nothing was recalled', async () => {
		queue.push([]);
		queue.push([]);
		queue.push([{ id: 'dec-1', seq: 1, entry_hash: 'h' }]);
		await recordDecision({ agentId: AGENT, kind: 'snipe', subjectRef: 'mint', actionRef: 'pos' });
		expect(calls.some((c) => c.text.includes('decision_recalls'))).toBe(false);
	});

	it('does not fail the decision when the link write throws', async () => {
		sqlMock.mockImplementationOnce(() => Promise.resolve([])).mockImplementationOnce(() => Promise.resolve([]))
			.mockImplementationOnce(() => Promise.resolve([{ id: 'dec-1', seq: 1, entry_hash: 'h' }]))
			.mockImplementationOnce(() => Promise.reject(new Error('relation "decision_recalls" does not exist')));
		const out = await recordDecision({ agentId: AGENT, kind: 'snipe', recallIds: [MEM_A] });
		expect(out).toMatchObject({ id: 'dec-1', seq: 1, deduped: false });
	});

	it('writes pnl, win and hold time onto the recalled memories, idempotently', async () => {
		queue.push([{ memory_id: MEM_A }, { memory_id: MEM_B }]);
		const out = await linkOutcomeToMemories({
			decisionId: 'dec-1', agentId: AGENT, pnlUsd: -42.5, win: false, holdSeconds: 900,
			closedAt: '2026-10-23T00:00:00.000Z',
		});
		expect(out.linked).toBe(2);
		const w = calls[0];
		expect(w.text).toContain('insert into memory_outcomes');
		expect(w.text).toContain('on conflict do nothing');
		expect(w.values).toEqual([-42.5, false, 900, '2026-10-23T00:00:00.000Z', 'dec-1', AGENT]);
	});
});
