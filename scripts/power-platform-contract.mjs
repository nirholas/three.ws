// scripts/power-platform-contract.mjs
// Contract helpers for the three.ws Power Platform connector: build a request
// exactly the way the connector runtime does from apiDefinition.swagger.json, and
// validate a response against the schema the swagger declares for it.
//
// Used by the live contract test (tests/microsoft-power-platform-connector-live.test.js)
// and the template checks, so a template, the swagger and the production handlers
// cannot drift apart without a failing test.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONNECTOR_DIR = join(root, 'integrations', 'microsoft', 'power-platform-connector');

export function loadDefinition() {
	return JSON.parse(readFileSync(join(CONNECTOR_DIR, 'apiDefinition.swagger.json'), 'utf8'));
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'];

/** Every operation in the definition, keyed by operationId. */
export function operations(def) {
	const out = new Map();
	for (const [path, item] of Object.entries(def.paths || {})) {
		for (const method of HTTP_METHODS) {
			if (item[method]?.operationId) out.set(item[method].operationId, { path, method, op: item[method] });
		}
	}
	return out;
}

function deref(def, node) {
	if (!node || typeof node !== 'object') return node;
	if (typeof node.$ref === 'string') {
		const name = node.$ref.replace('#/definitions/', '');
		const target = def.definitions?.[name];
		if (!target) throw new Error(`unresolved $ref ${node.$ref}`);
		return deref(def, target);
	}
	return node;
}

/**
 * Convert a Swagger 2.0 schema to the JSON Schema the connector runtime enforces:
 * `$ref`s inlined, `x-nullable: true` admitting null, and declared types strict.
 * Undeclared properties stay allowed, as they are in the flow designer.
 */
export function toJsonSchema(def, node) {
	const s = deref(def, node);
	if (!s || typeof s !== 'object') return {};
	const out = {};
	for (const key of ['type', 'format', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'required']) {
		if (key in s) out[key] = structuredClone(s[key]);
	}
	if (s.properties) {
		out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(def, v)]));
	}
	if (s.items) out.items = toJsonSchema(def, s.items);
	if (s['x-nullable'] === true && out.type) {
		out.type = [out.type, 'null'];
		if (out.enum) out.enum = [...out.enum, null];
	}
	return out;
}

let ajv = null;
function validator() {
	if (!ajv) {
		ajv = new Ajv({ strict: false, allErrors: true });
		addFormats(ajv);
		for (const f of ['int32', 'int64', 'float', 'double']) ajv.addFormat(f, true);
	}
	return ajv;
}

/** Validate a response body against the schema declared for operationId + status. */
export function validateResponse(def, operationId, status, body) {
	const entry = operations(def).get(operationId);
	if (!entry) return { ok: false, errors: [`unknown operation ${operationId}`] };
	const response = entry.op.responses?.[String(status)];
	if (!response) return { ok: false, errors: [`${operationId} does not declare a ${status} response`] };
	if (!response.schema) return { ok: true, errors: [] };
	const check = validator().compile(toJsonSchema(def, response.schema));
	const ok = check(body);
	return { ok, errors: ok ? [] : check.errors.map((e) => `${e.instancePath || '/'} ${e.message}`) };
}

/**
 * Build the HTTP request the connector sends for operationId with the given
 * inputs. Every input must be a declared parameter (or a declared body property),
 * every required one must be present, and enum values must be allowed, exactly
 * as the designer enforces before a flow can save. With `expressions: true` a
 * string value that is a workflow expression (it starts with `@`) is accepted
 * for an enum input, because its value is only known when the flow runs.
 */
export function buildRequest(def, operationId, inputs = {}, { expressions = false } = {}) {
	const allowed = (list, value) => list.includes(value) || (expressions && typeof value === 'string' && value.startsWith('@'));
	const entry = operations(def).get(operationId);
	if (!entry) throw new Error(`unknown operation ${operationId}`);
	const { path, method, op } = entry;
	const params = op.parameters || [];
	const bodyParam = params.find((p) => p.in === 'body');
	const bodyProps = bodyParam ? deref(def, bodyParam.schema).properties || {} : {};
	const query = new URLSearchParams();
	const body = {};
	const declared = new Set([...params.filter((p) => p.in !== 'body').map((p) => p.name), ...Object.keys(bodyProps)]);
	for (const key of Object.keys(inputs)) {
		if (!declared.has(key)) throw new Error(`${operationId} has no input named ${key}`);
	}
	for (const p of params) {
		if (p.in === 'body') continue;
		const value = inputs[p.name];
		if (value === undefined) {
			if (p.required) throw new Error(`${operationId} requires ${p.name}`);
			continue;
		}
		if (p.enum && !allowed(p.enum, value)) throw new Error(`${operationId} ${p.name} must be one of ${p.enum.join(', ')}`);
		if (p.in === 'query') query.set(p.name, String(value));
		else throw new Error(`${operationId} parameter location ${p.in} is not supported by this builder`);
	}
	if (bodyParam) {
		const required = deref(def, bodyParam.schema).required || [];
		for (const name of required) if (inputs[name] === undefined) throw new Error(`${operationId} requires ${name}`);
		for (const [name, prop] of Object.entries(bodyProps)) {
			if (inputs[name] === undefined) continue;
			if (prop.enum && !allowed(prop.enum, inputs[name])) throw new Error(`${operationId} ${name} must be one of ${prop.enum.join(', ')}`);
			body[name] = inputs[name];
		}
	}
	const qs = query.toString();
	return {
		method: method.toUpperCase(),
		url: `https://${def.host}${path}${qs ? `?${qs}` : ''}`,
		body: bodyParam ? body : undefined,
	};
}
