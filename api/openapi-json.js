// GET /openapi.json — x402 OpenAPI discovery document
// Preferred over /.well-known/x402 by x402scan.

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
					'API for 3D avatar management, AI agent identity, and MCP tool access.',
				'x-guidance':
					'Use POST /api/mcp to interact with the MCP server. Send a JSON-RPC 2.0 request body. ' +
					'Authenticate with a Bearer access token obtained via OAuth 2.1 at ' +
					origin +
					'/oauth/authorize, or use a Bearer API key from the dashboard. ' +
					'Available MCP tools: list_my_avatars, get_avatar, search_public_avatars, ' +
					'render_avatar, delete_avatar, validate_model, inspect_model, optimize_model.',
			},
			servers: [{ url: origin }],
			components: {
				securitySchemes: {
					siwx: {
						type: 'apiKey',
						in: 'header',
						name: 'Authorization',
						description:
							'Bearer token from OAuth 2.1 or API key. Wallet-based SIWX authentication is supported via SIWE.',
					},
				},
			},
			paths: {
				'/api/mcp': {
					post: {
						operationId: 'mcp_call',
						summary: 'MCP tool call',
						description:
							'JSON-RPC 2.0 request to the MCP server. Supports tools for 3D avatar management, model validation, inspection, and optimization.',
						requestBody: {
							required: true,
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['jsonrpc', 'method'],
										properties: {
											jsonrpc: {
												type: 'string',
												enum: ['2.0'],
											},
											id: {
												oneOf: [{ type: 'string' }, { type: 'number' }],
											},
											method: {
												type: 'string',
												description:
													'MCP method name, e.g. "tools/call" or "initialize".',
											},
											params: {
												type: 'object',
												description: 'Method-specific parameters.',
											},
										},
									},
								},
							},
						},
						responses: {
							200: { description: 'JSON-RPC 2.0 response' },
							401: { description: 'Unauthorized — missing or invalid token' },
							402: { description: 'Payment Required' },
							429: { description: 'Rate limited' },
						},
						'x-payment-info': {
							price: {
								mode: 'fixed',
								currency: 'USD',
								amount: '0.001',
							},
							// Per spec, protocols lists protocol *support* (one entry per
							// protocol). Per-network payment lanes are advertised at runtime
							// in the 402 challenge `accepts[]` array — see api/_lib/x402-spec.js
							// `paymentRequirements()` which emits Solana USDC + Base USDC.
							protocols: [
								{ x402: {} },
								{
									mpp: {
										method: 'solana-pay',
										intent: 'purchase',
										currency: 'USDC',
									},
								},
							],
						},
					},
				},
				'/api/avatars': {
					get: {
						operationId: 'list_avatars',
						summary: 'List my avatars',
						security: [{ siwx: [] }],
						responses: {
							200: { description: 'Array of avatar objects' },
							401: { description: 'Unauthorized' },
						},
					},
					post: {
						operationId: 'create_avatar',
						summary: 'Register an uploaded avatar',
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
											content_type: {
												type: 'string',
												enum: ['model/gltf-binary', 'model/gltf+json'],
											},
											visibility: {
												type: 'string',
												enum: ['private', 'unlisted', 'public'],
											},
											tags: {
												type: 'array',
												items: { type: 'string' },
											},
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
						security: [],
						parameters: [
							{ name: 'q', in: 'query', schema: { type: 'string' } },
							{
								name: 'limit',
								in: 'query',
								schema: { type: 'integer', default: 20, maximum: 100 },
							},
							{ name: 'cursor', in: 'query', schema: { type: 'string' } },
						],
						responses: {
							200: { description: 'Paginated list of public avatars' },
						},
					},
				},
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
				},
				'/api/pump/curve': {
					get: {
						operationId: 'pump_curve',
						summary: 'Pump.fun bonding-curve snapshot',
						description:
							'Returns raw bonding-curve state, current spot price + market cap, and graduation progress for a Pump.fun token. Public, edge-cached for 10s.',
						parameters: [
							{ name: 'mint', in: 'query', required: true, schema: { type: 'string' }, description: 'Base58 SPL mint address' },
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
						summary: 'Pump.fun buy/sell quote (SDK-precise)',
						description:
							'Deterministic buy or sell quote computed via @nirholas/pump-sdk on the live bonding curve. Returns output amount, price impact %, and a market context block.',
						parameters: [
							{ name: 'mint', in: 'query', required: true, schema: { type: 'string' } },
							{ name: 'side', in: 'query', required: true, schema: { type: 'string', enum: ['buy', 'sell'] } },
							{ name: 'amount', in: 'query', required: true, schema: { type: 'number', minimum: 0 }, description: 'For buy: SOL. For sell: tokens (UI units, 6 decimals).' },
							{ name: 'network', in: 'query', schema: { type: 'string', enum: ['mainnet', 'devnet'] } },
						],
						responses: {
							200: { description: 'Quote payload with input/output and priceImpactPct' },
							400: { description: 'Validation error' },
							404: { description: 'No bonding curve for that mint' },
						},
					},
				},
			},
		},
		{ 'cache-control': 'public, max-age=300' },
	);
});
