// scripts/build-power-platform-connector.mjs
// Validate and package the three.ws Power Platform connector (Power Automate, Power Apps,
// Logic Apps and Copilot Studio) from integrations/microsoft/power-platform-connector/.
//
//   npm run package:power-platform-connector                build dist/microsoft/three-ws-power-platform-connector/
//   npm run package:power-platform-connector -- --check     validate everything except the owner value, write nothing
//   npm run package:power-platform-connector -- --regen-icon  rewrite icon.png from public/logo.png
//
// The owner-only value comes from the environment and is never defaulted:
//   PP_OAUTH_CLIENT_ID  the public PKCE client registered at https://three.ws/oauth/register
//                       with the connector's per-connector redirect URL
// The output folder is what `paconn create` / `pac connector create` and the
// PowerPlatformConnectors certification pull request take; the zip beside it is the same
// files for upload.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { zipSync } from 'fflate';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'integrations', 'microsoft', 'power-platform-connector');
const outDir = join(root, 'dist', 'microsoft', 'three-ws-power-platform-connector');
const outZip = `${outDir}.zip`;
const LOGO = join(root, 'public', 'logo.png');

const OWNER_VAR = 'PP_OAUTH_CLIENT_ID';
const CHECK_ONLY_CLIENT_ID = 'mcp_checkonlyclientid000';
const PRODUCTION_HOST = 'three.ws';
const PACKAGE_FILES = ['apiDefinition.swagger.json', 'apiProperties.json', 'icon.png', 'intro.md'];

// Certification rules (learn.microsoft.com/connectors/custom-connectors/certification-submission).
const PRODUCT_NAMES = ['Copilot Studio', 'Power Apps', 'Power Automate', 'Power Platform', 'Power BI', 'Power Pages', 'Logic Apps', 'Dataverse'];
const TITLE_BANNED = ['API', 'Connector', ...PRODUCT_NAMES];
const SUMMARY_RE = /^[A-Za-z0-9 ()]+$/;
const BANNED_BRAND_COLORS = new Set(['#ffffff', '#007ee5']);
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];

const readText = (name) => readFileSync(join(srcDir, name), 'utf8');

// ── Schema ───────────────────────────────────────────────────────────────────

// The published Swagger 2.0 schema is draft-04 and points into the draft-04 meta-schema
// for a handful of shared definitions. Ajv 8 does not ship draft-04, so those references
// are replaced with the definitions they name (json-schema.org/draft-04/schema), written
// in the keyword forms Ajv's default dialect reads the same way.
const SIMPLE_TYPES = ['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'];
const DRAFT04 = 'http://json-schema.org/draft-04/schema#';
const DRAFT04_DEFS = {
	'/definitions/positiveInteger': { type: 'integer', minimum: 0 },
	'/definitions/positiveIntegerDefault0': { type: 'integer', minimum: 0, default: 0 },
	'/definitions/stringArray': { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true },
	'/properties/default': {},
	'/properties/description': { type: 'string' },
	'/properties/enum': { type: 'array', minItems: 1, uniqueItems: true },
	'/properties/exclusiveMaximum': { type: 'boolean', default: false },
	'/properties/exclusiveMinimum': { type: 'boolean', default: false },
	'/properties/maximum': { type: 'number' },
	'/properties/minimum': { type: 'number' },
	'/properties/multipleOf': { type: 'number', exclusiveMinimum: 0 },
	'/properties/pattern': { type: 'string', format: 'regex' },
	'/properties/title': { type: 'string' },
	'/properties/type': {
		anyOf: [
			{ enum: SIMPLE_TYPES },
			{ type: 'array', items: { enum: SIMPLE_TYPES }, minItems: 1, uniqueItems: true },
		],
	},
	'/properties/uniqueItems': { type: 'boolean', default: false },
};

function inlineDraft04(node) {
	if (Array.isArray(node)) return node.map(inlineDraft04);
	if (!node || typeof node !== 'object') return node;
	if (typeof node.$ref === 'string' && node.$ref.startsWith(DRAFT04)) {
		const def = DRAFT04_DEFS[node.$ref.slice(DRAFT04.length)];
		if (!def) throw new Error(`swagger schema references an unmapped draft-04 definition: ${node.$ref}`);
		return structuredClone(def);
	}
	return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, inlineDraft04(v)]));
}

export function loadSwaggerSchema() {
	const schema = JSON.parse(readText('schema/swagger-2.0.schema.json'));
	delete schema.$schema;
	if (schema.id) {
		schema.$id = schema.id;
		delete schema.id;
	}
	return inlineDraft04(schema);
}

let compiled = null;
function swaggerValidator() {
	if (!compiled) {
		const ajv = new Ajv({ strict: false, allErrors: true });
		addFormats(ajv);
		compiled = ajv.compile(loadSwaggerSchema());
	}
	return compiled;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Replace ${VAR} tokens in every string of a parsed JSON document. */
function fill(node, values) {
	if (typeof node === 'string') return node.replace(/\$\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
	if (Array.isArray(node)) return node.map((n) => fill(n, values));
	if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v, values)]));
	return node;
}

function nonAscii(text) {
	const hit = [...text].find((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && !'\n\r\t'.includes(c)));
	return hit ? `U+${hit.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : null;
}

const endsWithPunctuation = (s) => /[.!?)]$/.test(String(s).trim());
const namesProduct = (s) => PRODUCT_NAMES.find((p) => String(s).toLowerCase().includes(p.toLowerCase()));

function resolveRef(doc, ref) {
	if (!ref.startsWith('#/')) return undefined;
	return ref.slice(2).split('/').reduce((n, key) => (n == null ? undefined : n[key.replace(/~1/g, '/').replace(/~0/g, '~')]), doc);
}

function walk(node, visit, path = '') {
	if (Array.isArray(node)) {
		node.forEach((n, i) => walk(n, visit, `${path}/${i}`));
		return;
	}
	if (!node || typeof node !== 'object') return;
	visit(node, path);
	for (const [k, v] of Object.entries(node)) walk(v, visit, `${path}/${k}`);
}

function checkSummary(label, value, problems) {
	if (typeof value !== 'string' || !value.trim()) {
		problems.push(`${label} is missing`);
		return;
	}
	if (value.length > 80) problems.push(`${label} "${value}" is longer than 80 characters`);
	if (!SUMMARY_RE.test(value)) problems.push(`${label} "${value}" may only contain letters, digits, spaces and parentheses`);
	const product = namesProduct(value);
	if (product) problems.push(`${label} "${value}" names the product ${product}`);
}

function checkDescription(label, value, problems) {
	if (typeof value !== 'string' || !value.trim()) {
		problems.push(`${label} is missing`);
		return;
	}
	if (!endsWithPunctuation(value)) problems.push(`${label} must be a full sentence ending in punctuation`);
	const product = namesProduct(value);
	if (product) problems.push(`${label} names the product ${product}`);
}

// ── Definition checks ────────────────────────────────────────────────────────

/** Schema validation plus the certification rules for the OpenAPI definition. */
export function checkDefinition(def) {
	const problems = [];
	const validate = swaggerValidator();
	if (!validate(def)) {
		for (const e of validate.errors) problems.push(`swagger schema: ${e.instancePath || '/'} ${e.message}`);
	}

	const title = def.info?.title ?? '';
	if (!title || title.length > 30) problems.push(`info.title must be 1 to 30 characters, got ${title.length}`);
	if (!/[A-Za-z0-9]$/.test(title)) problems.push('info.title must end in a letter or digit');
	for (const word of TITLE_BANNED) {
		if (new RegExp(`\\b${word}\\b`, 'i').test(title)) problems.push(`info.title must not contain "${word}"`);
	}
	const description = def.info?.description ?? '';
	if (description.length <= 30 || description.length >= 500) problems.push(`info.description must be 31 to 499 characters, got ${description.length}`);
	const product = namesProduct(description);
	if (product) problems.push(`info.description names the product ${product}`);
	if (!def.info?.contact?.name || !def.info?.contact?.url || !def.info?.contact?.email) problems.push('info.contact needs a name, url and email');

	if (def.host !== PRODUCTION_HOST) problems.push(`host must be the production host ${PRODUCTION_HOST}, got ${def.host}`);
	if (JSON.stringify(def.schemes) !== '["https"]') problems.push('schemes must be exactly ["https"]');

	const meta = Object.fromEntries((def['x-ms-connector-metadata'] || []).map((m) => [m.propertyName, m.propertyValue]));
	for (const key of ['Website', 'Privacy policy', 'Categories']) {
		if (!meta[key]) problems.push(`x-ms-connector-metadata is missing "${key}"`);
	}
	for (const key of ['Website', 'Privacy policy']) {
		if (meta[key] && !/^https:\/\//.test(meta[key])) problems.push(`x-ms-connector-metadata "${key}" must be an https URL`);
	}

	const operationIds = new Map();
	const securityScopes = new Set();
	for (const scheme of Object.values(def.securityDefinitions || {})) {
		for (const scope of Object.keys(scheme.scopes || {})) securityScopes.add(scope);
	}

	for (const [path, item] of Object.entries(def.paths || {})) {
		for (const method of HTTP_METHODS) {
			const op = item[method];
			if (!op) continue;
			const where = `${method.toUpperCase()} ${path}`;
			if (!op.operationId) problems.push(`${where} has no operationId`);
			else if (operationIds.has(op.operationId)) problems.push(`operationId ${op.operationId} is used twice`);
			else operationIds.set(op.operationId, op.summary);
			checkSummary(`${where} summary`, op.summary, problems);
			checkDescription(`${where} description`, op.description, problems);
			if (!op['x-ms-visibility']) problems.push(`${where} has no x-ms-visibility`);

			const responses = op.responses || {};
			if ('default' in responses) problems.push(`${where} must not use a default response`);
			const ok = Object.keys(responses).filter((code) => /^2\d\d$/.test(code));
			if (!ok.length) problems.push(`${where} has no 2xx response`);
			for (const code of ok) {
				const schema = responses[code].schema;
				if (!schema || (!schema.$ref && !schema.properties && !schema.items)) problems.push(`${where} ${code} needs an exact response schema`);
			}

			for (const param of op.parameters || []) {
				const label = `${where} parameter ${param.name}`;
				if (param.in === 'body') {
					const props = param.schema?.properties || {};
					if (!Object.keys(props).length) problems.push(`${label} body schema has no properties`);
					for (const [name, prop] of Object.entries(props)) {
						checkSummary(`${label}.${name} x-ms-summary`, prop['x-ms-summary'], problems);
						checkDescription(`${label}.${name} description`, prop.description, problems);
					}
				} else {
					checkSummary(`${label} x-ms-summary`, param['x-ms-summary'], problems);
					checkDescription(`${label} description`, param.description, problems);
				}
			}
		}
	}

	walk(def, (node, at) => {
		if (typeof node.$ref === 'string' && resolveRef(def, node.$ref) === undefined) problems.push(`${at} $ref ${node.$ref} does not resolve`);
		const dyn = node['x-ms-dynamic-values'];
		if (dyn && !operationIds.has(dyn.operationId)) problems.push(`${at} x-ms-dynamic-values names unknown operation ${dyn.operationId}`);
		if (typeof node['x-ms-summary'] === 'string') checkSummary(`${at} x-ms-summary`, node['x-ms-summary'], problems);
		if (typeof node.description === 'string' && !at.startsWith('/paths') && !at.startsWith('/info')) {
			checkDescription(`${at} description`, node.description, problems);
		}
	});

	for (const req of def.security || []) {
		for (const [name, scopes] of Object.entries(req)) {
			if (!def.securityDefinitions?.[name]) problems.push(`security names undefined scheme ${name}`);
			for (const s of scopes) if (!securityScopes.has(s)) problems.push(`security scope ${s} is not declared in securityDefinitions`);
		}
	}

	const bad = nonAscii(JSON.stringify(def));
	if (bad) problems.push(`apiDefinition.swagger.json contains a non-ASCII character (${bad})`);
	return { problems: [...new Set(problems)], operationIds };
}

// ── Properties checks ────────────────────────────────────────────────────────

/** Fill the owner value into apiProperties and check it against the definition. */
export function buildProperties(values, def) {
	const problems = [];
	const props = fill(JSON.parse(readText('apiProperties.template.json')), values);
	const p = props.properties || {};
	const token = p.connectionParameters?.token;
	const oauth = token?.oAuthSettings;

	if (!token || token.type !== 'oauthSetting' || !oauth) problems.push('connectionParameters.token must be an oauthSetting');
	else {
		if (oauth.identityProvider !== 'oauth2generic') problems.push('identityProvider must be oauth2generic (the only generic provider that sends a PKCE challenge)');
		if (oauth.redirectMode !== 'GlobalPerConnector') problems.push('redirectMode must be GlobalPerConnector (certification requirement)');
		if (!/^[A-Za-z0-9_-]{8,}$/.test(oauth.clientId || '')) problems.push(`${OWNER_VAR} must be the client_id /oauth/register returned, got "${oauth.clientId}"`);
		const cp = oauth.customParameters || {};
		const tmpl = (k) => cp[k]?.value || '';
		const urls = { authorize: 'https://three.ws/oauth/authorize', token: 'https://three.ws/oauth/token' };
		if (tmpl('authorizationUrlTemplate') !== urls.authorize) problems.push(`authorizationUrlTemplate must be ${urls.authorize}`);
		if (tmpl('tokenUrlTemplate') !== urls.token || tmpl('refreshUrlTemplate') !== urls.token) problems.push(`tokenUrlTemplate and refreshUrlTemplate must be ${urls.token}`);
		const query = tmpl('authorizationUrlQueryStringTemplate');
		for (const part of ['{CodeChallenge}', 'code_challenge_method=S256', '{RedirectUrl}', '{State}', '{Scopes}', 'response_type=code']) {
			if (!query.includes(part)) problems.push(`authorizationUrlQueryStringTemplate must include ${part} (three.ws requires S256 PKCE)`);
		}
		if (!tmpl('tokenBodyTemplate').includes('code_verifier={CodeVerifier}')) problems.push('tokenBodyTemplate must send code_verifier={CodeVerifier}');
		if (!tmpl('refreshBodyTemplate').includes('grant_type=refresh_token')) problems.push('refreshBodyTemplate must use grant_type=refresh_token');
		if (tmpl('scopeListDelimiter') !== ' ') problems.push('scopeListDelimiter must be a single space');

		const declared = new Set();
		for (const req of def.security || []) for (const scopes of Object.values(req)) scopes.forEach((s) => declared.add(s));
		const asked = new Set(oauth.scopes || []);
		if ([...declared].sort().join(' ') !== [...asked].sort().join(' ')) {
			problems.push(`apiProperties scopes (${[...asked].join(' ')}) must match the definition's security scopes (${[...declared].join(' ')})`);
		}
		if (!asked.has('offline_access')) problems.push('scopes must include offline_access so connections refresh instead of expiring after an hour');
		const ui = token.uiDefinition || {};
		if (!ui.displayName || !ui.description || !ui.tooltip) problems.push('token.uiDefinition needs displayName, description and tooltip');
	}

	const color = String(p.iconBrandColor || '').toLowerCase();
	if (!/^#[0-9a-f]{6}$/.test(color)) problems.push(`iconBrandColor must be a #rrggbb color, got "${p.iconBrandColor}"`);
	else if (BANNED_BRAND_COLORS.has(color)) problems.push(`iconBrandColor must not be ${color}`);
	if (!p.publisher || !p.stackOwner) problems.push('publisher and stackOwner are required');
	if (!Array.isArray(p.capabilities)) problems.push('capabilities must be an array');

	const bad = nonAscii(JSON.stringify(props));
	if (bad) problems.push(`apiProperties.json contains a non-ASCII character (${bad})`);
	return { properties: props, problems };
}

// ── Icon ─────────────────────────────────────────────────────────────────────

function hex(r, g, b) {
	return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Icon rules: square PNG, 100 to 230 px, opaque brand-color background, glyph within 70%. */
export async function checkIcon(buffer, brandColor) {
	const problems = [];
	const meta = await sharp(buffer).metadata();
	if (meta.format !== 'png') problems.push(`icon.png must be a PNG, got ${meta.format}`);
	if (meta.width !== meta.height) problems.push(`icon.png must be square, got ${meta.width}x${meta.height}`);
	if (meta.width < 100 || meta.width > 230) problems.push(`icon.png must be 100 to 230 px wide, got ${meta.width}`);
	const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const px = (x, y) => {
		const i = (y * info.width + x) * info.channels;
		return [data[i], data[i + 1], data[i + 2], data[i + 3]];
	};
	let transparent = false;
	for (let i = 3; i < data.length; i += info.channels) {
		if (data[i] < 255) {
			transparent = true;
			break;
		}
	}
	if (transparent) problems.push('icon.png must be fully opaque');
	const [r, g, b] = px(0, 0);
	const bg = hex(r, g, b);
	if (bg !== String(brandColor).toLowerCase()) problems.push(`icon.png background ${bg} must match iconBrandColor ${brandColor}`);

	// The glyph is every pixel that differs from the background; its box must stay
	// inside 70% of the canvas in both directions.
	let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
	for (let y = 0; y < info.height; y++) {
		for (let x = 0; x < info.width; x++) {
			const [pr, pg, pb] = px(x, y);
			if (Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) > 24) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < 0) problems.push('icon.png has no visible glyph');
	else {
		const w = (maxX - minX + 1) / info.width;
		const h = (maxY - minY + 1) / info.height;
		if (w > 0.7 || h > 0.7) problems.push(`icon.png glyph covers ${Math.round(w * 100)}% x ${Math.round(h * 100)}%, must stay within 70%`);
	}
	return problems;
}

async function regenIcon() {
	const props = JSON.parse(readText('apiProperties.template.json'));
	const color = props.properties.iconBrandColor;
	const size = 230;
	const glyphSize = Math.floor(size * 0.6);
	const glyph = await sharp(LOGO).trim().resize(glyphSize, glyphSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
	await sharp({ create: { width: size, height: size, channels: 3, background: color } })
		.composite([{ input: glyph, gravity: 'center' }])
		.flatten({ background: color })
		.removeAlpha()
		.png()
		.toFile(join(srcDir, 'icon.png'));
	console.log(`icon.png (${size}x${size}) rewritten from public/logo.png on ${color}`);
}

// ── Assemble ─────────────────────────────────────────────────────────────────

export function resolveOwnerValue(env, { check }) {
	if (check) return { values: { [OWNER_VAR]: CHECK_ONLY_CLIENT_ID }, missing: false };
	const value = String(env[OWNER_VAR] ?? '').trim();
	return { values: { [OWNER_VAR]: value }, missing: !value };
}

export async function assemble(values) {
	const problems = [];
	let def;
	try {
		def = JSON.parse(readText('apiDefinition.swagger.json'));
	} catch (err) {
		return { problems: [`apiDefinition.swagger.json is not valid JSON: ${err.message}`], files: {} };
	}
	const defCheck = checkDefinition(def);
	problems.push(...defCheck.problems);
	const { properties, problems: propProblems } = buildProperties(values, def);
	problems.push(...propProblems);

	const icon = readFileSync(join(srcDir, 'icon.png'));
	problems.push(...(await checkIcon(icon, properties.properties?.iconBrandColor)));

	const intro = readText('intro.md');
	for (const [id, summary] of defCheck.operationIds) {
		if (!summary || !intro.includes(summary)) problems.push(`intro.md does not document the ${id} action ("${summary}")`);
	}
	for (const heading of ['## Prerequisites', '## Obtaining credentials', '## Known issues and limitations']) {
		if (!intro.includes(heading)) problems.push(`intro.md is missing the "${heading}" section certification asks for`);
	}
	const bad = nonAscii(intro);
	if (bad) problems.push(`intro.md contains a non-ASCII character (${bad})`);

	const files = {
		'apiDefinition.swagger.json': Buffer.from(`${JSON.stringify(def, null, 2)}\n`),
		'apiProperties.json': Buffer.from(`${JSON.stringify(properties, null, 2)}\n`),
		'icon.png': icon,
		'intro.md': Buffer.from(intro),
	};
	return { problems, files, operations: defCheck.operationIds.size };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
	if (argv.includes('--regen-icon')) return regenIcon();
	const check = argv.includes('--check');
	const { values, missing } = resolveOwnerValue(env, { check });
	if (missing) {
		console.error(`Missing owner-only environment variable ${OWNER_VAR}: the client_id from registering the connector's`);
		console.error('public PKCE client at https://three.ws/oauth/register (see the README). Run with --check to validate everything else.');
		return 2;
	}
	const { problems, files, operations } = await assemble(values);
	if (problems.length) {
		console.error(`Connector is not valid:\n- ${problems.join('\n- ')}`);
		return 1;
	}
	if (check) {
		console.log(`OK: Swagger 2.0 schema, ${operations} operations, certification rules, OAuth PKCE settings, icon and intro.md pass (client id not checked).`);
		return 0;
	}
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	for (const name of PACKAGE_FILES) writeFileSync(join(outDir, name), files[name]);
	const zip = Buffer.from(zipSync(Object.fromEntries(PACKAGE_FILES.map((n) => [n, new Uint8Array(files[n])]))));
	writeFileSync(outZip, zip);
	console.log(`Wrote ${outDir}/ and ${outZip} (${zip.length} bytes)`);
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().then(
		(code) => process.exit(code ?? 0),
		(err) => {
			console.error(err.message);
			process.exit(1);
		},
	);
}
