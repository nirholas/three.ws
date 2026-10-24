// Open Solana agent registry (8004): registration and standing reads.
// ---------------------------------------------------------------------------
// The 8004 registry is the Solana port of the ERC-8004 agent identity standard:
// every registered agent is a Metaplex Core asset owned by the registry program
// family, with a feedback ledger and an ATOM engine that turns feedback into a
// sybil-resistant trust tier (Unrated, Bronze, Silver, Gold, Platinum).
//
// This module owns two things, both through the published `8004-solana` SDK:
//
//   1. WRITE. `register8004Agent` enrols an agent with the same authority-managed
//      flow as the Metaplex identity step in `onchain-deploy.js`: the platform
//      authority key signs and pays, the agent owner never signs and needs no
//      SOL. The registration URI is the agent's live, mutable registration
//      document, so its services and model stay accurate after enrolment. The
//      registry asset address is stored on the agent row at
//      `meta.registry_8004` (mainnet) or `meta.devnet.registry_8004` (devnet).
//
//   2. READ. `read8004Standing` reads any registry asset's trust tier and
//      feedback score straight from chain. Reads never need a key and never
//      throw: an unreachable RPC is reported as `unavailable`, never as an
//      unrated agent, so a hiring agent cannot mistake an outage for a verdict.
//
// Mainnet writes spend authority SOL, so they are opt-in: set
// SOLANA_8004_REGISTER_MAINNET=1. Devnet writes are always allowed.

import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { sql } from './db.js';
import { env } from './env.js';
import { solanaRpcEndpoints } from './solana/connection.js';

export const TIER_NAMES = ['Unrated', 'Bronze', 'Silver', 'Gold', 'Platinum'];

/** Rough rent + fee for one registration (agent account + core asset + ATOM stats). */
export const EST_REGISTER_8004_LAMPORTS = 12_000_000;

/** A cached standing older than this is re-read from chain by the refresh job. */
export const STANDING_TTL_MS = 6 * 60 * 60 * 1000;

/** The funded platform authority secret (same key that mints and registers Core assets). */
function authoritySecret() {
	return process.env.SOLANA_AGENT_COLLECTION_AUTHORITY_KEY || process.env.LAUNCH_FUNDER_SECRET || null;
}

const READ_TIMEOUT_MS = 8_000;

let _sdkModule = null;
async function sdkModule() {
	if (!_sdkModule) _sdkModule = await import('8004-solana');
	return _sdkModule;
}

/** 8004 SDK cluster name for one of our network names. */
export function clusterFor(network) {
	return network === 'devnet' ? 'devnet' : 'mainnet-beta';
}

/** Program ids for the registry on this network (primary source: the published SDK). */
export async function registryProgramIds(network) {
	const { getProgramIds } = await sdkModule();
	const ids = getProgramIds(clusterFor(network));
	return {
		registry: ids.agentRegistry.toBase58(),
		atomEngine: ids.atomEngine.toBase58(),
		mplCore: ids.mplCore.toBase58(),
	};
}

/** Whether this process may sign a registration on `network`. */
export function registrationEnabled(network, e = process.env) {
	if (network === 'devnet') return true;
	return e.SOLANA_8004_REGISTER_MAINNET === '1';
}

/** Where an agent's registry block lives inside `meta` for a network. */
export function registryBlockOf(meta, network) {
	const m = meta || {};
	return (network === 'devnet' ? m.devnet?.registry_8004 : m.registry_8004) || null;
}

/** The registry block for whichever network the agent is registered on (mainnet wins). */
export function anyRegistryBlock(meta) {
	const main = registryBlockOf(meta, 'mainnet');
	if (main?.asset) return { ...main, network: 'mainnet' };
	const dev = registryBlockOf(meta, 'devnet');
	if (dev?.asset) return { ...dev, network: 'devnet' };
	return null;
}

/** Numeric rank of a tier name, for ordering. Unknown and missing rank 0. */
export function tierRank(name) {
	const i = TIER_NAMES.indexOf(name);
	return i < 0 ? 0 : i;
}

function rpcUrlFor(network) {
	return solanaRpcEndpoints(network === 'devnet' ? 'devnet' : 'mainnet')[0] || undefined;
}

/** Build an SDK instance. Read-only unless a keypair is given. */
export async function build8004Sdk(network, { signer = null, rpcUrl = null } = {}) {
	const { SolanaSDK } = await sdkModule();
	return new SolanaSDK({
		cluster: clusterFor(network),
		rpcUrl: rpcUrl || rpcUrlFor(network),
		...(signer ? { signer } : {}),
		// Standing must reflect chain state, not a third-party indexer's lag.
		useIndexer: false,
		forceOnChain: true,
	});
}

function withTimeout(promise, ms, label) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Read one registry asset's standing from chain.
 *
 * @returns {Promise<{
 *   registered: boolean, unavailable?: boolean, error?: string,
 *   asset: string, network: string,
 *   tier?: string, tier_rank?: number,
 *   average_score?: number|null, total_feedbacks?: number,
 *   quality_score?: number|null, confidence?: number|null, risk_score?: number|null,
 *   unique_clients?: number|null, checked_at: string
 * }>}
 */
export async function read8004Standing(asset, network, { sdk = null } = {}) {
	const checked_at = new Date().toISOString();
	const base = { asset, network, checked_at };
	try {
		const { PublicKey } = await import('@solana/web3.js');
		const s = sdk || (await build8004Sdk(network));
		const pk = new PublicKey(asset);
		const account = await withTimeout(s.loadAgent(pk), READ_TIMEOUT_MS, 'loadAgent');
		if (!account) return { ...base, registered: false };

		const [tier, summary, enriched] = await Promise.all([
			withTimeout(s.getTrustTier(pk), READ_TIMEOUT_MS, 'getTrustTier').catch(() => 0),
			withTimeout(s.getSummary(pk), READ_TIMEOUT_MS, 'getSummary').catch(() => null),
			withTimeout(s.getEnrichedSummary(pk), READ_TIMEOUT_MS, 'getEnrichedSummary').catch(() => null),
		]);
		const rank = Number(tier) || 0;
		const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
		return {
			...base,
			registered: true,
			tier: TIER_NAMES[rank] || 'Unrated',
			tier_rank: rank,
			average_score: num(summary?.averageScore),
			total_feedbacks: Number(summary?.totalFeedbacks ?? enriched?.totalFeedbacks ?? 0),
			quality_score: num(enriched?.qualityScore),
			confidence: num(enriched?.confidence),
			risk_score: num(enriched?.riskScore),
			unique_clients: num(enriched?.uniqueCallers),
		};
	} catch (err) {
		return { ...base, registered: false, unavailable: true, error: String(err?.message || err).slice(0, 200) };
	}
}

/** Reduce a standing to the compact snapshot stored beside the registry address. */
export function standingSnapshot(standing) {
	if (!standing?.registered) return null;
	return {
		tier: standing.tier,
		tier_rank: standing.tier_rank,
		average_score: standing.average_score,
		total_feedbacks: standing.total_feedbacks,
		checked_at: standing.checked_at,
	};
}

async function writeBlock(agentId, network, block) {
	const json = JSON.stringify(block);
	if (network === 'devnet') {
		await sql`
			UPDATE agent_identities
			SET meta = jsonb_set(
				meta,
				'{devnet}',
				COALESCE(meta->'devnet', '{}'::jsonb) || jsonb_build_object('registry_8004', ${json}::jsonb)
			), updated_at = NOW()
			WHERE id = ${agentId}
		`;
	} else {
		await sql`
			UPDATE agent_identities
			SET meta = jsonb_set(meta, '{registry_8004}', ${json}::jsonb), updated_at = NOW()
			WHERE id = ${agentId}
		`;
	}
}

/**
 * Enrol an agent in the 8004 registry. Idempotent: an agent whose stored asset
 * still resolves on chain is returned as-is without a transaction.
 *
 * @param {object} p
 * @param {{id: string, name?: string, meta?: object}} p.agent
 * @param {'mainnet'|'devnet'} p.network
 * @param {Keypair} [p.keypair]  defaults to the platform authority
 * @param {object} [p.sdk]       injected for tests
 * @returns {Promise<{asset: string, signature: string|null, alreadyRegistered: boolean, registrationUri: string, block: object}>}
 */
export async function register8004Agent({ agent, network, keypair = null, sdk = null }) {
	if (!registrationEnabled(network)) {
		throw new Error('mainnet 8004 registration is off: set SOLANA_8004_REGISTER_MAINNET=1 to enable it');
	}
	const existing = registryBlockOf(agent.meta, network);
	const registrationUri = `${env.APP_ORIGIN}/api/agents/${agent.id}/registration`;

	let signer = keypair;
	if (!signer && !sdk) {
		const secret = authoritySecret();
		if (!secret) {
			throw new Error('Set SOLANA_AGENT_COLLECTION_AUTHORITY_KEY (or LAUNCH_FUNDER_SECRET) to the funded authority wallet secret.');
		}
		signer = Keypair.fromSecretKey(bs58.decode(secret));
	}
	const s = sdk || (await build8004Sdk(network, { signer }));

	if (existing?.asset) {
		const { PublicKey } = await import('@solana/web3.js');
		const live = await s.loadAgent(new PublicKey(existing.asset));
		if (live) {
			return { asset: existing.asset, signature: null, alreadyRegistered: true, registrationUri: existing.registration_uri || registrationUri, block: existing };
		}
	}

	const result = await s.registerAgent(registrationUri, { atomEnabled: true });
	if (!result?.asset) {
		throw new Error(`8004 registerAgent returned no asset${result?.error ? `: ${result.error}` : ''}`);
	}
	const asset = result.asset.toBase58();
	const signature = result.signature || result.signatures?.[0] || null;
	const { getProgramIds } = await sdkModule();
	const ids = getProgramIds(clusterFor(network));

	const block = {
		standard: '8004-solana',
		program: ids.agentRegistry.toBase58(),
		asset,
		registration_uri: registrationUri,
		authority: signer ? signer.publicKey.toBase58() : null,
		network,
		...(signature ? { tx_hash: signature } : {}),
		registered_at: new Date().toISOString(),
	};
	await writeBlock(agent.id, network, block);

	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (${agent.id}, ${'solana.register_8004'},
			${JSON.stringify({ asset, network, signature, program: block.program })}::jsonb,
			${'registry_8004'})
	`.catch(() => {});

	return { asset, signature, alreadyRegistered: false, registrationUri, block };
}

/**
 * Re-read one agent's standing and store the snapshot beside its registry block.
 * Returns the live standing. An unreachable RPC leaves the stored snapshot alone.
 */
export async function refresh8004Standing({ agent, network, sdk = null }) {
	const block = registryBlockOf(agent.meta, network);
	if (!block?.asset) return null;
	const standing = await read8004Standing(block.asset, network, { sdk });
	if (standing.unavailable) return standing;
	await writeBlock(agent.id, network, { ...block, standing: standingSnapshot(standing) });
	return standing;
}

/**
 * Agents minted on this network that have no 8004 registration yet, oldest first.
 * Only agents that already hold a Core asset qualify, mirroring the Metaplex
 * back-fill, so the registry is never populated with empty shells.
 */
export async function fetchUnregistered8004(network, limit) {
	return network === 'mainnet'
		? sql`
			SELECT id, user_id, name, description, meta FROM agent_identities
			WHERE deleted_at IS NULL
			  AND meta->>'sol_mint_address' IS NOT NULL
			  AND meta->'registry_8004'->>'asset' IS NULL
			ORDER BY created_at ASC LIMIT ${limit}`
		: sql`
			SELECT id, user_id, name, description, meta FROM agent_identities
			WHERE deleted_at IS NULL
			  AND meta->'devnet'->>'sol_mint_address' IS NOT NULL
			  AND meta->'devnet'->'registry_8004'->>'asset' IS NULL
			ORDER BY created_at ASC LIMIT ${limit}`;
}

/** Registered agents whose cached standing is missing or older than the TTL. */
export async function fetchStale8004(network, limit, ttlMs = STANDING_TTL_MS) {
	const cutoff = new Date(Date.now() - ttlMs).toISOString();
	return network === 'mainnet'
		? sql`
			SELECT id, name, meta FROM agent_identities
			WHERE deleted_at IS NULL
			  AND meta->'registry_8004'->>'asset' IS NOT NULL
			  AND COALESCE(meta->'registry_8004'->'standing'->>'checked_at', '') < ${cutoff}
			ORDER BY COALESCE(meta->'registry_8004'->'standing'->>'checked_at', '') ASC LIMIT ${limit}`
		: sql`
			SELECT id, name, meta FROM agent_identities
			WHERE deleted_at IS NULL
			  AND meta->'devnet'->'registry_8004'->>'asset' IS NOT NULL
			  AND COALESCE(meta->'devnet'->'registry_8004'->'standing'->>'checked_at', '') < ${cutoff}
			ORDER BY COALESCE(meta->'devnet'->'registry_8004'->'standing'->>'checked_at', '') ASC LIMIT ${limit}`;
}

/**
 * One back-fill pass: register up to `limit` unregistered agents, then refresh
 * stale standings. Sequential with a pause between registrations so the
 * authority wallet and the RPC are never hammered. Returns a per-agent log.
 */
export async function runBackfill8004({ network, limit = 5, pauseMs = 750, register = true, refresh = true, keypair = null, sdk = null, onEvent = null }) {
	const out = { network, registered: [], already: [], refreshed: [], errors: [] };
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	if (register && registrationEnabled(network)) {
		for (const agent of await fetchUnregistered8004(network, limit)) {
			try {
				const r = await register8004Agent({ agent, network, keypair, sdk });
				(r.alreadyRegistered ? out.already : out.registered).push({ agent_id: agent.id, asset: r.asset, signature: r.signature });
				onEvent?.('registered', { agent_id: agent.id, asset: r.asset, signature: r.signature });
			} catch (err) {
				out.errors.push({ agent_id: agent.id, error: err.message });
				onEvent?.('error', { agent_id: agent.id, error: err.message });
			}
			await sleep(pauseMs);
		}
	}
	if (refresh) {
		for (const agent of await fetchStale8004(network, limit * 4)) {
			const st = await refresh8004Standing({ agent, network, sdk }).catch(() => null);
			if (st && !st.unavailable) out.refreshed.push({ agent_id: agent.id, tier: st.tier });
		}
	}
	return out;
}

/**
 * The public, non-sensitive view of a stored registry block, with its cached
 * standing. This is what catalogs, agent cards and hire responses carry.
 * Returns null when the agent is not registered (so callers render nothing).
 */
export function publicRegistry8004(block, network = block?.network || 'mainnet') {
	if (!block?.asset) return null;
	const st = block.standing || null;
	const suffix = network === 'devnet' ? '?cluster=devnet' : '';
	return {
		asset: block.asset,
		program: block.program || null,
		network,
		tier: st?.tier || null,
		tier_rank: st ? tierRank(st.tier) : null,
		average_score: st?.average_score ?? null,
		total_feedbacks: st?.total_feedbacks ?? null,
		checked_at: st?.checked_at || null,
		explorer_url: `https://solscan.io/account/${block.asset}${suffix}`,
	};
}

/**
 * Replace a cached registry view with a live chain read. When the chain cannot be
 * reached the cached view is kept and flagged `stale`, so a hire is never decided
 * on a silently missing signal.
 */
export async function liveRegistry8004(view, { sdk = null } = {}) {
	if (!view?.asset) return view;
	const live = await read8004Standing(view.asset, view.network, { sdk });
	if (live.unavailable) return { ...view, stale: true };
	if (!live.registered) return { ...view, tier: null, tier_rank: null, average_score: null, total_feedbacks: null, checked_at: live.checked_at, registered: false };
	return {
		...view,
		registered: true,
		tier: live.tier,
		tier_rank: live.tier_rank,
		average_score: live.average_score,
		total_feedbacks: live.total_feedbacks,
		checked_at: live.checked_at,
		stale: false,
	};
}

/** Parse a caller-supplied minimum tier name (case-insensitive). Null when absent, throws on junk. */
export function parseMinTier(value) {
	if (value == null || value === '') return null;
	const i = TIER_NAMES.findIndex((n) => n.toLowerCase() === String(value).toLowerCase());
	if (i < 0) throw new RangeError(`minRegistryTier must be one of ${TIER_NAMES.join(', ')}`);
	return i;
}

/** True when a registry view meets a minimum tier rank. */
export function meetsMinTier(view, minRank) {
	if (minRank == null || minRank <= 0) return true;
	return (view?.tier_rank ?? 0) >= minRank;
}
