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
							protocols: [
								{
									x402: {
										network: 'solana',
										asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
										payTo: 'BUrwd1nK6tFeeJMyzRHDo6AuVbnSfUULfvwq21X93nSN',
										scheme: 'exact',
										maxAmountRequired: '1000',
									},
								},
								{
									x402: {
										network: 'base',
										asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
										payTo: '0x0C70c0e8453C5667739E41acdF6eC5787B8ff542',
										scheme: 'exact',
										maxAmountRequired: '1000',
									},
								},
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
			},
		},
		{ 'cache-control': 'public, max-age=300' },
	);
});
