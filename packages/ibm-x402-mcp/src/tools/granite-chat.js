// `ibm_granite_chat` — paid MCP tool: conversational AI via IBM Granite.
//
// Price: $0.02 USDC (exact, Solana). No IBM Cloud account needed — server
// handles credentials; end users pay USDC per call.

import { z } from 'zod';
import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod, generativeAnnotations } from './_shared.js';
import { WatsonxError } from '../watsonx.js';

const TOOL_NAME = 'ibm_granite_chat';
const TOOL_DESCRIPTION =
	'Chat completion powered by IBM Granite foundation models (default: ibm/granite-3-8b-instruct). ' +
	'Send a conversation as role/content message pairs and receive the assistant reply with token usage. ' +
	'Use this for open-ended conversation or free-form text generation; for code tasks call ibm_granite_code, and for structured JSON extraction call ibm_granite_analyze. ' +
	'No IBM Cloud account required — pay $0.02 USDC per call via x402.';

const inputZodShape = {
	messages: z
		.array(
			z.object({
				role: z.enum(['system', 'user', 'assistant']).describe('Message role.'),
				content: z.string().min(1).max(32_000).describe('Message text.'),
			}),
		)
		.min(1)
		.max(50)
		.describe('Conversation history. Must include at least one user message.'),
	model: z
		.string()
		.optional()
		.describe(
			'Override the Granite model id (e.g. ibm/granite-3-2b-instruct). Defaults to ibm/granite-3-8b-instruct.',
		),
	max_new_tokens: z
		.number()
		.int()
		.min(1)
		.max(4096)
		.optional()
		.describe('Maximum tokens to generate. Defaults to 1024.'),
	temperature: z
		.number()
		.min(0)
		.max(2)
		.optional()
		.describe('Sampling temperature (0 = deterministic). Defaults to 0.7.'),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildGraniteChatTool(client) {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			priceUsd: '$0.02',
			inputSchema: inputJsonSchema,
			example: {
				messages: [{ role: 'user', content: 'Explain quantum entanglement in two sentences.' }],
			},
			outputExample: {
				ok: true,
				text: 'Quantum entanglement is a phenomenon where two particles...',
				finishReason: 'stop',
				usage: { input_tokens: 14, generated_tokens: 38 },
				model: 'ibm/granite-3-8b-instruct',
			},
		},
		async ({ messages, model, max_new_tokens, temperature }) => {
			try {
				const parameters = {};
				if (max_new_tokens !== undefined) parameters.max_new_tokens = max_new_tokens;
				if (temperature !== undefined) parameters.temperature = temperature;
				const result = await client.chat(messages, {
					model,
					parameters: Object.keys(parameters).length ? parameters : undefined,
				});
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
		title: 'IBM Granite Chat ($0.02)',
		description: TOOL_DESCRIPTION,
		annotations: generativeAnnotations,
		inputSchema: inputZodShape,
		handler,
	};
}
