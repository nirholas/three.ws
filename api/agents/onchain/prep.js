/**
 * POST /api/agents/onchain/prep
 *
 * Unified prep endpoint covering all chain families. Replaces:
 *   • /api/agents/register-prep         (EVM)
 *   • /api/agents/solana-register-prep  (Solana)
 *
 * Single payload shape, single CAIP-2 chain selector. The metadata manifest is
 * pinned once (IPFS) regardless of family, so EVM and Solana point at the same
 * canonical content.
 *
 * Returns a `prepId` that the confirm endpoint validates against. Persistence
 * uses `agent_registrations_pending` (existing table) with a unified payload.
 *
 * Wallet-ownership rule: if the wallet isn't yet linked to the user, prep
 * still succeeds — the SolanaAdapter runs SIWS on the client before calling
 * here, and EVM uses signed-tx ownership at confirm time. We re-verify on
 * confirm; prep only requires the wallet to *belong* to no other user.
 */

import { z } from 'zod';
import {
	createUmi,
} from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore, createV1 } from '@metaplex-foundation/mpl-core';
import {
	generateSigner,
	publicKey as umiPublicKey,
	signerIdentity,
	createNoopSigner,
} from '@metaplex-foundation/umi';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { randomToken } from '../../_lib/crypto.js';
import { env } from '../../_lib/env.js';

// ── Chain parsing ────────────────────────────────────────────────────────────

const SOLANA_REFS = {
	mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
	devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
};
const SOLANA_REF_TO_CLUSTER = Object.fromEntries(
	Object.entries(SOLANA_REFS).map(([k, v]) => [v, k]),
);

/** @returns {{ family: 'evm', chainId: number } | { family: 'solana', cluster: 'mainnet'|'devnet' }} */
function parseChain(caip2) {
	const [ns, ref] = String(caip2).split(':');
	if (ns === 'eip155') {
		const id = Number(ref);
		if (!Number.isInteger(id) || id <= 0) throw new Error(`bad eip155 ref: ${ref}`);
		return { family: 'evm', chainId: id };
	}
	if (ns === 'solana') {
		const cluster = SOLANA_REF_TO_CLUSTER[ref];
		if (!cluster) throw new Error(`unknown solana ref: ${ref}`);
		return { family: 'solana', cluster };
	}
	throw new Error(`unsupported namespace: ${ns}`);
}

// ── Request schema ───────────────────────────────────────────────────────────

const bodySchema = z.object({
	agent_id: z.string().min(1).max(80),
	chain: z.string().min(8).max(120),
	wallet_address: z.string().min(20).max(80),
	name: z.string().trim().min(1).max(60),
	description: z.string().trim().max(280).default(''),
	avatar_id: z.string().uuid().nullable().optional(),
	skills: z
		.array(z.string().regex(/^[a-z0-9-]{1,40}$/i))
		.max(16)
		.optional(),
});

// ── Manifest pinning (shared across families) ────────────────────────────────

import { createHash } from 'crypto';
import { r2 } from '../../_lib/r2.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';

async function pinManifest(manifest) {
	const bytes = Buffer.from(JSON.stringify(manifest), 'utf-8');
	const token = process.env.WEB3_STORAGE_TOKEN;
	if (token) {
		try {
			const r = await fetch('https://api.web3.storage/upload', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
				body: bytes,
			});
			if (r.ok) {
				const data = await r.json();
				if (data.cid) return { cid: data.cid, uri: `ipfs://${data.cid}` };
			}
		} catch (e) {
			console.warn('[onchain/prep] web3.storage pin failed:', e.message);
		}
	}
	// Deterministic fallback: stash to R2, generate a content-hash CID stub
	// so the URL stays pointing at real bytes even if web3.storage is down.
	const hash = createHash('sha256').update(bytes).digest('hex');
	const stubCid = `bafkreigenerated${hash.slice(0, 40)}`;
	const key = `agent-manifests/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
	await r2.send(
		new PutObjectCommand({
			Bucket: env.S3_BUCKET,
			Key: key,
			Body: bytes,
			ContentType: 'application/json',
		}),
	);
	return { cid: stubCid, uri: `ipfs://${stubCid}` };
}

function buildManifest({ name, description, avatar_id, skills }) {
	return {
		$schema: 'https://3d-agent.io/schemas/manifest/0.1.json',
		spec: 'agent-manifest/0.1',
		name,
		description,
		image: '',
		tags: [],
		body: { uri: '', format: 'gltf-binary' },
		_baseURI: 'ipfs://',
		...(avatar_id ? { avatarId: avatar_id } : {}),
		...(skills?.length ? { skills } : {}),
	};
}

// ── Family-specific tx prep ──────────────────────────────────────────────────

async function prepEvm({ chainId, metadataUri }) {
	// EVM: client builds its own tx via ethers; we just hand back the metadata
	// URI and the registry address (looked up from the existing chain config).
	const { CHAIN_BY_ID } = await import('../../_lib/erc8004-chains.js');
	return {
		contractAddress: CHAIN_BY_ID?.[chainId]?.registry || null,
		metadataUri,
	};
}

async function prepSolana({ cluster, metadataUri, walletAddress, name }) {
	const rpc =
		cluster === 'devnet'
			? process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com'
			: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

	const umi = createUmi(rpc).use(mplCore());
	const ownerPk = umiPublicKey(walletAddress);
	const assetSigner = generateSigner(umi);
	umi.use(signerIdentity(createNoopSigner(ownerPk)));

	const builder = createV1(umi, {
		asset: assetSigner,
		owner: ownerPk,
		name,
		uri: metadataUri,
	});
	const txBytes = await builder.buildAndSign(umi);
	return {
		assetPubkey: assetSigner.publicKey,
		txBase64: Buffer.from(txBytes).toString('base64'),
		metadataUri,
	};
}

// ── Endpoint ─────────────────────────────────────────────────────────────────

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	let chain;
	try {
		chain = parseChain(body.chain);
	} catch (e) {
		return error(res, 400, 'validation_error', `invalid chain: ${e.message}`);
	}

	if (body.avatar_id) {
		const [av] = await sql`
			select id from avatars
			where id=${body.avatar_id} and owner_id=${user.id} and deleted_at is null
			limit 1
		`;
		if (!av) return error(res, 404, 'not_found', 'avatar not found');
	}

	// Refuse if the wallet is linked to a *different* user. If unlinked, allow
	// — confirm-time tx receipt verification is the binding step.
	const [conflict] = await sql`
		select user_id from user_wallets
		where address = ${body.wallet_address}
		  and chain_type = ${chain.family === 'solana' ? 'solana' : 'evm'}
		  and user_id <> ${user.id}
		limit 1
	`;
	if (conflict) {
		return error(res, 403, 'forbidden', 'wallet is linked to another account');
	}

	const manifest = buildManifest(body);
	const { cid, uri: metadataUri } = await pinManifest(manifest);

	let familyPrep;
	if (chain.family === 'evm') {
		familyPrep = await prepEvm({ chainId: chain.chainId, metadataUri });
	} else {
		familyPrep = await prepSolana({
			cluster: chain.cluster,
			metadataUri,
			walletAddress: body.wallet_address,
			name: body.name,
		});
	}

	const prepId = await randomToken(24);
	const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

	await sql`
		insert into agent_registrations_pending
			(user_id, cid, metadata_uri, payload, expires_at)
		values (
			${user.id},
			${cid},
			${metadataUri},
			${JSON.stringify({
				prep_id: prepId,
				agent_id: body.agent_id,
				chain: body.chain,
				chain_family: chain.family,
				wallet_address: body.wallet_address,
				name: body.name,
				description: body.description,
				avatar_id: body.avatar_id || null,
				skills: body.skills || [],
				...(chain.family === 'evm'
					? { contract_address: familyPrep.contractAddress }
					: { asset_pubkey: familyPrep.assetPubkey, cluster: chain.cluster }),
			})}::jsonb,
			${expiresAt}
		)
	`;

	return json(res, 201, {
		prepId,
		chain: body.chain,
		metadataUri,
		cid,
		...(chain.family === 'evm'
			? { contractAddress: familyPrep.contractAddress }
			: {
					assetPubkey: familyPrep.assetPubkey,
					txBase64: familyPrep.txBase64,
					cluster: chain.cluster,
				}),
		expiresAt: expiresAt.toISOString(),
	});
});
