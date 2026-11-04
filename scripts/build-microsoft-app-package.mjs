// scripts/build-microsoft-app-package.mjs
// Build the Microsoft 365 app package for the Partner Center offer type
// "Apps and Agents for M365 and Copilot" from integrations/microsoft/copilot-teams/.
//
//   npm run package:microsoft-app                   build dist/microsoft/three-ws-m365-app.zip
//   npm run package:microsoft-app -- --check        validate everything except the owner values
//   npm run package:microsoft-app -- --refresh-tools  rewrite mcptools.json from the live MCP endpoint
//   npm run package:microsoft-app -- --regen-icons    rewrite color.png and outline.png from public/logo.png
//
// Owner-only values come from the environment and are never defaulted:
//   MS_APP_ID          the app GUID Partner Center assigns to the offer
//   MS_DEVELOPER_NAME  the legal entity name (32 characters or fewer)
//   MS_KEYVAULT_URL    the Azure Key Vault URL that holds the OAuth client details
// --check substitutes clearly marked check-only values so the structure, the schema,
// the icons and the tool file are still validated, and writes no zip.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { zipSync } from 'fflate';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'integrations', 'microsoft', 'copilot-teams');
const outFile = join(root, 'dist', 'microsoft', 'three-ws-m365-app.zip');
const MCP_URL = 'https://three.ws/api/mcp-studio';
const LOGO = join(root, 'public', 'logo.png');

const OWNER_VARS = ['MS_APP_ID', 'MS_DEVELOPER_NAME', 'MS_KEYVAULT_URL'];
const CHECK_ONLY = {
	MS_APP_ID: '00000000-0000-4000-8000-000000000000',
	MS_DEVELOPER_NAME: 'Check Only Developer',
	MS_KEYVAULT_URL: 'https://check-only.vault.azure.net/',
};
const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const PACKAGE_FILES = ['manifest.json', 'mcptools.json', 'intro.md', 'color.png', 'outline.png'];

const read = (name) => readFileSync(join(srcDir, name));
const readText = (name) => readFileSync(join(srcDir, name), 'utf8');

/** Characters Microsoft rejects in the manifest and tool files, mapped to ASCII. */
const ASCII_MAP = new Map([
	['\u2014', ' - '],
	['\u2013', '-'],
	['\u2018', "'"],
	['\u2019', "'"],
	['\u201C', '"'],
	['\u201D', '"'],
	['\u2026', '...'],
	['\u00A0', ' '],
	['\u2192', '->'],
	['\u00D7', 'x'],
]);

export function toAscii(text) {
	let out = '';
	for (const ch of text) out += ASCII_MAP.get(ch) ?? ch;
	return out;
}

function nonAscii(text) {
	const hit = [...text].find((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && !'\n\r\t'.includes(c)));
	return hit ? `U+${hit.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : null;
}

/** Replace ${VAR} tokens in every string of a parsed manifest. */
function fill(node, values) {
	if (typeof node === 'string') return node.replace(/\$\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
	if (Array.isArray(node)) return node.map((n) => fill(n, values));
	if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v, values)]));
	return node;
}

/** The owner values: from env, or the check-only set. Returns { values, missing }. */
export function resolveOwnerValues(env, { check }) {
	const missing = OWNER_VARS.filter((k) => !String(env[k] ?? '').trim());
	if (check) return { values: { ...CHECK_ONLY }, missing: [] };
	return { values: Object.fromEntries(OWNER_VARS.map((k) => [k, String(env[k] ?? '').trim()])), missing };
}

export function loadSchema() {
	const schema = JSON.parse(readFileSync(join(srcDir, 'schema', 'MicrosoftTeams.schema.v1.30.json'), 'utf8'));
	// The published schema declares draft-04. Ajv 8 validates the same keywords under its
	// default dialect once the draft-04 meta-schema reference is dropped.
	delete schema.$schema;
	return schema;
}

/** Build the filled manifest object and return it with every problem found. */
export function buildManifest(values) {
	const problems = [];
	const manifest = fill(JSON.parse(readText('manifest.template.json')), values);

	if (!GUID_RE.test(manifest.id)) problems.push(`MS_APP_ID must be a GUID, got "${manifest.id}"`);
	if (!values.MS_DEVELOPER_NAME || values.MS_DEVELOPER_NAME.length > 32) {
		problems.push('MS_DEVELOPER_NAME must be 1 to 32 characters (the manifest schema limit)');
	}
	if (!/^https:\/\/[^\s/]+\.vault\.azure\.net\/?$/i.test(values.MS_KEYVAULT_URL)) {
		problems.push('MS_KEYVAULT_URL must look like https://<vault-name>.vault.azure.net/');
	}
	if (values.MS_KEYVAULT_URL.length > 128) problems.push('MS_KEYVAULT_URL must be 128 characters or fewer (schema limit on referenceId)');

	const ajv = new Ajv({ strict: false, allErrors: true });
	addFormats(ajv);
	const validate = ajv.compile(loadSchema());
	if (!validate(manifest)) {
		for (const e of validate.errors) problems.push(`manifest schema: ${e.instancePath || '/'} ${e.message}`);
	}
	const bad = nonAscii(JSON.stringify(manifest));
	if (bad) problems.push(`manifest.json contains a non-ASCII character (${bad})`);
	return { manifest, problems };
}

export function checkTools(text) {
	const problems = [];
	let doc;
	try {
		doc = JSON.parse(text);
	} catch (err) {
		return [`mcptools.json is not valid JSON: ${err.message}`];
	}
	if (!Array.isArray(doc.tools) || doc.tools.length === 0) problems.push('mcptools.json needs a non-empty "tools" array');
	const seen = new Set();
	for (const t of doc.tools ?? []) {
		if (!t.name || !t.description || typeof t.inputSchema !== 'object') problems.push(`tool ${t.name || '(unnamed)'} needs name, description and inputSchema`);
		if (seen.has(t.name)) problems.push(`duplicate tool name ${t.name}`);
		seen.add(t.name);
	}
	const bad = nonAscii(text);
	if (bad) problems.push(`mcptools.json contains a non-ASCII character (${bad}); run --refresh-tools`);
	return problems;
}

async function checkIcons() {
	const problems = [];
	for (const [file, size] of [['color.png', 192], ['outline.png', 32]]) {
		if (!existsSync(join(srcDir, file))) {
			problems.push(`${file} is missing; run --regen-icons`);
			continue;
		}
		const meta = await sharp(read(file)).metadata();
		if (meta.format !== 'png' || meta.width !== size || meta.height !== size) {
			problems.push(`${file} must be a ${size}x${size} PNG, got ${meta.width}x${meta.height} ${meta.format}`);
		}
	}
	if (existsSync(join(srcDir, 'outline.png'))) {
		const { data, info } = await sharp(read('outline.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
		let opaque = 0;
		let notWhite = 0;
		for (let i = 0; i < data.length; i += info.channels) {
			if (data[i + 3] > 0) {
				opaque++;
				if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) notWhite++;
			}
		}
		if (opaque === 0) problems.push('outline.png is fully transparent');
		if (notWhite > 0) problems.push('outline.png must be white on transparent');
		if (opaque === info.width * info.height) problems.push('outline.png has no transparent pixels');
	}
	return problems;
}

/** Validate everything and return { problems, files } without touching the disk. */
export async function assemble(values) {
	const { manifest, problems } = buildManifest(values);
	problems.push(...checkTools(readText('mcptools.json')));
	problems.push(...(await checkIcons()));
	for (const ref of [manifest.icons?.color, manifest.icons?.outline, manifest.agentConnectors?.[0]?.toolSource?.remoteMcpServer?.mcpToolDescription?.file]) {
		if (ref && !existsSync(join(srcDir, ref))) problems.push(`manifest references ${ref}, which is not in the source directory`);
	}
	const bad = nonAscii(readText('intro.md'));
	if (bad) problems.push(`intro.md contains a non-ASCII character (${bad})`);
	const files = {
		'manifest.json': Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
		'mcptools.json': read('mcptools.json'),
		'intro.md': read('intro.md'),
		'color.png': existsSync(join(srcDir, 'color.png')) ? read('color.png') : Buffer.alloc(0),
		'outline.png': existsSync(join(srcDir, 'outline.png')) ? read('outline.png') : Buffer.alloc(0),
	};
	return { problems, files };
}

export function zipFiles(files) {
	const entries = {};
	for (const name of PACKAGE_FILES) entries[name] = [new Uint8Array(files[name]), { level: 9, mtime: new Date('2026-01-01T00:00:00Z') }];
	return Buffer.from(zipSync(entries));
}

/** Parse a JSON-RPC reply that is either plain JSON or one or more SSE `data:` frames. */
export function parseRpcReply(body) {
	const trimmed = body.trim();
	if (trimmed.startsWith('{')) return JSON.parse(trimmed);
	const frames = trimmed.split(/\r?\n\r?\n/).map((f) =>
		f
			.split(/\r?\n/)
			.filter((l) => l.startsWith('data:'))
			.map((l) => l.slice(5).trimStart())
			.join('\n'),
	);
	for (const f of frames) {
		if (f.startsWith('{')) {
			const msg = JSON.parse(f);
			if (msg.result || msg.error) return msg;
		}
	}
	throw new Error('No JSON-RPC result in the response');
}

async function refreshTools() {
	const res = await fetch(MCP_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
	});
	if (!res.ok) throw new Error(`${MCP_URL} answered HTTP ${res.status}`);
	const msg = parseRpcReply(await res.text());
	if (msg.error) throw new Error(`tools/list failed: ${msg.error.message}`);
	const tools = msg.result?.tools;
	if (!Array.isArray(tools) || !tools.length) throw new Error('tools/list returned no tools');
	const ascii = JSON.parse(toAscii(JSON.stringify({ tools })));
	const text = `${JSON.stringify(ascii, null, 2)}\n`;
	const problems = checkTools(text);
	if (problems.length) throw new Error(problems.join('\n'));
	writeFileSync(join(srcDir, 'mcptools.json'), text);
	console.log(`mcptools.json rewritten from ${MCP_URL}: ${ascii.tools.length} tools`);
}

async function regenIcons() {
	const trimmed = await sharp(LOGO).trim().png().toBuffer();
	const glyph = (size, pad) =>
		sharp(trimmed).resize(size - pad * 2, size - pad * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

	const colorGlyph = await glyph(192, 16);
	await sharp({ create: { width: 192, height: 192, channels: 4, background: '#080814' } })
		.composite([{ input: colorGlyph, gravity: 'center' }])
		.png()
		.toFile(join(srcDir, 'color.png'));

	const canvas = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
		.composite([{ input: await glyph(32, 3), gravity: 'center' }])
		.png()
		.toBuffer();
	const alpha = await sharp(canvas).extractChannel(3).raw().toBuffer();
	await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } })
		.joinChannel(alpha, { raw: { width: 32, height: 32, channels: 1 } })
		.png()
		.toFile(join(srcDir, 'outline.png'));
	console.log('color.png (192x192) and outline.png (32x32) rewritten from public/logo.png');
}

export async function main(argv = process.argv.slice(2), env = process.env) {
	if (argv.includes('--refresh-tools')) return refreshTools();
	if (argv.includes('--regen-icons')) return regenIcons();

	const check = argv.includes('--check');
	const { values, missing } = resolveOwnerValues(env, { check });
	if (missing.length) {
		console.error(`Missing owner-only environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
		console.error('MS_APP_ID is the app GUID from Partner Center, MS_DEVELOPER_NAME the legal entity name (32 characters or fewer),');
		console.error('MS_KEYVAULT_URL the Azure Key Vault URL. Run with --check to validate everything else without them.');
		return 2;
	}
	const { problems, files } = await assemble(values);
	if (problems.length) {
		console.error(`Package is not valid:\n- ${problems.join('\n- ')}`);
		return 1;
	}
	if (check) {
		console.log(`OK: manifest, schema v1.30, ${JSON.parse(files['mcptools.json']).tools.length} tools, icons and ASCII checks pass (owner values not checked).`);
		return 0;
	}
	mkdirSync(dirname(outFile), { recursive: true });
	const zip = zipFiles(files);
	writeFileSync(outFile, zip);
	console.log(`Wrote ${outFile} (${zip.length} bytes)`);
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
