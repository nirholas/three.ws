// The ownership invariant — the user's central promise.
//
// Forking someone else's avatar must mint a BRAND-NEW custodial wallet for the
// forker and leave the source untouched. This test proves it two ways:
//
//  1. Cryptographic distinctness (real keygen): provisioning two agents (the
//     source and its fork) yields a DISTINCT Solana address, a DISTINCT EVM
//     address, and DISTINCT encrypted secrets. No key material is shared.
//
//  2. Source-level non-copy guarantee: the fork handler (api/avatars/fork.js)
//     never reads an encrypted secret off the source, provisions wallets for the
//     NEWLY inserted agent id, and assigns ownership to the caller — so a secret
//     cannot leak from source to fork by construction.
//
// Real key generation + real AES-GCM encryption run; only the DB and audit sink
// are mocked (mirrors tests/api/ensure-agent-wallet.test.js).

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';

const sqlState = { queue: [], calls: [] };
vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const query = typeof strings === 'string' ? strings : strings.join('?');
		sqlState.calls.push({ query, values });
		return sqlState.queue.length ? sqlState.queue.shift() : [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

vi.mock('../../api/_lib/env.js', () => ({
	env: { JWT_SECRET: 'test-secret-please-do-not-use-in-production-ever' },
}));

const { provisionAgentWallets } = await import('../../api/_lib/agent-wallet.js');

// Queue the four DB responses one provisionAgentWallets() call makes:
// EVM SELECT, EVM UPDATE, Solana SELECT, Solana UPDATE.
function queueProvision(agentId) {
	sqlState.queue.push([{ id: agentId, wallet_address: null, meta: {} }]); // EVM select
	sqlState.queue.push([{ wallet_address: 'claimed' }]); // EVM atomic claim (update ... returning)
	sqlState.queue.push([{ id: agentId, meta: {} }]); // Solana select
	sqlState.queue.push([{ id: agentId }]); // Solana atomic claim (update ... returning)
}

// Pull the persisted address + encrypted secret back out of the UPDATE writes.
function persistedFor(agentId) {
	const updates = sqlState.calls.filter(
		(c) => /update agent_identities/i.test(c.query) && c.values.includes(agentId),
	);
	const evm = updates.find((c) => /wallet_address\s*=/i.test(c.query));
	const sol = updates.find((c) => !/wallet_address\s*=/i.test(c.query));
	const evmMeta = JSON.parse(evm.values.find((v) => typeof v === 'string' && v.includes('encrypted_wallet_key')));
	const solMeta = JSON.parse(sol.values.find((v) => typeof v === 'string' && v.includes('encrypted_solana_secret')));
	return {
		evmAddress: evm.values[0],
		evmSecret: evmMeta.encrypted_wallet_key,
		solAddress: solMeta.solana_address,
		solSecret: solMeta.encrypted_solana_secret,
	};
}

beforeEach(() => {
	sqlState.queue = [];
	sqlState.calls = [];
});

describe('ownership invariant · fork mints a fresh, isolated wallet', () => {
	it('source and fork get distinct addresses AND distinct encrypted secrets', async () => {
		queueProvision('source-agent');
		const sourceWallets = await provisionAgentWallets('source-agent');

		queueProvision('fork-agent');
		const forkWallets = await provisionAgentWallets('fork-agent');

		// Live addresses returned to the caller are distinct on both chains.
		expect(forkWallets.solana).not.toBe(sourceWallets.solana);
		expect(forkWallets.evm).not.toBe(sourceWallets.evm);
		expect(forkWallets.solana).toBeTruthy();
		expect(forkWallets.evm).toMatch(/^0x[0-9a-fA-F]{40}$/);

		// The persisted secrets are independently generated — no shared key bytes.
		const src = persistedFor('source-agent');
		const fork = persistedFor('fork-agent');
		expect(fork.solSecret).not.toBe(src.solSecret);
		expect(fork.evmSecret).not.toBe(src.evmSecret);
		expect(fork.solAddress).toBe(forkWallets.solana);
		expect(fork.evmAddress).toBe(forkWallets.evm);

		// The fork's write path never references the source agent id — bytes
		// untouched on the source side.
		const forkUpdates = sqlState.calls.filter(
			(c) => /update agent_identities/i.test(c.query) && c.values.includes('fork-agent'),
		);
		for (const u of forkUpdates) {
			expect(u.values).not.toContain('source-agent');
			expect(JSON.stringify(u.values)).not.toContain(src.solSecret);
			expect(JSON.stringify(u.values)).not.toContain(src.evmSecret);
		}
	});
});

describe('ownership invariant · the fork handler cannot leak a secret', () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const forkSrc = readFileSync(resolve(here, '../../api/avatars/fork.js'), 'utf8');

	it('never selects or copies an encrypted secret from the source', () => {
		// The source SELECT pulls only public columns; secrets are never read.
		expect(forkSrc).not.toMatch(/encrypted_solana_secret/);
		expect(forkSrc).not.toMatch(/encrypted_wallet_key/);
	});

	it('provisions fresh wallets for the newly inserted agent, owned by the caller', () => {
		// A new agent_identities row is inserted with the caller as user_id…
		expect(forkSrc).toMatch(/insert into agent_identities[\s\S]*?user_id/i);
		expect(forkSrc).toMatch(/values\s*\(\s*\$\{auth\.userId\}/);
		// …and wallets are provisioned for THAT new agent, not reused from source.
		expect(forkSrc).toMatch(/provisionAgentWallets\(agent\.id\)/);
		// Lineage is recorded (attribution), not key material.
		expect(forkSrc).toMatch(/forked_from/);
	});
});
