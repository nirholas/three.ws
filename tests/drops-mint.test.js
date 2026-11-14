// Drop-native Solana mint: one Metaplex Core collection per drop, each revealed
// item minted into it. Everything runs against an in-memory store that honours
// the same atomic-claim contract as api/_lib/drop-store.js, with the chain and
// storage injected, so no RPC, R2 or database is touched.

import { describe, it, expect, beforeEach } from 'vitest';
import {
	createDropCollection,
	mintDropItem,
	buildDropCollectionMetadata,
	buildDropItemMetadata,
	DropMintError,
} from '../api/_lib/drop-mint.js';

const OWNER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const OTHER = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';

function makeWorld({ chainFails = 0 } = {}) {
	const drop = {
		id: 'drop-1',
		slug: 'clay-wardens',
		name: 'Clay Wardens',
		symbol: 'WARDEN',
		description: 'A clay collection',
		supply: 3,
		status: 'live',
		seed: 'seed-abc',
		provenance_hash: 'hash-123',
		collection_address: null,
		collection_network: null,
	};
	const items = new Map();
	for (let i = 0; i < 3; i++) {
		items.set(i, {
			index: i,
			status: i < 2 ? 'revealed' : 'sealed',
			glb_url: i < 2 ? `https://cdn.example/${i}.glb` : null,
			traits: [{ layer: 'species', layer_name: 'Species', value: i ? 'Wolf' : 'Fox' }],
			rarity_tier: 'rare',
			rarity_rank: i + 1,
			rarity_score: 12.5,
			mint_address: null,
			owner_wallet: null,
			minted_at: null,
			claimed: false,
		});
	}
	const calls = { collection: 0, mint: 0, launches: [] };
	let failuresLeft = chainFails;

	const store = {
		async claimCollectionCreate(dropId) {
			if (drop.collection_address || drop.claimed) return false;
			drop.claimed = true;
			return true;
		},
		async setCollectionAddress(dropId, address, network) {
			drop.collection_address = address;
			drop.collection_network = network;
			drop.claimed = false;
		},
		async releaseCollectionClaim() {
			drop.claimed = false;
		},
		async claimItemForMint(dropId, idx) {
			const it = items.get(idx);
			if (!it || it.status !== 'revealed' || it.mint_address || it.claimed) return false;
			it.claimed = true;
			return true;
		},
		async markItemMinted(dropId, idx, { mint, ownerWallet }) {
			const it = items.get(idx);
			it.mint_address = mint;
			it.owner_wallet = ownerWallet;
			it.minted_at = '2026-11-04T00:00:00Z';
			it.claimed = false;
			return it;
		},
		async releaseItemMintClaim(dropId, idx) {
			items.get(idx).claimed = false;
		},
		async getItemState(dropId, idx) {
			return items.get(idx) || null;
		},
	};
	const deps = {
		store,
		storage: {
			async promoteToDurableStorage() {
				return { glbUrl: 'https://r2/m.glb', imageUrl: 'https://r2/t.png', glbIpfs: null, imageIpfs: null };
			},
			async uploadMetadataJson({ metadata }) {
				return { uri: `https://r2/${metadata.name.replace(/\W/g, '')}.json`, ipfs: null };
			},
		},
		chain: {
			async createCollection({ name }) {
				calls.collection++;
				return { address: 'COLL' + calls.collection, signature: 'sigC' + calls.collection, name };
			},
			async mintItem({ collection, ownerWallet }) {
				if (failuresLeft > 0) {
					failuresLeft--;
					throw new Error('rpc timeout');
				}
				calls.mint++;
				return { mint: 'MINT' + calls.mint, signature: 'sigM' + calls.mint, collection, ownerWallet };
			},
		},
		async recordLaunch(row) {
			calls.launches.push(row);
		},
		now: () => '2026-11-04T00:00:00.000Z',
	};
	return { drop, items, calls, deps };
}

describe('createDropCollection', () => {
	let w;
	beforeEach(() => (w = makeWorld()));

	it('creates the collection and records its address and network', async () => {
		const r = await createDropCollection({ drop: w.drop, network: 'devnet' }, w.deps);
		expect(r.collection_address).toBe('COLL1');
		expect(w.drop.collection_address).toBe('COLL1');
		expect(w.drop.collection_network).toBe('devnet');
		expect(r.created).toBe(true);
	});

	it('is idempotent: two calls create one collection', async () => {
		await createDropCollection({ drop: w.drop, network: 'devnet' }, w.deps);
		const second = await createDropCollection({ drop: { ...w.drop }, network: 'devnet' }, w.deps);
		expect(w.calls.collection).toBe(1);
		expect(second.created).toBe(false);
		expect(second.collection_address).toBe('COLL1');
	});

	it('refuses a draft drop', async () => {
		w.drop.status = 'draft';
		await expect(createDropCollection({ drop: w.drop, network: 'devnet' }, w.deps)).rejects.toMatchObject({
			code: 'not_published',
		});
		expect(w.calls.collection).toBe(0);
	});

	it('refuses a second collection on a different network', async () => {
		await createDropCollection({ drop: w.drop, network: 'devnet' }, w.deps);
		await expect(
			createDropCollection({ drop: { ...w.drop }, network: 'mainnet' }, w.deps),
		).rejects.toMatchObject({ code: 'network_mismatch' });
	});

	it('releases the claim when the chain fails so it can retry', async () => {
		w.deps.chain.createCollection = async () => {
			throw new Error('rpc down');
		};
		await expect(createDropCollection({ drop: w.drop, network: 'devnet' }, w.deps)).rejects.toThrow('rpc down');
		expect(w.drop.claimed).toBe(false);
		expect(w.drop.collection_address).toBeNull();
	});

	it('reports in-progress when another caller holds the claim', async () => {
		w.drop.claimed = true;
		await expect(createDropCollection({ drop: w.drop, network: 'devnet' }, w.deps)).rejects.toMatchObject({
			code: 'in_progress',
		});
	});
});

describe('mintDropItem', () => {
	let w;
	beforeEach(async () => {
		w = makeWorld();
		await createDropCollection({ drop: w.drop, network: 'devnet' }, w.deps);
		w.drop = { ...w.drop };
	});

	it('refuses an unrevealed item', async () => {
		await expect(
			mintDropItem({ drop: w.drop, index: 2, ownerWallet: OWNER, network: 'devnet' }, w.deps),
		).rejects.toMatchObject({ code: 'not_revealed' });
		expect(w.calls.mint).toBe(0);
	});

	it('refuses when the drop has no collection yet', async () => {
		const bare = makeWorld();
		await expect(
			mintDropItem({ drop: bare.drop, index: 0, ownerWallet: OWNER, network: 'devnet' }, bare.deps),
		).rejects.toMatchObject({ code: 'no_collection' });
	});

	it('rejects an invalid recipient wallet', async () => {
		await expect(
			mintDropItem({ drop: w.drop, index: 0, ownerWallet: 'not-a-wallet', network: 'devnet' }, w.deps),
		).rejects.toMatchObject({ code: 'invalid_wallet' });
	});

	it('records mint address, owner and time exactly once', async () => {
		const r = await mintDropItem({ drop: w.drop, index: 0, ownerWallet: OWNER, network: 'devnet' }, w.deps);
		expect(r.mint_address).toBe('MINT1');
		expect(r.idempotent).toBe(false);
		expect(w.items.get(0)).toMatchObject({ mint_address: 'MINT1', owner_wallet: OWNER });
		expect(w.items.get(0).minted_at).toBeTruthy();
		expect(w.calls.launches).toHaveLength(1);
		expect(w.calls.launches[0]).toMatchObject({ mint: 'MINT1', collection: 'COLL1', network: 'devnet' });
	});

	it('double submit returns the same mint and sends no second transaction', async () => {
		const a = await mintDropItem({ drop: w.drop, index: 0, ownerWallet: OWNER, network: 'devnet' }, w.deps);
		const b = await mintDropItem({ drop: w.drop, index: 0, ownerWallet: OTHER, network: 'devnet' }, w.deps);
		expect(b.mint_address).toBe(a.mint_address);
		expect(b.idempotent).toBe(true);
		expect(w.calls.mint).toBe(1);
		expect(w.items.get(0).owner_wallet).toBe(OWNER);
	});

	it('concurrent submits mint once', async () => {
		const results = await Promise.allSettled([
			mintDropItem({ drop: w.drop, index: 1, ownerWallet: OWNER, network: 'devnet' }, w.deps),
			mintDropItem({ drop: w.drop, index: 1, ownerWallet: OWNER, network: 'devnet' }, w.deps),
		]);
		expect(w.calls.mint).toBe(1);
		const ok = results.filter((r) => r.status === 'fulfilled');
		const rejected = results.filter((r) => r.status === 'rejected');
		expect(ok).toHaveLength(1);
		expect(rejected[0].reason).toBeInstanceOf(DropMintError);
		expect(rejected[0].reason.code).toBe('in_progress');
	});

	it('a chain failure leaves the item retryable', async () => {
		const f = makeWorld({ chainFails: 1 });
		await createDropCollection({ drop: f.drop, network: 'devnet' }, f.deps);
		const drop = { ...f.drop };
		await expect(
			mintDropItem({ drop, index: 0, ownerWallet: OWNER, network: 'devnet' }, f.deps),
		).rejects.toThrow('rpc timeout');
		expect(f.items.get(0).claimed).toBe(false);
		expect(f.items.get(0).mint_address).toBeNull();
		const retry = await mintDropItem({ drop, index: 0, ownerWallet: OWNER, network: 'devnet' }, f.deps);
		expect(retry.mint_address).toBe('MINT1');
	});

	it('mints into the drop collection on the collection network only', async () => {
		await expect(
			mintDropItem({ drop: w.drop, index: 0, ownerWallet: OWNER, network: 'mainnet' }, w.deps),
		).rejects.toMatchObject({ code: 'network_mismatch' });
	});
});

describe('metadata', () => {
	it('puts traits, rarity and the provenance commitment in the item attributes', () => {
		const md = buildDropItemMetadata({
			drop: { name: 'Clay Wardens', symbol: 'WARDEN', slug: 'clay-wardens', provenance_hash: 'hash-123', supply: 3 },
			item: {
				index: 4,
				traits: [{ layer: 'species', layer_name: 'Species', value: 'Fox' }],
				rarity_tier: 'epic',
				rarity_rank: 7,
				rarity_score: 31.2,
			},
			media: { glbUrl: 'https://r2/m.glb', imageUrl: 'https://r2/t.png', glbIpfs: null, imageIpfs: null },
			viewerUrl: 'https://three.ws/viewer?src=x',
			ownerWallet: OWNER,
			collection: 'COLL1',
			network: 'devnet',
			createdAt: '2026-11-04T00:00:00.000Z',
			royaltyBps: 500,
		});
		expect(md.name).toBe('Clay Wardens #4');
		expect(md.symbol).toBe('WARDEN');
		expect(md.animation_url).toBe('https://r2/m.glb');
		const attrs = Object.fromEntries(md.attributes.map((a) => [a.trait_type, a.value]));
		expect(attrs.Species).toBe('Fox');
		expect(attrs['Rarity Tier']).toBe('epic');
		expect(attrs['Rarity Rank']).toBe('7 of 3');
		expect(attrs['Provenance Hash']).toBe('hash-123');
		expect(md.collection).toMatchObject({ address: 'COLL1' });
	});

	it('commits the provenance hash and supply in the collection metadata, never the seed of a draft', () => {
		const md = buildDropCollectionMetadata({
			drop: { name: 'Clay Wardens', symbol: 'WARDEN', slug: 'clay-wardens', description: 'd', provenance_hash: 'hash-123', supply: 3, seed: 'seed-abc', status: 'live' },
			imageUrl: 'https://r2/cover.png',
			network: 'devnet',
		});
		expect(md.name).toBe('Clay Wardens');
		const attrs = Object.fromEntries(md.attributes.map((a) => [a.trait_type, a.value]));
		expect(attrs['Provenance Hash']).toBe('hash-123');
		expect(attrs.Supply).toBe('3');
		expect(attrs.Seed).toBe('seed-abc');
	});
});

// A transaction can land while its confirmation fails or stalls. Releasing the
// claim in that case lets the next click mint the same item a second time (or
// create a second collection), spending rent twice. Confirmation goes over HTTP
// polling, never a websocket, and an ambiguous outcome keeps the claim held.
describe('confirmation safety', () => {
	it('keeps the item claim when the mint was sent but its confirmation timed out', async () => {
		const f = makeWorld();
		await createDropCollection({ drop: f.drop, network: 'devnet' }, f.deps);
		f.deps.chain.mintItem = async () => {
			throw Object.assign(new Error('Transaction sigX not confirmed within 90s'), {
				code: 'tx_confirm_timeout',
				signature: 'sigX',
			});
		};
		await expect(
			mintDropItem({ drop: { ...f.drop }, index: 0, ownerWallet: OWNER, network: 'devnet' }, f.deps),
		).rejects.toMatchObject({ code: 'confirm_pending' });
		expect(f.items.get(0).claimed).toBe(true);
		await expect(
			mintDropItem({ drop: { ...f.drop }, index: 0, ownerWallet: OWNER, network: 'devnet' }, f.deps),
		).rejects.toMatchObject({ code: 'in_progress' });
	});

	it('keeps the collection claim when creation was sent but its confirmation timed out', async () => {
		const f = makeWorld();
		f.deps.chain.createCollection = async () => {
			throw Object.assign(new Error('not confirmed'), { code: 'tx_confirm_timeout', signature: 'sigC' });
		};
		await expect(createDropCollection({ drop: f.drop, network: 'devnet' }, f.deps)).rejects.toMatchObject({
			code: 'confirm_pending',
		});
		expect(f.drop.claimed).toBe(true);
	});

	it('still releases the claim when the transaction definitely did not land', async () => {
		const f = makeWorld();
		await createDropCollection({ drop: f.drop, network: 'devnet' }, f.deps);
		f.deps.chain.mintItem = async () => {
			throw Object.assign(new Error('blockhash expired'), { code: 'tx_expired' });
		};
		await expect(
			mintDropItem({ drop: { ...f.drop }, index: 0, ownerWallet: OWNER, network: 'devnet' }, f.deps),
		).rejects.toMatchObject({ code: 'tx_expired' });
		expect(f.items.get(0).claimed).toBe(false);
	});
});

describe('sendAndConfirmUmi', () => {
	const sigBytes = new Uint8Array(64).fill(7);
	const umi = { rpc: { getLatestBlockhash: async () => ({ blockhash: 'BH1', lastValidBlockHeight: 500 }) } };
	function builder() {
		return {
			blockhash: null,
			setBlockhash(bh) {
				this.blockhash = bh;
				return this;
			},
			async send() {
				if (!this.blockhash) throw new Error('sent without a pinned blockhash');
				return sigBytes;
			},
		};
	}
	function conn(status) {
		return {
			async getSignatureStatuses() {
				return { value: [status] };
			},
			confirmTransaction() {
				throw new Error('websocket confirmation used');
			},
		};
	}

	it('confirms by polling signature status, never the websocket path', async () => {
		const { sendAndConfirmUmi } = await import('../api/_lib/solana/confirm.js');
		const bs58 = (await import('bs58')).default;
		const r = await sendAndConfirmUmi(umi, builder(), conn({ confirmationStatus: 'confirmed', err: null, slot: 9 }));
		expect(r.signature).toBe(bs58.encode(sigBytes));
		expect(r.blockhash).toBe('BH1');
	});

	it('throws tx_reverted for a transaction that landed but failed', async () => {
		const { sendAndConfirmUmi } = await import('../api/_lib/solana/confirm.js');
		await expect(
			sendAndConfirmUmi(umi, builder(), conn({ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] }, slot: 9 })),
		).rejects.toMatchObject({ code: 'tx_reverted' });
	});
});
