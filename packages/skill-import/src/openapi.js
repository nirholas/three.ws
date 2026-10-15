// Parse raw OpenAPI/Swagger bytes into a normalized OpenAPI 3.x document.
//
// Swagger 2.0 documents are never hand-rolled into OpenAPI 3: swagger2openapi
// is a well-maintained converter (also used by Postman, APIMatic, and
// readme.com) and is already a dependency of this package for exactly that
// reason.

import yaml from 'js-yaml';
import { convertObj } from 'swagger2openapi';

export class OpenApiParseError extends Error {}

/** Parse JSON or YAML text into a plain object. Throws OpenApiParseError. */
function parseText(text) {
	const trimmed = String(text).trim();
	if (!trimmed) throw new OpenApiParseError('empty document');
	if (trimmed[0] === '{' || trimmed[0] === '[') {
		try {
			return JSON.parse(trimmed);
		} catch (err) {
			throw new OpenApiParseError(`not valid JSON: ${err.message}`);
		}
	}
	try {
		return yaml.load(trimmed);
	} catch (err) {
		throw new OpenApiParseError(`not valid YAML: ${err.message}`);
	}
}

/**
 * @param {string} text raw spec bytes (JSON or YAML)
 * @returns {Promise<{ document: object, convertedFromSwagger2: boolean }>}
 */
export async function parseOpenApiDocument(text) {
	const doc = parseText(text);
	if (!doc || typeof doc !== 'object') {
		throw new OpenApiParseError('document is not an object');
	}

	if (typeof doc.openapi === 'string') {
		if (!/^3\./.test(doc.openapi)) {
			throw new OpenApiParseError(`unsupported openapi version "${doc.openapi}"`);
		}
		return { document: doc, convertedFromSwagger2: false };
	}

	if (typeof doc.swagger === 'string' && doc.swagger.startsWith('2.')) {
		const { openapi } = await convertObj(doc, { patch: true, warnOnly: true });
		return { document: openapi, convertedFromSwagger2: true };
	}

	throw new OpenApiParseError('document has neither "openapi" (3.x) nor "swagger" (2.x)');
}

/** True when text looks like an OpenAPI/Swagger document, without throwing. */
export function looksLikeOpenApi(text) {
	try {
		const doc = parseText(text);
		return Boolean(doc && typeof doc === 'object' && (doc.openapi || doc.swagger));
	} catch {
		return false;
	}
}
