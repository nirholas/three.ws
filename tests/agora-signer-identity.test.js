// agora-citizens signer identity: what makes a deployed fleet survive a restart.
//
// Two failures kept the Commons empty once the daemon left the machine that first
// ran it:
//   1. Signers lived only in .cache/, which a Cloud Run instance loses on every
//      restart, so each boot minted fresh keypairs for citizens already registered
//      on-chain under the old ones.
//   2. ensureRegistered treated ANY existing agent account as "ours". A citizen
//      whose AgenC authority is a lost key was reported registered and then failed
//      every claim with an authority error, tick after tick.
//
// The fix: derive signers from one seed secret (AGORA_SIGNER_SEED), and when the
// canonical agent id is held by an authority this fleet cannot sign for, walk
// forward to a deterministic identity slot it can own.

import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';

const chain = new Map();
const registered = [];

// The SDK is externalized in vitest (vitest.config.js), so the chain is injected:
// ensureRegistered takes the same three SDK calls it otherwise lazy-loads.
const fakeSdk = {
	deriveAgenCAgentPda: (_client, idHex) =>
		new PublicKey(createHash('sha256').update(`pda:${idHex}`).digest()),
	getAgenCAgent: async (_client, pda) => chain.get(pda.toBase58()) ?? null,
	registerAgenCAgent: async (client, args) => {
		const pda = new PublicKey(createHash('sha256').update(`pda:${args.agentId}`).digest());
		chain.set(pda.toBase58(), { authority: client.signer.publicKey, reputation: 5000, stakeAmount: 1n });
		registered.push(args.agentId);
		return { agentPda: pda, agentId: new Uint8Array(32), txSignature: `sig-${args.agentId.slice(0, 6)}` };
	},
};

const { ensureRegistered, slotAgentIdHex } = await import('../workers/agora-citizens/agenc.js');
const { deriveSignerKeypair, loadOrCreateKeypair } = await import('../workers/agora-citizens/keypair.js');

const cfg = { maxRetries: 0, retryBaseMs: 1 };
const SEED_ONE = 'synthetic-test-seed-one-0000000000000000';
const SEED_TWO = 'synthetic-test-seed-two-0000000000000000';
const params = { capabilities: 1n, endpoint: 'https://three.ws/agora/x', metadataUri: null, stakeLamports: 1 };
const canonical = createHash('sha256').update('agora-aria-sculpt').digest('hex');
const pdaOf = (hex) => new PublicKey(createHash('sha256').update(`pda:${hex}`).digest()).toBase58();

beforeEach(() => {
	chain.clear();
	registered.length = 0;
});

describe('deterministic signers', () => {
	it('derives the same keypair for the same seed and key, and distinct ones per key', () => {
		const a1 = deriveSignerKeypair(SEED_ONE, 'aria-sculpt');
		const a2 = deriveSignerKeypair(SEED_ONE, 'aria-sculpt');
		const s1 = deriveSignerKeypair(SEED_ONE, 'sol-scribe');
		const b1 = deriveSignerKeypair(SEED_TWO, 'aria-sculpt');
		expect(a1.publicKey.toBase58()).toBe(a2.publicKey.toBase58());
		expect(s1.publicKey.toBase58()).not.toBe(a1.publicKey.toBase58());
		expect(b1.publicKey.toBase58()).not.toBe(a1.publicKey.toBase58());
	});

	it('loadOrCreateKeypair uses the seed when one is configured (no disk state needed)', async () => {
		const kp = await loadOrCreateKeypair('aria-sculpt', SEED_ONE);
		expect(kp.publicKey.toBase58()).toBe(deriveSignerKeypair(SEED_ONE, 'aria-sculpt').publicKey.toBase58());
	});

	it('rejects a seed too short to be a secret', () => {
		expect(() => deriveSignerKeypair('short', 'k')).toThrow(/at least/);
	});
});

describe('identity slots', () => {
	it('slot 0 is the canonical id and later slots are distinct and stable', () => {
		expect(slotAgentIdHex(canonical, 0)).toBe(canonical);
		const s1 = slotAgentIdHex(canonical, 1);
		expect(s1).toMatch(/^[0-9a-f]{64}$/);
		expect(s1).not.toBe(canonical);
		expect(slotAgentIdHex(canonical, 1)).toBe(s1);
		expect(slotAgentIdHex(canonical, 2)).not.toBe(s1);
	});
});

describe('ensureRegistered authority', () => {
	it('reuses an agent this signer owns', async () => {
		const me = Keypair.generate();
		chain.set(pdaOf(canonical), { authority: me.publicKey, reputation: 5600 });
		const reg = await ensureRegistered({ signer: me }, canonical, params, cfg, fakeSdk);
		expect(reg.existed).toBe(true);
		expect(reg.agentIdHex).toBe(canonical);
		expect(reg.orphanedPdas).toEqual([]);
		expect(registered).toEqual([]);
	});

	it('does not claim an agent held by a lost authority; registers the next slot instead', async () => {
		const me = Keypair.generate();
		const lost = Keypair.generate();
		chain.set(pdaOf(canonical), { authority: lost.publicKey, reputation: 5900 });
		const reg = await ensureRegistered({ signer: me }, canonical, params, cfg, fakeSdk);
		expect(reg.existed).toBe(false);
		expect(reg.agentIdHex).toBe(slotAgentIdHex(canonical, 1));
		expect(reg.agentPda.toBase58()).toBe(pdaOf(slotAgentIdHex(canonical, 1)));
		expect(reg.orphanedPdas).toEqual([pdaOf(canonical)]);
		expect(registered).toEqual([slotAgentIdHex(canonical, 1)]);
	});

	it('finds its own slot again after a restart without registering twice', async () => {
		const me = Keypair.generate();
		const lost = Keypair.generate();
		chain.set(pdaOf(canonical), { authority: lost.publicKey });
		await ensureRegistered({ signer: me }, canonical, params, cfg, fakeSdk);
		const again = await ensureRegistered({ signer: me }, canonical, params, cfg, fakeSdk);
		expect(again.existed).toBe(true);
		expect(again.agentIdHex).toBe(slotAgentIdHex(canonical, 1));
		expect(registered).toHaveLength(1);
	});

	it('read-only walk reports the slot it would register without registering', async () => {
		const me = Keypair.generate();
		chain.set(pdaOf(canonical), { authority: Keypair.generate().publicKey });
		const plan = await ensureRegistered({ signer: me }, canonical, params, cfg, fakeSdk, { readOnly: true });
		expect(plan.wouldRegister).toBe(true);
		expect(plan.slot).toBe(1);
		expect(plan.orphanedPdas).toEqual([pdaOf(canonical)]);
		expect(registered).toEqual([]);
	});

	it('gives up with a clear error when every slot is held by someone else', async () => {
		const me = Keypair.generate();
		for (let s = 0; s < 8; s++) chain.set(pdaOf(slotAgentIdHex(canonical, s)), { authority: Keypair.generate().publicKey });
		await expect(ensureRegistered({ signer: me }, canonical, params, cfg, fakeSdk)).rejects.toThrow(/identity slot/);
	});
});
