// Minimal JSON Schema (draft-07 subset) -> zod converter, just expressive
// enough for tools.json's property shapes (string/number/integer/boolean/array,
// enum, min/max, minItems/maxItems, default, description). Named tools are
// authored once as plain JSON in tools.json (so the hosted dispatcher can read
// the same facts without pulling in zod); this turns that JSON into the zod
// shape McpServer.registerTool expects.

import { z } from 'zod';

function propertyToZod(prop) {
	let schema;
	switch (prop.type) {
		case 'string':
			schema = Array.isArray(prop.enum) ? z.enum(prop.enum) : z.string();
			if (!Array.isArray(prop.enum)) {
				if (typeof prop.minLength === 'number') schema = schema.min(prop.minLength);
				if (typeof prop.maxLength === 'number') schema = schema.max(prop.maxLength);
			}
			break;
		case 'integer':
			schema = z.number().int();
			if (typeof prop.minimum === 'number') schema = schema.min(prop.minimum);
			if (typeof prop.maximum === 'number') schema = schema.max(prop.maximum);
			break;
		case 'number':
			schema = z.number();
			if (typeof prop.minimum === 'number') schema = schema.min(prop.minimum);
			if (typeof prop.maximum === 'number') schema = schema.max(prop.maximum);
			break;
		case 'boolean':
			schema = z.boolean();
			break;
		case 'array':
			schema = z.array(prop.items ? propertyToZod(prop.items) : z.any());
			if (typeof prop.minItems === 'number') schema = schema.min(prop.minItems);
			if (typeof prop.maxItems === 'number') schema = schema.max(prop.maxItems);
			break;
		default:
			schema = z.any();
	}
	if (prop.description) schema = schema.describe(prop.description);
	if (prop.default !== undefined) schema = schema.default(prop.default);
	return schema;
}

/**
 * Convert a JSON Schema object (`{ type: 'object', required, properties }`)
 * into a zod raw shape (the plain `{ key: ZodType }` object McpServer's
 * registerTool and tool `def.inputSchema` both expect, as used throughout
 * this package).
 * @param {object} jsonSchema
 * @returns {Record<string, import('zod').ZodTypeAny>}
 */
export function jsonSchemaToZodShape(jsonSchema) {
	const properties = jsonSchema?.properties || {};
	const required = new Set(jsonSchema?.required || []);
	const shape = {};
	for (const [key, prop] of Object.entries(properties)) {
		let field = propertyToZod(prop);
		if (!required.has(key) && prop.default === undefined) field = field.optional();
		shape[key] = field;
	}
	return shape;
}
