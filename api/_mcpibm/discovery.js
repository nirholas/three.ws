// Bazaar discovery + service metadata for the hosted IBM Granite MCP endpoint.
//
// The 402 challenge an unauthenticated/unpaid caller receives carries this
// metadata so x402 facilitators (CDP Bazaar, agentic.market, x402scan) index
// /api/ibm-mcp with a Granite-specific service name, tags, icon, and a v2
// `bazaar` extension describing the JSON-RPC tools/call shape. Mirrors the
// generic bazaarExtension() in api/_lib/x402-spec.js, specialized for Granite.

import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';

export const RESOURCE_DESCRIPTION =
	'three.ws x402 MCP: Streamable HTTP (MCP 2025-06-18) exposing IBM Granite foundation models as ' +
	'pay-per-call tools: ibm_granite_chat (conversational AI), ibm_granite_code (generate/review/refactor/' +
	'explain/test/document), ibm_granite_embed (multilingual embeddings), ibm_granite_analyze (structured ' +
	'document analysis), and ibm_granite_forecast (zero-shot time-series). Pay per call in USDC on Base or ' +
	'Solana mainnet, no IBM Cloud account required. Operated by three.ws.';

// Endpoint-level v2 bazaar discovery entry, shaped exactly like the validator
// expects (see api/_lib/x402-spec.js → bazaarExtension). Describes how to POST a
// JSON-RPC 2.0 tools/call and what comes back.
function graniteBazaarExtension() {
	const exampleBody = {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: {
			name: 'ibm_granite_chat',
			arguments: {
				messages: [
					{
						role: 'user',
						content: 'Summarize the IBM Granite model family in one sentence.',
					},
				],
			},
		},
	};
	const exampleResponse = {
		jsonrpc: '2.0',
		id: 1,
		result: {
			content: [
				{ type: 'text', text: 'IBM Granite is a family of open foundation models...' },
			],
			structuredContent: {
				ok: true,
				text: 'IBM Granite is a family of open foundation models...',
				model: 'ibm/granite-3-8b-instruct',
			},
		},
	};
	const requestBodySchema = {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		type: 'object',
		required: ['jsonrpc', 'method'],
		properties: {
			jsonrpc: { type: 'string', const: '2.0' },
			id: { type: ['string', 'number'] },
			method: {
				type: 'string',
				enum: ['initialize', 'tools/list', 'tools/call', 'ping'],
				description: 'MCP JSON-RPC method.',
			},
			params: {
				type: 'object',
				description:
					'For tools/call: { name, arguments }. Tool names: ibm_granite_chat, ibm_granite_code, ibm_granite_embed, ibm_granite_analyze, ibm_granite_forecast; see tools/list.',
			},
		},
	};
	const responseBodySchema = {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		type: 'object',
		properties: {
			jsonrpc: { type: 'string', const: '2.0' },
			id: { type: ['string', 'number'] },
			result: {
				type: 'object',
				properties: {
					content: {
						type: 'array',
						items: {
							type: 'object',
							required: ['type', 'text'],
							properties: {
								type: { type: 'string', enum: ['text'] },
								text: { type: 'string' },
							},
						},
					},
				},
			},
			error: {
				type: 'object',
				properties: { code: { type: 'number' }, message: { type: 'string' } },
			},
		},
	};
	return {
		discoverable: true,
		info: {
			input: { type: 'http', method: 'POST', body: exampleBody, bodyType: 'json' },
			output: { type: 'json', example: exampleResponse },
		},
		schema: buildBazaarSchema({
			method: 'POST',
			bodyType: 'json',
			bodySchema: requestBodySchema,
			outputSchema: responseBodySchema,
		}),
	};
}

// The challenge override block threaded into authenticateRequest/handleSse so
// the 402 envelope advertises Granite service metadata + discovery.
export const GRANITE_CHALLENGE = {
	description: RESOURCE_DESCRIPTION,
	bazaar: graniteBazaarExtension(),
	...withService({
		serviceName: 'three.ws Granite x402',
		tags: ['x402', 'mcp', 'ibm', 'granite', 'ai'],
	}),
};
