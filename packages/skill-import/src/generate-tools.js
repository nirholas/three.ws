// Operations -> tools.json (Anthropic/OpenAI-style input_schema, see specs/SKILL_SPEC.md).

function paramSchema(parameters) {
	const properties = {};
	const required = [];
	for (const p of parameters) {
		properties[p.name] = {
			...p.schema,
			description: p.description || p.schema?.description || `${p.in} parameter "${p.name}"`,
		};
		if (p.required) required.push(p.name);
	}
	return { properties, required };
}

/**
 * @param {import('./operations.js').listOperations} operations
 * @returns {{tools: Array<{name: string, description: string, input_schema: object}>}}
 */
export function generateTools(operations) {
	const tools = operations.map((op) => {
		const { properties, required } = paramSchema(op.parameters);

		if (op.requestBody) {
			properties.body = {
				...op.requestBody.schema,
				description: op.requestBody.description || 'Request body',
			};
			if (op.requestBody.required) required.push('body');
		}

		return {
			name: op.operationId,
			description: op.description || op.summary || `${op.method} ${op.path}`,
			input_schema: {
				type: 'object',
				properties,
				required,
			},
		};
	});
	return { tools };
}
