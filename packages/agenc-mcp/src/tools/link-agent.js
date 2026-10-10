// `link_agent` — resolve a three.ws identity to its canonical AgenC agent id
// and check whether that identity is registered on-chain. Read-only: it derives
// + looks up, it does not itself register or sign anything.
//
// Wraps POST /api/agenc/link. Give it any one of: an ERC-8004 agent id, an
// MPL-Core asset, or a three.ws handle. The bridge computes the deterministic
// AgenC agentId + PDA via the identity bridge, builds the metadata URI three.ws
// would publish, and reports whether that PDA already holds a registration.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'link_agent',
	title: 'Link a three.ws identity to its AgenC agent id',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Resolve a three.ws identity to its canonical AgenC agent id and check whether it is registered on-chain. Provide ONE of: `erc8004AgentId` (an ERC-8004 numeric/hex id), `mplCoreAsset` (a base58 MPL-Core asset address), or `handle` (a three.ws handle). The identity bridge returns the deterministic `agenCAgentId` (hex), its on-chain `agentPda`, the `source`/`label` the id was derived from, the `metadataUri` three.ws would publish for it, and `registered:true|false`. When already registered, the live registry `agent` snapshot (authority, status, endpoint, reputation, active tasks, stake) is included. This derives identity and reads chain state; it does NOT register, stake, or sign; registration itself is an authenticated on-chain action performed elsewhere. Read-only; registration state is live, so results are not idempotent. Free, no key required. Use this when you know a three.ws handle, ERC-8004 id, or MPL-Core asset and need the matching AgenC id; if you already have the AgenC id or PDA call get_agent instead.',
	inputSchema: {
		erc8004AgentId: z
			.union([z.string(), z.number()])
			.optional()
			.describe('ERC-8004 agent id (numeric or hex). Provide exactly one identity input.'),
		mplCoreAsset: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('Base58 MPL-Core asset address backing the agent identity.'),
		handle: z
			.string()
			.min(1)
			.optional()
			.describe('three.ws handle to resolve to an AgenC agent id.'),
		baseUrl: z
			.string()
			.url()
			.optional()
			.describe('Base URL used to build the published metadata URI (default https://three.ws).'),
		cluster: z
			.enum(['mainnet', 'devnet'])
			.default('mainnet')
			.describe('Solana cluster to check registration on (default mainnet).'),
	},
	async handler(args) {
		const erc8004AgentId = args?.erc8004AgentId ?? null;
		const mplCoreAsset = args?.mplCoreAsset ? String(args.mplCoreAsset).trim() : null;
		const handle = args?.handle ? String(args.handle).trim() : null;
		if (erc8004AgentId === null && !mplCoreAsset && !handle) {
			throw Object.assign(
				new Error('provide one identity input: erc8004AgentId, mplCoreAsset, or handle'),
				{ code: 'validation_error' },
			);
		}
		const cluster = args?.cluster === 'devnet' ? 'devnet' : 'mainnet';
		const body = { erc8004AgentId, mplCoreAsset, handle, cluster };
		if (args?.baseUrl) body.baseUrl = String(args.baseUrl).trim();

		const data = await apiRequest('/api/agenc/link', { method: 'POST', body });
		return {
			ok: true,
			cluster: data?.cluster ?? cluster,
			programId: data?.programId ?? null,
			source: data?.source ?? null,
			label: data?.label ?? null,
			agenCAgentId: data?.agenCAgentId ?? null,
			agentPda: data?.agentPda ?? null,
			metadataUri: data?.metadataUri ?? null,
			registered: data?.registered ?? false,
			agent: data?.agent ?? null,
			fetchedAt: data?.fetchedAt ?? null,
		};
	},
};
