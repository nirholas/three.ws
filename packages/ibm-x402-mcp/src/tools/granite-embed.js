// `ibm_granite_embed` — paid MCP tool: text embeddings via IBM Granite.
//
// Price: $0.005 USDC (exact, Solana). Batch-embeds up to 64 texts per call
// using IBM's multilingual Granite embedding model, returning vectors suitable
// for semantic search, RAG retrieval, clustering, and similarity scoring.

import { z } from 'zod';
import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod, deterministicAnnotations } from './_shared.js';
import { WatsonxError } from '../watsonx.js';

const TOOL_NAME = 'ibm_granite_embed';
const TOOL_DESCRIPTION =
	'Generate embedding vectors for one or more texts using IBM Granite ' +
	'(default: ibm/granite-embedding-278m-multilingual). Returns one float array per input, ' +
	'suitable for semantic search, RAG retrieval, and similarity scoring. ' +
	'Use this to index documents or compare texts by meaning; it returns vectors, not prose, so call ibm_granite_chat when you need a written answer. ' +
	'Up to 64 texts per call. No IBM Cloud account required — pay $0.005 USDC per call via x402.';

const inputZodShape = {
	inputs: z
		.array(z.string().min(1).max(8_000))
		.min(1)
		.max(64)
		.describe('Texts to embed. 1–64 strings per call, up to 8,000 characters each.'),
	model: z
		.string()
		.optional()
		.describe(
			'Override the embedding model id (e.g. ibm/granite-embedding-125m-english). Defaults to ibm/granite-embedding-278m-multilingual.',
		),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildGraniteEmbedTool(client) {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			priceUsd: '$0.005',
			inputSchema: inputJsonSchema,
			example: {
				inputs: ['enterprise AI platform', 'cloud-native machine learning'],
			},
			outputExample: {
				ok: true,
				model: 'ibm/granite-embedding-278m-multilingual',
				inputCount: 2,
				dimensions: 768,
				vectors: [[0.012, -0.034, 0.091], [0.008, -0.027, 0.088]],
			},
		},
		async ({ inputs, model }) => {
			try {
				const result = await client.embed(inputs, { model });
				return { ok: true, ...result };
			} catch (err) {
				if (err instanceof WatsonxError) {
					return toolError('watsonx_error', err.message, { status: err.status });
				}
				return toolError('internal_error', err.message);
			}
		},
	);

	return {
		name: TOOL_NAME,
		title: 'IBM Granite Embed ($0.005)',
		description: TOOL_DESCRIPTION,
		annotations: deterministicAnnotations,
		inputSchema: inputZodShape,
		handler,
	};
}
