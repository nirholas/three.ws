// Two concurrent provisions for one agent must converge on a single custodial
// wallet. The old select-then-update let both callers generate a key and the
// later write silently replaced the earlier one, stranding anything sent to the
// address the first caller was handed.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || 'a'.repeat(64);

const dbState = { pg: null };
vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		return (await dbState.pg.query(text, values)).rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const W = await import('../api/_lib/agent-wallet.js');

const EVM_AGENT = '44444444-4444-4444-8444-444444444444';
const SOL_AGENT = '55555555-5555-4555-8555-555555555555';

beforeAll(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(`
		create table agent_identities (id uuid primary key, wallet_address text, chain_id int, deleted_at timestamptz, meta jsonb default '{}'::jsonb);
		insert into agent_identities (id) values ('${EVM_AGENT}'), ('${SOL_AGENT}');
	`);
});

describe('agent wallet get-or-create', () => {
	it('concurrent EVM provisions return one address and exactly one creator', async () => {
		const results = await Promise.all([
			W.getOrCreateAgentEvmWallet(EVM_AGENT),
			W.getOrCreateAgentEvmWallet(EVM_AGENT),
			W.getOrCreateAgentEvmWallet(EVM_AGENT),
		]);
		const { rows } = await dbState.pg.query('select wallet_address from agent_identities where id = $1', [EVM_AGENT]);
		expect(new Set(results.map((r) => r.address))).toEqual(new Set([rows[0].wallet_address]));
		expect(results.filter((r) => r.created)).toHaveLength(1);
	});

	it('concurrent Solana provisions return one address and exactly one creator', async () => {
		const results = await Promise.all([
			W.getOrCreateAgentSolanaWallet(SOL_AGENT),
			W.getOrCreateAgentSolanaWallet(SOL_AGENT),
			W.getOrCreateAgentSolanaWallet(SOL_AGENT),
		]);
		const { rows } = await dbState.pg.query(`select meta->>'solana_address' as a from agent_identities where id = $1`, [SOL_AGENT]);
		expect(new Set(results.map((r) => r.address))).toEqual(new Set([rows[0].a]));
		expect(results.filter((r) => r.created)).toHaveLength(1);
	});
});
