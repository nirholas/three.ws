// Spec metadata + operations -> manifest.json (specs/SKILL_SPEC.md shape).
// `requires.secrets` is an extension this package introduces: it names the
// ctx.secrets keys handlers.js reads for auth, so a host never hardcodes a key.

function slugify(text) {
	return String(text || 'imported-skill')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'imported-skill';
}

/**
 * @param {object} doc parsed OpenAPI document
 * @param {Array} operations from listOperations()
 * @param {string[]} secrets secret names handlers.js needs (from generateHandlers())
 * @param {{sourceUrl?: string}} opts
 */
export function generateManifest(doc, operations, secrets, opts = {}) {
	const info = doc.info || {};
	const name = slugify(info.title);
	const manifest = {
		spec: 'skill/0.1',
		name,
		version: '0.1.0',
		description: (info.description || info.title || 'Imported API skill').slice(0, 500),
		author: info.contact?.name || info.contact?.email || 'imported',
		license: info.license?.name || 'unknown',
		tags: ['imported', 'openapi'],
		requires: {
			rig: ['any'],
			runtime: '>=0.1.0',
			tools: [],
			secrets,
		},
		dependencies: {},
		provides: {
			tools: operations.map((op) => op.operationId),
			triggers: ['imported', name],
		},
	};
	if (opts.sourceUrl) manifest.source = { type: 'openapi', url: opts.sourceUrl };
	return manifest;
}
