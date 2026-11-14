// Two production failures behind the agent_index DOWN verdict of 2026-11-14:
//
// 1. Orphan cursors. agent_event_cursor rows whose agent left the sweep's
//    candidate set (solana_agents_index.active flipped false, identity deleted)
//    are never re-crawled, so their last_indexed_at froze (3 rows, 502h on
//    prod) and the sensor reported them as the worst overdue agent forever.
// 2. Provider outage stamped onto agents. When every Solana lane answered 429,
//    the sweep wrote the 429 onto each cursor it touched (252 rows, 12.4%),
//    marking healthy agents as erroring and pushing them out a full dormant
//    interval, instead of leaving them at the queue head for the next tick.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));

const signaturesMock = vi.fn();
vi.mock('../api/_lib/solana/cursor-recovery.js', () => ({
	signaturesSinceCursor: (...a) => signaturesMock(...a),
}));

import { sweepAgentEvents } from '../api/_lib/solana-agent-events.js';
import { readIndexLag } from '../api/_lib/ops/index-lag.js';

const text = (strings) => (Array.isArray(strings) ? strings.join('?') : String(strings));

describe('readIndexLag: solana leg scores only agents the sweep still crawls', () => {
	beforeEach(() => sqlMock.mockReset());

	it('restricts the solana cursor aggregate to current sweep candidates', async () => {
		const queries = [];
		sqlMock.mockImplementation((strings) => {
			queries.push(text(strings));
			return Promise.resolve([{}]);
		});
		await readIndexLag().catch(() => {});
		const solana = queries.find((q) => q.includes("cur.chain = 'solana'"));
		expect(solana).toBeTruthy();
		expect(solana).toMatch(/solana_agents_index/);
		expect(solana).toMatch(/agent_identities/);
	});
});

describe('sweepAgentEvents: a provider outage is not the agent failing', () => {
	beforeEach(() => {
		sqlMock.mockReset();
		signaturesMock.mockReset();
	});

	it('does not stamp an error onto cursors when the RPC fabric is exhausted', async () => {
		const writes = [];
		sqlMock.mockImplementation((strings, ...values) => {
			const t = text(strings);
			if (t.includes('WITH candidates')) {
				return Promise.resolve(
					['9wfHhvzhnmmzU3P2E8X95uevP5jj5FyaEKxXwQcXDivo', '6iRMN65yz113NYUwBeoAEQCoT9jrmoYsyjGJgrpLCqkL'].map(
						(agent_ref) => ({ agent_ref, network: 'mainnet', source: 'x' }),
					),
				);
			}
			if (t.includes('INSERT INTO agent_event_cursor')) writes.push({ t, values });
			return Promise.resolve([]);
		});
		signaturesMock.mockRejectedValue(new Error('solana rpc 429 @ https://api.mainnet-beta.solana.com'));

		const r = await sweepAgentEvents({ concurrency: 1 });
		expect(r.failed).toBe(2);
		expect(writes).toHaveLength(0);
	});

	it('still records an error that is about the agent itself', async () => {
		const writes = [];
		sqlMock.mockImplementation((strings, ...values) => {
			const t = text(strings);
			if (t.includes('WITH candidates')) {
				return Promise.resolve([{ agent_ref: 'not-a-key', network: 'mainnet', source: 'x' }]);
			}
			if (t.includes('INSERT INTO agent_event_cursor')) writes.push({ t, values });
			return Promise.resolve([]);
		});
		await sweepAgentEvents({ concurrency: 1 });
		expect(writes).toHaveLength(1);
		expect(writes[0].values.join(' ')).toContain('not a Solana account key');
	});
});
