import { sql } from '../../_lib/db.js';
import { limits } from '../../_lib/rate-limit.js';
import { runAgentDelegation, AgentNotFoundError } from '../../_lib/agent-delegate.js';
import { checkIdentityIntegrity } from '../../_lib/identity-integrity.js';
import { agentHomeUrl } from '../../_lib/three-brand.js';
import { getAgentCollection } from '../../_lib/solana-collection.js';
import {
	authoritySecret,
	buildAuthorityUmi,
	loadCollectionAsset,
	deployAgentOnce,
	registerAgentOnce,
	explorerUrl,
} from '../../_lib/onchain-deploy.js';
import { buildRegistrationJSON } from '../../../src/erc8004/registration-json.js';
import { REGISTRY_DEPLOYMENTS } from '../../../src/erc8004/abi.js';
import { isUuid } from '../../_lib/validate.js';
import { logAudit } from '../../_lib/audit.js';

// Base mainnet — the EVM chain we expose for ERC-8004 self-registration.
const BASE_CHAIN_ID = 8453;

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

// A tool result that carries both human-readable text and the structured
// payload. `isError` marks designed *error* states (sign-in required, unknown
// agent, unconfigured registry) — distinct from designed *non-error* states
// (registered, already_registered, needs_wallet_signature) which return ok.
function toolResult(structured, { isError = false } = {}) {
	return {
		content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
		structuredContent: structured,
		...(isError ? { isError: true } : {}),
	};
}

function designedError(status, message, extra = {}) {
	return toolResult({ status, error: status, message, ...extra }, { isError: true });
}

// Resolve which Solana network to register on. An explicit `network` wins;
// otherwise follow where the agent already lives on-chain; otherwise prefer the
// network that has a configured collection. Keeps register/read paths aligned.
function resolveSolanaNetwork(meta, requested) {
	if (requested === 'mainnet' || requested === 'devnet') return requested;
	if (meta?.sol_mint_address) return 'mainnet';
	if (meta?.devnet?.sol_mint_address) return 'devnet';
	if (getAgentCollection('mainnet')) return 'mainnet';
	if (getAgentCollection('devnet')) return 'devnet';
	return 'mainnet';
}

// Build the prepared ERC-8004 "continue in browser" payload for the EVM path.
// The Base register() call needs the user's own wallet to sign, so we never
// fabricate a tx — we return the exact registration JSON plus a deep link to
// the web deploy flow with everything pre-filled.
function prepareBaseRegistration(agent) {
	const deployment = REGISTRY_DEPLOYMENTS[BASE_CHAIN_ID];
	const registrationJson = buildRegistrationJSON({
		name: agent.name,
		description: agent.description || '',
		// agentId is assigned on-chain by register() — unknown until the user signs.
		agentId: null,
		chainId: BASE_CHAIN_ID,
		registryAddr: deployment.identityRegistry,
		x402Support: true,
	});
	return toolResult({
		status: 'needs_wallet_signature',
		chain: 'base',
		chain_id: BASE_CHAIN_ID,
		agent_id: agent.id,
		identity_registry: deployment.identityRegistry,
		registration_json: registrationJson,
		continue_url: `${agentHomeUrl(agent.id)}?deploy=base`,
		message:
			'ERC-8004 registration on Base requires your browser wallet to sign the ' +
			'on-chain register() call — headless agents cannot do this. Open continue_url ' +
			'to finish in three.ws with the registration metadata pre-filled.',
	});
}

// Server-custodial Solana registration: mint the Core asset if needed, then
// enrol it in the Metaplex Agent Registry. The collection authority signs and
// pays — the agent's owner wallet never signs — so this runs headless.
async function registerOnSolana({ agent, network, force }) {
	const secret = authoritySecret();
	if (!secret) {
		return designedError(
			'registration_not_configured',
			'On-chain agent registration is not configured on this deployment. Set ' +
				'SOLANA_AGENT_COLLECTION_AUTHORITY_KEY (the funded collection authority) to ' +
				'enable server-custodial Solana registration.',
			{ chain: 'solana', network },
		);
	}

	let umi, authoritySigner;
	try {
		({ umi, authoritySigner } = buildAuthorityUmi(network, secret));
	} catch (e) {
		return designedError('registration_not_configured', e.message, { chain: 'solana', network });
	}

	const meta = agent.meta || {};
	const net = network === 'mainnet' ? meta : meta.devnet || {};
	const existing = net.agent_registry;

	// Idempotent: already enrolled and not forcing → return the existing identity,
	// never a second mint.
	if (existing?.identity_pda && !force) {
		return toolResult({
			status: 'already_registered',
			chain: 'solana',
			network,
			agent_id: agent.id,
			agent_pda: existing.identity_pda,
			asset: existing.asset || net.sol_mint_address || null,
			registration_uri: existing.registration_uri || null,
			tx_hash: existing.tx_hash || null,
			explorer_url: explorerUrl(existing.identity_pda, network),
		});
	}

	const collectionAddr = getAgentCollection(network);
	let registry;

	if (!net.sol_mint_address) {
		// No Core asset on this network yet — mint it (deployAgentOnce mints AND
		// enrols in the registry as its final step).
		const collectionAsset = await loadCollectionAsset(umi, collectionAddr);
		const out = await deployAgentOnce({
			umi,
			authoritySigner,
			collectionAddr,
			collectionAsset,
			agent,
			network,
		});
		registry = out.registry;
		if (!registry) {
			// The asset minted but the registry step failed mid-flow — report it
			// honestly; a retry of register_agent finishes the enrolment.
			return designedError(
				'registration_incomplete',
				'The on-chain asset was minted but Agent Registry enrolment did not complete. ' +
					'Retry register_agent to finish enrolling the existing asset.',
				{ chain: 'solana', network, agent_id: agent.id, asset: out.asset },
			);
		}
	} else {
		// Asset already minted — enrol (or re-confirm) it. registerAgentOnce is
		// idempotent on-chain: an existing PDA short-circuits without a new tx.
		registry = await registerAgentOnce({
			umi,
			authoritySigner,
			agent,
			asset: net.sol_mint_address,
			collectionAddr,
			network,
		});
	}

	return toolResult({
		status: 'registered',
		chain: 'solana',
		network,
		agent_id: agent.id,
		agent_pda: registry.identityPda,
		asset: registry.asset,
		registration_uri: registry.registrationUri,
		tx_hash: registry.signature || null,
		already_registered: registry.alreadyRegistered,
		explorer_url: explorerUrl(registry.identityPda, network),
		asset_explorer_url: explorerUrl(registry.asset, network),
	});
}

export const toolDefs = [
	{
		name: 'create_agent',
		title: 'Create an agent',
		// Inserts a new agent (with its custodial wallets) on every call: a
		// reversible write, not a spend. Deleting the agent undoes it.
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		},
		description:
			'Create a new three.ws agent on your account: a named identity with a persona, a brain model, a custodial Solana wallet and a public page. Returns the agent id, its Solana address and its page URL. Read three://models (or read_resource uri "three://models") for the model ids. Creating an agent moves no funds; fund the wallet separately.',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', minLength: 1, maxLength: 100, description: 'Display name.' },
				persona: {
					type: 'string',
					maxLength: 8000,
					description: 'Who the agent is and how it speaks. Becomes its system persona.',
				},
				description: { type: 'string', maxLength: 500, description: 'One-line public description.' },
				model: {
					type: 'string',
					maxLength: 80,
					description: 'Brain model id from three://models agent_models (for example claude-sonnet-5). Omit for the free platform default.',
				},
				avatar_id: { type: 'string', format: 'uuid', description: 'An avatar you own to use as the body.' },
			},
			required: ['name'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) {
				return toolResult(
					{ error: 'sign_in_required', message: 'Sign in with three.ws OAuth or an API key to create an agent.' },
					{ isError: true },
				);
			}
			const rl = await limits.agentCreateIp(`user:${auth.userId}`);
			if (!rl.success)
				throw rpcError(-32000, 'rate_limited', {
					retry_after: Math.ceil((rl.reset - Date.now()) / 1000),
				});

			const meta = {};
			if (args.model) {
				const { getAvailableProviders, canonicalProviderKey } = await import('../../brain/chat.js');
				const key = canonicalProviderKey(args.model.trim());
				const known = getAvailableProviders().find((p) => p.key === key);
				if (!known) {
					return toolResult(
						{
							error: 'unknown_model',
							message: `Unknown model "${args.model}". Read three://models for the ids an agent brain accepts.`,
						},
						{ isError: true },
					);
				}
				meta.brain = { provider: key };
			}

			let avatarId = null;
			if (args.avatar_id) {
				const [av] = await sql`
					SELECT id FROM avatars
					 WHERE id = ${args.avatar_id} AND owner_id = ${auth.userId} AND deleted_at IS NULL
					 LIMIT 1
				`;
				if (!av) {
					return toolResult(
						{ error: 'avatar_not_found', message: 'No avatar with that id on your account. list_my_avatars shows yours.' },
						{ isError: true },
					);
				}
				avatarId = av.id;
			}

			const { createAgentIdentity } = await import('../../_lib/agent-create.js');
			const created = await createAgentIdentity({
				userId: auth.userId,
				name: args.name.trim().slice(0, 100),
				description: args.description || null,
				avatarId,
				meta,
				personaPrompt: args.persona || null,
			});
			if (created.blocked) {
				return toolResult(
					{ error: 'identity_conflict', message: created.blocked.message },
					{ isError: true },
				);
			}
			const agent = created.agent;
			return toolResult({
				agent_id: agent.id,
				name: agent.name,
				model: meta.brain?.provider || null,
				solana_address: agent.meta?.solana_address || null,
				page: agentHomeUrl(agent.id),
				resource: `three://agents/${agent.id}`,
				next: `Read three://agents/${agent.id}/wallet for the wallet, or attach_avatar_to_agent to give it a body.`,
			});
		},
	},
	{
		name: 'call_agent',
		title: 'Call agent',
		// Invokes another agent's LLM turn — not a pure read, never destructive.
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		description:
			'Send a message to another three.ws agent and get its response. Use this to delegate specialized tasks.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { type: 'string', description: "The agent's ID" },
				message: { type: 'string', description: 'The message to send' },
			},
			required: ['agent_id', 'message'],
			additionalProperties: false,
		},
		scope: 'avatars:read',
		async handler(args, auth) {
			// Same 10/min ceiling as the HTTP delegate endpoint, keyed to the caller.
			const rl = await limits.agentDelegate(auth.userId || auth.rateKey || 'anon');
			if (!rl.success)
				throw rpcError(-32000, 'rate_limited', {
					retry_after: Math.ceil((rl.reset - Date.now()) / 1000),
				});

			try {
				const out = await runAgentDelegation({
					toAgentId: args.agent_id,
					message: args.message,
				});
				return {
					content: [{ type: 'text', text: out.response }],
					structuredContent: out,
				};
			} catch (err) {
				if (err instanceof AgentNotFoundError) throw new Error('target agent not found');
				throw err;
			}
		},
	},
	{
		name: 'register_agent',
		title: 'Register an agent on-chain',
		// Creates on-chain state (mint + registry enrolment). The handler
		// short-circuits an already-registered agent, but force:true re-runs,
		// so the conservative hint is non-idempotent.
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		description:
			"Mint one of your agents' on-chain digital identity. On Solana (chain:solana) " +
			'this enrols the agent in the Metaplex Agent Registry server-custodially — ' +
			'three.ws signs and pays, your wallet never has to — and returns the Agent ' +
			'Identity PDA, registration URI, and explorer link. On Base (chain:base) ' +
			'ERC-8004 registration needs your browser wallet to sign, so this returns a ' +
			'prepared registration_json plus a continue_url to finish in the browser. ' +
			'Idempotent: an already-registered agent is returned as-is unless force:true. ' +
			'Requires a signed-in three.ws account.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { type: 'string', format: 'uuid', description: 'Your agent identity id (uuid).' },
				chain: {
					type: 'string',
					enum: ['solana', 'base'],
					default: 'solana',
					description: 'Which chain to register on. solana = headless; base = ERC-8004 (needs your wallet).',
				},
				network: {
					type: 'string',
					enum: ['mainnet', 'devnet'],
					description: 'Solana cluster (chain:solana only). Defaults to where the agent already lives, else the configured collection network.',
				},
				force: {
					type: 'boolean',
					default: false,
					description: 'Re-run registration even if the agent is already registered (never double-mints).',
				},
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			// Account-scoped write: x402 pay-per-call principals have no user, so they
			// cannot register an agent. Surface a designed, actionable sign-in state.
			if (!auth.userId) {
				return designedError(
					'sign_in_required',
					'register_agent writes to your three.ws account and requires a signed-in ' +
						'user. Pay-per-call (x402) callers cannot register agents — authenticate ' +
						'with your three.ws account (OAuth) and retry.',
					{ chain: args.chain || 'solana' },
				);
			}

			const rl = await limits.agentRegister(auth.userId);
			if (!rl.success)
				throw rpcError(-32000, 'rate_limited', {
					retry_after: Math.ceil((rl.reset - Date.now()) / 1000),
				});

			if (!isUuid(args.agent_id || '')) {
				return designedError('validation_error', 'agent_id must be a valid uuid.', {});
			}

			const [agent] = await sql`
				SELECT ai.id, ai.user_id, ai.name, ai.description, ai.meta, ai.avatar_id,
				       av.thumbnail_key, av.storage_key
				FROM agent_identities ai
				LEFT JOIN avatars av ON av.id = ai.avatar_id AND av.deleted_at IS NULL
				WHERE ai.id = ${args.agent_id} AND ai.deleted_at IS NULL
				LIMIT 1
			`;
			if (!agent) {
				return designedError('not_found', 'No agent with that id.', { agent_id: args.agent_id });
			}
			if (agent.user_id !== auth.userId) {
				return designedError(
					'forbidden',
					'That agent belongs to another account — you can only register your own agents.',
					{ agent_id: args.agent_id },
				);
			}

			const chain = args.chain || 'solana';
			if (chain === 'base') return prepareBaseRegistration(agent);

			const network = resolveSolanaNetwork(agent.meta, args.network);
			return registerOnSolana({ agent, network, force: !!args.force });
		},
	},
	{
		name: 'attach_avatar_to_agent',
		title: 'Give an agent a body',
		// Sets one column on an owned row; re-running with the same avatar_id is a
		// no-op (idempotent), but it IS a write.
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
		description:
			'Attach a generated/rigged avatar (from forge_avatar, mesh_forge + rig_mesh, or any avatar you own) to ' +
			"one of your registered agent identities — giving the agent a persistent visual body tied to its " +
			'account identity. This is the bridge between generation and identity: generate a rigged GLB, save it ' +
			'as an avatar (list_my_avatars / the Forge \'Save\' action), then call this tool to make it the agent\'s ' +
			'body. The same agent_id always shows the same body afterwards (get_avatar / render_avatar / ' +
			'get_embed_code all resolve it). Chain register_agent next to mint the on-chain identity (ERC-8004 on ' +
			'Base, or a Metaplex Agent Registry PDA on Solana) and anchor_provenance to credential the GLB itself — ' +
			'together the agent has a body, an on-chain identity, and a verifiable authenticity record. Requires a ' +
			'signed-in three.ws account; both the agent and the avatar must belong to the caller.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { type: 'string', format: 'uuid', description: 'Your agent identity id (uuid).' },
				avatar_id: {
					type: 'string',
					format: 'uuid',
					description: 'The avatar to attach (uuid) — one of your own avatars (see list_my_avatars).',
				},
			},
			required: ['agent_id', 'avatar_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) {
				return designedError(
					'sign_in_required',
					'attach_avatar_to_agent writes to your three.ws account and requires a signed-in user. ' +
						'Pay-per-call (x402) callers cannot attach avatars — authenticate with your three.ws ' +
						'account (OAuth) and retry.',
					{},
				);
			}
			if (!isUuid(args.agent_id || '')) {
				return designedError('validation_error', 'agent_id must be a valid uuid.', {});
			}
			if (!isUuid(args.avatar_id || '')) {
				return designedError('validation_error', 'avatar_id must be a valid uuid.', {});
			}

			const [agent] = await sql`
				SELECT id, user_id, name, avatar_id
				FROM agent_identities
				WHERE id = ${args.agent_id} AND deleted_at IS NULL
				LIMIT 1
			`;
			if (!agent) {
				return designedError('not_found', 'No agent with that id.', { agent_id: args.agent_id });
			}
			if (agent.user_id !== auth.userId) {
				return designedError(
					'forbidden',
					'That agent belongs to another account — you can only give a body to your own agents.',
					{ agent_id: args.agent_id },
				);
			}

			const [avatar] = await sql`
				SELECT id, name, storage_key, visibility
				FROM avatars
				WHERE id = ${args.avatar_id} AND owner_id = ${auth.userId} AND deleted_at IS NULL
				LIMIT 1
			`;
			if (!avatar) {
				return designedError(
					'not_found',
					'No avatar with that id in your account. Generate one (forge_avatar / mesh_forge + rig_mesh) ' +
						'and save it first, or pick one from list_my_avatars.',
					{ avatar_id: args.avatar_id },
				);
			}

			const [updated] = await sql`
				UPDATE agent_identities
				SET avatar_id = ${avatar.id}, updated_at = now()
				WHERE id = ${agent.id}
				RETURNING id, name, avatar_id, wallet_address, meta
			`;

			logAudit({
				userId: auth.userId,
				action: 'attach_avatar_to_agent',
				resourceId: agent.id,
				meta: { via: 'mcp', avatar_id: avatar.id, previous_avatar_id: agent.avatar_id || null },
			});

			const onchain = Boolean(updated.meta?.agent_registry || updated.meta?.devnet?.agent_registry);
			return toolResult({
				status: 'attached',
				agent_id: updated.id,
				agent_name: updated.name,
				avatar_id: updated.avatar_id,
				avatar_name: avatar.name,
				replaced_avatar_id: agent.avatar_id !== avatar.id ? agent.avatar_id || null : null,
				profile_url: agentHomeUrl(updated.id),
				already_onchain: onchain,
				next_steps: onchain
					? ['anchor_provenance(glb_url) to credential this body\'s authenticity']
					: [
							'register_agent(agent_id) to mint the on-chain identity',
							'anchor_provenance(glb_url) to credential this body\'s authenticity',
						],
			});
		},
	},
	{
		name: 'identity_check',
		title: 'Screen an agent identity for impersonation',
		// Pure screening read; verdicts come from live models, so not idempotent.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		description:
			'Screen an agent identity (an existing agent_id, or a proposed name + description) ' +
			'for impersonation and policy violations before it goes public. Uses IBM Granite ' +
			'embeddings to find look-alike agents a name match would miss, and Granite Guardian ' +
			'to screen the identity text. Returns a clear | review | block verdict with the ' +
			'nearest neighbours and human-readable reasons.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { type: 'string', format: 'uuid', description: 'Screen one of your existing agents by id.' },
				name: { type: 'string', description: 'Proposed agent name (use with description instead of agent_id).' },
				description: { type: 'string', description: 'Proposed agent description.' },
				persona_tone_tags: {
					type: 'array',
					items: { type: 'string' },
					description: 'Optional persona/tone tags to include in the embedded identity.',
				},
			},
			additionalProperties: false,
		},
		scope: 'agents:read',
		async handler(args, auth) {
			const rl = await limits.identityCheckIp(auth.userId || auth.rateKey || 'anon');
			if (!rl.success)
				throw rpcError(-32000, 'rate_limited', {
					retry_after: Math.ceil((rl.reset - Date.now()) / 1000),
				});

			let name = typeof args.name === 'string' ? args.name.trim().slice(0, 100) : '';
			let description =
				typeof args.description === 'string' ? args.description.trim().slice(0, 500) : '';
			let tags = Array.isArray(args.persona_tone_tags)
				? args.persona_tone_tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
				: [];
			let excludeAgentId = null;

			// When an agent_id is given, screen that agent's stored identity. Ownership
			// isn't required to *read* a public identity, but we only resolve the row
			// for the caller (own or public) and exclude it from its own comparison.
			if (args.agent_id) {
				if (!isUuid(args.agent_id)) {
					return designedError('validation_error', 'agent_id must be a valid uuid.', {});
				}
				const [row] = await sql`
					SELECT id, name, description, persona_tone_tags, user_id, is_public
					FROM agent_identities
					WHERE id = ${args.agent_id} AND deleted_at IS NULL
					LIMIT 1
				`;
				if (!row) {
					return designedError('not_found', 'No agent with that id.', { agent_id: args.agent_id });
				}
				if (!row.is_public && row.user_id !== auth.userId) {
					return designedError(
						'forbidden',
						'That agent is private and belongs to another account.',
						{ agent_id: args.agent_id },
					);
				}
				name = row.name || '';
				description = row.description || '';
				tags = Array.isArray(row.persona_tone_tags) ? row.persona_tone_tags : [];
				excludeAgentId = row.id;
			}

			if (!name && !description) {
				return designedError(
					'validation_error',
					'Provide an agent_id, or a name and/or description to screen.',
					{},
				);
			}

			const result = await checkIdentityIntegrity(
				{ name, description, persona_tone_tags: tags },
				{ userId: auth.userId, excludeAgentId },
			);

			// Project the integrity report onto the task's contract shape while keeping
			// the full detail (uniqueness, guardian, model) alongside.
			const structured = {
				verdict: result.status, // clear | review | block | unavailable
				configured: result.configured,
				agent_id: excludeAgentId,
				similar_agents: (result.similar || []).map((s) => ({
					id: s.id,
					name: s.name,
					score: s.score,
					owned: s.owned,
					public: s.public,
				})),
				reasons: result.reasons || [],
				duplicate_of: result.duplicateOf || null,
				uniqueness: result.uniqueness,
				guardian: result.guardian,
				model: result.model,
			};
			return toolResult(structured);
		},
	},
];
