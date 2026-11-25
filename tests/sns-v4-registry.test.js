// @bonfida/spl-name-service v4 (adopted 2026-10-23) stops resolving ".sol"
// through its high-level APIs once mainnet passes SOL_TLD_CUTOFF_SLOT: resolve,
// createSubdomain, transferSubdomain and createRecord throw "Domain has an
// unsupported TLD suffix" for "x.sol" and for bare "x", and getFavoriteDomain
// and createRecordV2Instruction were renamed away. The classic registry that
// holds every .sol name and every <label>.threews.sol subdomain is the same one;
// v4 addresses it as ".sns". In production on 2026-11-25 /api/sns could not
// resolve any .sol name, pay-by-name 404'd threews.sol every ten minutes, reverse
// lookups always came back empty, and subdomain claims could not be minted.
//
// These tests run our SNS code against the REAL library over an in-memory RPC
// (tests/helpers/fake-sns-rpc.js) so an SDK API change can no longer hide
// behind a mock.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { createFakeSnsRpc } from './helpers/fake-sns-rpc.js';

let rpc;
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => rpc.connection,
}));

const { resolveSnsName, reverseLookupAddress, resolveSnsOwner, snsRegistryName } = await import('../src/solana/sns.js');
const { createNamedSubdomain, checkSubdomainAvailability } = await import('../src/solana/sns-subdomain.js');

const OWNER = Keypair.generate().publicKey;
const SUB_OWNER = Keypair.generate().publicKey;

beforeEach(() => {
	rpc = createFakeSnsRpc();
	process.env.THREEWS_SOL_PARENT_DOMAIN = 'threews.sol';
});

describe('snsRegistryName', () => {
	it('addresses the classic registry for .sol names, bare names and subdomains', () => {
		expect(snsRegistryName('threews.sol')).toBe('threews.sns');
		expect(snsRegistryName('Nich.Threews.SOL')).toBe('nich.threews.sns');
		expect(snsRegistryName('threews')).toBe('threews.sns');
		expect(snsRegistryName('nich.threews.sns')).toBe('nich.threews.sns');
		expect(snsRegistryName('  ')).toBeNull();
	});
});

describe('forward resolution of .sol names', () => {
	it('resolves a top-level .sol domain to its owner', async () => {
		rpc.register('threews', OWNER);
		expect(await resolveSnsName('threews.sol')).toBe(OWNER.toBase58());
		expect(await resolveSnsName('threews')).toBe(OWNER.toBase58());
	});

	it('resolves a <label>.threews.sol subdomain to its owner', async () => {
		rpc.register('threews', OWNER);
		rpc.register('nich.threews', SUB_OWNER);
		expect(await resolveSnsName('nich.threews.sol')).toBe(SUB_OWNER.toBase58());
	});

	it('answers null for a name nobody registered', async () => {
		expect(await resolveSnsName('nobody-registered-this.sol')).toBeNull();
	});

	it('resolveSnsOwner returns the owner key on a caller-supplied connection', async () => {
		rpc.register('threews', OWNER);
		const pk = await resolveSnsOwner(rpc.connection, 'threews.sol');
		expect(pk.toBase58()).toBe(OWNER.toBase58());
	});
});

describe('reverse lookup', () => {
	it('returns the wallet primary domain with its .sol suffix', async () => {
		rpc.register('threews', OWNER);
		rpc.setPrimary(OWNER, 'threews');
		expect(await reverseLookupAddress(OWNER.toBase58())).toBe('threews.sol');
	});
});

describe('subdomain minting', () => {
	it('builds and sends create, URL record and transfer for <label>.threews.sol', async () => {
		const parent = Keypair.generate();
		process.env.THREEWS_SOL_PARENT_SECRET_BASE58 = bs58.encode(parent.secretKey);
		rpc.register('threews', parent.publicKey);

		const out = await createNamedSubdomain({ label: 'nich', newOwner: SUB_OWNER.toBase58() });

		expect(out.fullName).toBe('nich.threews.sol');
		expect(out.owner).toBe(SUB_OWNER.toBase58());
		expect(rpc.sent).toHaveLength(1);
		const tx = VersionedTransaction.deserialize(rpc.sent[0]);
		const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
		expect(keys).toContain(rpc.domainKey('nich.threews').toBase58());
		// The transfer instruction carries the new owner in its data.
		const ownerBytes = SUB_OWNER.toBuffer();
		expect(tx.message.compiledInstructions.some((ix) => Buffer.from(ix.data).includes(ownerBytes))).toBe(true);
		// create (2 ixs: create + reverse), URL record, transfer.
		expect(tx.message.compiledInstructions.length).toBeGreaterThanOrEqual(4);
	});

	it('derives the same subdomain account the SDK does', async () => {
		rpc.register('nich.threews', SUB_OWNER);
		const out = await checkSubdomainAvailability({ connection: rpc.connection, parentDomain: 'threews.sol', label: 'nich' });
		expect(out).toEqual({ exists: true, owner: SUB_OWNER.toBase58() });
	});
});
