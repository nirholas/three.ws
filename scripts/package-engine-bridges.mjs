#!/usr/bin/env node
// Package and validate the Unity, Godot and Unreal engine bridges for their stores.
//
//   node scripts/package-engine-bridges.mjs [--out dist/engine-stores] [--only unity|godot|unreal] [--check]
//
// Output per bridge: a deterministic .zip (sorted entries, fixed timestamps, so the same
// source tree always yields the same SHA-256), store artwork rendered from the platform
// favicon, and one entry in manifest.json with the hash, file list and validation results.
// Exit code 1 if any validation fails. Nothing is uploaded: the owner submits.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXED_MTIME = Date.UTC(2026, 0, 1, 0, 0, 0);
const BANNED_DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const LEFTOVER = /\b(TODO|FIXME|XXX)\b|not implemented/i;
const TEXT_EXT = /\.(cs|gd|cpp|h|cfg|json|md|tscn|godot|uplugin|asmdef|cs|txt)$/i;

function readJson(p) {
	return JSON.parse(readFileSync(p, 'utf8'));
}

const BRIDGES = {
	unity: {
		dir: 'packages/unity-bridge',
		listing: 'docs/engine-store-listings/unity.json',
		zipBase: 'com.three-ws.forge-bridge',
		required: ['package.json', 'README.md', 'LICENSE', 'Runtime/ThreeWsClient.cs', 'Runtime/ThreeWsForgeImporter.cs', 'Editor/ThreeWsForgeWindow.cs'],
		manifest(dir) {
			const p = readJson(join(dir, 'package.json'));
			return { name: p.displayName, id: p.name, version: p.version, license: p.license, description: p.description, minEngine: p.unity };
		},
		extra(dir, v) {
			const p = readJson(join(dir, 'package.json'));
			for (const k of ['documentationUrl', 'changelogUrl', 'licensesUrl']) {
				if (!p[k]) v.fail(`package.json is missing "${k}" (Unity Package Manager shows it in the package details panel)`);
			}
			if (!/^\d+\.\d+\.\d+$/.test(p.version)) v.fail('package.json version is not semver x.y.z');
			if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(p.name)) v.fail('package name is not a valid reverse-DNS UPM name');
			const asmdefs = ['Runtime/ThreeWsBridge.Runtime.asmdef', 'Editor/ThreeWsBridge.Editor.asmdef'];
			for (const a of asmdefs) readJson(join(dir, a));
			for (const s of p.samples || []) if (!existsSync(join(dir, s.path))) v.fail(`sample path missing: ${s.path}`);
		},
		exclude: (rel) => false,
	},
	godot: {
		dir: 'packages/godot-bridge',
		listing: 'docs/engine-store-listings/godot.json',
		zipBase: 'three-ws-forge-bridge-godot',
		required: ['LICENSE', 'README.md', 'addons/three_ws_bridge/plugin.cfg', 'addons/three_ws_bridge/plugin.gd', 'addons/three_ws_bridge/three_ws_client.gd', 'addons/three_ws_bridge/forge_importer.gd'],
		manifest(dir) {
			const cfg = readFileSync(join(dir, 'addons/three_ws_bridge/plugin.cfg'), 'utf8');
			const get = (k) => (cfg.match(new RegExp(`^${k}="([^"]*)"`, 'm')) || [])[1];
			const feat = readFileSync(join(dir, 'project.godot'), 'utf8').match(/config\/features=PackedStringArray\("([\d.]+)"/);
			return { name: get('name'), id: 'three_ws_bridge', version: get('version'), license: 'Apache-2.0', description: get('description'), minEngine: feat ? feat[1] : null };
		},
		extra(dir, v) {
			const cfg = readFileSync(join(dir, 'addons/three_ws_bridge/plugin.cfg'), 'utf8');
			for (const k of ['name', 'description', 'author', 'version', 'script']) {
				if (!new RegExp(`^${k}="[^"]+"`, 'm').test(cfg)) v.fail(`plugin.cfg is missing ${k}`);
			}
			if (!existsSync(join(dir, 'addons/three_ws_bridge', (cfg.match(/^script="([^"]+)"/m) || [])[1] || '-'))) v.fail('plugin.cfg script file does not exist');
		},
		// The Asset Library installs only what is under addons/; the packaged zip is the addon, license and readme.
		include: (rel) => rel.startsWith('addons/') || rel === 'LICENSE' || rel === 'README.md',
		exclude: (rel) => rel.split('/').includes('.godot'),
	},
	unreal: {
		dir: 'packages/unreal-bridge',
		listing: 'docs/engine-store-listings/unreal.json',
		zipBase: 'ThreeWsBridge-unreal-source',
		required: ['ThreeWsBridge.uplugin', 'README.md', 'LICENSE', 'Source/ThreeWsBridge/ThreeWsBridge.Build.cs', 'Source/ThreeWsBridgeEditor/ThreeWsBridgeEditor.Build.cs'],
		manifest(dir) {
			const u = readJson(join(dir, 'ThreeWsBridge.uplugin'));
			return { name: u.FriendlyName, id: 'ThreeWsBridge', version: u.VersionName, license: 'Apache-2.0', description: u.Description, minEngine: u.EngineVersion };
		},
		extra(dir, v) {
			const u = readJson(join(dir, 'ThreeWsBridge.uplugin'));
			if (!Number.isInteger(u.Version)) v.fail('uplugin Version must be an integer');
			if (!u.DocsURL) v.fail('uplugin DocsURL is empty (Fab shows it on the listing)');
			for (const m of u.Modules || []) {
				const base = join(dir, 'Source', m.Name);
				if (!existsSync(join(base, `${m.Name}.Build.cs`))) v.fail(`module ${m.Name} has no Build.cs`);
			}
		},
		exclude: (rel) => /(^|\/)(Binaries|Intermediate|Saved)\//.test(rel),
	},
};

function makeValidator(label) {
	const result = { label, errors: [], checks: [] };
	return {
		result,
		pass: (m) => result.checks.push(m),
		fail: (m) => result.errors.push(m),
	};
}

function walk(dir, base = dir, out = []) {
	for (const name of readdirSync(dir).sort()) {
		const abs = join(dir, name);
		if (statSync(abs).isDirectory()) walk(abs, base, out);
		else out.push(relative(base, abs).split(sep).join('/'));
	}
	return out;
}

export function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

export function listing(key) {
	return readJson(join(ROOT, BRIDGES[key].listing));
}

export function validateBridge(key) {
	const b = BRIDGES[key];
	const dir = join(ROOT, b.dir);
	const v = makeValidator(key);
	const meta = b.manifest(dir);
	for (const f of b.required) (existsSync(join(dir, f)) ? v.pass(`has ${f}`) : v.fail(`missing required file ${f}`));
	if (!meta.version) v.fail('no version found in the engine manifest');
	if (!meta.name) v.fail('no display name found in the engine manifest');
	if (!/^\d+\.\d+\.\d+$/.test(meta.version || '')) v.fail(`version "${meta.version}" is not x.y.z`);
	else v.pass(`version ${meta.version}`);
	if (existsSync(join(dir, 'LICENSE')) && !/Apache License/.test(readFileSync(join(dir, 'LICENSE'), 'utf8').slice(0, 400))) v.fail('LICENSE is not Apache-2.0 text');
	if (meta.license !== 'Apache-2.0') v.fail(`license in manifest is ${meta.license}, expected Apache-2.0`);
	b.extra(dir, v);

	let files = walk(dir).filter((r) => !b.exclude(r));
	if (b.include) files = files.filter(b.include);
	for (const rel of files) {
		if (!TEXT_EXT.test(rel) && !/^LICENSE$/.test(rel)) continue;
		const text = readFileSync(join(dir, rel), 'utf8');
		if (BANNED_DASH.test(text)) v.fail(`${rel} contains an en or em dash`);
		if (rel !== 'LICENSE' && LEFTOVER.test(text)) v.fail(`${rel} contains an unfinished-work marker`);
	}
	v.pass(`${files.length} files scanned`);

	const l = listing(key);
	const need = ['store', 'productName', 'version', 'tagline', 'description', 'category', 'tags', 'price', 'license', 'minEngine', 'supportUrl', 'documentationUrl', 'sourceUrl', 'dataDisclosure', 'releaseNotes', 'submission'];
	for (const k of need) if (l[k] == null || l[k] === '' || (Array.isArray(l[k]) && !l[k].length)) v.fail(`listing is missing "${k}"`);
	if (l.version !== meta.version) v.fail(`listing version ${l.version} differs from engine manifest ${meta.version}`);
	if (l.minEngine !== meta.minEngine) v.fail(`listing minEngine ${l.minEngine} differs from engine manifest ${meta.minEngine}`);
	if (l.tagline && l.tagline.length > 80) v.fail(`tagline is ${l.tagline.length} chars, limit 80`);
	if (l.description && l.description.length < 200) v.fail('description is under 200 chars');
	if (l.license !== meta.license) v.fail('listing license differs from engine manifest');
	for (const k of Object.keys(l)) if (BANNED_DASH.test(JSON.stringify(l[k]))) v.fail(`listing field ${k} contains an en or em dash`);
	for (const k of ['supportUrl', 'documentationUrl', 'sourceUrl']) if (l[k] && !/^https:\/\//.test(l[k])) v.fail(`${k} must be https`);
	if (!v.result.errors.length) v.pass('listing metadata matches the engine manifest');
	return { meta, files, dir, v, l };
}

export async function renderArtwork(outDir) {
	const svg = readFileSync(join(ROOT, 'public/favicon.svg'));
	mkdirSync(outDir, { recursive: true });
	const sizes = [128, 512];
	const out = [];
	for (const s of sizes) {
		const buf = await sharp(svg, { density: 384 }).resize(s, s).png({ compressionLevel: 9 }).toBuffer();
		const name = `icon-${s}.png`;
		writeFileSync(join(outDir, name), buf);
		out.push({ file: name, bytes: buf.length, sha256: sha256(buf) });
	}
	return out;
}

export function buildZip(key, info) {
	const entries = {};
	for (const rel of info.files) {
		entries[rel] = [readFileSync(join(info.dir, rel)), { mtime: FIXED_MTIME, level: 9 }];
	}
	const root = key === 'godot' ? '' : '';
	const ordered = Object.fromEntries(Object.keys(entries).sort().map((k) => [root + k, entries[k]]));
	return Buffer.from(zipSync(ordered));
}

export async function packageAll({ out = join(ROOT, 'dist/engine-stores'), only = null, write = true } = {}) {
	const keys = only ? [only] : Object.keys(BRIDGES);
	const manifest = { generatedFor: 'three.ws engine bridges', bridges: {} };
	let ok = true;
	if (write) {
		rmSync(out, { recursive: true, force: true });
		mkdirSync(out, { recursive: true });
	}
	for (const key of keys) {
		const info = validateBridge(key);
		const zip = buildZip(key, info);
		const zipName = `${BRIDGES[key].zipBase}-${info.meta.version}.zip`;
		const entry = {
			store: info.l.store,
			version: info.meta.version,
			zip: zipName,
			bytes: zip.length,
			sha256: sha256(zip),
			fileCount: info.files.length,
			validation: { passed: info.v.result.errors.length === 0, checks: info.v.result.checks, errors: info.v.result.errors },
		};
		if (write) {
			const d = join(out, key);
			mkdirSync(d, { recursive: true });
			writeFileSync(join(d, zipName), zip);
			writeFileSync(join(d, 'listing.json'), JSON.stringify(info.l, null, '\t') + '\n');
			entry.artwork = await renderArtwork(join(d, 'artwork'));
		}
		if (!entry.validation.passed) ok = false;
		manifest.bridges[key] = entry;
	}
	if (write) writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	return { ok, manifest, out };
}

async function main() {
	const args = process.argv.slice(2);
	const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
	const only = arg('--only');
	if (only && !BRIDGES[only]) {
		console.error(`unknown bridge "${only}", expected unity, godot or unreal`);
		process.exit(2);
	}
	const { ok, manifest, out } = await packageAll({ out: resolve(ROOT, arg('--out') || 'dist/engine-stores'), only, write: !args.includes('--check') });
	for (const [key, e] of Object.entries(manifest.bridges)) {
		console.log(`${e.validation.passed ? 'PASS' : 'FAIL'} ${key} (${e.store}) v${e.version} ${e.zip} ${e.bytes} bytes sha256 ${e.sha256}`);
		for (const c of e.validation.checks) console.log(`   ok   ${c}`);
		for (const er of e.validation.errors) console.log(`   FAIL ${er}`);
	}
	if (!args.includes('--check')) console.log(`\nWrote ${out}`);
	process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
