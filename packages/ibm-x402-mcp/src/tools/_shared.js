import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export { toolError } from '../payments.js';

// MCP ToolAnnotations shared by the inference tools. Every tool is a pure
// model-inference call: nothing local is modified (readOnlyHint) and the call
// reaches external services — watsonx.ai and the x402 facilitator
// (openWorldHint). Generative tools can return different output for identical
// input; embeddings are deterministic for a given model.
export const generativeAnnotations = Object.freeze({
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: true,
	idempotentHint: false,
});

export const deterministicAnnotations = Object.freeze({
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: true,
	idempotentHint: true,
});

export function jsonSchemaFromZod(shape) {
	const schema = zodToJsonSchema(z.object(shape).strict(), {
		$refStrategy: 'none',
		target: 'jsonSchema7',
	});
	delete schema.$schema;
	return schema;
}
