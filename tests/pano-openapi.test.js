// /openapi.json coverage for the 360 capture lanes (api/_lib/pano-openapi.js):
// every C4 route and method is documented with an operationId, a tag, auth and
// an error schema; every $ref resolves; every schema compiles as JSON Schema
// 2020-12 (the dialect of OpenAPI 3.1); and every request and response example,
// all of them bodies the real handlers returned, validates against the schema
// it sits under. The document is rendered by the real handler, not rebuilt here.

import { describe, it, expect, beforeAll } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import openapiHandler from '../api/openapi-json.js';
import { PANO_SCHEMAS, PANO_TAGS } from '../api/_lib/pano-openapi.js';

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) {
			this._headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this._headers[k.toLowerCase()];
		},
		end(b) {
			this._body = b || '';
		},
		get headersSent() {
			return false;
		},
		get writableEnded() {
			return false;
		},
	};
}

const mockReq = () => ({
	method: 'GET',
	url: '/openapi.json',
	headers: { accept: 'application/json', origin: 'https://three.ws' },
	socket: { remoteAddress: '127.0.0.1' },
});

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const C4 = {
	'/api/capture-upload/create': ['post'],
	'/api/capture-upload/sign': ['post'],
	'/api/capture-upload/parts': ['post'],
	'/api/capture-upload/complete': ['post'],
	'/api/capture-upload/abort': ['post'],
	'/api/pano-capture': ['get', 'post', 'delete'],
	'/api/pano-scene': ['get', 'post'],
};

function* walk(node, path = []) {
	if (node && typeof node === 'object') {
		yield [node, path];
		for (const [k, v] of Object.entries(node)) yield* walk(v, [...path, k]);
	}
}

/** Every { schema, examples } media object under an operation, with where it sits. */
function* mediaObjects(op) {
	const body = op.requestBody?.content?.['application/json'];
	if (body) yield ['request', body];
	for (const [status, r] of Object.entries(op.responses || {})) {
		const media = r.content?.['application/json'];
		if (media) yield [status, media];
	}
}

describe('/openapi.json: 360 capture lanes', () => {
	let doc;
	let ajv;

	beforeAll(async () => {
		const res = mockRes();
		await openapiHandler(mockReq(), res);
		expect(res.statusCode).toBe(200);
		doc = JSON.parse(res._body);
		ajv = new Ajv2020({ strict: true, allErrors: true });
		addFormats(ajv);
		for (const [name, schema] of Object.entries(doc.components.schemas)) ajv.addSchema(localRefs(schema), `schema:${name}`);
	});

	// Component refs point at schema:<Name>, the id each component is registered under.
	const localRefs = (schema) => JSON.parse(JSON.stringify(schema).replaceAll('"#/components/schemas/', '"schema:'));
	const compile = (schema) => ajv.compile(localRefs(schema));

	it('documents every C4 route and method with an operationId, tag, auth and error schema', () => {
		const tagNames = new Set(doc.tags.map((t) => t.name));
		for (const t of PANO_TAGS) expect(tagNames.has(t.name)).toBe(true);
		for (const [path, methods] of Object.entries(C4)) {
			for (const m of methods) {
				const op = doc.paths[path]?.[m];
				expect(op, `${m.toUpperCase()} ${path}`).toBeTruthy();
				expect(op.operationId).toMatch(/^[a-z_]+$/);
				expect(op.tags.every((t) => tagNames.has(t))).toBe(true);
				expect(op.security).toEqual(expect.arrayContaining([{ bearerAuth: [] }, { apiKeyAuth: [] }]));
				const errors = Object.entries(op.responses).filter(([s]) => Number(s) >= 400);
				expect(errors.length).toBeGreaterThan(0);
				for (const [, r] of errors) {
					expect(r.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/CaptureError' });
				}
			}
		}
	});

	it('uses security schemes and schema refs that exist', () => {
		const schemes = Object.keys(doc.components.securitySchemes);
		for (const path of Object.keys(C4)) {
			for (const [node] of walk(doc.paths[path])) {
				if (typeof node.$ref === 'string') {
					const name = node.$ref.replace('#/components/schemas/', '');
					expect(doc.components.schemas[name], node.$ref).toBeTruthy();
				}
			}
			for (const m of HTTP_METHODS) {
				for (const req of doc.paths[path][m]?.security || []) {
					for (const s of Object.keys(req)) expect(schemes).toContain(s);
				}
			}
		}
	});

	it('keeps operationIds unique across the whole document', () => {
		const seen = new Map();
		for (const [path, item] of Object.entries(doc.paths)) {
			for (const m of HTTP_METHODS) {
				const id = item[m]?.operationId;
				if (!id) continue;
				expect(seen.get(id), `operationId ${id} on ${m} ${path}`).toBeUndefined();
				seen.set(id, `${m} ${path}`);
			}
		}
	});

	it('compiles every capture schema as JSON Schema 2020-12', () => {
		for (const name of Object.keys(PANO_SCHEMAS)) {
			expect(() => compile({ $ref: `#/components/schemas/${name}` }), name).not.toThrow();
		}
	});

	it('validates every captured example against the schema it documents', () => {
		let checked = 0;
		for (const path of Object.keys(C4)) {
			for (const m of HTTP_METHODS) {
				const op = doc.paths[path][m];
				if (!op) continue;
				for (const [where, media] of mediaObjects(op)) {
					const validate = compile(media.schema);
					for (const [name, ex] of Object.entries(media.examples || {})) {
						const ok = validate(ex.value);
						expect(ok, `${m} ${path} ${where} example ${name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
						expect(ex.summary).toBeTruthy();
						checked++;
					}
				}
			}
		}
		expect(checked).toBeGreaterThanOrEqual(30);
	});

	it('rejects bodies the handlers would refuse, so the schemas are not vacuous', () => {
		const create = compile({ $ref: '#/components/schemas/CaptureUploadCreateRequest' });
		expect(create({ filename: 'walk.mp4', content_type: 'video/mp4', size_bytes: 1, kind: 'pano' })).toBe(true);
		expect(create({ filename: 'walk.mp4', content_type: 'application/zip', size_bytes: 1, kind: 'pano' })).toBe(false);
		expect(create({ filename: 'walk.mp4', content_type: 'video/mp4', size_bytes: 8589934593, kind: 'pano' })).toBe(false);
		const capture = compile({ $ref: '#/components/schemas/PanoCaptureRequest' });
		expect(capture({ source_url: 'https://example.org/a.mp4', source_kind: 'mp4' })).toBe(false);
		expect(capture({ source_url: 'https://example.org/a.mp4', source_kind: 'insv', quality: 'ultra' })).toBe(false);
		const error = compile({ $ref: '#/components/schemas/CaptureError' });
		expect(error({ message: 'no code' })).toBe(false);
	});
});
