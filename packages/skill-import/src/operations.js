// Walk an OpenAPI 3.x document into a flat, resolved list of operations.

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Resolve a local "#/a/b/c" $ref against the document root. Returns undefined if unresolved. */
export function resolveRef(doc, ref) {
	if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
	const path = ref.slice(2).split('/').map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
	let node = doc;
	for (const seg of path) {
		if (node == null) return undefined;
		node = node[seg];
	}
	return node;
}

/** Resolve $ref (one hop, then recurse) and merge sibling keys over it, OpenAPI-style. */
function deref(doc, node, seen = new Set()) {
	if (!node || typeof node !== 'object') return node;
	if (!node.$ref) return node;
	if (seen.has(node.$ref)) return {}; // cyclic ref: stop rather than loop forever
	const resolved = resolveRef(doc, node.$ref);
	if (resolved === undefined) return {};
	const next = new Set(seen);
	next.add(node.$ref);
	const { $ref, ...rest } = node;
	return { ...deref(doc, resolved, next), ...rest };
}

/** Recursively dereference every $ref in a schema/object tree, bounded to avoid cycles. */
export function derefDeep(doc, node, depth = 0, seen = new Set()) {
	if (depth > 12 || !node || typeof node !== 'object') return node;
	if (Array.isArray(node)) return node.map((n) => derefDeep(doc, n, depth + 1, seen));
	const resolved = deref(doc, node, seen);
	if (resolved !== node && resolved.$ref) return {}; // unresolved after one hop
	const out = {};
	for (const [k, v] of Object.entries(resolved)) {
		out[k] = v && typeof v === 'object' ? derefDeep(doc, v, depth + 1, seen) : v;
	}
	return out;
}

/**
 * @param {object} doc normalized OpenAPI 3.x document
 * @returns {Array<{
 *   operationId: string, method: string, path: string,
 *   summary: string, description: string,
 *   parameters: Array<{name: string, in: string, required: boolean, schema: object, description: string}>,
 *   requestBody: null | { required: boolean, schema: object, description: string },
 *   security: Array<object>,
 * }>}
 */
export function listOperations(doc) {
	const paths = doc.paths || {};
	const globalSecurity = doc.security || [];
	const seenIds = new Set();
	const out = [];

	for (const [path, pathItem] of Object.entries(paths)) {
		if (!pathItem || typeof pathItem !== 'object') continue;
		const pathLevelParams = (pathItem.parameters || []).map((p) => deref(doc, p));

		for (const method of HTTP_METHODS) {
			const op = pathItem[method];
			if (!op || typeof op !== 'object') continue;

			const ownParams = (op.parameters || []).map((p) => deref(doc, p));
			const byKey = new Map();
			for (const p of [...pathLevelParams, ...ownParams]) {
				if (p?.name && p?.in) byKey.set(`${p.in}:${p.name}`, p);
			}
			const parameters = [...byKey.values()].map((p) => ({
				name: p.name,
				in: p.in,
				required: Boolean(p.required || p.in === 'path'),
				schema: derefDeep(doc, p.schema || { type: 'string' }),
				description: p.description || '',
			}));

			let requestBody = null;
			const rawBody = op.requestBody ? deref(doc, op.requestBody) : null;
			if (rawBody) {
				const content = rawBody.content || {};
				const mediaType = content['application/json'] || Object.values(content)[0] || null;
				requestBody = {
					required: Boolean(rawBody.required),
					schema: derefDeep(doc, mediaType?.schema || { type: 'object' }),
					description: rawBody.description || '',
				};
			}

			let operationId = op.operationId || `${method}_${path}`;
			operationId = operationId.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
			if (!/^[a-zA-Z_]/.test(operationId)) operationId = `op_${operationId}`;
			let unique = operationId;
			let n = 2;
			while (seenIds.has(unique)) unique = `${operationId}_${n++}`;
			seenIds.add(unique);

			out.push({
				operationId: unique,
				method: method.toUpperCase(),
				path,
				summary: op.summary || '',
				description: op.description || op.summary || `${method.toUpperCase()} ${path}`,
				parameters,
				requestBody,
				security: op.security || globalSecurity,
			});
		}
	}
	return out;
}
