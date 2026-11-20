// @ts-check
// Build a real OpenAPI 3.1 document FROM the free 3D API catalog entries.
//
// The catalog (see ./index.js) is the single source of truth; this renders it
// into the spec agents and tooling (Swagger UI, openapi-generator, LangChain's
// OpenAPI toolkit) consume. Every path, parameter, requestBody, and response
// schema comes from an entry's normalized `path` / `methods` / `inputSchema` /
// `outputSchema` — nothing is hand-maintained, so the spec can never drift from
// what `/api/3d` lists.
//
// Method-aware: entries carry a `methods` array. A GET emits the input schema as
// query/path `parameters`; a POST/PUT/PATCH emits it as a JSON `requestBody`.
// This mirrors the real endpoints — inspect is GET+POST, generate is POST.

/** @param {string} path @returns {Set<string>} names of `{templated}` segments */
function pathParamNames(path) {
	const names = new Set();
	const re = /\{([^}]+)\}/g;
	let m;
	while ((m = re.exec(path))) names.add(m[1]);
	return names;
}

/** Normalize one property descriptor into an OpenAPI Schema Object. */
function toSchema(prop) {
	if (!prop || typeof prop !== 'object') return { type: 'string' };
	const { description, example, required, ...schema } = prop;
	if (!schema.type && !schema.oneOf && !schema.anyOf && !schema.$ref) schema.type = 'string';
	return schema;
}

/**
 * Convert an entry's `inputSchema` into an OpenAPI `parameters` array (for GET).
 * Accepts either a JSON-Schema object or an array of OpenAPI parameter objects.
 * @param {any} inputSchema
 * @param {Set<string>} inPath
 * @returns {Array<object>}
 */
function toParameters(inputSchema, inPath) {
	if (!inputSchema) {
		return [...inPath].map((name) => ({
			name,
			in: 'path',
			required: true,
			schema: { type: 'string' },
		}));
	}

	if (Array.isArray(inputSchema)) {
		return inputSchema
			.filter((p) => p && typeof p === 'object' && typeof p.name === 'string')
			.map((p) => ({
				name: p.name,
				in: p.in || (inPath.has(p.name) ? 'path' : 'query'),
				required: p.required ?? inPath.has(p.name),
				...(p.description ? { description: p.description } : {}),
				schema: p.schema || toSchema(p),
				...(p.example !== undefined ? { example: p.example } : {}),
			}));
	}

	const properties =
		inputSchema.properties && typeof inputSchema.properties === 'object'
			? inputSchema.properties
			: {};
	const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);
	const params = Object.entries(properties).map(([name, prop]) => {
		const isPath = inPath.has(name);
		const p = /** @type {any} */ (prop || {});
		return {
			name,
			in: isPath ? 'path' : 'query',
			required: isPath || required.has(name),
			...(p.description ? { description: p.description } : {}),
			schema: toSchema(p),
			...(p.example !== undefined ? { example: p.example } : {}),
		};
	});
	for (const name of inPath) {
		if (!params.some((p) => p.name === name)) {
			params.push({ name, in: 'path', required: true, schema: { type: 'string' } });
		}
	}
	return params;
}

/** Build a JSON requestBody (for POST/PUT/PATCH) from an entry's inputSchema. */
function toRequestBody(inputSchema, requestBodyOverride) {
	if (requestBodyOverride && typeof requestBodyOverride === 'object') return requestBodyOverride;
	if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) return null;
	const schema =
		inputSchema.type || inputSchema.properties || inputSchema.$ref
			? inputSchema
			: { type: 'object', properties: inputSchema };
	return {
		required: Array.isArray(inputSchema.required) && inputSchema.required.length > 0,
		content: { 'application/json': { schema } },
	};
}

/** Build the response schema for an entry from its `outputSchema`. */
function toResponseSchema(outputSchema) {
	if (outputSchema && typeof outputSchema === 'object') {
		if (outputSchema.type || outputSchema.properties || outputSchema.$ref) return outputSchema;
		return { type: 'object', properties: outputSchema };
	}
	return { type: 'object', additionalProperties: true };
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * @param {Array<any>} entries normalized 3d-catalog entries
 * @param {{ origin?: string, version?: string }} [opts]
 * @returns {object} OpenAPI 3.1 document
 */
export function buildOpenApiDoc(entries, { origin = 'https://three.ws', version = '1.0.0' } = {}) {
	/** @type {Record<string, any>} */
	const paths = {};

	for (const e of entries) {
		const inPath = pathParamNames(e.path);
		const methods = Array.isArray(e.methods) && e.methods.length ? e.methods : ['GET'];
		if (!paths[e.path]) paths[e.path] = {};

		for (const method of methods) {
			const isBody = BODY_METHODS.has(method);
			const op = {
				operationId: methods.length > 1 ? `${e.slug}_${method.toLowerCase()}` : e.slug,
				summary: e.title || e.slug,
				...(e.description || e.summary ? { description: e.description || e.summary } : {}),
				tags: ['3d'],
				...(isBody
					? {
							...(toRequestBody(e.inputSchema, e.requestBody)
								? { requestBody: toRequestBody(e.inputSchema, e.requestBody) }
								: {}),
							parameters: [...inPath].map((name) => ({
								name,
								in: 'path',
								required: true,
								schema: { type: 'string' },
							})),
						}
					: { parameters: toParameters(e.inputSchema, inPath) }),
				...(e.account ? { security: [{ bearerAuth: [] }] } : {}),
				responses: {
					200: {
						description: e.summary || `${e.title || e.slug} response`,
						content: {
							'application/json': {
								schema: toResponseSchema(e.outputSchema),
								...(e.example !== undefined && e.example !== null
									? { example: e.example }
									: {}),
							},
						},
					},
					400: { description: 'Invalid or missing input.' },
					...(e.account
						? { 401: { description: 'sign_in_required: send a three.ws API key as a Bearer token, or sign in. Accounts are free.' } }
						: {}),
					429: { description: 'Rate limited — retry after the `Retry-After` header.' },
					502: { description: 'Upstream fetch or generation backend failed.' },
				},
			};
			paths[e.path][method.toLowerCase()] = op;
		}
	}

	return {
		openapi: '3.1.0',
		info: {
			title: 'three.ws 3D API',
			version,
			description:
				'A free 3D API for AI agents: turn text into a real GLB model and ' +
				'validate/optimize any glTF/GLB, all from one origin. Inspecting, diffing ' +
				'and print prep need no key. Making a model needs a free three.ws account: ' +
				'send its API key as a Bearer token (operations marked with bearerAuth). ' +
				'Free draft generation and inspection funnel to paid Forge Pro quality ' +
				'tiers and Rigged Avatars. See https://three.ws/docs/3d-api.',
			contact: { name: 'three.ws', url: 'https://three.ws', email: 'support@three.ws' },
			license: { name: 'Free to use', url: 'https://three.ws/docs/3d-api' },
		},
		servers: [{ url: origin, description: 'three.ws production' }],
		tags: [{ name: '3d', description: 'Free text→3D (with an account) and keyless glTF/GLB inspection endpoints.' }],
		paths,
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					description: 'A three.ws API key (free account, make one at https://three.ws/dashboard/api-keys).',
				},
			},
		},
	};
}

/**
 * Minimal structural assertion used by tests and by any caller that wants to
 * fail fast on a malformed doc. Returns an array of problems (empty = valid).
 * @param {any} doc
 * @returns {string[]}
 */
export function validateOpenApiDoc(doc) {
	const problems = [];
	if (!doc || typeof doc !== 'object') return ['document is not an object'];
	if (doc.openapi !== '3.1.0') problems.push(`openapi must be "3.1.0", got ${doc.openapi}`);
	if (!doc.info || typeof doc.info !== 'object') problems.push('info object missing');
	else {
		if (!doc.info.title) problems.push('info.title missing');
		if (!doc.info.version) problems.push('info.version missing');
	}
	if (!doc.paths || typeof doc.paths !== 'object') problems.push('paths object missing');
	else {
		for (const [p, item] of Object.entries(doc.paths)) {
			if (!p.startsWith('/')) problems.push(`path "${p}" must start with "/"`);
			for (const [verb, op] of Object.entries(/** @type {any} */ (item))) {
				if (!HTTP_VERBS.has(verb)) continue;
				const o = /** @type {any} */ (op);
				if (!o.responses || typeof o.responses !== 'object')
					problems.push(`${verb.toUpperCase()} ${p}: responses missing`);
				if (verb === 'get' && !Array.isArray(o.parameters))
					problems.push(`GET ${p}: parameters must be an array`);
			}
		}
	}
	return problems;
}

const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
