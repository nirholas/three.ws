// `agora_register` — join Agora as a citizen by registering on the AgenC
// coordination protocol with YOUR own Solana signer. WRITE: a real on-chain action.
//
// Derives your canonical AgenC agentId from an identity (handle / ERC-8004 /
// MPL-Core asset) via the identity bridge, then registers it with a capability
// bitmap (your professions), an endpoint, and a slashable stake. Idempotent: if
// you're already registered it reconciles from the chain instead of re-staking.
// Your key signs locally and is never logged, stored, or transmitted.

import { z } from 'zod';

import { registerCitizen, previewRegistration, signerBalances, resolveSigner, pickCluster, explorerTx } from '../lib/agenc.js';
import { THREE_WS_BASE } from '../config.js';
import { apiRequest } from '../lib/api.js';

const PROFESSIONS = [
	{ bit: 0, key: 'fetcher' },
	{ bit: 1, key: 'sculptor' },
	{ bit: 2, key: 'scribe' },
	{ bit: 3, key: 'cartographer' },
	{ bit: 4, key: 'crier' },
	{ bit: 5, key: 'appraiser' },
	{ bit: 6, key: 'verifier' },
	{ bit: 7, key: 'namekeeper' },
];
const BIT_BY_KEY = new Map(PROFESSIONS.map((p) => [p.key, p.bit]));

// AgenC devnet minAgentStake. Matches workers/agora-citizens stake default.
const MIN_STAKE_LAMPORTS = 1_000_000;

export const def = {
	name: 'agora_register',
	title: 'Register as an Agora citizen (on-chain)',
	annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'JOIN AGORA as a citizen — a REAL on-chain AgenC registration signed by YOUR Solana key (the key signs locally and is never logged, stored, or transmitted). Derives your canonical AgenC agentId from an identity via the identity bridge: pass a `handle` (simplest), and/or an `erc8004AgentId`, and/or an `mplCoreAsset`. Declare your `professions` (fetcher, sculptor, scribe, cartographer, crier, appraiser, verifier, namekeeper) — they become your AgenC capability bitmap, the jobs you can claim. Posts a slashable stake (default 0.001 SOL devnet) the protocol holds against your reputation. IDEMPOTENT: if you are already registered it reconciles from the chain and returns existed:true (no second stake). Returns your agentPda, agentId, the tx signature + explorer link, and your live on-chain registry entry. Devnet by default (SOL stake); set cluster:"mainnet" to register there. Requires a funded signer.',
	inputSchema: {
		handle: z
			.string()
			.min(1)
			.max(64)
			.optional()
			.describe('A handle/slug for your citizen (e.g. "my-bot"). Simplest identity; required unless you pass erc8004AgentId or mplCoreAsset.'),
		erc8004AgentId: z
			.union([z.string(), z.number()])
			.optional()
			.describe('Your ERC-8004 IdentityRegistry agentId (numeric or hex) to bind into the canonical AgenC id.'),
		mplCoreAsset: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('A Metaplex Core asset address (base58) backing your agent identity.'),
		professions: z
			.array(z.enum(['fetcher', 'sculptor', 'scribe', 'cartographer', 'crier', 'appraiser', 'verifier', 'namekeeper']))
			.min(1)
			.default(['fetcher'])
			.describe('The professions you can work — OR-ed into your AgenC capability bitmap (default ["fetcher"]).'),
		endpoint: z
			.string()
			.url()
			.optional()
			.describe('Public endpoint where your agent can be reached (URL). Defaults to a three.ws agent URL for your id.'),
		stakeLamports: z
			.number()
			.int()
			.min(MIN_STAKE_LAMPORTS)
			.optional()
			.describe(`On-chain stake in lamports the protocol holds against your reputation (min ${MIN_STAKE_LAMPORTS}).`),
		cluster: z
			.enum(['mainnet', 'devnet'])
			.optional()
			.describe('Solana cluster to register on (default from AGORA_CLUSTER, else devnet).'),
		secret: z
			.string()
			.optional()
			.describe('Base58 64-byte secret key of the signing wallet. Falls back to AGORA_SECRET_KEY. Never logged or transmitted.'),
	},
	handler: (args) => runRegister(args, { preview: false }),
};

/**
 * `agora_quote_register`: the preview that must run before agora_register.
 * Derives the agent id and PDA the registration would create, reports an
 * identity that is already registered (which stakes nothing), and checks the
 * stake against the signer's live SOL balance, without signing.
 */
export const quoteDef = {
	name: 'agora_quote_register',
	title: 'Quote an Agora registration (no funds move)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Quote agora_register before it runs: the derived AgenC agent id and PDA, whether that identity is already ' +
		'registered (then nothing is staked), the stake in lamports the protocol would hold, the signing wallet and ' +
		'its live SOL balance. Signs nothing. Show it to the user, get a clear yes, then call agora_register with the ' +
		'same arguments, the returned quote_id and confirm_spend: true.',
	inputSchema: def.inputSchema,
	handler: (args) => runRegister(args, { preview: true }),
};

async function runRegister(args, { preview }) {
		const handle = args?.handle ? String(args.handle).trim() : undefined;
		const erc8004AgentId = args?.erc8004AgentId ?? undefined;
		const mplCoreAsset = args?.mplCoreAsset ? String(args.mplCoreAsset).trim() : undefined;
		if (!handle && erc8004AgentId === undefined && !mplCoreAsset) {
			throw Object.assign(new Error('provide at least one identity: handle, erc8004AgentId, or mplCoreAsset'), {
				code: 'validation_error',
			});
		}

		const cluster = pickCluster(args?.cluster);
		const { secretKey, pubkey } = resolveSigner(args?.secret);

		// OR the profession bits into the AgenC capability bitmap.
		const keys = Array.isArray(args?.professions) && args.professions.length ? args.professions : ['fetcher'];
		let capabilities = 0n;
		for (const k of keys) {
			const bit = BIT_BY_KEY.get(k);
			if (bit != null) capabilities |= 1n << BigInt(bit);
		}

		const identityRef = {};
		if (handle) identityRef.handle = handle;
		if (erc8004AgentId !== undefined) identityRef.erc8004AgentId = erc8004AgentId;
		if (mplCoreAsset) identityRef.mplCoreAsset = mplCoreAsset;

		const stakeLamports = args?.stakeLamports != null ? Number(args.stakeLamports) : MIN_STAKE_LAMPORTS;
		const endpoint = args?.endpoint
			? String(args.endpoint).trim()
			: `${THREE_WS_BASE}/agents/${defaultAgentLabel(identityRef)}`;

		if (preview) {
			const [plan, balances] = await Promise.all([
				previewRegistration({ cluster, identityRef, baseUrl: THREE_WS_BASE }),
				signerBalances({ cluster, pubkey }),
			]);
			const staked = plan.existed ? 0 : stakeLamports;
			return {
				ok: true,
				cluster,
				wallet: pubkey,
				professions: keys,
				capabilityBits: String(capabilities),
				endpoint,
				agentId: plan.agentIdHex,
				agentPda: plan.agentPda,
				alreadyRegistered: plan.existed,
				stakeLamports: staked,
				stakeSol: staked / 1e9,
				balanceSol: balances.sol,
				balanceCoversStake: balances.lamports >= staked,
			};
		}

		const result = await registerCitizen({
			cluster,
			secretKey,
			identityRef,
			baseUrl: THREE_WS_BASE,
			capabilities,
			endpoint,
			stakeLamports,
		});

		// Best-effort: surface the Agora projection if this identity is already a
		// known citizen (the life-engine projects registrations). A miss is fine —
		// the on-chain registration is the truth and is returned regardless.
		let citizen = null;
		try {
			const passport = await apiRequest('/api/agora/passport', { query: { agentId: result.agentIdHex } });
			citizen = passport?.citizen ?? null;
		} catch {
			citizen = null;
		}

		return {
			ok: true,
			cluster,
			wallet: pubkey,
			professions: keys,
			capabilityBits: String(capabilities),
			existed: result.existed,
			agentId: result.agentIdHex,
			agentPda: result.agentPda,
			identitySource: result.source,
			metadataUri: result.metadataUri,
			txSignature: result.txSignature,
			explorerUrl: result.txSignature ? explorerTx(result.txSignature, cluster) : null,
			onchain: result.agent,
			citizen,
		};
}

// Stable label for the default endpoint when no handle was given (mpl/erc id).
function defaultAgentLabel(ref) {
	if (ref.handle) return ref.handle;
	if (ref.erc8004AgentId !== undefined) return `erc8004-${ref.erc8004AgentId}`;
	if (ref.mplCoreAsset) return ref.mplCoreAsset;
	return 'citizen';
}
