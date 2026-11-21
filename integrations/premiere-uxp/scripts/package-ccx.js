'use strict';

/**
 * Build the .ccx (a zip with manifest.json at its root) and validate the manifest.
 *
 * Adobe's own packager, `@adobe/uxp-devtools-cli` (`uxp plugin package`), drives the UXP Developer
 * Tool service, which only runs on macOS and Windows. This script produces the same layout
 * deterministically anywhere (fixed timestamps, sorted entries) so the SHA-256 is reproducible,
 * and checks the manifest against scripts/manifest.schema.json plus the rules the UXP loader enforces
 * (every referenced icon exists, the entry HTML and its script exist).
 *
 *   node scripts/package-ccx.js           build dist/<id>-<version>.ccx and print its SHA-256
 *   node scripts/package-ccx.js --check   validate only
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Ajv = require('ajv');
const { zipSync, unzipSync } = require('fflate');

const root = path.resolve(__dirname, '..');
const INCLUDE = ['manifest.json', 'index.html', 'styles.css', 'src', 'icons'];
const FIXED_TIME = Date.UTC(2026, 0, 1);

function walk(rel) {
	const abs = path.join(root, rel);
	const st = fs.statSync(abs);
	if (st.isFile()) return [rel];
	return fs
		.readdirSync(abs)
		.sort()
		.flatMap((name) => walk(path.posix.join(rel.split(path.sep).join('/'), name)));
}

function validateManifest() {
	const errors = [];
	const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
	const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.schema.json'), 'utf8'));
	const ajv = new Ajv({ allErrors: true, strict: false });
	const validate = ajv.compile(schema);
	if (!validate(manifest)) {
		for (const e of validate.errors) errors.push(`manifest${e.instancePath} ${e.message}`);
	}
	const exists = (p) => fs.existsSync(path.join(root, p));
	if (!exists(manifest.main)) errors.push(`main ${manifest.main} is missing`);
	const icons = [...(manifest.icons || []), ...manifest.entrypoints.flatMap((e) => e.icons || [])];
	for (const icon of icons) {
		const scales = icon.scale || [1];
		for (const s of scales) {
			const file = s === 1 ? icon.path : icon.path.replace(/(\.[a-z]+)$/i, `@${s}x$1`);
			if (!exists(file)) errors.push(`icon ${file} is missing`);
		}
	}
	const html = fs.readFileSync(path.join(root, manifest.main), 'utf8');
	for (const m of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
		if (!/^[a-z]+:/i.test(m[1]) && !exists(m[1])) errors.push(`${manifest.main} references missing file ${m[1]}`);
	}
	const domains = (manifest.requiredPermissions.network || {}).domains || [];
	for (const d of domains) if (d === 'https://*' || d === '*') errors.push(`network domain ${d} is too broad`);
	return { manifest, errors };
}

function build() {
	const { manifest, errors } = validateManifest();
	if (errors.length) {
		for (const e of errors) console.error(`invalid: ${e}`);
		process.exit(1);
	}
	const files = INCLUDE.flatMap(walk);
	const entries = {};
	for (const rel of files) {
		entries[rel] = [new Uint8Array(fs.readFileSync(path.join(root, rel))), { mtime: FIXED_TIME, level: 9 }];
	}
	const zip = zipSync(entries);
	const dist = path.join(root, 'dist');
	fs.mkdirSync(dist, { recursive: true });
	const out = path.join(dist, `${manifest.id}-${manifest.version}.ccx`);
	fs.writeFileSync(out, zip);

	const readBack = unzipSync(new Uint8Array(fs.readFileSync(out)));
	const names = Object.keys(readBack);
	if (!names.includes('manifest.json')) throw new Error('manifest.json is not at the archive root');
	const packed = JSON.parse(Buffer.from(readBack['manifest.json']).toString('utf8'));
	if (packed.id !== manifest.id || packed.version !== manifest.version) throw new Error('packed manifest differs');

	const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
	console.log(JSON.stringify({ file: path.relative(root, out), bytes: zip.length, entries: names.length, sha256: sha, manifestVersion: manifest.manifestVersion, host: manifest.host }, null, 2));
}

if (process.argv.includes('--check')) {
	const { manifest, errors } = validateManifest();
	if (errors.length) {
		for (const e of errors) console.error(`invalid: ${e}`);
		process.exit(1);
	}
	console.log(`manifest ok: ${manifest.id}@${manifest.version} (manifest v${manifest.manifestVersion}, ${manifest.host.app} >= ${manifest.host.minVersion})`);
} else {
	build();
}

module.exports = { validateManifest };
