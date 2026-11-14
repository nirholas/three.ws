#!/usr/bin/env node
// Package and validate the Unity, Godot, Unreal and Blender bridges for their stores.
//
//   node scripts/package-engine-bridges.mjs [--out dist/engine-stores] [--only unity|godot|unreal|blender]
//                                           [--check] [--sync] [--godot <bin>] [--blender <bin>]
//
// --check   validate only, write nothing.
// --sync    write the in-repo store files the validator requires: missing Unity .meta files
//           (existing ones are never touched, GUIDs must stay stable) and the committed icons
//           that stores hotlink or that the engine shows (Godot icon, Unreal Icon128).
// --godot / --blender (or GODOT_BIN / BLENDER_BIN): also run the real engine's own validator.
//
// Output per bridge: the store archive (deterministic: sorted entries, fixed timestamps), the
// store key images at the exact sizes each store requires, the listing text, and one entry in
// manifest.json with the hash and every validation result. Exit 1 if any validation fails.
// Nothing is uploaded here; scripts/publish-engine-stores.mjs does that behind --yes.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { parse as parseToml } from 'smol-toml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXED_MTIME = Date.UTC(2026, 0, 1, 0, 0, 0);
const BANNED_DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const LEFTOVER = /\b(TODO|FIXME|XXX)\b|not implemented/i;
const TEXT_EXT = /\.(cs|gd|cpp|h|cfg|json|md|tscn|godot|uplugin|asmdef|txt|ini|py|toml|meta)$/i;
export const COPYRIGHT_HOLDER = 'nirholas';
const COPYRIGHT_LINE = /^\/\/ Copyright 2026 nirholas\. Licensed under the Apache License, Version 2\.0\.$/;

function readJson(p) {
	return JSON.parse(readFileSync(p, 'utf8'));
}

function walk(dir, { dirs = false, skip = () => false } = {}, base = dir, out = []) {
	for (const name of readdirSync(dir).sort()) {
		const abs = join(dir, name);
		const rel = relative(base, abs).split(sep).join('/');
		if (skip(rel, name)) continue;
		if (statSync(abs).isDirectory()) {
			if (dirs) out.push(rel + '/');
			walk(abs, { dirs, skip }, base, out);
		} else out.push(rel);
	}
	return out;
}

/** Width and height from a PNG header, so validation stays synchronous. */
function pngSize(file) {
	const b = readFileSync(file);
	if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

export function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

// Unity: every file and folder Unity imports from a package needs a committed .meta. Packages
// installed from the Asset Store, a git URL or a tarball are immutable, and Unity ignores any
// asset in an immutable folder that has no .meta ("has no meta file, but it's in an immutable
// folder"). Unity skips names that start with "." or end with "~" and everything below them.

const unityHidden = (name) => name.startsWith('.') || name.endsWith('~');

export function unityMetaTargets(dir) {
	return walk(dir, { dirs: true, skip: (rel, name) => unityHidden(name) || name.endsWith('.meta') }).map((r) => r.replace(/\/$/, ''));
}

function unityImporter(rel, isDir) {
	if (isDir) return 'folderAsset: yes\nDefaultImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n';
	if (rel.endsWith('.cs')) return 'MonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n';
	if (rel.endsWith('.asmdef')) return 'AssemblyDefinitionImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n';
	if (rel === 'package.json') return 'PackageManifestImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n';
	return 'TextScriptImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n';
}

/** A GUID derived from the package name and path: stable across machines, unique per asset. */
export function unityGuid(pkgName, rel) {
	return createHash('md5').update(`${pkgName}/${rel}`).digest('hex');
}

export function writeMissingUnityMeta(dir) {
	const pkg = readJson(join(dir, 'package.json')).name;
	const written = [];
	for (const rel of unityMetaTargets(dir)) {
		const metaPath = join(dir, `${rel}.meta`);
		if (existsSync(metaPath)) continue;
		const isDir = statSync(join(dir, rel)).isDirectory();
		writeFileSync(metaPath, `fileFormatVersion: 2\nguid: ${unityGuid(pkg, rel)}\n${unityImporter(rel, isDir)}`);
		written.push(`${rel}.meta`);
	}
	return written;
}

function validateUnityMeta(dir, v) {
	const targets = unityMetaTargets(dir);
	const guids = new Map();
	let missing = 0;
	for (const rel of targets) {
		const metaPath = join(dir, `${rel}.meta`);
		if (!existsSync(metaPath)) {
			missing++;
			v.fail(`${rel} has no .meta (Unity ignores it in an immutable package install; run with --sync)`);
			continue;
		}
		const meta = readFileSync(metaPath, 'utf8');
		const guid = meta.match(/^guid: ([0-9a-f]{32})$/m)?.[1];
		if (!/^fileFormatVersion: 2\n/.test(meta) || !guid) v.fail(`${rel}.meta is not a valid Unity meta file`);
		else if (guids.has(guid)) v.fail(`${rel}.meta reuses the GUID of ${guids.get(guid)}`);
		else guids.set(guid, rel);
	}
	const targetSet = new Set(targets);
	for (const m of walk(dir, { skip: (_, name) => unityHidden(name) }).filter((r) => r.endsWith('.meta'))) {
		if (!targetSet.has(m.slice(0, -5))) v.fail(`${m} is an orphan .meta with no asset beside it`);
	}
	if (!missing) v.pass(`${targets.length} assets carry a .meta with a unique GUID`);
}

// Store key images. Sizes are each store's published requirement, exact to the pixel.
//   Unity Asset Store: icon 160x160, card 420x280, cover 1950x1300, social 1200x630, 24-bit, no alpha.
//   Godot Asset Library: square icon, 128px minimum, hotlinked from raw.githubusercontent.com.
//   Fab: gallery images 1920x1080 minimum, under 3 MB; plugin browser icon 128x128.
//   Blender Extensions: icon 256x256, featured image 1920x1080.
// `text` picks what is drawn: none (icon, social), the title, or the title plus tagline.

export const ARTWORK = {
	unity: [
		{ name: 'icon', w: 160, h: 160, text: 'none' },
		{ name: 'card', w: 420, h: 280, text: 'title' },
		{ name: 'cover', w: 1950, h: 1300, text: 'tagline' },
		{ name: 'social', w: 1200, h: 630, text: 'none' },
	],
	godot: [{ name: 'icon', w: 256, h: 256, text: 'none', commit: 'packages/godot-bridge/media/icon.png' }],
	unreal: [
		{ name: 'gallery', w: 1920, h: 1080, text: 'tagline' },
		{ name: 'icon128', w: 128, h: 128, text: 'none', commit: 'packages/unreal-bridge/Resources/Icon128.png' },
	],
	blender: [
		{ name: 'icon', w: 256, h: 256, text: 'none' },
		{ name: 'featured', w: 1920, h: 1080, text: 'tagline' },
	],
};

const ENGINE_LABEL = { unity: 'for Unity', godot: 'for Godot 4', unreal: 'for Unreal Engine 5', blender: 'for Blender' };

function escapeXml(s) {
	return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

function backgroundSvg(w, h) {
	const r = Math.max(w, h);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0a14"/><stop offset="1" stop-color="#170f2e"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7c5cff" stop-opacity="0.55"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="__CX__" cy="${h / 2}" r="${r * 0.42}" fill="url(#glow)"/>
</svg>`;
}

function textSvg(w, h, { title, tagline, engine, x }) {
	const t = Math.round(h * (tagline ? 0.085 : 0.13));
	const s = Math.round(t * 0.46);
	const lines = [];
	const words = (tagline || '').split(' ');
	const maxChars = Math.max(18, Math.floor((w - x - w * 0.05) / (s * 0.55)));
	let cur = '';
	for (const word of words) {
		if ((cur + ' ' + word).trim().length > maxChars) {
			lines.push(cur.trim());
			cur = word;
		} else cur += ' ' + word;
	}
	if (cur.trim()) lines.push(cur.trim());
	const blockH = t + (engine ? s * 1.5 : 0) + lines.length * s * 1.4;
	let y = h / 2 - blockH / 2 + t * 0.85;
	const parts = [`<text x="${x}" y="${y}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${t}" fill="#ffffff">${escapeXml(title)}</text>`];
	if (engine) {
		y += s * 1.6;
		parts.push(`<text x="${x}" y="${y}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${s}" fill="#a996ff">${escapeXml(engine)}</text>`);
	}
	for (const line of lines) {
		y += s * 1.4;
		parts.push(`<text x="${x}" y="${y}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${s}" fill="#d9d4f2">${escapeXml(line)}</text>`);
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join('')}</svg>`;
}

async function renderKeyImage(spec, l, key) {
	const { w, h, text } = spec;
	const withText = text !== 'none';
	const markSize = Math.round(withText ? Math.min(h * 0.62, w * 0.36) : Math.min(w, h) * 0.78);
	const markX = withText ? Math.round(w * 0.06) : Math.round((w - markSize) / 2);
	const markY = Math.round((h - markSize) / 2);
	const bg = backgroundSvg(w, h).replace('__CX__', String(markX + markSize / 2));
	const mark = await sharp(join(ROOT, 'public/favicon.svg'), { density: Math.max(72, Math.ceil((markSize / 1500) * 72 * 1.5)) })
		.resize(markSize, markSize)
		.png()
		.toBuffer();
	const layers = [{ input: mark, left: markX, top: markY }];
	if (withText) {
		const x = markX + markSize + Math.round(w * 0.04);
		layers.push({ input: Buffer.from(textSvg(w, h, { title: l.productName, tagline: text === 'tagline' ? l.tagline : '', engine: ENGINE_LABEL[key], x })), left: 0, top: 0 });
	}
	return sharp(Buffer.from(bg)).composite(layers).flatten({ background: '#0b0a14' }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

export async function renderStoreArtwork(key) {
	const l = listing(key);
	const out = [];
	for (const spec of ARTWORK[key]) out.push({ file: `${spec.name}.png`, w: spec.w, h: spec.h, commit: spec.commit, buffer: await renderKeyImage(spec, l, key) });
	return out;
}

export async function syncCommittedArtwork() {
	const written = [];
	for (const key of BRIDGE_KEYS) {
		for (const img of await renderStoreArtwork(key)) {
			if (!img.commit) continue;
			const abs = join(ROOT, img.commit);
			mkdirSync(dirname(abs), { recursive: true });
			if (existsSync(abs) && sha256(readFileSync(abs)) === sha256(img.buffer)) continue;
			writeFileSync(abs, img.buffer);
			written.push(img.commit);
		}
	}
	return written;
}

const BRIDGES = {
	unity: {
		dir: 'packages/unity-bridge',
		listing: 'docs/engine-store-listings/unity.json',
		license: 'Apache-2.0',
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
			if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(p.name)) v.fail('package name is not a valid reverse-DNS UPM name');
			for (const a of ['Runtime/ThreeWsBridge.Runtime.asmdef', 'Editor/ThreeWsBridge.Editor.asmdef']) readJson(join(dir, a));
			for (const s of p.samples || []) if (!existsSync(join(dir, s.path))) v.fail(`sample path missing: ${s.path}`);
			validateUnityMeta(dir, v);
		},
		exclude: () => false,
	},
	godot: {
		dir: 'packages/godot-bridge',
		listing: 'docs/engine-store-listings/godot.json',
		license: 'Apache-2.0',
		required: ['LICENSE', 'README.md', 'addons/three_ws_bridge/plugin.cfg', 'addons/three_ws_bridge/plugin.gd', 'addons/three_ws_bridge/three_ws_client.gd', 'addons/three_ws_bridge/forge_importer.gd', 'addons/three_ws_bridge/LICENSE', 'addons/three_ws_bridge/README.md', 'media/icon.png', 'media/.gdignore'],
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
			// Asset Library rule: the plugin folder carries its own copy of the license and readme.
			const inner = join(dir, 'addons/three_ws_bridge/LICENSE');
			if (existsSync(inner) && readFileSync(inner, 'utf8') !== readFileSync(join(dir, 'LICENSE'), 'utf8')) v.fail('addons/three_ws_bridge/LICENSE differs from the package LICENSE');
			// Asset Library rule: the license states the year and the copyright holder.
			if (!/Copyright 20\d\d \S+/.test(readFileSync(join(dir, 'LICENSE'), 'utf8'))) v.fail('LICENSE has no "Copyright <year> <holder>" line');
			const icon = existsSync(join(dir, 'media/icon.png')) && pngSize(join(dir, 'media/icon.png'));
			if (icon && (icon.w !== icon.h || icon.w < 128)) v.fail(`media/icon.png is ${icon.w}x${icon.h}; the Asset Library needs a square icon of at least 128px`);
		},
		// Godot installs the archive into the project root, so it holds exactly the addon folder.
		include: (rel) => rel.startsWith('addons/three_ws_bridge/'),
		exclude: (rel) => rel.split('/').includes('.godot'),
	},
	unreal: {
		dir: 'packages/unreal-bridge',
		listing: 'docs/engine-store-listings/unreal.json',
		license: 'Apache-2.0',
		root: 'ThreeWsBridge/',
		required: ['ThreeWsBridge.uplugin', 'README.md', 'LICENSE', 'Config/FilterPlugin.ini', 'Resources/Icon128.png', 'Source/ThreeWsBridge/ThreeWsBridge.Build.cs', 'Source/ThreeWsBridgeEditor/ThreeWsBridgeEditor.Build.cs'],
		manifest(dir) {
			const u = readJson(join(dir, 'ThreeWsBridge.uplugin'));
			return { name: u.FriendlyName, id: 'ThreeWsBridge', version: u.VersionName, license: 'Apache-2.0', description: u.Description, minEngine: u.EngineVersion };
		},
		extra(dir, v) {
			const u = readJson(join(dir, 'ThreeWsBridge.uplugin'));
			if (!Number.isInteger(u.Version)) v.fail('uplugin Version must be an integer');
			for (const k of ['DocsURL', 'SupportURL', 'CreatedBy', 'CreatedByURL', 'Description', 'Category']) if (!u[k]) v.fail(`uplugin ${k} is empty (Fab shows it on the listing)`);
			if (!/^5\.\d+\.0$/.test(u.EngineVersion || '')) v.fail('uplugin EngineVersion must be set to the minimum 5.x.0 (Fab builds against each selected version)');
			if ('MarketplaceURL' in u) v.fail('uplugin carries the retired MarketplaceURL; Fab uses FabURL, added after the listing is approved');
			if (u.FabURL && !/^https:\/\/www\.fab\.com\/listings\//.test(u.FabURL)) v.fail('uplugin FabURL is not a fab.com listing URL');
			if (!(u.Plugins || []).some((p) => p.Name === 'Interchange' && p.Enabled)) v.fail('uplugin must declare the Interchange plugin it imports through, or UBT warns and Fab rejects the build');
			for (const m of u.Modules || []) {
				if (!existsSync(join(dir, 'Source', m.Name, `${m.Name}.Build.cs`))) v.fail(`module ${m.Name} has no Build.cs`);
				const allow = m.PlatformAllowList || [];
				if (!['Win64', 'Mac', 'Linux'].every((p) => allow.includes(p))) v.fail(`module ${m.Name} needs a PlatformAllowList with Win64, Mac and Linux`);
			}
			const filter = existsSync(join(dir, 'Config/FilterPlugin.ini')) ? readFileSync(join(dir, 'Config/FilterPlugin.ini'), 'utf8') : '';
			for (const f of ['/README.md', '/LICENSE']) if (!filter.split(/\r?\n/).includes(f)) v.fail(`Config/FilterPlugin.ini must list ${f} or BuildPlugin strips it from the packaged plugin`);
			if (!/^\[FilterPlugin\]$/m.test(filter)) v.fail('Config/FilterPlugin.ini has no [FilterPlugin] section');
			const icon = existsSync(join(dir, 'Resources/Icon128.png')) && pngSize(join(dir, 'Resources/Icon128.png'));
			if (icon && (icon.w !== 128 || icon.h !== 128)) v.fail(`Resources/Icon128.png is ${icon.w}x${icon.h}, expected 128x128`);
			let sources = 0;
			for (const rel of walk(join(dir, 'Source')).filter((r) => /\.(h|cpp|cs)$/.test(r))) {
				sources++;
				if (!COPYRIGHT_LINE.test(readFileSync(join(dir, 'Source', rel), 'utf8').split('\n')[0])) v.fail(`Source/${rel} does not open with the publisher copyright notice`);
			}
			v.pass(`${sources} source files checked for the copyright notice`);
		},
		exclude: (rel) => /(^|\/)(Binaries|Intermediate|Saved|DerivedDataCache)\//.test(rel),
	},
	blender: {
		dir: 'integrations/blender/three_ws',
		listing: 'docs/engine-store-listings/blender.json',
		license: 'GPL-3.0-or-later',
		required: ['blender_manifest.toml', '__init__.py', 'three_ws_client.py', 'LICENSE'],
		manifest(dir) {
			const m = parseToml(readFileSync(join(dir, 'blender_manifest.toml'), 'utf8'));
			const spdx = (m.license || []).find((x) => x.startsWith('SPDX:'));
			return { name: m.name, id: m.id, version: m.version, license: spdx ? spdx.slice(5) : null, description: m.tagline, minEngine: m.blender_version_min, raw: m };
		},
		extra(dir, v) {
			const m = parseToml(readFileSync(join(dir, 'blender_manifest.toml'), 'utf8'));
			if (m.schema_version !== '1.0.0') v.fail('blender_manifest.toml schema_version must be "1.0.0"');
			if (!/^[a-z][a-z0-9_]*$/.test(m.id || '')) v.fail('manifest id must be lowercase letters, digits and underscores');
			if (m.type !== 'add-on') v.fail('manifest type must be "add-on"');
			if (!m.maintainer) v.fail('manifest maintainer is empty');
			if (!m.tagline || m.tagline.length > 64) v.fail('manifest tagline must be 1 to 64 characters');
			if (/[.!?,;:]$/.test(m.tagline || '')) v.fail('manifest tagline must not end in punctuation');
			if (!/^\d+\.\d+\.\d+$/.test(m.blender_version_min || '')) v.fail('manifest blender_version_min must be x.y.z');
			for (const [perm, reason] of Object.entries(m.permissions || {})) {
				if (typeof reason !== 'string' || !reason || reason.length > 64) v.fail(`permission ${perm} needs a reason of 1 to 64 characters`);
				else if (/[.!?]$/.test(reason)) v.fail(`permission ${perm} reason must not end in punctuation`);
			}
			if (/^bl_info\s*=/m.test(readFileSync(join(dir, '__init__.py'), 'utf8'))) v.fail('__init__.py still declares bl_info; the manifest replaces it');
			if (!/GNU GENERAL PUBLIC LICENSE\s+Version 3/.test(readFileSync(join(dir, 'LICENSE'), 'utf8').slice(0, 400))) v.fail('LICENSE is not the GPL-3.0 text Blender Extensions requires');
		},
		// Blender's own `extension build` default exclusions plus the manifest's paths_exclude_pattern.
		exclude: (rel) => rel.split('/').some((p) => p.startsWith('.') || p === '__pycache__') || /\.zip$/.test(rel),
	},
};

export const BRIDGE_KEYS = Object.keys(BRIDGES);

const LICENSE_HEAD = { 'Apache-2.0': /Apache License/, 'GPL-3.0-or-later': /GNU GENERAL PUBLIC LICENSE/ };

function makeValidator(label) {
	const result = { label, errors: [], checks: [] };
	return { result, pass: (m) => result.checks.push(m), fail: (m) => result.errors.push(m) };
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
	if (!meta.name) v.fail('no display name found in the engine manifest');
	if (!/^\d+\.\d+\.\d+$/.test(meta.version || '')) v.fail(`version "${meta.version}" is not x.y.z`);
	else v.pass(`version ${meta.version}`);
	if (existsSync(join(dir, 'LICENSE')) && !LICENSE_HEAD[b.license].test(readFileSync(join(dir, 'LICENSE'), 'utf8').slice(0, 400))) v.fail(`LICENSE is not ${b.license} text`);
	if (meta.license !== b.license) v.fail(`license in manifest is ${meta.license}, expected ${b.license}`);
	b.extra(dir, v);

	let files = walk(dir).filter((r) => !b.exclude(r));
	if (b.include) files = files.filter(b.include);
	for (const rel of files) {
		if (!TEXT_EXT.test(rel) && basename(rel) !== 'LICENSE') continue;
		const text = readFileSync(join(dir, rel), 'utf8');
		if (BANNED_DASH.test(text)) v.fail(`${rel} contains an en or em dash`);
		if (basename(rel) !== 'LICENSE' && LEFTOVER.test(text)) v.fail(`${rel} contains an unfinished-work marker`);
	}
	v.pass(`${files.length} packaged files scanned`);

	const l = listing(key);
	const need = ['store', 'productName', 'version', 'tagline', 'description', 'category', 'tags', 'price', 'license', 'minEngine', 'supportUrl', 'documentationUrl', 'sourceUrl', 'dataDisclosure', 'releaseNotes', 'submission'];
	for (const k of need) if (l[k] == null || l[k] === '' || (Array.isArray(l[k]) && !l[k].length)) v.fail(`listing is missing "${k}"`);
	if (l.version !== meta.version) v.fail(`listing version ${l.version} differs from engine manifest ${meta.version}`);
	if (l.minEngine !== meta.minEngine) v.fail(`listing minEngine ${l.minEngine} differs from engine manifest ${meta.minEngine}`);
	const taglineLimit = key === 'blender' ? 64 : 80;
	if (l.tagline && l.tagline.length > taglineLimit) v.fail(`tagline is ${l.tagline.length} chars, limit ${taglineLimit}`);
	if (key === 'blender' && l.tagline !== meta.raw.tagline) v.fail('listing tagline differs from the manifest tagline Blender displays');
	if (l.description && l.description.length < 200) v.fail('description is under 200 chars');
	if (l.license !== meta.license) v.fail('listing license differs from engine manifest');
	for (const k of Object.keys(l)) if (BANNED_DASH.test(JSON.stringify(l[k]))) v.fail(`listing field ${k} contains an en or em dash`);
	for (const k of ['supportUrl', 'documentationUrl', 'sourceUrl']) if (l[k] && !/^https:\/\//.test(l[k])) v.fail(`${k} must be https`);
	if (!v.result.errors.length) v.pass('listing metadata matches the engine manifest');
	return { meta, files, dir, v, l };
}

function buildZip(files, dir, root = '') {
	const entries = {};
	for (const rel of [...files].sort()) entries[root + rel] = [readFileSync(join(dir, rel)), { mtime: FIXED_MTIME, level: 9 }];
	return Buffer.from(zipSync(entries));
}

/** Unity installs a UPM tarball in exactly the `npm pack` layout (package/ prefix, fixed mtimes). */
function buildUpmTarball(dir) {
	const tmp = mkdtempSync(join(tmpdir(), 'upm-pack-'));
	try {
		const out = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
		return readFileSync(join(tmp, out[0].filename));
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

const ARCHIVE_NAME = {
	unity: (m) => `${m.id}-${m.version}.tgz`,
	godot: (m) => `three-ws-forge-bridge-godot-${m.version}.zip`,
	unreal: (m) => `ThreeWsBridge-${m.version}.zip`,
	blender: (m) => `${m.id}-${m.version}.zip`,
};

export function buildArchive(key, info) {
	const buffer = key === 'unity' ? buildUpmTarball(info.dir) : buildZip(info.files, info.dir, BRIDGES[key].root || '');
	return { name: ARCHIVE_NAME[key](info.meta), buffer };
}

/** Runs an engine's own validator when its binary is available; returns null when it is not. */
export function engineValidate(key, archivePath, bins = {}) {
	if (key === 'blender' && bins.blender) {
		try {
			const out = execFileSync(bins.blender, ['--factory-startup', '--command', 'extension', 'validate', archivePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
			return { ok: /Success parsing TOML/.test(out), tool: 'blender --command extension validate', output: out.trim() };
		} catch (e) {
			return { ok: false, tool: 'blender --command extension validate', output: `${e.stdout || ''}${e.stderr || e.message}`.trim() };
		}
	}
	if (key === 'godot' && bins.godot) {
		const project = mkdtempSync(join(tmpdir(), 'godot-assetlib-'));
		try {
			writeFileSync(join(project, 'project.godot'), 'config_version=5\n\n[application]\nconfig/name="AssetLib install check"\nconfig/features=PackedStringArray("4.3")\n\n[editor_plugins]\nenabled=PackedStringArray("res://addons/three_ws_bridge/plugin.cfg")\n');
			execFileSync('unzip', ['-q', archivePath, '-d', project]);
			const res = execFileSync(bins.godot, ['--headless', '--editor', '--path', project, '--quit-after', '120'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
			const bad = res.split('\n').filter((line) => /SCRIPT ERROR|Parse Error|ERROR:|WARNING:.*three_ws/.test(line));
			return { ok: bad.length === 0, tool: 'godot --headless --editor (fresh project, archive unzipped as the Asset Library installs it)', output: bad.join('\n') || 'addon loaded and enabled with no errors or warnings' };
		} catch (e) {
			return { ok: false, tool: 'godot --headless --editor', output: `${e.stdout || ''}${e.stderr || e.message}`.trim() };
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	}
	return null;
}

export async function packageAll({ out = join(ROOT, 'dist/engine-stores'), only = null, write = true, bins = {} } = {}) {
	const keys = only ? [only] : BRIDGE_KEYS;
	const manifest = { generatedFor: 'three.ws engine bridges', bridges: {} };
	let ok = true;
	if (write) {
		rmSync(out, { recursive: true, force: true });
		mkdirSync(out, { recursive: true });
	}
	for (const key of keys) {
		const info = validateBridge(key);
		const archive = buildArchive(key, info);
		const entry = {
			store: info.l.store,
			version: info.meta.version,
			archive: archive.name,
			bytes: archive.buffer.length,
			sha256: sha256(archive.buffer),
			fileCount: info.files.length,
			validation: { passed: info.v.result.errors.length === 0, checks: info.v.result.checks, errors: info.v.result.errors },
		};
		const d = join(out, key);
		const scratch = write ? d : mkdtempSync(join(tmpdir(), `engine-store-${key}-`));
		mkdirSync(scratch, { recursive: true });
		writeFileSync(join(scratch, archive.name), archive.buffer);
		const engine = engineValidate(key, join(scratch, archive.name), bins);
		if (engine) {
			entry.engineValidation = engine;
			if (engine.ok) entry.validation.checks.push(`${engine.tool}: passed`);
			else {
				entry.validation.errors.push(`${engine.tool} failed: ${engine.output.slice(0, 600)}`);
				entry.validation.passed = false;
			}
		}
		if (write) {
			writeFileSync(join(d, 'listing.json'), JSON.stringify(info.l, null, '\t') + '\n');
			mkdirSync(join(d, 'artwork'), { recursive: true });
			entry.artwork = [];
			for (const img of await renderStoreArtwork(key)) {
				writeFileSync(join(d, 'artwork', img.file), img.buffer);
				entry.artwork.push({ file: `artwork/${img.file}`, size: `${img.w}x${img.h}`, bytes: img.buffer.length });
			}
		} else rmSync(scratch, { recursive: true, force: true });
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
		console.error(`unknown bridge "${only}", expected one of ${BRIDGE_KEYS.join(', ')}`);
		process.exit(2);
	}
	if (args.includes('--sync')) {
		const metas = writeMissingUnityMeta(join(ROOT, BRIDGES.unity.dir)).map((m) => `${BRIDGES.unity.dir}/${m}`);
		const art = await syncCommittedArtwork();
		for (const f of [...metas, ...art]) console.log(`wrote ${f}`);
		if (!metas.length && !art.length) console.log('in-repo store files already in sync');
	}
	const bins = { godot: arg('--godot') || process.env.GODOT_BIN || null, blender: arg('--blender') || process.env.BLENDER_BIN || null };
	const { ok, manifest, out } = await packageAll({ out: resolve(ROOT, arg('--out') || 'dist/engine-stores'), only, write: !args.includes('--check'), bins });
	for (const [key, e] of Object.entries(manifest.bridges)) {
		console.log(`${e.validation.passed ? 'PASS' : 'FAIL'} ${key} (${e.store}) v${e.version} ${e.archive} ${e.bytes} bytes sha256 ${e.sha256}`);
		for (const c of e.validation.checks) console.log(`   ok   ${c}`);
		for (const er of e.validation.errors) console.log(`   FAIL ${er}`);
		if (!e.engineValidation && (key === 'godot' || key === 'blender')) console.log(`   note no ${key} binary given (--${key} or ${key.toUpperCase()}_BIN), engine-side validation skipped`);
	}
	if (!args.includes('--check')) console.log(`\nWrote ${out}`);
	process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
