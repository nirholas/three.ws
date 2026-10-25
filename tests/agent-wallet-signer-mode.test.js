// loadWallet is the signer the pump close-all and strategy-run routes use. It
// must resolve the agent's signing mode like every other custodial signer: an
// agent whose owner chose external or session signing is never signed for by the
// platform, and every decrypt leaves a custody-trail audit.

import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-signer-mode';

const state = { mode: null };
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => {
		if (/agent_signers/.test(strings.join('?'))) return state.mode ? [{ mode: state.mode }] : [];
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn(), logger: () => ({ info() {}, warn() {}, error() {} }) }));

const { generateSolanaAgentWallet } = await import('../api/_lib/agent-wallet.js');
const { loadWallet } = await import('../api/_lib/solana-wallet.js');
const { recordEvent } = await import('../api/_lib/usage.js');

const AGENT = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';

describe('loadWallet signing-mode enforcement', () => {
	let encrypted;
	beforeEach(async () => {
		state.mode = null;
		recordEvent.mockClear();
		({ encrypted_secret: encrypted } = await generateSolanaAgentWallet());
	});

	it('refuses to decrypt when the caller names no agent to audit', async () => {
		await expect(loadWallet(encrypted)).rejects.toMatchObject({ code: 'audit_required' });
	});

	it.each(['external', 'session'])('refuses a %s-mode agent', async (mode) => {
		state.mode = mode;
		await expect(loadWallet(encrypted, { agentId: AGENT, userId: USER, reason: 'test' })).rejects.toMatchObject({
			code: 'platform_signing_disabled',
		});
		expect(recordEvent).not.toHaveBeenCalled();
	});

	it('signs for a platform-mode agent and records the key use', async () => {
		state.mode = 'platform';
		const wallet = await loadWallet(encrypted, { agentId: AGENT, userId: USER, reason: 'test' });
		expect(wallet.publicKey.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
		expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'solana_key_use', agentId: AGENT }));
	});
});
