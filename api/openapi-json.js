// GET /openapi.json — x402 OpenAPI discovery document
// Preferred over /.well-known/x402 by x402scan and pay-skills.

import { env } from './_lib/env.js';
import { cors, json, method, wrap } from './_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const origin = env.APP_ORIGIN;

	return json(
		res,
		200,
		{
			openapi: '3.1.0',
			info: {
				title: 'three.ws API',
				version: '1.0.0',
				description:
					'Agent-first 3D and Solana identity platform. Nine paid REST endpoints (x402 v2, CDP Bazaar) ' +
					'plus a paid MCP endpoint covering 12 tools. All paid REST endpoints accept USDC on Base (eip155:8453) ' +
					'and Arbitrum One (eip155:42161) via CDP facilitator. Platform covers: 3D avatar management, ' +
					'AI agent identity and reputation, Solana on-chain attestations, Pump.fun token intelligence, ' +
					'glTF/GLB model validation and optimization, Solana vanity address grinding, and AI revenue analysis.',
				'x-guidance':
					'Paid REST endpoints (x402, USDC on Base/Arbitrum): ' +
					'GET /api/x402/model-check ($0.001), GET /api/x402/mint-to-mesh ($0.01), ' +
					'POST /api/x402/solana-vanity-grind ($0.05), GET /api/x402/solana-agent-passport ($0.001), ' +
					'GET /api/x402/pumpfun-token-intel ($0.005), GET /api/x402/pumpfun-creator-intel ($0.005), ' +
					'POST /api/x402/solana-tx-explain ($0.002), GET /api/insights/revenue-vision ($0.001). ' +
					'MCP endpoint (POST /api/mcp, $0.001/call): 12 tools across avatar, model, Solana, and Pump.fun groups. ' +
					'MCP auth: Bearer token from OAuth 2.1 at ' + origin + '/oauth/authorize or API key.',
			},
			servers: [{ url: origin }],
			components: {
				securitySchemes: {
					siwx: {
						type: 'apiKey',
						in: 'header',
						name: 'Authorization',
						description: 'Bearer token from OAuth 2.1 or API key from the three.ws dashboard.',
					},
				},
			},
			paths: {

				// ── MCP ──────────────────────────────────────────────────────────
				'/api/mcp': {
					get: {
						operationId: 'mcp_discover',
						summary: 'MCP server discovery',
						description: 'Returns MCP server capabilities, supported protocol versions, and the list of available tools.',
						security: [],
						responses: {
							200: { description: 'MCP server capabilities and tool list' },
						},
					},
					post: {
						operationId: 'mcp_call',
						summary: 'MCP tool call',
						description:
							'JSON-RPC 2.0 Streamable HTTP endpoint. Supports 12 tools: ' +
							'avatar management (list_my_avatars, get_avatar, search_public_avatars, render_avatar, delete_avatar), ' +
							'model operations (validate_model, inspect_model, optimize_model), ' +
							'Solana agent identity (solana_agent_passport, solana_agent_reputation, solana_agent_attestations), ' +
							'Pump.fun intelligence (pumpfun_token_intel, pumpfun_creator_intel, pumpfun_recent_claims, pumpfun_recent_graduations). ' +
							'Solana and Pump.fun tools are public; avatar/model tools require auth.',
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['jsonrpc', 'method'],
										properties: {
											jsonrpc: { type: 'string', enum: ['2.0'] },
											id: { oneOf: [{ type: 'string' }, { type: 'number' }] },
											method: { type: 'string', description: 'MCP method, e.g. "tools/call".' },
											params: { type: 'object' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'JSON-RPC 2.0 response' },
							401: { description: 'Unauthorized' },
							402: { description: 'Payment Required — $0.001 Solana USDC via x402 or MPP' },
							429: { description: 'Rate limited' },
						},
						'x-payment-info': {
							price: { mode: 'fixed', currency: 'USD', amount: '0.001' },
							protocols: [{ x402: {} }, { mpp: { method: 'solana-pay', intent: 'purchase', currency: 'USDC' } }],
						},
					},
					delete: {
						operationId: 'mcp_session_close',
						summary: 'Close MCP session',
						description: 'Terminates a persistent MCP session and releases server-side resources.',
						security: [{ siwx: [] }],
						responses: {
							204: { description: 'Session closed' },
							401: { description: 'Unauthorized' },
						},
					},
				},

				// ── AVATARS ───────────────────────────────────────────────────────
				'/api/avatars': {
					get: {
						operationId: 'list_avatars',
						summary: 'List my avatars',
						description: 'Returns all avatars owned by the authenticated wallet.',
						security: [{ siwx: [] }],
						responses: {
							200: { description: 'Array of avatar objects' },
							401: { description: 'Unauthorized' },
						},
					},
					post: {
						operationId: 'create_avatar',
						summary: 'Register an uploaded avatar',
						description: 'Register a glTF/GLB file that was uploaded to storage via the presign endpoint.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['storage_key', 'name', 'content_type'],
										properties: {
											storage_key: { type: 'string' },
											name: { type: 'string', maxLength: 100 },
											description: { type: 'string', maxLength: 500 },
											content_type: { type: 'string', enum: ['model/gltf-binary', 'model/gltf+json'] },
											visibility: { type: 'string', enum: ['private', 'unlisted', 'public'] },
											tags: { type: 'array', items: { type: 'string' } },
										},
									},
								},
							},
						},
						responses: {
							201: { description: 'Avatar created' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/avatars/public': {
					get: {
						operationId: 'browse_public_avatars',
						summary: 'Browse public avatars',
						description: 'Keyword-searchable public avatar browse. Free, no auth required.',
						security: [],
						parameters: [
							{ name: 'q', in: 'query', schema: { type: 'string' } },
							{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
							{ name: 'cursor', in: 'query', schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Paginated list of public avatars' },
						},
					},
				},
				'/api/avatars/presign': {
					post: {
						operationId: 'avatar_presign',
						summary: 'Get presigned upload URL',
						description: 'Returns a short-lived presigned URL for direct-to-storage glTF/GLB upload.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['filename', 'content_type'],
										properties: {
											filename: { type: 'string' },
											content_type: { type: 'string', enum: ['model/gltf-binary', 'model/gltf+json'] },
											size_bytes: { type: 'integer', maximum: 16777216 },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Presigned URL and storage key' },
							401: { description: 'Unauthorized' },
							413: { description: 'File too large — max 16 MiB' },
						},
					},
				},
				'/api/avatars/thumbnail': {
					get: {
						operationId: 'avatar_thumbnail',
						summary: 'Render avatar thumbnail',
						description: 'Generate a 512×512 PNG thumbnail for a public avatar. Edge-cached.',
						security: [],
						parameters: [
							{ name: 'id', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'size', in: 'query', schema: { type: 'integer', default: 512 } },
						],
						responses: {
							200: { description: 'PNG image' },
							404: { description: 'Avatar not found' },
						},
					},
				},
				'/api/avatars/{id}': {
					get: {
						operationId: 'get_avatar',
						summary: 'Get avatar by ID',
						description: 'Returns avatar metadata and signed download URL.',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Avatar object with download URL' },
							401: { description: 'Unauthorized' },
							404: { description: 'Avatar not found' },
						},
					},
					patch: {
						operationId: 'update_avatar',
						summary: 'Update avatar metadata',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: {
											name: { type: 'string', maxLength: 100 },
											description: { type: 'string', maxLength: 500 },
											visibility: { type: 'string', enum: ['private', 'unlisted', 'public'] },
											tags: { type: 'array', items: { type: 'string' } },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Updated avatar' },
							401: { description: 'Unauthorized' },
							404: { description: 'Not found' },
						},
					},
					delete: {
						operationId: 'delete_avatar',
						summary: 'Delete avatar',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							204: { description: 'Deleted' },
							401: { description: 'Unauthorized' },
							404: { description: 'Not found' },
						},
					},
				},

				// ── AGENTS ────────────────────────────────────────────────────────
				'/api/agents': {
					get: {
						operationId: 'list_agents',
						summary: 'List my agents',
						security: [{ siwx: [] }],
						responses: {
							200: { description: 'Array of agent identity objects' },
							401: { description: 'Unauthorized' },
						},
					},
					post: {
						operationId: 'create_agent',
						summary: 'Create agent',
						description: 'Register a new AI agent identity linked to the authenticated wallet.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['name'],
										properties: {
											name: { type: 'string', maxLength: 50 },
											description: { type: 'string', maxLength: 500 },
											avatar_id: { type: 'string' },
											visibility: { type: 'string', enum: ['private', 'public'] },
										},
									},
								},
							},
						},
						responses: {
							201: { description: 'Agent created' },
							401: { description: 'Unauthorized' },
							409: { description: 'Name already taken' },
						},
					},
				},
				'/api/agents/by-wallet': {
					get: {
						operationId: 'get_agent_by_wallet',
						summary: 'Lookup agent by Solana wallet',
						description: 'Returns the agent associated with a given Solana wallet pubkey.',
						security: [],
						parameters: [
							{ name: 'wallet', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: 'Agent record' },
							404: { description: 'No agent for that wallet' },
						},
					},
				},
				'/api/agents/check-name': {
					get: {
						operationId: 'check_agent_name',
						summary: 'Check agent name availability',
						security: [],
						parameters: [
							{ name: 'name', in: 'query', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: '{ available: boolean }' },
						},
					},
				},
				'/api/agents/suggest': {
					get: {
						operationId: 'suggest_agent_names',
						summary: 'Suggest available agent names',
						description: 'Returns up to 5 unique name suggestions based on a seed word.',
						security: [],
						parameters: [
							{ name: 'seed', in: 'query', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Array of name suggestions' },
						},
					},
				},
				'/api/agents/solana-attestations': {
					get: {
						operationId: 'list_solana_attestations',
						summary: 'List on-chain agent attestations',
						description: 'Returns recent on-chain attestations for all agents owned by the authenticated wallet.',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
							{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
						],
						responses: {
							200: { description: 'Array of attestation objects' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/agents/solana-reputation': {
					get: {
						operationId: 'get_solana_reputation_summary',
						summary: 'Aggregated Solana reputation',
						description: 'Aggregated reputation scores (feedback counts, averages, verified vs disputed) across all agents owned by the wallet.',
						security: [{ siwx: [] }],
						responses: {
							200: { description: 'Reputation summary' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/agents/tokens/launch-prep': {
					post: {
						operationId: 'agent_token_launch_prep',
						summary: 'Prepare agent token launch',
						description: 'Build an unsigned Solana transaction to launch a Pump.fun token for an agent identity.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['agent_id', 'name', 'symbol'],
										properties: {
											agent_id: { type: 'string' },
											name: { type: 'string', maxLength: 32 },
											symbol: { type: 'string', maxLength: 10 },
											description: { type: 'string', maxLength: 500 },
											image_url: { type: 'string', format: 'uri' },
											initial_buy_sol: { type: 'number', minimum: 0 },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Unsigned transaction + metadata' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/agents/tokens/launch-confirm': {
					post: {
						operationId: 'agent_token_launch_confirm',
						summary: 'Confirm agent token launch',
						description: 'Submit a signed agent token launch transaction and persist the mint address to the agent record.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['agent_id', 'signed_tx'],
										properties: {
											agent_id: { type: 'string' },
											signed_tx: { type: 'string', description: 'Base64-encoded signed transaction.' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Confirmed — mint address and signature' },
							401: { description: 'Unauthorized' },
							409: { description: 'Token already launched for this agent' },
						},
					},
				},
				'/api/agents/tokens/launch-quote': {
					get: {
						operationId: 'agent_token_launch_quote',
						summary: 'Agent token launch fee quote',
						description: 'Returns expected fees (Pump.fun creation fee + SOL reserve) for a given initial buy size.',
						security: [],
						parameters: [
							{ name: 'initial_buy_sol', in: 'query', schema: { type: 'number', default: 0 } },
						],
						responses: {
							200: { description: 'Fee breakdown' },
						},
					},
				},
				'/api/agents/x402/invoke': {
					post: {
						operationId: 'agent_x402_invoke',
						summary: 'Invoke an agent skill via x402',
						description: "Agent-to-agent x402 invocation. The caller pays USDC; the target agent's skill handler executes.",
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['target_agent_id', 'skill', 'input'],
										properties: {
											target_agent_id: { type: 'string' },
											skill: { type: 'string' },
											input: { type: 'object' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Skill output' },
							402: { description: 'Payment required' },
							404: { description: 'Agent or skill not found' },
						},
					},
				},
				'/api/agents/x402/manifest': {
					get: {
						operationId: 'agent_x402_manifest',
						summary: 'x402 skill manifest for an agent',
						description: 'Returns the x402 payment manifest (skills, prices, accepted networks) for a given agent.',
						security: [],
						parameters: [
							{ name: 'agent_id', in: 'query', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'x402 manifest JSON' },
							404: { description: 'Agent not found' },
						},
					},
				},
				'/api/agents/onchain/prep': {
					post: {
						operationId: 'agent_onchain_prep',
						summary: 'Prepare on-chain agent registration',
						description: 'Build an unsigned Metaplex Core transaction to mint the on-chain agent identity asset.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['agent_id'],
										properties: {
											agent_id: { type: 'string' },
											network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Unsigned transaction + estimated fees' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/agents/onchain/confirm': {
					post: {
						operationId: 'agent_onchain_confirm',
						summary: 'Confirm on-chain agent registration',
						description: 'Submit the signed transaction and link the Metaplex Core asset address to the agent record.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['agent_id', 'signed_tx'],
										properties: {
											agent_id: { type: 'string' },
											signed_tx: { type: 'string', description: 'Base64-encoded signed transaction.' },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Confirmed — asset pubkey and signature' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/agents/payments/pay-prep': {
					post: {
						operationId: 'agent_payment_prep',
						summary: 'Prepare agent payment transaction',
						description: 'Build an unsigned Solana Pay or EVM USDC transfer to pay an agent for a service.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['agent_id', 'amount_usdc'],
										properties: {
											agent_id: { type: 'string' },
											amount_usdc: { type: 'number', minimum: 0.001 },
											memo: { type: 'string', maxLength: 128 },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Unsigned transaction and payment reference' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/agents/payments/pay-confirm': {
					post: {
						operationId: 'agent_payment_confirm',
						summary: 'Confirm agent payment',
						description: 'Verify a completed Solana Pay or EVM USDC payment and credit the receiving agent.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['reference', 'signature'],
										properties: {
											reference: { type: 'string' },
											signature: { type: 'string' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Payment confirmed and credited' },
							404: { description: 'Reference not found' },
						},
					},
				},
				'/api/agents/{id}': {
					get: {
						operationId: 'get_agent',
						summary: 'Get agent by ID',
						description: 'Public agent identity record: name, description, avatar, owner wallet, Solana mint address, and metadata.',
						security: [],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Agent identity object' },
							404: { description: 'Agent not found' },
						},
					},
					put: {
						operationId: 'update_agent',
						summary: 'Update agent',
						description: 'Update mutable agent fields. Owner only.',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: {
											name: { type: 'string', maxLength: 50 },
											description: { type: 'string', maxLength: 500 },
											avatar_id: { type: 'string' },
											visibility: { type: 'string', enum: ['private', 'public'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Updated agent' },
							401: { description: 'Unauthorized' },
							404: { description: 'Not found' },
						},
					},
					delete: {
						operationId: 'delete_agent',
						summary: 'Delete agent',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							204: { description: 'Deleted' },
							401: { description: 'Unauthorized' },
							404: { description: 'Not found' },
						},
					},
				},
				'/api/agents/{id}/manifest': {
					get: {
						operationId: 'get_agent_manifest',
						summary: 'Agent canonical manifest',
						description: 'Public canonical manifest: identity, capabilities, Solana asset pubkey, SNS domain, attestation schema URL.',
						security: [],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Agent manifest JSON' },
							404: { description: 'Not found' },
						},
					},
				},
				'/api/agents/{id}/solana': {
					get: {
						operationId: 'get_agent_solana',
						summary: 'Agent Solana wallet info',
						description: "Agent's Solana wallet address and SOL balance. Auth required — owner only.",
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: 'Wallet address and balance' },
							401: { description: 'Unauthorized' },
							404: { description: 'Not found' },
						},
					},
					post: {
						operationId: 'link_agent_solana_wallet',
						summary: 'Link Solana wallet to agent',
						description: 'Associate a Solana wallet with this agent (requires wallet signature proof).',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['wallet', 'signature', 'message'],
										properties: {
											wallet: { type: 'string' },
											signature: { type: 'string' },
											message: { type: 'string' },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Wallet linked' },
							401: { description: 'Unauthorized' },
							422: { description: 'Signature verification failed' },
						},
					},
				},
				'/api/agents/{id}/solana/activity': {
					get: {
						operationId: 'get_agent_solana_activity',
						summary: 'Agent on-chain activity',
						description: "Recent on-chain transactions and events for the agent's Solana wallet.",
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
							{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
						],
						responses: {
							200: { description: 'Array of on-chain activity events' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/agents/{id}/solana/reputation': {
					get: {
						operationId: 'get_agent_solana_reputation',
						summary: 'Agent on-chain reputation',
						description: 'On-chain reputation: feedback counts, score averages, verified vs disputed attestations.',
						security: [],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: 'Reputation object' },
							404: { description: 'Not found' },
						},
					},
				},
				'/api/agents/{id}/solana/metadata': {
					get: {
						operationId: 'get_agent_solana_metadata',
						summary: 'Agent Metaplex Core metadata',
						description: "Metaplex Core asset metadata for the agent's on-chain identity.",
						security: [],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: 'Metaplex asset metadata' },
							404: { description: 'Not found or not on-chain' },
						},
					},
				},
				'/api/agents/{id}/sns': {
					get: {
						operationId: 'get_agent_sns',
						summary: 'Agent SNS domain',
						description: 'Returns the Solana Name Service domain registered for this agent.',
						security: [],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'SNS domain info or null if none registered' },
						},
					},
				},
				'/api/agents/{id}/sns/register-prep': {
					post: {
						operationId: 'agent_sns_register_prep',
						summary: 'Prepare SNS domain registration',
						description: 'Build an unsigned Solana transaction to register a .sol domain for this agent.',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['domain'],
										properties: {
											domain: { type: 'string', description: 'Domain name without .sol suffix.' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Unsigned transaction + fee estimate' },
							401: { description: 'Unauthorized' },
							409: { description: 'Domain already taken' },
						},
					},
				},
				'/api/agents/{id}/pricing': {
					get: {
						operationId: 'get_agent_pricing',
						summary: 'List agent skill pricing',
						description: 'Returns all priced skills for this agent.',
						security: [],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Array of { skill, price_usdc } objects' },
						},
					},
					post: {
						operationId: 'create_agent_pricing',
						summary: 'Add a priced skill',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['skill', 'price_usdc'],
										properties: {
											skill: { type: 'string', maxLength: 64 },
											price_usdc: { type: 'number', minimum: 0.001 },
											description: { type: 'string', maxLength: 200 },
										},
									},
								},
							},
						},
						responses: {
							201: { description: 'Skill pricing created' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/agents/{id}/pricing/{skill}': {
					get: {
						operationId: 'get_agent_skill_price',
						summary: 'Get skill price',
						security: [],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							{ name: 'skill', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Skill price object' },
							404: { description: 'Skill not priced' },
						},
					},
					put: {
						operationId: 'update_agent_skill_price',
						summary: 'Update skill price',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							{ name: 'skill', in: 'path', required: true, schema: { type: 'string' } },
						],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['price_usdc'],
										properties: {
											price_usdc: { type: 'number', minimum: 0.001 },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Updated skill price' },
							401: { description: 'Unauthorized' },
						},
					},
					delete: {
						operationId: 'delete_agent_skill_price',
						summary: 'Remove skill pricing',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							{ name: 'skill', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							204: { description: 'Removed' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/agents/{id}/settings': {
					get: {
						operationId: 'get_agent_settings',
						summary: 'Agent settings',
						description: 'Private agent settings (webhook URL, notification preferences). Owner only.',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Agent settings object' },
							401: { description: 'Unauthorized' },
						},
					},
					patch: {
						operationId: 'update_agent_settings',
						summary: 'Update agent settings',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: {
											webhook_url: { type: 'string', format: 'uri' },
											payment_notifications: { type: 'boolean' },
											attestation_notifications: { type: 'boolean' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Updated settings' },
							401: { description: 'Unauthorized' },
						},
					},
				},

				// ── PUMP.FUN ──────────────────────────────────────────────────────
				'/api/pump/curve': {
					get: {
						operationId: 'pump_curve',
						summary: 'Pump.fun bonding-curve snapshot',
						description: 'Raw bonding-curve state, spot price, market cap, and graduation progress. Free, edge-cached 10s.',
						security: [],
						parameters: [
							{ name: 'mint', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: 'Bonding curve snapshot' },
							400: { description: 'Bad mint' },
							404: { description: 'No bonding curve for that mint' },
						},
					},
				},
				'/api/pump/quote-sdk': {
					get: {
						operationId: 'pump_quote_sdk',
						summary: 'Pump.fun buy/sell quote',
						description: 'Deterministic buy or sell quote via @nirholas/pump-sdk on the live bonding curve. Free.',
						security: [],
						parameters: [
							{ name: 'mint', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'side', in: 'query', required: true, schema: { type: 'string', enum: ['buy', 'sell'] } },
							{ name: 'amount', in: 'query', required: true, schema: { type: 'number', minimum: 0 } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: 'Quote with output amount and priceImpactPct' },
							400: { description: 'Validation error' },
							404: { description: 'No bonding curve' },
						},
					},
				},
				'/api/pump/recent-graduations': {
					get: {
						operationId: 'pump_recent_graduations',
						summary: 'Recent Pump.fun graduations',
						description: 'Recently graduated tokens (those that reached the Raydium threshold) from the live feed.',
						security: [],
						parameters: [
							{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
						],
						responses: {
							200: { description: 'Array of graduated token objects' },
						},
					},
				},
				'/api/pump/recent-claims': {
					get: {
						operationId: 'pump_recent_claims',
						summary: 'Recent Pump.fun LP claims',
						description: 'Recent creator LP fee claim events from the Pump.fun feed.',
						security: [],
						parameters: [
							{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
						],
						responses: {
							200: { description: 'Array of claim events' },
						},
					},
				},
				'/api/pump/balances': {
					get: {
						operationId: 'pump_balances',
						summary: 'Pump.fun token balances',
						description: 'All Pump.fun token balances held by a wallet.',
						security: [],
						parameters: [
							{ name: 'wallet', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: 'Array of { mint, balance, uiAmount }' },
						},
					},
				},
				'/api/pump/launch-prep': {
					post: {
						operationId: 'pump_launch_prep',
						summary: 'Prepare Pump.fun token launch',
						description: 'Build an unsigned Solana transaction for launching a new Pump.fun token.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['name', 'symbol', 'creator_wallet'],
										properties: {
											name: { type: 'string', maxLength: 32 },
											symbol: { type: 'string', maxLength: 10 },
											description: { type: 'string', maxLength: 500 },
											image_url: { type: 'string', format: 'uri' },
											creator_wallet: { type: 'string' },
											initial_buy_sol: { type: 'number', minimum: 0, default: 0 },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Unsigned transaction + mint pubkey + fee estimate' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/pump/launch-confirm': {
					post: {
						operationId: 'pump_launch_confirm',
						summary: 'Confirm Pump.fun token launch',
						description: 'Submit a signed token launch transaction and return the confirmed mint address.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['signed_tx'],
										properties: {
											signed_tx: { type: 'string' },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Confirmed — mint address and signature' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/pump/buy-prep': {
					post: {
						operationId: 'pump_buy_prep',
						summary: 'Prepare Pump.fun buy transaction',
						description: 'Build an unsigned buy transaction for a Pump.fun token at a given SOL amount.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['mint', 'buyer_wallet', 'sol_amount'],
										properties: {
											mint: { type: 'string' },
											buyer_wallet: { type: 'string' },
											sol_amount: { type: 'number', minimum: 0.001 },
											slippage_bps: { type: 'integer', default: 500 },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Unsigned transaction + expected output' },
							404: { description: 'Token not found or graduated' },
						},
					},
				},
				'/api/pump/buy-confirm': {
					post: {
						operationId: 'pump_buy_confirm',
						summary: 'Confirm Pump.fun buy',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['signed_tx'],
										properties: {
											signed_tx: { type: 'string' },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Signature and confirmed token amount received' },
						},
					},
				},
				'/api/pump/sell-prep': {
					post: {
						operationId: 'pump_sell_prep',
						summary: 'Prepare Pump.fun sell transaction',
						description: 'Build an unsigned sell transaction to redeem Pump.fun tokens for SOL.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['mint', 'seller_wallet', 'token_amount'],
										properties: {
											mint: { type: 'string' },
											seller_wallet: { type: 'string' },
											token_amount: { type: 'number', minimum: 0 },
											slippage_bps: { type: 'integer', default: 500 },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Unsigned transaction + expected SOL output' },
							404: { description: 'Token not found or graduated' },
						},
					},
				},
				'/api/pump/sell-confirm': {
					post: {
						operationId: 'pump_sell_confirm',
						summary: 'Confirm Pump.fun sell',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['signed_tx'],
										properties: {
											signed_tx: { type: 'string' },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Signature and confirmed SOL received' },
						},
					},
				},
				'/api/pump/vanity-keygen': {
					post: {
						operationId: 'pump_vanity_keygen',
						summary: 'Generate vanity mint keypair',
						description: 'Generate a keypair with a custom mint address prefix for Pump.fun token launches.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: {
											prefix: { type: 'string', maxLength: 3 },
											suffix: { type: 'string', maxLength: 3 },
											caseSensitive: { type: 'boolean', default: false },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'publicKey + secretKey (Base58)' },
							408: { description: 'No match found — retry with shorter pattern' },
						},
					},
				},

				// ── x402 PAID ENDPOINTS ───────────────────────────────────────────
				'/api/x402/model-check': {
					get: {
						operationId: 'x402_model_check',
						summary: 'glTF/GLB model validation and stats',
						description: 'Fetch a glTF/GLB by URL and return structural stats (vertices, triangles, materials, textures, animations, extensions) plus prioritized optimization recommendations. Max 16 MiB.',
						security: [],
						parameters: [
							{ name: 'url', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
						],
						responses: {
							200: { description: 'Model stats and optimization hints' },
							400: { description: 'Invalid URL or unsupported format' },
							402: { description: 'Payment required — $0.001 USDC on Base or Arbitrum' },
						},
						'x-payment-info': {
							price: { mode: 'fixed', currency: 'USD', amount: '0.001' },
							protocols: [{ x402: {} }],
							networks: ['eip155:8453', 'eip155:42161'],
						},
					},
				},
				'/api/x402/mint-to-mesh': {
					get: {
						operationId: 'x402_mint_to_mesh',
						summary: 'Solana token to GLB mesh',
						description: 'Pass a Solana SPL mint address and receive a binary glTF (GLB) cube themed for that token. Color is a stable hash of the mint; Metaplex PNG/JPEG is embedded as baseColor texture.',
						security: [],
						parameters: [
							{ name: 'mint', in: 'query', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'JSON envelope with base64-encoded GLB and metadata' },
							400: { description: 'Invalid mint address' },
							402: { description: 'Payment required — $0.01 USDC on Base or Arbitrum' },
						},
						'x-payment-info': {
							price: { mode: 'fixed', currency: 'USD', amount: '0.01' },
							protocols: [{ x402: {} }],
							networks: ['eip155:8453', 'eip155:42161'],
						},
					},
				},
				'/api/x402/solana-vanity-grind': {
					post: {
						operationId: 'x402_solana_vanity_grind',
						summary: 'Solana vanity address grind',
						description: 'Server-side keypair grind returning a Solana address matching a requested prefix and/or suffix. Pattern limit: ≤ 4 Base58 chars total. Times out after 45 s / 3 M attempts (408). Returns publicKey + secretKey in Base58.',
						security: [],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: {
											prefix: { type: 'string', minLength: 1, maxLength: 4 },
											suffix: { type: 'string', minLength: 1, maxLength: 4 },
											caseSensitive: { type: 'boolean', default: false },
										},
										additionalProperties: false,
									},
								},
							},
						},
						responses: {
							200: { description: 'Matched keypair: publicKey, secretKey (Base58), attempts, ms, pattern' },
							400: { description: 'Invalid pattern' },
							402: { description: 'Payment required — $0.05 USDC on Base or Arbitrum' },
							408: { description: 'No match in 3 M attempts — retry with shorter pattern' },
						},
						'x-payment-info': {
							price: { mode: 'fixed', currency: 'USD', amount: '0.05' },
							protocols: [{ x402: {} }],
							networks: ['eip155:8453', 'eip155:42161'],
						},
					},
				},
				'/api/x402/solana-agent-passport': {
					get: {
						operationId: 'x402_solana_agent_passport',
						summary: 'Solana agent passport',
						description: 'Full discovery card for a three.ws registered agent: Metaplex Core identity, owner wallet, reputation summary (feedback counts, score averages, verified vs disputed), and 10 most recent on-chain attestations.',
						security: [],
						parameters: [
							{ name: 'asset', in: 'query', required: true, schema: { type: 'string' }, description: 'Base58 Metaplex Core asset pubkey.' },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' } },
						],
						responses: {
							200: { description: 'Agent passport object' },
							400: { description: 'Missing or invalid asset address' },
							402: { description: 'Payment required — $0.001 USDC on Base or Arbitrum' },
							404: { description: 'Agent not found on-chain' },
						},
						'x-payment-info': {
							price: { mode: 'fixed', currency: 'USD', amount: '0.001' },
							protocols: [{ x402: {} }],
							networks: ['eip155:8453', 'eip155:42161'],
						},
					},
				},
				'/api/x402/pumpfun-token-intel': {
					get: {
						operationId: 'x402_pumpfun_token_intel',
						summary: 'Pump.fun token intelligence',
						description: 'Full intelligence on a pump.fun token: graduation status, bonding-curve progress, creator profile, top holders, volume, bundle detection, and behavioural trust signals.',
						security: [],
						parameters: [
							{ name: 'mint', in: 'query', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Token intelligence object' },
							400: { description: 'Missing or invalid mint' },
							402: { description: 'Payment required — $0.005 USDC on Base or Arbitrum' },
							503: { description: 'Pump.fun feed not available' },
						},
						'x-payment-info': {
							price: { mode: 'fixed', currency: 'USD', amount: '0.005' },
							protocols: [{ x402: {} }],
							networks: ['eip155:8453', 'eip155:42161'],
						},
					},
				},
				'/api/x402/pumpfun-creator-intel': {
					get: {
						operationId: 'x402_pumpfun_creator_intel',
						summary: 'Pump.fun creator intelligence',
						description: 'Reputation profile for a pump.fun creator wallet: prior launches, graduation rate, claim activity, and behavioural trust signals. Use before buying into a new token.',
						security: [],
						parameters: [
							{ name: 'wallet', in: 'query', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Creator intelligence object' },
							400: { description: 'Missing wallet' },
							402: { description: 'Payment required — $0.005 USDC on Base or Arbitrum' },
							503: { description: 'Pump.fun feed not available' },
						},
						'x-payment-info': {
							price: { mode: 'fixed', currency: 'USD', amount: '0.005' },
							protocols: [{ x402: {} }],
							networks: ['eip155:8453', 'eip155:42161'],
						},
					},
				},
				'/api/x402/solana-tx-explain': {
					post: {
						operationId: 'x402_solana_tx_explain',
						summary: 'Decode and explain a Solana transaction',
						description: 'Decode a Solana transaction via Helius: token transfers, native SOL transfers, type, fee payer, description, and optional plain-English AI summary.',
						security: [],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['signature'],
										properties: {
											signature: { type: 'string', description: 'Base58 Solana transaction signature.' },
										},
										additionalProperties: false,
									},
								},
							},
						},
						responses: {
							200: { description: 'Decoded transaction: type, feePayer, tokenTransfers, nativeTransfers, optional AI summary' },
							400: { description: 'Missing signature' },
							402: { description: 'Payment required — $0.002 USDC on Base or Arbitrum' },
							404: { description: 'Transaction not found' },
							503: { description: 'Helius API not configured' },
						},
						'x-payment-info': {
							price: { mode: 'fixed', currency: 'USD', amount: '0.002' },
							protocols: [{ x402: {} }],
							networks: ['eip155:8453', 'eip155:42161'],
						},
					},
				},

				// ── INSIGHTS ──────────────────────────────────────────────────────
				'/api/insights/revenue-vision': {
					get: {
						operationId: 'x402_revenue_vision',
						summary: 'AI-powered revenue growth analysis',
						description: 'Agentic growth analysis powered by Claude. Returns { power_mode, insight, recommended_move, confidence } — one prioritized next-best move with data-grounded rationale.',
						security: [],
						parameters: [
							{ name: 'agent_codename', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'power_request', in: 'query', required: true, schema: { type: 'string', enum: ['revenue-vision'] } },
							{ name: 'mission_brief', in: 'query', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: '{ power_mode, insight, recommended_move, confidence }' },
							400: { description: 'Missing required parameters' },
							402: { description: 'Payment required — $0.001 USDC on Base or Arbitrum' },
						},
						'x-payment-info': {
							price: { mode: 'fixed', currency: 'USD', amount: '0.001' },
							protocols: [{ x402: {} }],
							networks: ['eip155:8453', 'eip155:42161'],
						},
					},
				},

				// ── AUTH ──────────────────────────────────────────────────────────
				'/api/auth/siws/nonce': {
					get: {
						operationId: 'siws_nonce',
						summary: 'Get SIWS nonce',
						description: 'Returns a one-time nonce for Sign-In with Solana (SIWS). Expires in 5 minutes.',
						security: [],
						responses: {
							200: { description: '{ nonce: string, expiresAt: ISO8601 }' },
						},
					},
				},
				'/api/auth/siws/verify': {
					post: {
						operationId: 'siws_verify',
						summary: 'Verify SIWS signature',
						description: 'Verify a SIWS message + signature and issue a session Bearer token.',
						security: [],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['message', 'signature', 'wallet'],
										properties: {
											message: { type: 'string' },
											signature: { type: 'string' },
											wallet: { type: 'string' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: '{ token, expiresAt }' },
							401: { description: 'Invalid signature' },
							422: { description: 'Expired or invalid nonce' },
						},
					},
				},
				'/oauth/authorize': {
					get: {
						operationId: 'oauth_authorize',
						summary: 'OAuth 2.1 authorization endpoint',
						description: 'Initiates an OAuth 2.1 authorization code flow. Used by MCP clients to obtain Bearer tokens.',
						security: [],
						parameters: [
							{ name: 'client_id', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'redirect_uri', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
							{ name: 'response_type', in: 'query', required: true, schema: { type: 'string', enum: ['code'] } },
							{ name: 'scope', in: 'query', schema: { type: 'string' } },
							{ name: 'state', in: 'query', schema: { type: 'string' } },
							{ name: 'code_challenge', in: 'query', schema: { type: 'string' } },
							{ name: 'code_challenge_method', in: 'query', schema: { type: 'string', enum: ['S256'] } },
						],
						responses: {
							302: { description: 'Redirect to wallet sign-in or consent screen' },
							400: { description: 'Invalid client or redirect URI' },
						},
					},
				},
				'/oauth/token': {
					post: {
						operationId: 'oauth_token',
						summary: 'OAuth 2.1 token endpoint',
						description: 'Exchange an authorization code for a Bearer token or refresh an existing token.',
						security: [],
						requestBody: {
							required: true,
							content: {
								'application/x-www-form-urlencoded': {
									schema: {
										type: 'object',
										required: ['grant_type', 'client_id'],
										properties: {
											grant_type: { type: 'string', enum: ['authorization_code', 'refresh_token'] },
											client_id: { type: 'string' },
											code: { type: 'string' },
											redirect_uri: { type: 'string' },
											code_verifier: { type: 'string' },
											refresh_token: { type: 'string' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: '{ access_token, token_type, expires_in, refresh_token }' },
							400: { description: 'Invalid grant' },
						},
					},
				},

				// ── API KEYS ──────────────────────────────────────────────────────
				'/api/api-keys': {
					get: {
						operationId: 'list_api_keys',
						summary: 'List API keys',
						description: 'Returns all API keys for the authenticated wallet (secret not shown after creation).',
						security: [{ siwx: [] }],
						responses: {
							200: { description: 'Array of API key metadata' },
							401: { description: 'Unauthorized' },
						},
					},
					post: {
						operationId: 'create_api_key',
						summary: 'Create API key',
						description: 'Generate a new API key. The full secret is returned only once.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: {
											label: { type: 'string', maxLength: 64 },
											scopes: { type: 'array', items: { type: 'string' } },
											expires_in_days: { type: 'integer', minimum: 1, maximum: 365 },
										},
									},
								},
							},
						},
						responses: {
							201: { description: '{ id, key, label, scopes, expiresAt }' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/api-keys/{id}': {
					delete: {
						operationId: 'revoke_api_key',
						summary: 'Revoke API key',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							204: { description: 'Revoked' },
							401: { description: 'Unauthorized' },
							404: { description: 'Not found' },
						},
					},
				},

				// ── BILLING ───────────────────────────────────────────────────────
				'/api/billing/revenue': {
					get: {
						operationId: 'billing_revenue',
						summary: 'Revenue summary',
						description: 'Earned revenue breakdown by endpoint, time period, and network.',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'period', in: 'query', schema: { type: 'string', enum: ['day', 'week', 'month', 'all'], default: 'month' } },
						],
						responses: {
							200: { description: 'Revenue breakdown' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/billing/payout-wallets': {
					get: {
						operationId: 'list_payout_wallets',
						summary: 'List payout wallets',
						security: [{ siwx: [] }],
						responses: {
							200: { description: 'Array of payout wallet objects' },
							401: { description: 'Unauthorized' },
						},
					},
					post: {
						operationId: 'add_payout_wallet',
						summary: 'Add payout wallet',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['wallet', 'network'],
										properties: {
											wallet: { type: 'string' },
											network: { type: 'string', enum: ['solana', 'base', 'arbitrum'] },
											label: { type: 'string', maxLength: 64 },
										},
									},
								},
							},
						},
						responses: {
							201: { description: 'Payout wallet added' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/billing/withdrawals': {
					get: {
						operationId: 'list_withdrawals',
						summary: 'List withdrawal history',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
							{ name: 'cursor', in: 'query', schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Paginated withdrawal history' },
							401: { description: 'Unauthorized' },
						},
					},
					post: {
						operationId: 'request_withdrawal',
						summary: 'Request withdrawal',
						description: 'Initiate a USDC withdrawal to a registered payout wallet.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['payout_wallet_id', 'amount_usdc'],
										properties: {
											payout_wallet_id: { type: 'string' },
											amount_usdc: { type: 'number', minimum: 1 },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Withdrawal initiated — signature and status' },
							400: { description: 'Insufficient balance or below minimum' },
							401: { description: 'Unauthorized' },
						},
					},
				},

				// ── MARKETPLACE ───────────────────────────────────────────────────
				'/api/marketplace': {
					get: {
						operationId: 'list_marketplace',
						summary: 'Browse marketplace listings',
						description: 'Publicly listed agent skills and services available for purchase.',
						security: [],
						parameters: [
							{ name: 'q', in: 'query', schema: { type: 'string' } },
							{ name: 'category', in: 'query', schema: { type: 'string' } },
							{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
							{ name: 'cursor', in: 'query', schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Paginated marketplace listings' },
						},
					},
				},
				'/api/marketplace/{id}': {
					get: {
						operationId: 'get_marketplace_listing',
						summary: 'Get marketplace listing',
						security: [],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Marketplace listing detail' },
							404: { description: 'Not found' },
						},
					},
				},
				'/api/marketplace/purchase': {
					post: {
						operationId: 'marketplace_purchase',
						summary: 'Purchase a marketplace listing',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['listing_id'],
										properties: {
											listing_id: { type: 'string' },
											payment_tx: { type: 'string' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Purchase confirmed — access grant and receipt' },
							402: { description: 'Payment required' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/marketplace/purchase-as-agent': {
					post: {
						operationId: 'marketplace_purchase_as_agent',
						summary: 'Agent purchases marketplace skill',
						description: 'Agents purchase marketplace skills autonomously using their linked USDC balance.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['listing_id', 'agent_id'],
										properties: {
											listing_id: { type: 'string' },
											agent_id: { type: 'string' },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Purchase confirmed for agent' },
							402: { description: 'Insufficient agent balance' },
							401: { description: 'Unauthorized' },
						},
					},
				},

				// ── SKILLS ────────────────────────────────────────────────────────
				'/api/skills': {
					get: {
						operationId: 'list_skills',
						summary: 'List available skills',
						description: 'Returns the catalog of agent skill types supported by the platform.',
						security: [],
						parameters: [
							{ name: 'category', in: 'query', schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Array of skill descriptors' },
						},
					},
				},
				'/api/skills/{id}': {
					get: {
						operationId: 'get_skill',
						summary: 'Get skill descriptor',
						security: [],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Skill descriptor with input/output schema' },
							404: { description: 'Not found' },
						},
					},
				},

				// ── SUBSCRIPTIONS ─────────────────────────────────────────────────
				'/api/subscriptions': {
					get: {
						operationId: 'list_subscriptions',
						summary: 'List active subscriptions',
						security: [{ siwx: [] }],
						responses: {
							200: { description: 'Array of active subscriptions' },
							401: { description: 'Unauthorized' },
						},
					},
					post: {
						operationId: 'create_subscription',
						summary: 'Create subscription',
						description: 'Subscribe to a paid plan or skill package with recurring USDC billing.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['plan_id'],
										properties: {
											plan_id: { type: 'string' },
											payout_wallet_id: { type: 'string' },
										},
									},
								},
							},
						},
						responses: {
							201: { description: 'Subscription created' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/subscriptions/{id}': {
					delete: {
						operationId: 'cancel_subscription',
						summary: 'Cancel subscription',
						security: [{ siwx: [] }],
						parameters: [
							{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
						],
						responses: {
							204: { description: 'Cancelled at period end' },
							401: { description: 'Unauthorized' },
							404: { description: 'Not found' },
						},
					},
				},

				// ── TRANSACTIONS ──────────────────────────────────────────────────
				'/api/tx/explain': {
					post: {
						operationId: 'tx_explain',
						summary: 'Explain a Solana transaction (free)',
						description: 'Free tier: decode a Solana transaction and return structured fields without AI summary. For AI summary use the paid /api/x402/solana-tx-explain.',
						security: [],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['signature'],
										properties: {
											signature: { type: 'string' },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Decoded transaction fields' },
							404: { description: 'Transaction not found' },
						},
					},
				},
				'/api/tx/solana/build-transfer': {
					post: {
						operationId: 'tx_build_transfer',
						summary: 'Build Solana transfer transaction',
						description: 'Build an unsigned SOL or SPL token transfer transaction ready for wallet signing.',
						security: [],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['from', 'to', 'amount'],
										properties: {
											from: { type: 'string' },
											to: { type: 'string' },
											amount: { type: 'number', minimum: 0 },
											mint: { type: 'string', description: 'SPL mint; omit for native SOL.' },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Unsigned serialized transaction (base64)' },
							400: { description: 'Validation error' },
						},
					},
				},

				// ── WALLET ────────────────────────────────────────────────────────
				'/api/wallet/balances': {
					get: {
						operationId: 'wallet_balances',
						summary: 'Wallet balances',
						description: 'SOL and SPL token balances for a given Solana wallet.',
						security: [],
						parameters: [
							{ name: 'wallet', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: '{ sol, tokens: [{ mint, balance, uiAmount }] }' },
							400: { description: 'Invalid wallet address' },
						},
					},
				},

				// ── NFT / SCENE ───────────────────────────────────────────────────
				'/api/nft/mint-scene': {
					post: {
						operationId: 'nft_mint_scene',
						summary: 'Mint a 3D scene as NFT',
						description: 'Upload a glTF/GLB scene to Arweave and mint a Metaplex NFT referencing it on Solana.',
						security: [{ siwx: [] }],
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['storage_key', 'name'],
										properties: {
											storage_key: { type: 'string' },
											name: { type: 'string', maxLength: 32 },
											description: { type: 'string', maxLength: 500 },
											creator_wallet: { type: 'string' },
											royalty_bps: { type: 'integer', minimum: 0, maximum: 10000 },
											network: { type: 'string', enum: ['mainnet', 'devnet'] },
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'Unsigned mint transaction + metadata URI' },
							401: { description: 'Unauthorized' },
						},
					},
				},
				'/api/nft/resolve': {
					get: {
						operationId: 'nft_resolve',
						summary: 'Resolve NFT metadata',
						description: 'On-chain metadata and the Arweave/IPFS asset URI for a Metaplex NFT.',
						security: [],
						parameters: [
							{ name: 'mint', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: 'NFT metadata + asset URI' },
							404: { description: 'Not found' },
						},
					},
				},

				// ── DISCOVERY / MISC ──────────────────────────────────────────────
				'/api/showcase': {
					get: {
						operationId: 'showcase',
						summary: 'Featured agents and avatars',
						description: 'Curated featured agents and public avatars for the discovery feed.',
						security: [],
						responses: {
							200: { description: '{ agents: [], avatars: [] }' },
						},
					},
				},
				'/api/explore': {
					get: {
						operationId: 'explore',
						summary: 'Explore agents and skills',
						description: 'Full-text search across public agents, avatars, and marketplace listings.',
						security: [],
						parameters: [
							{ name: 'q', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'type', in: 'query', schema: { type: 'string', enum: ['agents', 'avatars', 'skills', 'all'], default: 'all' } },
							{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
						],
						responses: {
							200: { description: 'Search results grouped by type' },
						},
					},
				},
				'/api/x402-status': {
					get: {
						operationId: 'x402_status',
						summary: 'x402 payment infrastructure status',
						description: 'Live status of x402 payment rails: CDP facilitator connectivity, supported networks, and USDC contract addresses.',
						security: [],
						responses: {
							200: { description: 'x402 status object' },
						},
					},
				},
				'/api/healthz': {
					get: {
						operationId: 'healthz',
						summary: 'Service liveness',
						description: 'Lightweight liveness probe with uptime and service version.',
						security: [],
						responses: {
							200: { description: 'Health summary JSON' },
						},
					},
				},
				'/.well-known/x402.json': {
					get: {
						operationId: 'x402_well_known',
						summary: 'x402 payment discovery document',
						description: 'Machine-readable x402 resource listing for all paid endpoints. Used by x402 clients for payment discovery.',
						security: [],
						responses: {
							200: { description: 'x402 resource manifest' },
						},
					},
				},
				'/.well-known/agent-attestation-schemas': {
					get: {
						operationId: 'attestation_schemas',
						summary: 'Agent attestation schemas',
						description: 'On-chain attestation schema definitions used by three.ws for agent reputation.',
						security: [],
						responses: {
							200: { description: 'Array of attestation schema objects' },
						},
					},
				},
			},
		},
		{ 'cache-control': 'public, max-age=300' },
	);
});
