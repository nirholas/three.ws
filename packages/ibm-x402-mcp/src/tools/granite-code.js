// `ibm_granite_code` — paid MCP tool: code generation and review via IBM Granite.
//
// Price: $0.025 USDC (exact, Solana). Uses IBM Granite's code-capable instruct
// models for generation, review, refactoring, and explanation tasks.

import { z } from 'zod';
import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod, generativeAnnotations } from './_shared.js';
import { WatsonxError } from '../watsonx.js';

const TOOL_NAME = 'ibm_granite_code';
const TOOL_DESCRIPTION =
	'Code generation, review, refactoring, and explanation via IBM Granite instruct models. ' +
	'Provide a task type and code/prompt; receive the generated or reviewed code with explanation. ' +
	'Use this when the input is source code or a request to write code; for general conversation call ibm_granite_chat instead. ' +
	'No IBM Cloud account required — pay $0.025 USDC per call via x402.';

const TASK_DESCRIPTIONS = {
	generate: 'Generate new code from the prompt description.',
	review: 'Review the provided code for bugs, security issues, and improvements.',
	refactor: 'Refactor the code for clarity, performance, and best practices.',
	explain: 'Explain what the code does in plain language.',
	test: 'Generate unit tests for the provided code.',
	document: 'Add inline documentation and docstrings to the code.',
};

const inputZodShape = {
	task: z
		.enum(['generate', 'review', 'refactor', 'explain', 'test', 'document'])
		.describe(
			'Code task: generate (new code from description), review (bugs/security), refactor (quality), explain (plain language), test (unit tests), or document (add docstrings).',
		),
	prompt: z
		.string()
		.min(1)
		.max(16_000)
		.describe(
			'For "generate": describe what to build. For all others: paste the code to process.',
		),
	language: z
		.string()
		.optional()
		.describe('Target programming language (e.g. "TypeScript", "Python", "Rust"). Optional for explain/review.'),
	context: z
		.string()
		.max(4_000)
		.optional()
		.describe('Additional context: architecture notes, constraints, or example usage.'),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

function buildSystemPrompt(task, language) {
	const lang = language ? ` in ${language}` : '';
	const base = `You are an expert software engineer${lang}. ${TASK_DESCRIPTIONS[task]}`;
	const format =
		task === 'review'
			? ' Structure your response as: FINDINGS (bulleted issues with severity), then RECOMMENDATIONS.'
			: task === 'explain'
				? ' Be concise and clear. Use plain language suitable for a code review.'
				: ' Return only the code block, then a brief explanation of key decisions.';
	return base + format;
}

export async function buildGraniteCodeTool(client) {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			priceUsd: '$0.025',
			inputSchema: inputJsonSchema,
			example: {
				task: 'generate',
				prompt: 'A debounce function with TypeScript generics and a cancel method.',
				language: 'TypeScript',
			},
			outputExample: {
				ok: true,
				task: 'generate',
				text: 'function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number) { ... }',
				usage: { input_tokens: 42, generated_tokens: 190 },
				model: 'ibm/granite-3-8b-instruct',
			},
		},
		async ({ task, prompt, language, context }) => {
			try {
				const systemContent = buildSystemPrompt(task, language);
				const userContent = context ? `${prompt}\n\nContext: ${context}` : prompt;
				const result = await client.chat(
					[
						{ role: 'system', content: systemContent },
						{ role: 'user', content: userContent },
					],
					{
						parameters: {
							max_new_tokens: 2048,
							temperature: task === 'generate' ? 0.3 : 0.1,
						},
					},
				);
				return { ok: true, task, ...result };
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
		title: 'IBM Granite Code ($0.025)',
		description: TOOL_DESCRIPTION,
		annotations: generativeAnnotations,
		inputSchema: inputZodShape,
		handler,
	};
}
