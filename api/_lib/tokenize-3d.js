/**
 * Tokenized 3D — mint a generated/owned GLB as a Metaplex Core NFT whose media
 * is a live, interactive 3D viewer, with baked provenance and enforced royalties.
 * ---------------------------------------------------------------------------
 * The payoff of infrastructure that already coexists in this repo: text→3D→rig
 * generation, R2 avatar storage, and Solana signing rails. This module ties them
 * together so a generated avatar becomes ownable, transferable, composable
 * on-chain property.
 *
 * Flow (mintTokenized3dAsset):
 *   1. Resolve the source GLB (an owned avatar or a supplied GLB URL) and the
 *      recipient wallet (OAuth-linked or supplied).
 *   2. CLAIM an idempotency row *before* any on-chain call — the double-mint
 *      guard. A second call with the same key reads back the winner's mint.
 *   3. Promote media to durable storage: copy the GLB + a fresh thumbnail into a
 *      tokenize-namespaced R2 key (so the NFT media never moves even if the
 *      source avatar is later deleted), and pin to IPFS when configured.
 *   4. Build + upload Metaplex-compliant metadata (GLB under animation_url).
 *   5. Mint a Core asset with an enforced Royalties plugin (capped), owned by the
 *      recipient, signed + paid by the three.ws collection authority.
 *   6. Persist the launch record (mint, tx, provenance) and return the mint +
 *      explorer + viewer links.
 *
 * Heavy Solana/Umi + render deps are imported here (not in the pure metadata
 * module) so callers that only need metadata shape stay dependency-light.
 *
 * $THREE-policy clean: $THREE is the only coin named. SOL is the Core rent +
 * royalty rail (a settlement mechanic); no other mint is ever referenced.
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore, create, fetchAsset, ruleSet } from '@metaplex-foundation/mpl-core';
import {
	generateSigner,
	publicKey as umiPublicKey,
	signerIdentity,
} from '@metaplex-foundation/umi';
import bs58 from 'bs58';

import { sql } from './db.js';
import { env } from './env.js';
import { collectionAuthoritySigner, collectionAuthorityAddress } from './solana-collection.js';
import { solanaConnection } from './solana/connection.js';
import { explorerTxUrl } from './avatar-wallet.js';
import { putObject, publicUrl } from './r2.js';
import { pinToIPFS, ipfsPinningConfigured } from './ipfs-pin.js';
import { fetchSafePublicUrl } from './ssrf-guard.js';
import { getAvatar, resolveAvatarUrl } from './avatars.js';
import { getUserSolanaWallets } from './nft-gate.js';
import { resolveRenderParams, renderAvatarScene } from './avatar-render.js';
import {
	buildTokenized3dMetadata,
	viewerLinkFor,
	clampSellerFeeBps,
	deriveIdempotencyKey,
	TOKENIZE_3D_ROYALTY_CAP_BPS,
} from './tokenize-3d-metadata.js';
import { agentIdForAvatar, writeAssetProvenance } from './asset-provenance.js';
import { computeRemixSplit } from './remix-royalty.js';
import { resolvePayoutKeyBase58 } from './remix-settlement.js';
import { transferSolanaUSDC } from './solana-transfer.js';
import { SOLANA_USDC_MINT } from '../payments/_config.js';
import { priceFor } from './pump-pricing.js';

export { TOKENIZE_3D_ROYALTY_CAP_BPS };

/** The x402 price of one mint call, in USDC atomics — single source of truth
 * (api/_lib/pump-pricing.js), reused so the remix-royalty split on a mint
 * never drifts from what the caller was actually charged. */
function mintPriceAtomics() {
	const usd = priceFor('mint_3d_asset')?.amount_usdc;
	return usd > 0 ? BigInt(Math.round(usd * 1_000_000)) : 0n;
}

/** Networks we mint on. Devnet is the default; mainnet is explicit. */
export const TOKENIZE_3D_NETWORKS = /** @type {const} */ (['mainnet', 'devnet']);

/**
 * Resolve the minting network. Devnet-default is deliberate: real value only
 * moves when a caller explicitly asks for mainnet.
 * @param {string|null|undefined} preferred
 * @returns {'mainnet'|'devnet'}
 */
export function resolveNetwork(preferred) {
	return preferred === 'mainnet' ? 'mainnet' : 'devnet';
}

function rpcForNetwork(network) {
	return network === 'devnet' ? env.SOLANA_RPC_URL_DEVNET : env.SOLANA_RPC_URL;
}

function isValidBase58Pubkey(addr) {
	try {
		umiPublicKey(addr);
		return true;
	} catch {
		return false;
	}
}

function encodeSignature(sig) {
	return typeof sig === 'string' ? sig : bs58.encode(sig);
}

function assetExplorerUrl(mint, network) {
	const cluster = network === 'devnet' ? '?cluster=devnet' : '';
	return `https://solscan.io/token/${mint}${cluster}`;
}

// ── Source + owner resolution ────────────────────────────────────────────────

/**
 * Resolve the GLB source into { glbUrl, name, sourceAvatarId, provenance } and
 * the durable-storage bytes fetcher. Accepts either an owned avatar id or a raw
 * GLB URL.
 *
 * @param {object} p
 * @param {string} [p.avatarId]
 * @param {string} [p.glbUrl]
 * @param {string|null} p.requesterId  OAuth userId (visibility gate for avatars)
 * @param {string} [p.name]
 */
async function resolveSource({ avatarId, glbUrl, requesterId, name }) {
	if (avatarId) {
		const avatar = await getAvatar({ id: avatarId, requesterId });
		if (!avatar) {
			throw Object.assign(new Error('avatar not found'), { status: 404, code: 'not_found' });
		}
		const urlInfo = await resolveAvatarUrl(avatar);
		if (!urlInfo?.url) {
			throw Object.assign(new Error('this avatar has no model to tokenize yet'), {
				status: 409,
				code: 'no_model',
			});
		}
		const meta = avatar.source_meta || {};
		return {
			sourceUrl: urlInfo.url,
			sourceAvatarId: avatar.id,
			name: name || avatar.name || 'three.ws 3D asset',
			description: avatar.description || '',
			parentAvatarId: avatar.parent_avatar_id || null,
			provenance: {
				prompt: meta.source_prompt || null,
				generationModel: meta.generator || meta.model || null,
				generationProvider: meta.provider || (meta.generator ? 'three.ws' : null),
			},
		};
	}
	if (glbUrl) {
		if (!/^https?:\/\//i.test(glbUrl)) {
			throw Object.assign(new Error('glb_url must be an absolute http(s) URL'), {
				status: 400,
				code: 'validation_error',
			});
		}
		return {
			sourceUrl: glbUrl,
			sourceAvatarId: null,
			name: name || 'three.ws 3D asset',
			description: '',
			parentAvatarId: null,
			provenance: { prompt: null, generationModel: null, generationProvider: null },
		};
	}
	throw Object.assign(new Error('provide either avatar_id or glb_url'), {
		status: 400,
		code: 'validation_error',
	});
}

/**
 * Resolve the NFT recipient wallet: an explicitly supplied base58 address, else
 * the OAuth user's linked Solana wallet.
 */
async function resolveOwnerWallet({ ownerWallet, requesterId }) {
	if (ownerWallet) {
		if (!isValidBase58Pubkey(ownerWallet)) {
			throw Object.assign(new Error('owner_wallet is not a valid Solana address'), {
				status: 400,
				code: 'validation_error',
			});
		}
		return ownerWallet;
	}
	if (requesterId) {
		const wallets = await getUserSolanaWallets(requesterId);
		if (wallets.length) return wallets[0];
	}
	throw Object.assign(
		new Error('no recipient wallet — connect a Solana wallet (sign in) or pass owner_wallet'),
		{ status: 400, code: 'no_wallet' },
	);
}

// ── Durable storage promotion ────────────────────────────────────────────────

/**
 * Copy the source GLB and a freshly-rendered thumbnail into a tokenize-namespaced
 * R2 key so the NFT media is permanent + first-party, and pin both to IPFS when
 * a provider is configured. Returns the durable URLs.
 *
 * @returns {Promise<{ glbUrl: string, imageUrl: string, glbIpfs: string|null, imageIpfs: string|null }>}
 */
async function promoteToDurableStorage({ idempotencyKey, sourceUrl, name }) {
	const base = `tokenized/${idempotencyKey}`;

	// 1. GLB bytes → durable R2 key.
	const glbResp = await fetchSafePublicUrl(sourceUrl, {}, { allowHttp: false });
	if (!glbResp.ok) {
		throw Object.assign(new Error(`could not fetch source GLB (${glbResp.status})`), {
			status: 502,
			code: 'source_unreachable',
		});
	}
	const glbBuf = Buffer.from(await glbResp.arrayBuffer());
	const glbKey = `${base}/model.glb`;
	await putObject({ key: glbKey, body: glbBuf, contentType: 'model/gltf-binary' });
	const glbUrl = publicUrl(glbKey);

	// 2. Thumbnail — render the model once, store it durably. A 3D NFT needs a
	//    real image for wallets/marketplaces that don't render glTF.
	const { params, error } = resolveRenderParams({
		scene: 'full-body',
		size: 1024,
		bg: '#0b0b0f',
		format: 'png',
	});
	if (error) {
		throw Object.assign(new Error(`thumbnail params invalid: ${error.message}`), {
			status: 400,
			code: 'render_params',
		});
	}
	let png;
	try {
		({ png } = await renderAvatarScene({
			glbUrl,
			width: params.width,
			height: params.height,
			background: params.bg,
			posePresetId: params.posePresetId,
			cameraOrbit: { theta: params.scenePreset.theta, phi: params.scenePreset.phi, radius: null },
			expression: null,
			scenePreset: params.scenePreset,
		}));
	} catch (err) {
		throw Object.assign(
			new Error(`could not render a thumbnail for the asset: ${err?.message || 'render failed'}`),
			{ status: 502, code: 'thumbnail_failed' },
		);
	}
	const imageKey = `${base}/thumb.png`;
	await putObject({ key: imageKey, body: png, contentType: 'image/png' });
	const imageUrl = publicUrl(imageKey);

	// 3. Optional IPFS permanence copies (best-effort; R2 https is the primary).
	let glbIpfs = null;
	let imageIpfs = null;
	if (ipfsPinningConfigured()) {
		try {
			const safeName = (name || 'asset').replace(/[^a-z0-9._-]/gi, '_').slice(0, 40);
			const [g, i] = await Promise.all([
				pinToIPFS(glbBuf, `${safeName}.glb`),
				pinToIPFS(png, `${safeName}.png`),
			]);
			glbIpfs = g?.uri || null;
			imageIpfs = i?.uri || null;
		} catch (err) {
			// Permanence is a bonus; a pin failure must not fail the mint.
			console.warn('[tokenize-3d] IPFS pin failed (continuing on R2):', err?.message);
		}
	}

	return { glbUrl, imageUrl, glbIpfs, imageIpfs };
}

async function uploadMetadataJson({ idempotencyKey, metadata }) {
	const key = `tokenized/${idempotencyKey}/metadata.json`;
	await putObject({
		key,
		body: Buffer.from(JSON.stringify(metadata)),
		contentType: 'application/json',
	});
	let ipfs = null;
	if (ipfsPinningConfigured()) {
		try {
			ipfs = (await pinToIPFS(Buffer.from(JSON.stringify(metadata)), 'metadata.json'))?.uri || null;
		} catch (err) {
			console.warn('[tokenize-3d] metadata IPFS pin failed:', err?.message);
		}
	}
	return { uri: publicUrl(key), ipfs };
}

// ── On-chain mint ────────────────────────────────────────────────────────────

/**
 * Mint the Core asset with an enforced Royalties plugin. The three.ws collection
 * authority is the fee payer + update authority (authority-managed model: the
 * holder owns/transfers the asset, three.ws can curate its on-chain metadata);
 * the recipient wallet is the owner.
 */
async function mintCoreAsset({ network, ownerWallet, name, metadataUri, royaltyBps, royaltyRecipient }) {
	const umi = createUmi(solanaConnection({ url: rpcForNetwork(network), network })).use(mplCore());
	const authority = collectionAuthoritySigner(umi);
	umi.use(signerIdentity(authority));

	const assetSigner = generateSigner(umi);
	const { signature } = await create(umi, {
		asset: assetSigner,
		owner: umiPublicKey(ownerWallet),
		name: String(name).slice(0, 32) || '3D Asset',
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

// ── Public API: mint ─────────────────────────────────────────────────────────

/**
 * Default dependency set — real DB + real chain/storage. Tests inject fakes to
 * exercise the idempotency guard without touching Solana or R2.
 */
function defaultDeps() {
	return {
		sql,
		resolveSource,
		resolveOwnerWallet,
		promoteToDurableStorage,
		uploadMetadataJson,
		mintCoreAsset,
		now: () => new Date().toISOString(),
	};
}

/**
 * Mint a generated/owned GLB as a Metaplex Core 3D NFT.
 *
 * @param {object} input
 * @param {string} [input.avatarId]        owned avatar to tokenize
 * @param {string} [input.glbUrl]          or a GLB URL to tokenize
 * @param {string} [input.ownerWallet]     recipient (base58); defaults to OAuth wallet
 * @param {string|null} [input.requesterId] OAuth userId
 * @param {string} [input.name]
 * @param {string} [input.description]
 * @param {number} [input.sellerFeeBasisPoints]  requested royalty (clamped to cap)
 * @param {string} [input.royaltyRecipient]      wallet royalty routes to (default: owner)
 * @param {string} [input.network]         'devnet' (default) | 'mainnet'
 * @param {string} [input.parentMint]      lineage parent (remix source)
 * @param {string} [input.prompt]          provenance override
 * @param {string} [input.generationModel]
 * @param {string} [input.generationProvider]
 * @param {string} [input.idempotencyKey]  override the derived key
 * @param {bigint|number} [input.mintFeeAtomicsCollected]  the mint fee ACTUALLY
 *   collected for this call (USDC atomics) — used only to split a remix
 *   royalty when parentMint is set. Omit/0 for an OAuth-bypassed call (no fee
 *   was collected, so nothing is split) — never assume the advertised price
 *   was paid.
 * @param {object} [deps]                  injected dependencies (testing)
 * @returns {Promise<object>} mint result
 */
export async function mintTokenized3dAsset(input, deps = defaultDeps()) {
	const network = resolveNetwork(input.network);
	const src = await deps.resolveSource({
		avatarId: input.avatarId,
		glbUrl: input.glbUrl,
		requesterId: input.requesterId ?? null,
		name: input.name,
	});
	const ownerWallet = await deps.resolveOwnerWallet({
		ownerWallet: input.ownerWallet,
		requesterId: input.requesterId ?? null,
	});
	const royaltyRecipient =
		input.royaltyRecipient && isValidBase58Pubkey(input.royaltyRecipient)
			? input.royaltyRecipient
			: ownerWallet;
	const { bps: royaltyBps, capped, requestedBps } = clampSellerFeeBps(input.sellerFeeBasisPoints);

	const idempotencyKey =
		input.idempotencyKey ||
		deriveIdempotencyKey({
			ownerWallet,
			glbSource: src.sourceAvatarId ? `avatar:${src.sourceAvatarId}` : `url:${src.sourceUrl}`,
			network,
			creatorUserId: input.requesterId ?? null,
		});

	const provenance = {
		prompt: input.prompt ?? src.provenance.prompt,
		generationModel: input.generationModel ?? src.provenance.generationModel,
		generationProvider: input.generationProvider ?? src.provenance.generationProvider,
		parentMint: input.parentMint ?? null,
	};

	// ── Claim-first idempotency guard: insert a pending row; a conflict means a
	//    prior call already owns this key. ──
	const [claimed] = await deps.sql`
		insert into tokenized_3d_assets
			(idempotency_key, network, status, owner_wallet, creator_user_id, source_avatar_id,
			 parent_mint, name, glb_url, viewer_url, royalty_bps, royalty_recipient, provenance)
		values
			(${idempotencyKey}, ${network}, 'pending', ${ownerWallet}, ${input.requesterId ?? null},
			 ${src.sourceAvatarId}, ${provenance.parentMint}, ${src.name}, ${src.sourceUrl},
			 ${viewerLinkFor(env.APP_ORIGIN, src.sourceUrl)}, ${royaltyBps}, ${royaltyRecipient},
			 ${JSON.stringify(provenance)}::jsonb)
		on conflict (idempotency_key, network) do nothing
		returning id, status
	`;

	let rowId = claimed?.id;
	if (!claimed) {
		const [existing] = await deps.sql`
			select id, status, mint, network, name, glb_url, image_url, viewer_url,
			       metadata_uri, royalty_bps, royalty_recipient, tx_signature,
			       provenance_ledger, remix_royalty
			from tokenized_3d_assets
			where idempotency_key = ${idempotencyKey} and network = ${network}
		`;
		if (existing?.status === 'minted') {
			// Idempotent hit — return the already-minted asset, do NOT mint again.
			return formatMintResult(existing, { idempotent: true, capped, requestedBps, royaltyBps });
		}
		if (existing?.status === 'pending') {
			return {
				status: 'pending',
				idempotent: true,
				message: 'A mint for this asset is already in progress. Read it back once it confirms.',
				id: existing.id,
				network,
			};
		}
		// status === 'failed' → reclaim for a retry (only one winner flips it back).
		const [reclaimed] = await deps.sql`
			update tokenized_3d_assets
			set status = 'pending', mint_error = null, updated_at = now()
			where idempotency_key = ${idempotencyKey} and network = ${network} and status = 'failed'
			returning id
		`;
		if (!reclaimed) {
			return {
				status: 'pending',
				idempotent: true,
				message: 'A retry for this asset is already in progress.',
				id: existing?.id,
				network,
			};
		}
		rowId = reclaimed.id;
	}

	try {
		// 1. Durable media.
		const media = await deps.promoteToDurableStorage({
			idempotencyKey,
			sourceUrl: src.sourceUrl,
			name: src.name,
		});
		const viewerUrl = viewerLinkFor(env.APP_ORIGIN, media.glbUrl);
		const createdAt = deps.now();

		// 2. Metaplex metadata.
		const metadata = buildTokenized3dMetadata({
			name: src.name,
			description: input.description || src.description,
			glbUrl: media.glbUrl,
			imageUrl: media.imageUrl,
			viewerUrl,
			glbIpfs: media.glbIpfs,
			imageIpfs: media.imageIpfs,
			creatorWallet: ownerWallet,
			creatorUserId: input.requesterId ?? null,
			prompt: provenance.prompt,
			generationModel: provenance.generationModel,
			generationProvider: provenance.generationProvider,
			parentMint: provenance.parentMint,
			royaltyBps,
			royaltyRecipient,
			network,
			createdAt,
		});
		const { uri: metadataUri, ipfs: metadataIpfs } = await deps.uploadMetadataJson({
			idempotencyKey,
			metadata,
		});

		// 3. Mint.
		const { mint, signature } = await deps.mintCoreAsset({
			network,
			ownerWallet,
			name: src.name,
			metadataUri,
			royaltyBps,
			royaltyRecipient,
		});

		// 4. Persist the launch record.
		const [row] = await deps.sql`
			update tokenized_3d_assets
			set status = 'minted', mint = ${mint}, tx_signature = ${signature},
			    glb_url = ${media.glbUrl}, image_url = ${media.imageUrl}, viewer_url = ${viewerUrl},
			    metadata_uri = ${metadataUri},
			    provenance = ${JSON.stringify({ ...metadata.properties.provenance, metadata_ipfs: metadataIpfs })}::jsonb,
			    updated_at = now()
			where id = ${rowId}
			returning id, status, mint, network, name, glb_url, image_url, viewer_url,
			          metadata_uri, royalty_bps, royalty_recipient, tx_signature
		`;

		// 5. Signed provenance on the agent_actions ledger (Prompt 08, task 1) —
		// independently verifiable via query_action/list_agent_actions, alongside
		// the provenance already baked into the NFT metadata itself. Best-effort:
		// only fires when the source avatar has a provisioned agent, and never
		// blocks or fails the mint that already succeeded on-chain.
		let provenanceLedger = null;
		const provenanceAgentId = await agentIdForAvatar(src.sourceAvatarId).catch(() => null);
		if (provenanceAgentId) {
			const ledgerResult = await writeAssetProvenance({
				agentId: provenanceAgentId,
				type: 'tokenize_3d.mint',
				payload: {
					mint,
					network,
					name: src.name,
					prompt: provenance.prompt,
					generation_model: provenance.generationModel,
					generation_provider: provenance.generationProvider,
					parent_mint: provenance.parentMint,
					glb_url: media.glbUrl,
					viewer_url: viewerUrl,
					royalty_bps: royaltyBps,
					creator_wallet: ownerWallet,
					minted_at: createdAt,
				},
				sourceSkill: 'tokenize-3d',
			}).catch(() => null);
			if (ledgerResult?.recorded) {
				provenanceLedger = {
					action_id: ledgerResult.action_id,
					signed: ledgerResult.signed,
					signer_address: ledgerResult.signer_address,
					digest: ledgerResult.digest,
				};
			}
		}

		// 6. Remix royalty on the mint fee (Prompt 08, task 4) — when this mint
		// names a parent (a remix/derivative), route the parent creator's
		// royalty slice out of the fee actually collected for THIS mint call, a
		// real second USDC transfer, same rails as api/_lib/remix-settlement.js.
		// Mainnet only (the payout wallet is a real mainnet treasury); a devnet
		// remix mint still records durable parent→child lineage but settles
		// nothing. An OAuth-bypassed mint (feeAtomicsCollected=0) has nothing to
		// split — honestly reported, never a fabricated payout.
		let remixRoyalty = null;
		if (provenance.parentMint) {
			remixRoyalty = await settleOrDeferRemixRoyalty({
				sql: deps.sql,
				rowId,
				parentMint: provenance.parentMint,
				network,
				feeAtomics: input.mintFeeAtomicsCollected ?? 0n,
				defer: input.deferRoyalty,
			});
		}

		if (provenanceLedger || remixRoyalty) {
			await deps
				.sql`update tokenized_3d_assets set provenance_ledger = ${provenanceLedger ? JSON.stringify(provenanceLedger) : null}::jsonb, remix_royalty = ${remixRoyalty ? JSON.stringify(remixRoyalty) : null}::jsonb, updated_at = now() where id = ${rowId}`
				.catch((err) => console.warn('[tokenize-3d] provenance/royalty persist failed:', err?.message));
		}

		return formatMintResult(row, {
			idempotent: false,
			capped,
			requestedBps,
			royaltyBps,
			metadataIpfs,
			provenanceLedger,
			remixRoyalty,
		});
	} catch (err) {
		// Clean failure at the boundary: mark the row failed so the key can retry,
		// then surface a sanitized error. Never leak a key/secret.
		await deps
			.sql`update tokenized_3d_assets set status='failed', mint_error=${String(err?.message || 'mint failed').slice(0, 500)}, updated_at=now() where id=${rowId}`
			.catch(() => {});
		throw err;
	}
}

// ── Remix royalty on a mint ─────────────────────────────────────────────────

/**
 * When a mint names a `parent_mint` (it's a derivative of another creator's
 * tokenized 3D asset), route that creator's royalty slice out of THIS mint's
 * x402 fee — a real second USDC transfer, same split math + payout wallet as
 * the forge_creations remix bazaar (api/_lib/remix-royalty.js +
 * api/_lib/remix-settlement.js). Every non-paying outcome is reported with an
 * honest reason (never a fake "pending"): no such parent, the parent has no
 * royalty wallet, the split falls below the dust floor, the platform payout
 * wallet isn't configured, the remix crosses networks, or this specific mint
 * call collected no fee to split (an OAuth-bypassed call, or devnet — the
 * payout wallet only holds real mainnet funds).
 *
 * @param {object} p
 * @param {Function} p.sql          tagged-template SQL client (injectable for tests)
 * @param {string} p.parentMint     the asset this mint derives from
 * @param {string} p.network        this mint's network — must match the parent's
 * @param {bigint} p.feeAtomics     the mint fee actually collected for THIS call
 * @returns {Promise<object>} settlement summary — always defined, `paid` tells the story
 */
export async function settleTokenizeRemixRoyalty({ sql: sqlClient, parentMint, network, feeAtomics }) {
	const fee = typeof feeAtomics === 'bigint' ? feeAtomics : BigInt(feeAtomics || 0);

	if (network !== 'mainnet') {
		return { paid: false, reason: 'devnet_not_settled', parent_mint: parentMint };
	}
	if (fee <= 0n) {
		return { paid: false, reason: 'no_fee_collected', parent_mint: parentMint };
	}

	const [parent] = await sqlClient`
		select mint, royalty_bps, royalty_recipient, owner_wallet
		from tokenized_3d_assets
		where mint = ${parentMint} and network = ${network} and status = 'minted'
		limit 1
	`;
	if (!parent) {
		return { paid: false, reason: 'parent_not_found', parent_mint: parentMint };
	}

	const creatorWallet = parent.royalty_recipient || parent.owner_wallet;
	const split = computeRemixSplit({ priceAtomics: fee, royaltyBps: parent.royalty_bps });
	const summary = {
		parent_mint: parentMint,
		royalty_bps: split.royaltyBps,
		requested_bps: split.requestedBps,
		capped: split.capped,
		dust: split.dust,
		creator_usd: split.creatorUsd,
		platform_usd: split.platformUsd,
		creator_atomics: split.creatorAtomics.toString(),
		platform_atomics: split.platformAtomics.toString(),
	};

	if (!creatorWallet) {
		return { ...summary, paid: false, reason: 'no_creator_wallet' };
	}
	if (split.creatorAtomics <= 0n) {
		return { ...summary, paid: false, reason: split.dust ? 'below_dust_floor' : 'zero_royalty' };
	}
	const fromWallet = resolvePayoutKeyBase58();
	if (!fromWallet) {
		return { ...summary, paid: false, reason: 'payout_unconfigured' };
	}

	try {
		const sig = await transferSolanaUSDC({
			fromWallet,
			toAddress: creatorWallet,
			amount: split.creatorAtomics,
			mint: SOLANA_USDC_MINT,
		});
		return {
			...summary,
			paid: true,
			creator_wallet: creatorWallet,
			creator_tx: sig,
			explorer_tx_url: explorerTxUrl(sig, network),
			settled_at: new Date().toISOString(),
		};
	} catch (err) {
		return { ...summary, paid: false, reason: 'royalty_transfer_failed', error: err?.message || 'transfer failed' };
	}
}

/**
 * Pay the parent creator's remix royalty, or hold it until the caller's x402
 * payment has settled. The royalty comes out of the platform treasury, so it must
 * not leave before the fee it is carved from has actually landed: a payer whose
 * settlement fails would otherwise cost the platform the royalty.
 *
 * @param {object} p
 * @param {(run: () => Promise<void>) => void} [p.defer] registers work to run
 *   after settlement; omitted means pay now (no per-call fee to wait for).
 */
export async function settleOrDeferRemixRoyalty({ sql: sqlClient, rowId, parentMint, network, feeAtomics, defer }) {
	const settle = () => settleTokenizeRemixRoyalty({ sql: sqlClient, parentMint, network, feeAtomics });
	if (typeof defer !== 'function') return settle();
	defer(async () => {
		const settled = await settle();
		await sqlClient`update tokenized_3d_assets set remix_royalty = ${JSON.stringify(settled)}::jsonb, updated_at = now() where id = ${rowId}`;
	});
	return { paid: false, reason: 'pending_payment_settlement', parent_mint: parentMint };
}

function formatMintResult(
	row,
	{ idempotent, capped, requestedBps, royaltyBps, metadataIpfs = null, provenanceLedger, remixRoyalty },
) {
	return {
		status: 'minted',
		idempotent: Boolean(idempotent),
		mint: row.mint,
		network: row.network,
		name: row.name,
		owner: row.royalty_recipient, // recipient == owner unless royaltyRecipient overridden
		glb_url: row.glb_url,
		image_url: row.image_url,
		viewer_url: row.viewer_url,
		metadata_uri: row.metadata_uri,
		metadata_ipfs: metadataIpfs,
		// Signed agent_actions-ledger provenance for this mint (Prompt 08, task 1)
		// — null when the source avatar has no provisioned agent to sign as.
		provenance_ledger: provenanceLedger ?? row.provenance_ledger ?? null,
		// Real remix-royalty settlement out of this mint's fee (Prompt 08, task 4)
		// — null when this mint has no parent_mint (not a remix).
		remix_royalty: remixRoyalty ?? row.remix_royalty ?? null,
		royalty: {
			basis_points: row.royalty_bps ?? royaltyBps,
			percent: (row.royalty_bps ?? royaltyBps) / 100,
			recipient: row.royalty_recipient,
			cap_basis_points: TOKENIZE_3D_ROYALTY_CAP_BPS,
			capped: Boolean(capped),
			...(capped ? { requested_basis_points: requestedBps } : {}),
		},
		tx_signature: row.tx_signature,
		explorer_tx_url: row.tx_signature ? explorerTxUrl(row.tx_signature, row.network) : null,
		explorer_asset_url: assetExplorerUrl(row.mint, row.network),
	};
}

// ── Public API: read-back ────────────────────────────────────────────────────

/**
 * Resolve a mint to its live 3D asset + holder + provenance + royalty terms.
 * Reads the on-chain Core asset, fetches its off-chain metadata, joins our
 * launch record, and confirms it resolves to a live viewer.
 *
 * @param {object} p
 * @param {string} p.mint
 * @param {string} [p.network]  'devnet' (default) | 'mainnet'
 * @returns {Promise<object>}
 */
export async function readTokenized3dAsset({ mint, network: preferredNetwork }) {
	if (!isValidBase58Pubkey(mint)) {
		throw Object.assign(new Error('mint is not a valid Solana address'), {
			status: 400,
			code: 'validation_error',
		});
	}

	// Our launch record (if this was minted through three.ws) — the source of
	// truth for provenance, and it tells us which network to read.
	const [record] = await sql`
		select mint, network, owner_wallet, name, glb_url, image_url, viewer_url,
		       metadata_uri, royalty_bps, royalty_recipient, provenance, tx_signature, created_at,
		       provenance_ledger, remix_royalty
		from tokenized_3d_assets
		where mint = ${mint} and status = 'minted'
		limit 1
	`;
	const network = resolveNetwork(record?.network || preferredNetwork);

	// On-chain read: holder + enforced royalty live here, authoritative over the DB.
	const umi = createUmi(solanaConnection({ url: rpcForNetwork(network), network })).use(mplCore());
	let asset;
	try {
		asset = await fetchAsset(umi, umiPublicKey(mint));
	} catch (err) {
		throw Object.assign(new Error(`asset not found on ${network}: ${err?.message || 'read failed'}`), {
			status: 404,
			code: 'asset_not_found',
		});
	}

	const holder = asset.owner?.toString?.() || null;
	const onchainRoyalty = asset.royalties
		? {
				basis_points: asset.royalties.basisPoints,
				percent: asset.royalties.basisPoints / 100,
				creators: (asset.royalties.creators || []).map((c) => ({
					address: c.address?.toString?.() || String(c.address),
					percent: c.percentage,
				})),
			}
		: null;

	// Off-chain metadata (media + provenance). Prefer the on-chain URI so an
	// asset not in our DB still resolves.
	const metadataUri = asset.uri || record?.metadata_uri || null;
	let metadata = null;
	if (metadataUri) {
		try {
			const resp = await fetchSafePublicUrl(metadataUri, {}, { allowHttp: false });
			if (resp.ok) metadata = await resp.json();
		} catch (err) {
			console.warn('[tokenize-3d] metadata fetch failed:', err?.message);
		}
	}

	const glbUrl = metadata?.animation_url || record?.glb_url || null;
	const viewerUrl =
		metadata?.external_url ||
		record?.viewer_url ||
		(glbUrl ? viewerLinkFor(env.APP_ORIGIN, glbUrl) : null);

	// Confirm the media resolves to a live viewer (HEAD the GLB).
	let viewerLive = false;
	if (glbUrl) {
		try {
			const head = await fetchSafePublicUrl(glbUrl, { method: 'HEAD' }, { allowHttp: false });
			viewerLive = head.ok;
		} catch {
			viewerLive = false;
		}
	}

	const provenance = metadata?.properties?.provenance || record?.provenance || null;

	return {
		mint,
		network,
		holder,
		name: asset.name || metadata?.name || record?.name || null,
		media: {
			glb_url: glbUrl,
			image_url: metadata?.image || record?.image_url || null,
			viewer_url: viewerUrl,
			viewer_live: viewerLive,
			media_kind: '3d/gltf-binary',
		},
		provenance,
		// The signed agent_actions-ledger record for this mint (if the source
		// avatar had a provisioned agent to sign as) — independently verifiable
		// via query_action/list_agent_actions, alongside the metadata provenance.
		provenance_ledger: record?.provenance_ledger || null,
		royalty: {
			// The enforced on-chain terms are authoritative; fall back to the record.
			basis_points: onchainRoyalty?.basis_points ?? record?.royalty_bps ?? null,
			percent:
				onchainRoyalty?.percent ??
				(record?.royalty_bps != null ? record.royalty_bps / 100 : null),
			recipient:
				onchainRoyalty?.creators?.[0]?.address || record?.royalty_recipient || null,
			cap_basis_points: TOKENIZE_3D_ROYALTY_CAP_BPS,
			enforced_onchain: Boolean(onchainRoyalty),
			creators: onchainRoyalty?.creators || null,
		},
		// The real remix-royalty settlement this mint routed to its parent's
		// creator (only present when this mint named a parent_mint).
		remix_royalty: record?.remix_royalty || null,
		metadata_uri: metadataUri,
		minted_through_threews: Boolean(record),
		tx_signature: record?.tx_signature || null,
		explorer_tx_url: record?.tx_signature ? explorerTxUrl(record.tx_signature, network) : null,
		explorer_asset_url: assetExplorerUrl(mint, network),
	};
}

/** The three.ws authority that pays rent + holds update authority for these mints. */
export function tokenizeAuthorityAddress() {
	return collectionAuthorityAddress();
}
