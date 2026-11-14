// Devnet end-to-end for the drop-native Solana mint.
//
//   node scripts/drops-devnet-e2e.mjs
//
// Generates a THROWAWAY collection-authority keypair (the production key is never
// loaded), funds it from the devnet faucet, then runs the real drop-mint code
// path against the real devnet chain: create a Core collection, mint two items
// into it, and read both back over RPC to confirm collection membership and
// owner. Persistence and media storage are the only parts replaced (an
// in-memory store with the same atomic-claim contract as drop-store.js, and a
// stub media promoter), so no database or R2 object is touched and the script
// is safe to run anywhere. Never mainnet: the network is hard-coded to devnet.
//
// While the public devnet faucet is closed, the same code path runs against a
// local validator carrying the real mpl-core program cloned from devnet:
//
//   solana-test-validator --reset \
//     --clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d \
//     --url https://api.devnet.solana.com
//   SOLANA_RPC_URL_DEVNET=http://127.0.0.1:8899 node scripts/drops-devnet-e2e.mjs

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

// A pre-funded THROWAWAY devnet key can be supplied when the public faucet is
// closed (it has been since 2026): DROPS_E2E_DEVNET_KEY=<base58 secret>. Never
// the production authority.
const authority = process.env.DROPS_E2E_DEVNET_KEY
	? Keypair.fromSecretKey(bs58.decode(process.env.DROPS_E2E_DEVNET_KEY))
	: Keypair.generate();
process.env.SOLANA_AGENT_COLLECTION_AUTHORITY_KEY = bs58.encode(authority.secretKey);
const RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
process.env.SOLANA_RPC_URL_DEVNET = RPC;

const { createDropCollection, mintDropItem, defaultDeps } = await import('../api/_lib/drop-mint.js');
const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
const { mplCore, fetchAsset, fetchCollection } = await import('@metaplex-foundation/mpl-core');
const { publicKey } = await import('@metaplex-foundation/umi');

const conn = new Connection(RPC, 'confirmed');

async function fund() {
	if ((await conn.getBalance(authority.publicKey)) >= 0.05 * LAMPORTS_PER_SOL) {
		console.log(`authority ${authority.publicKey.toBase58()} already funded`);
		return;
	}
	console.log(`fund ${authority.publicKey.toBase58()} on devnet`);
	for (let attempt = 1; attempt <= 6; attempt++) {
		try {
			const sig = await conn.requestAirdrop(authority.publicKey, 1 * LAMPORTS_PER_SOL);
			const latest = await conn.getLatestBlockhash();
			await conn.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
			console.log(`airdrop ok ${sig}`);
			return;
		} catch (err) {
			console.log(`airdrop attempt ${attempt} failed: ${err.message}`);
			await new Promise((r) => setTimeout(r, 4000 * attempt));
		}
	}
	throw new Error('devnet faucet unavailable after 6 attempts');
}

const drop = {
	id: 'e2e-drop',
	slug: 'e2e-drop',
	name: 'E2E Wardens',
	symbol: 'E2E',
	description: 'devnet verification',
	supply: 3,
	status: 'live',
	seed: 'e2e-seed',
	provenance_hash: 'e2e-hash',
	collection_address: null,
	collection_network: null,
	owner_id: null,
};
const items = new Map(
	[0, 1, 2].map((i) => [
		i,
		{
			index: i,
			status: i < 2 ? 'revealed' : 'sealed',
			glb_url: `https://three.ws/e2e/${i}.glb`,
			traits: [{ layer: 'species', layer_name: 'Species', value: i ? 'Wolf' : 'Fox' }],
			rarity_tier: 'rare',
			rarity_rank: i + 1,
			rarity_score: 10,
			mint_address: null,
			claimed: false,
		},
	]),
);

const real = defaultDeps();
const deps = {
	...real,
	store: {
		async claimCollectionCreate() {
			if (drop.collection_address || drop.claimed) return false;
			return (drop.claimed = true);
		},
		async setCollectionAddress(_id, address, network) {
			Object.assign(drop, { collection_address: address, collection_network: network, claimed: false });
		},
		async releaseCollectionClaim() {
			drop.claimed = false;
		},
		async claimItemForMint(_id, idx) {
			const it = items.get(idx);
			if (!it || it.status !== 'revealed' || it.mint_address || it.claimed) return false;
			return (it.claimed = true);
		},
		async markItemMinted(_id, idx, { mint, ownerWallet }) {
			Object.assign(items.get(idx), { mint_address: mint, owner_wallet: ownerWallet, claimed: false, minted_at: new Date().toISOString() });
			return items.get(idx);
		},
		async releaseItemMintClaim(_id, idx) {
			items.get(idx).claimed = false;
		},
		async getItemState(_id, idx) {
			return items.get(idx) || null;
		},
	},
	storage: {
		async promoteToDurableStorage({ idempotencyKey }) {
			return { glbUrl: `https://three.ws/e2e/${idempotencyKey}.glb`, imageUrl: `https://three.ws/e2e/${idempotencyKey}.png`, glbIpfs: null, imageIpfs: null };
		},
		async uploadMetadataJson({ idempotencyKey }) {
			return { uri: `https://three.ws/e2e/${idempotencyKey}.json`, ipfs: null };
		},
		async uploadCollectionMetadata() {
			return { uri: 'https://three.ws/e2e/collection.json' };
		},
		async collectionCoverImage() {
			return null;
		},
	},
	async recordLaunch() {},
};

await fund();
const recipient = Keypair.generate().publicKey.toBase58();

const c1 = await createDropCollection({ drop, network: 'devnet' }, deps);
console.log('collection', c1.collection_address, c1.signature);
const c2 = await createDropCollection({ drop: { ...drop }, network: 'devnet' }, deps);
console.log('collection call 2 created =', c2.created, '(expected false)');

const results = [];
for (const index of [0, 1]) {
	const r = await mintDropItem({ drop: { ...drop }, index, ownerWallet: recipient, network: 'devnet' }, deps);
	console.log(`mint #${index}`, r.mint_address, r.signature);
	results.push(r);
}
const again = await mintDropItem({ drop: { ...drop }, index: 0, ownerWallet: recipient, network: 'devnet' }, deps);
console.log('re-mint #0 idempotent =', again.idempotent, 'same mint =', again.mint_address === results[0].mint_address);

let sealedRefused = false;
try {
	await mintDropItem({ drop: { ...drop }, index: 2, ownerWallet: recipient, network: 'devnet' }, deps);
} catch (err) {
	sealedRefused = err.code === 'not_revealed';
}
console.log('sealed item refused =', sealedRefused);

// Read at 'confirmed', the level the writes confirmed at. A bare createUmi(RPC)
// reads at the node default (finalized) and races the writes a few slots behind.
const umi = createUmi(RPC, 'confirmed').use(mplCore());
const coll = await fetchCollection(umi, publicKey(drop.collection_address));
console.log('chain collection name =', coll.name, 'numMinted =', coll.numMinted);
let ok = sealedRefused && !c2.created && again.idempotent;
for (const r of results) {
	const asset = await fetchAsset(umi, publicKey(r.mint_address));
	const inColl = asset.updateAuthority.type === 'Collection' && String(asset.updateAuthority.address) === drop.collection_address;
	const ownerOk = String(asset.owner) === recipient;
	console.log(`chain asset ${r.mint_address} name="${asset.name}" collection=${inColl} owner=${ownerOk} royalties=${Boolean(asset.royalties)}`);
	ok = ok && inColl && ownerOk;
}
console.log(ok ? 'E2E PASS' : 'E2E FAIL');
process.exit(ok ? 0 : 1);
