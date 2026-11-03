// Regression: evaluateExits referenced `result`, `pnl` and `pnlPct` (the
// profitable-trade skill hook) before the exit trade existed, so every sweep
// that re-quoted an open position threw a ReferenceError and the position was
// never marked to market, held, or closed. No funds move: all I/O is stubbed.

import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ updates: [] }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	const sql = (strings) => {
		const text = strings.join('?');
		let rows = [];
		if (/FROM agent_identities/.test(text)) {
			rows = [{ id: 'a1', user_id: 'u1', name: 'Bot', meta: { solana_address: '11111111111111111111111111111111', encrypted_solana_secret: 'x' } }];
		} else if (/FROM agent_strategy_positions/.test(text)) {
			rows = [{
				id: 'p1', mint: 'So11111111111111111111111111111111111111112', status: 'open', network: 'mainnet',
				entry_lamports: '1000', opened_at: new Date(Date.now() - 1000).toISOString(),
				peak_value_lamports: '1000', last_value_lamports: '1000',
			}];
		} else if (/UPDATE/.test(text)) {
			h.updates.push(text);
		}
		return Object.assign(Promise.resolve(rows), { catch: (f) => Promise.resolve(rows).catch(f) });
	};
	sql.transaction = async (q) => Promise.all(q);
	return { ...actual, sql };
});

vi.mock('../api/_lib/agent-pumpfun.js', () => ({
	solanaConnection: () => ({
		getParsedTokenAccountsByOwner: async () => ({
			value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '500', decimals: 6 } } } } } }],
		}),
	}),
}));
vi.mock('../api/agents/solana-trade.js', () => ({
	quoteTrade: vi.fn(async () => ({ outAtomics: '1500' })),
	buildTradeInstructions: vi.fn(),
}));

process.env.DATABASE_URL ||= 'postgres://stub.test/db';

describe('evaluateEquip exit sweep', () => {
	it('marks an open position to market under the kill switch without throwing', async () => {
		const { evaluateEquip } = await import('../api/_lib/agent-strategy-runtime.js');
		const out = await evaluateEquip(
			{ id: 'e1', agent_id: 'a1', network: 'mainnet', active: true, config_snapshot: {} },
			{ killed: true, launches: [] },
		);
		expect(out.error).toBeUndefined();
		expect(out.results).toEqual([{ mint: 'So11111111111111111111111111111111111111112', action: 'hold', status: 'killed' }]);
		expect(h.updates.some((t) => /last_value_lamports/.test(t))).toBe(true);
	});
});
