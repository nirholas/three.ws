// Drop-native Solana mint: one Metaplex Core collection per drop, each revealed
// item minted into it.
//
// Same ownership model as mint_3d_asset (api/_lib/tokenize-3d.js): the holder
// owns the asset, the three.ws collection authority pays rent and stays the
// collection's update authority. The difference is the collection: every item of
// a drop joins ONE collection, so a drop is a real on-chain collection instead
// of a pile of unrelated assets.
//
// Two invariants, both enforced by atomic claims in drop-store.js:
//   1. A drop gets exactly one collection. A second call returns the first.
//   2. An item is minted at most once. A double submit returns the same mint and
//      sends no transaction; a chain failure releases the claim so it retries.
//
// The store, chain and storage are injected (the same `deps` pattern as
// tokenize-3d) so the invariants are unit-tested without RPC, R2 or a database.
// $THREE is the only coin referenced, through the shared brand block.

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore, create, createCollection, fetchCollection, ruleSet } from '@metaplex-foundation/mpl-core';
import { generateSigner, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi';

import { sql } from './db.js';
import { env } from './env.js';
import { collectionAuthoritySigner } from './solana-collection.js';
import { solanaConnection } from './solana/connection.js';
import { THREE_WS, threeTokenLinks } from './three-brand.js';
import {
	buildTokenized3dMetadata,
	viewerLinkFor,
	clampSellerFeeBps,
} from './tokenize-3d-metadata.js';
import {
	promoteToDurableStorage,
	uploadMetadataJson,
	resolveNetwork,
	rpcForNetwork,
	isValidBase58Pubkey,
	encodeSignature,
} from './tokenize-3d.js';
import {
	claimCollectionCreate,
	claimItemForMint,
	getItemMintState,
	markItemMinted,
	releaseCollectionClaim,
	releaseItemMintClaim,
	setCollectionAddress,
} from './drop-store.js';
import { putObject, publicUrl } from './r2.js';

export class DropMintError extends Error {
	constructor(code, message, status = 409) {
		super(message);
		this.name = 'DropMintError';
		this.code = code;
		this.status = status;
	}
}

/** Default enforced secondary royalty for drop items (5%, to the drop creator). */
export const DROP_ROYALTY_BPS = 500;

/* ────────────────────────────────────────────────────────────────────────── *
 * Metadata (pure)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Off-chain JSON for the Core collection account. It carries the drop's
 * provenance commitment and, once the drop is live, the seed that makes the
 * whole supply recomputable by anyone.
 */
export function buildDropCollectionMetadata({ drop, imageUrl, network, appOrigin = env.APP_ORIGIN }) {
	const tok = threeTokenLinks();
	const base = String(appOrigin || THREE_WS.website).replace(/\/$/, '');
	const dropUrl = `${base}/drop-collection?slug=${encodeURIComponent(drop.slug)}`;
	const attributes = [
		{ trait_type: 'Platform', value: THREE_WS.name },
		{ trait_type: 'Standard', value: 'Metaplex Core' },
		{ trait_type: 'Supply', value: String(drop.supply) },
		{ trait_type: 'Provenance Hash', value: drop.provenance_hash },
		...(drop.status !== 'draft' && drop.seed ? [{ trait_type: 'Seed', value: drop.seed }] : []),
		{ trait_type: 'Network', value: network },
	];
	return {
		name: String(drop.name).slice(0, 32),
		symbol: String(drop.symbol).slice(0, 10),
		description:
			drop.description?.trim() ||
			`${drop.name}: a provably fair generative collection of rigged 3D characters on ${THREE_WS.name}.`,
		...(imageUrl ? { image: imageUrl } : {}),
		external_url: dropUrl,
		attributes,
		properties: { category: '3d', provenance_hash: drop.provenance_hash, supply: drop.supply },
		platform: { name: THREE_WS.name, url: THREE_WS.website },
		token: { symbol: tok.symbol, mint: tok.mint, url: tok.pumpfun },
		spec: 'drop-collection/0.1',
	};
}

/**
 * Off-chain JSON for one drop item: the base tokenized-3d metadata with the
 * item's traits and rarity as first-class attributes so wallets and
 * marketplaces can filter the collection by trait.
 */
export function buildDropItemMetadata({
	drop,
	item,
	media,
	viewerUrl,
	ownerWallet,
	royaltyRecipient = ownerWallet,
	collection,
	network,
	createdAt,
	royaltyBps = DROP_ROYALTY_BPS,
}) {
	const name = `${drop.name} #${item.index}`.slice(0, 32);
	const base = buildTokenized3dMetadata({
		name,
		description: drop.description || undefined,
		glbUrl: media.glbUrl,
		imageUrl: media.imageUrl,
		viewerUrl,
		glbIpfs: media.glbIpfs,
		imageIpfs: media.imageIpfs,
		creatorWallet: ownerWallet,
		royaltyBps,
		royaltyRecipient,
		network,
		createdAt,
	});
	const traitAttrs = (item.traits || []).map((t) => ({
		trait_type: t.layer_name || t.layer,
		value: t.value,
	}));
	const dropAttrs = [
		{ trait_type: 'Collection', value: drop.name },
		{ trait_type: 'Rarity Tier', value: item.rarity_tier },
		{ trait_type: 'Rarity Rank', value: `${item.rarity_rank} of ${drop.supply}` },
		{ trait_type: 'Provenance Hash', value: drop.provenance_hash },
	];
	return {
		...base,
		symbol: String(drop.symbol).slice(0, 10),
		attributes: [...traitAttrs, ...dropAttrs, ...base.attributes],
		collection: { name: drop.name, address: collection, family: THREE_WS.name },
		properties: {
			...base.properties,
			drop: {
				slug: drop.slug,
				index: item.index,
				provenance_hash: drop.provenance_hash,
				rarity_score: item.rarity_score,
			},
		},
		spec: 'drop-item/0.1',
	};
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Chain
 * ────────────────────────────────────────────────────────────────────────── */

function umiFor(network) {
	const umi = createUmi(solanaConnection({ url: rpcForNetwork(network), network })).use(mplCore());
	umi.use(signerIdentity(collectionAuthoritySigner(umi)));
	return umi;
}

async function createCollectionOnChain({ network, name, uri }) {
	const umi = umiFor(network);
	const collectionSigner = generateSigner(umi);
	const { signature } = await createCollection(umi, {
		collection: collectionSigner,
		name: String(name).slice(0, 32),
		uri,
		plugins: [
			{
				type: 'Attributes',
				attributeList: [
					{ key: 'platform', value: THREE_WS.name },
					{ key: 'kind', value: 'drop' },
				],
			},
		],
	}).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
	return { address: collectionSigner.publicKey.toString(), signature: encodeSignature(signature) };
}

async function mintItemOnChain({ network, collection, ownerWallet, name, metadataUri, royaltyBps, royaltyRecipient }) {
	const umi = umiFor(network);
	const collectionAccount = await fetchCollection(umi, umiPublicKey(collection));
	const assetSigner = generateSigner(umi);
	const { signature } = await create(umi, {
		asset: assetSigner,
		collection: collectionAccount,
		owner: umiPublicKey(ownerWallet),
		name: String(name).slice(0, 32),
		uri: metadataUri,
		plugins: [
			{
				type: 'Royalties',
				basisPoints: royaltyBps,
				creators: [{ address: umiPublicKey(royaltyRecipient), percentage: 100 }],
				ruleSet: ruleSet('None'),
			},
		],
	}).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
	return { mint: assetSigner.publicKey.toString(), signature: encodeSignature(signature) };
}

/** Record a drop mint in the launch directory (/minted) the same way mint_3d_asset does. */
async function recordLaunch({ drop, item, mint, signature, ownerWallet, royaltyRecipient, royaltyBps, collection, network, media, viewerUrl, metadataUri, createdAt }) {
	const provenance = {
		source: 'drop',
		drop_slug: drop.slug,
		drop_index: item.index,
		collection,
		provenance_hash: drop.provenance_hash,
		rarity_tier: item.rarity_tier,
		rarity_rank: item.rarity_rank,
		minted_at: createdAt,
	};
	await sql`
		insert into tokenized_3d_assets
			(idempotency_key, network, status, mint, owner_wallet, creator_user_id, name, glb_url,
			 image_url, viewer_url, metadata_uri, royalty_bps, royalty_recipient, provenance, tx_signature)
		values
			(${`drop:${drop.id}:${item.index}`}, ${network}, 'minted', ${mint}, ${ownerWallet},
			 ${drop.owner_id ?? null}, ${`${drop.name} #${item.index}`.slice(0, 120)}, ${media.glbUrl},
			 ${media.imageUrl}, ${viewerUrl}, ${metadataUri}, ${royaltyBps}, ${royaltyRecipient},
			 ${JSON.stringify(provenance)}::jsonb, ${signature})
		on conflict (idempotency_key, network) do nothing
	`;
}

/** Drop cover art for the collection account: the cover item's thumbnail when it has one. */
async function collectionCoverImage(drop) {
	const rows = await sql`
		select thumbnail_url from drop_items
		where drop_id = ${drop.id} and thumbnail_url is not null
		order by (idx = ${drop.cover_item_index ?? -1}) desc, rarity_rank asc limit 1
	`;
	return rows[0]?.thumbnail_url || null;
}

async function uploadCollectionMetadata({ drop, metadata }) {
	const key = `drops/${drop.id}/collection.json`;
	await putObject({ key, body: Buffer.from(JSON.stringify(metadata)), contentType: 'application/json' });
	return { uri: publicUrl(key) };
}

export function defaultDeps() {
	return {
		store: {
			claimCollectionCreate,
			setCollectionAddress,
			releaseCollectionClaim,
			claimItemForMint,
			markItemMinted,
			releaseItemMintClaim,
			getItemState: getItemMintState,
		},
		storage: {
			promoteToDurableStorage,
			uploadMetadataJson,
			uploadCollectionMetadata,
			collectionCoverImage,
		},
		chain: { createCollection: createCollectionOnChain, mintItem: mintItemOnChain },
		recordLaunch,
		now: () => new Date().toISOString(),
	};
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Public API
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Create the drop's Core collection. Idempotent: a drop that already has one
 * returns it; a concurrent caller gets `in_progress` rather than a second
 * collection.
 *
 * @returns {Promise<{created:boolean, collection_address:string, network:string, signature?:string}>}
 */
export async function createDropCollection({ drop, network: requested }, deps = defaultDeps()) {
	const network = resolveNetwork(requested);
	if (drop.status === 'draft') {
		throw new DropMintError('not_published', 'publish the drop before putting it on Solana');
	}
	if (drop.collection_address) {
		if (drop.collection_network && drop.collection_network !== network) {
			throw new DropMintError(
				'network_mismatch',
				`this drop's collection lives on ${drop.collection_network}; a drop has exactly one collection`,
			);
		}
		return { created: false, collection_address: drop.collection_address, network: drop.collection_network || network };
	}

	if (!(await deps.store.claimCollectionCreate(drop.id))) {
		throw new DropMintError('in_progress', 'the collection for this drop is already being created; try again shortly');
	}
	try {
		const coverImage = deps.storage.collectionCoverImage ? await deps.storage.collectionCoverImage(drop) : null;
		const metadata = buildDropCollectionMetadata({ drop, imageUrl: coverImage, network });
		const { uri } = deps.storage.uploadCollectionMetadata
			? await deps.storage.uploadCollectionMetadata({ drop, metadata })
			: { uri: null };
		const { address, signature } = await deps.chain.createCollection({ network, name: drop.name, uri });
		await deps.store.setCollectionAddress(drop.id, address, network, signature);
		return { created: true, collection_address: address, network, signature };
	} catch (err) {
		await deps.store.releaseCollectionClaim(drop.id).catch(() => {});
		throw err;
	}
}

/**
 * Mint one revealed item into the drop's collection.
 *
 * @param {object} p
 * @param {object} p.drop
 * @param {number} p.index
 * @param {string} p.ownerWallet           base58 recipient
 * @param {string} [p.royaltyRecipient]    defaults to the recipient
 * @param {string} [p.network]
 */
export async function mintDropItem(
	{ drop, index, ownerWallet, royaltyRecipient, network: requested },
	deps = defaultDeps(),
) {
	const network = resolveNetwork(requested);
	if (!drop.collection_address) {
		throw new DropMintError('no_collection', 'create the drop collection before minting items');
	}
	if (drop.collection_network && drop.collection_network !== network) {
		throw new DropMintError(
			'network_mismatch',
			`this drop's collection lives on ${drop.collection_network}; items can only be minted there`,
		);
	}

	const state = await deps.store.getItemState(drop.id, index);
	if (!state) throw new DropMintError('not_found', 'no such item', 404);
	if (state.mint_address) return resultOf(state, drop, true);
	if (state.status !== 'revealed') {
		throw new DropMintError('not_revealed', 'reveal this item before minting it');
	}
	if (!isValidBase58Pubkey(ownerWallet || '')) {
		throw new DropMintError('invalid_wallet', 'owner_wallet must be a valid Solana address', 400);
	}
	const royaltyTo = royaltyRecipient && isValidBase58Pubkey(royaltyRecipient) ? royaltyRecipient : ownerWallet;

	if (!(await deps.store.claimItemForMint(drop.id, index))) {
		const again = await deps.store.getItemState(drop.id, index);
		if (again?.mint_address) return resultOf(again, drop, true);
		throw new DropMintError('in_progress', 'this item is already being minted; try again shortly');
	}

	try {
		const { bps: royaltyBps } = clampSellerFeeBps(DROP_ROYALTY_BPS);
		const idempotencyKey = `drop-${drop.id}-${index}`;
		const media = await deps.storage.promoteToDurableStorage({
			idempotencyKey,
			sourceUrl: state.glb_url,
			name: `${drop.name} ${index}`,
		});
		const viewerUrl = viewerLinkFor(env.APP_ORIGIN, media.glbUrl);
		const createdAt = deps.now();
		const metadata = buildDropItemMetadata({
			drop,
			item: state,
			media,
			viewerUrl,
			ownerWallet,
			royaltyRecipient: royaltyTo,
			collection: drop.collection_address,
			network,
			createdAt,
			royaltyBps,
		});
		const { uri: metadataUri } = await deps.storage.uploadMetadataJson({ idempotencyKey, metadata });
		const { mint, signature } = await deps.chain.mintItem({
			network,
			collection: drop.collection_address,
			ownerWallet,
			name: metadata.name,
			metadataUri,
			royaltyBps,
			royaltyRecipient: royaltyTo,
		});
		const saved = await deps.store.markItemMinted(drop.id, index, { mint, ownerWallet, signature });
		await deps
			.recordLaunch({
				drop,
				item: state,
				mint,
				signature,
				ownerWallet,
				royaltyRecipient: royaltyTo,
				royaltyBps,
				collection: drop.collection_address,
				network,
				media,
				viewerUrl,
				metadataUri,
				createdAt,
			})
			.catch((err) => console.warn('[drop-mint] launch record failed:', err?.message));
		return { ...resultOf(saved || { ...state, mint_address: mint, owner_wallet: ownerWallet }, drop, false), signature };
	} catch (err) {
		await deps.store.releaseItemMintClaim(drop.id, index, err?.message).catch(() => {});
		throw err;
	}
}

function resultOf(item, drop, idempotent) {
	return {
		idempotent,
		index: item.index,
		mint_address: item.mint_address,
		owner_wallet: item.owner_wallet,
		minted_at: item.minted_at,
		collection_address: drop.collection_address,
		network: drop.collection_network || null,
	};
}
