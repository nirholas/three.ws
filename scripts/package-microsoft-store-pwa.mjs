// scripts/package-microsoft-store-pwa.mjs
// Package three.ws as a Microsoft Store app (the PWA wrapped as MSIX) and check
// the web app manifest the package is built from.
//
//   npm run package:microsoft-store -- --check
//       Fetch the live manifest and every icon, screenshot and widget URL it
//       names, and report anything the Store package or listing would reject.
//       Needs no owner value.
//   MS_STORE_PACKAGE_ID=... MS_STORE_PUBLISHER_CN=CN=... \
//   MS_STORE_PUBLISHER_DISPLAY_NAME=... MS_STORE_APP_NAME=... \
//   npm run package:microsoft-store
//       Run the same checks, then ask PWABuilder's Windows packaging service
//       for the Store upload bundle and write it to dist/microsoft/three-ws-store/.
//
// The four owner values come from Partner Center, Apps and games, the reserved
// app, Product identity: Package/Identity/Name, Package/Identity/Publisher,
// Package/Properties/PublisherDisplayName and the reserved app name. The package
// is signed by the Store on submission, so nothing secret is involved.
//
// Flags: --manifest-url <url> (default https://three.ws/manifest.webmanifest).
// Exit codes: 0 ok, 1 manifest or package problems, 2 owner values missing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(root, 'dist', 'microsoft', 'three-ws-store');
export const DEFAULT_MANIFEST_URL = 'https://three.ws/manifest.webmanifest';
// PWABuilder's production Windows packaging service (pwa-builder/PWABuilder,
// apps/pwabuilder/Frontend/src/script/utils/environment.ts).
export const PWABUILDER_WINDOWS_URL =
	'https://pwabuilder-windows-docker.azurewebsites.net/msix/generatezip';
const STANDALONE_DISPLAYS = new Set(['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']);
// Windows and Edge integration (docs/desktop.md, "Windows and Edge").
export const REQUIRED_FILE_EXTENSIONS = ['.glb', '.gltf', '.vrm'];
export const PROTOCOL_SCHEME = 'web+threews';
export const SIDE_PANEL_PATH = '/sidebar';
const CLIENT_MODES = ['auto', 'focus-existing', 'navigate-existing', 'navigate-new'];
const LAUNCH_TYPES = ['single-client', 'multiple-clients'];
// HTML's safelisted schemes, which may be registered without the web+ prefix.
const SAFELISTED_SCHEMES = new Set([
	'ftp', 'ftps', 'geo', 'im', 'irc', 'ircs', 'magnet', 'mailto', 'matrix', 'mms', 'news', 'nntp',
	'openpgp4fpr', 'sftp', 'sip', 'sms', 'smsto', 'ssh', 'tel', 'urn', 'webcal', 'wtai', 'xmpp',
]);

function inScope(href, manifest, manifestUrl) {
	const url = new URL(href, manifestUrl);
	const scope = new URL(manifest.scope || './', manifestUrl);
	return { url, scope, ok: url.origin === scope.origin && url.pathname.startsWith(scope.pathname) };
}

function checkWindowsMembers(manifest, manifestUrl, errors) {
	const accepted = new Set();
	for (const fh of manifest.file_handlers || []) {
		const where = inScope(fh.action || '', manifest, manifestUrl);
		if (!fh.action || !where.ok) errors.push(`file handler action ${where.url.href} is outside scope ${where.scope.href}`);
		for (const exts of Object.values(fh.accept || {})) {
			for (const ext of [].concat(exts)) {
				if (typeof ext !== 'string' || !ext.startsWith('.')) errors.push(`file handler extension "${ext}" must start with a period`);
				else accepted.add(ext.toLowerCase());
			}
		}
		if (fh.launch_type !== undefined && !LAUNCH_TYPES.includes(fh.launch_type)) {
			errors.push(`file handler launch_type "${fh.launch_type}" must be single-client or multiple-clients`);
		}
	}
	const missing = REQUIRED_FILE_EXTENSIONS.filter((ext) => !accepted.has(ext));
	if (missing.length) errors.push(`file_handlers do not accept ${missing.join(', ')}; Explorer will not offer three.ws for them`);

	const handlers = manifest.protocol_handlers || [];
	if (!handlers.some((h) => h.protocol === PROTOCOL_SCHEME)) {
		errors.push(`protocol_handlers has no ${PROTOCOL_SCHEME} entry; ${PROTOCOL_SCHEME}: links will not open the app`);
	}
	for (const h of handlers) {
		const scheme = String(h.protocol || '');
		if (!/^web\+[a-z]+$/.test(scheme) && !SAFELISTED_SCHEMES.has(scheme)) {
			errors.push(`protocol "${scheme}" is not web+ followed by lowercase letters, nor a safelisted scheme`);
		}
		const url = String(h.url || '');
		if (!url.includes('%s')) errors.push(`protocol handler ${scheme} url ${url} has no %s placeholder for the link`);
		const where = inScope(url, manifest, manifestUrl);
		if (!where.ok) errors.push(`protocol handler ${scheme} url ${url} is outside scope ${where.scope.href}`);
	}

	if (manifest.launch_handler) {
		for (const mode of [].concat(manifest.launch_handler.client_mode ?? [])) {
			if (!CLIENT_MODES.includes(mode)) errors.push(`launch_handler client_mode "${mode}" must be one of ${CLIENT_MODES.join(', ')}`);
		}
	}
	const panel = manifest.edge_side_panel;
	if (panel && panel.preferred_width !== undefined && !(typeof panel.preferred_width === 'number' && panel.preferred_width > 0)) {
		errors.push('edge_side_panel preferred_width must be a positive number of pixels');
	}
}

const OWNER_ENV = {
	packageId: 'MS_STORE_PACKAGE_ID',
	publisherCn: 'MS_STORE_PUBLISHER_CN',
	publisherDisplayName: 'MS_STORE_PUBLISHER_DISPLAY_NAME',
	appName: 'MS_STORE_APP_NAME',
};

function sizesOf(entry) {
	return String(entry?.sizes || '')
		.split(/\s+/)
		.map((s) => s.toLowerCase().match(/^(\d+)x(\d+)$/))
		.filter(Boolean)
		.map((m) => ({ w: Number(m[1]), h: Number(m[2]) }));
}

function purposes(icon) {
	return String(icon?.purpose || 'any').split(/\s+/);
}

/** The icon PWABuilder uses as the base image: the largest square PNG with purpose "any". */
export function pickBaseIcon(manifest) {
	let best = null;
	for (const icon of manifest.icons || []) {
		if (!purposes(icon).includes('any')) continue;
		const isPng = icon.type === 'image/png' || /\.png($|\?)/i.test(icon.src || '');
		if (!isPng) continue;
		for (const { w, h } of sizesOf(icon)) {
			if (w === h && (!best || w > best.size)) best = { icon, size: w };
		}
	}
	return best;
}

/**
 * Store rules that can be decided from the manifest JSON alone.
 * Errors block packaging; warnings are worth fixing but the Store accepts them.
 */
export function checkStoreManifest(manifest, { manifestUrl = DEFAULT_MANIFEST_URL } = {}) {
	const errors = [];
	const warnings = [];
	if (!manifest || typeof manifest !== 'object') return { errors: ['manifest is not a JSON object'], warnings };

	if (!manifest.name && !manifest.short_name) errors.push('name or short_name is required');
	if (!manifest.description) warnings.push('description is empty; the Store listing needs its own description anyway');

	if (!manifest.start_url) {
		errors.push('start_url is required');
	} else {
		const start = new URL(manifest.start_url, manifestUrl);
		const scope = new URL(manifest.scope || './', manifestUrl);
		if (start.origin !== scope.origin || !start.pathname.startsWith(scope.pathname)) {
			errors.push(`start_url ${start.href} is outside scope ${scope.href}`);
		}
		const loopback = start.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(start.hostname);
		if (start.protocol !== 'https:' && !loopback) errors.push('start_url must be https');
	}

	const displays = [manifest.display, ...(manifest.display_override || [])].filter(Boolean);
	if (!displays.some((d) => STANDALONE_DISPLAYS.has(d))) {
		errors.push('display must be standalone, fullscreen or minimal-ui so the app opens in its own window');
	}

	const base = pickBaseIcon(manifest);
	if (!base) errors.push('no square PNG icon with purpose "any"; the Store tiles are generated from one');
	else if (base.size < 512) errors.push(`largest square PNG icon is ${base.size}px; the Store tiles need 512px or larger`);

	if (!manifest.id) warnings.push('id is not set; installs are keyed on start_url until it is');
	if (!manifest.lang) warnings.push('lang is not set; the package defaults its resource language to en-us');
	const screenshots = manifest.screenshots || [];
	if (screenshots.length === 0) warnings.push('no screenshots; the Store install dialog shows none');
	if (manifest.background_color && !/^#[0-9a-f]{6}$/i.test(manifest.background_color)) {
		warnings.push(`background_color ${manifest.background_color} is not a #rrggbb color; tile backgrounds may be transparent`);
	}
	for (const w of manifest.widgets || []) {
		if (!w.ms_ac_template) errors.push(`widget "${w.name}" has no ms_ac_template; Windows widgets need an Adaptive Card template`);
		if (!w.tag) errors.push(`widget "${w.name}" has no tag`);
	}
	checkWindowsMembers(manifest, manifestUrl, errors);
	return { errors, warnings };
}

/** Every URL the manifest asks Windows to load, with what it should be. */
export function manifestAssetUrls(manifest, manifestUrl = DEFAULT_MANIFEST_URL) {
	const out = [];
	const add = (src, kind, expect) => {
		if (src) out.push({ url: new URL(src, manifestUrl).href, kind, expect });
	};
	for (const icon of manifest.icons || []) add(icon.src, 'icon', { image: true, sizes: sizesOf(icon) });
	for (const shot of manifest.screenshots || []) add(shot.src, 'screenshot', { image: true, sizes: sizesOf(shot) });
	for (const sc of manifest.shortcuts || []) {
		add(sc.url, `shortcut ${sc.name}`, { page: true });
		for (const icon of sc.icons || []) add(icon.src, `shortcut ${sc.name} icon`, { image: true, sizes: sizesOf(icon) });
	}
	for (const w of manifest.widgets || []) {
		add(w.ms_ac_template, `widget ${w.name} template`, { json: true });
		for (const icon of w.icons || []) add(icon.src, `widget ${w.name} icon`, { image: true, sizes: sizesOf(icon) });
		for (const shot of w.screenshots || []) add(shot.src, `widget ${w.name} screenshot`, { image: true, sizes: sizesOf(shot) });
	}
	for (const fh of manifest.file_handlers || []) {
		add(fh.action, 'file handler action', { page: true });
		for (const icon of fh.icons || []) add(icon.src, 'file handler icon', { image: true, sizes: sizesOf(icon) });
	}
	for (const h of manifest.protocol_handlers || []) {
		if (typeof h.url === 'string' && h.url.includes('%s')) {
			add(h.url.replace('%s', encodeURIComponent(`${h.protocol}://forge`)), `protocol handler ${h.protocol}`, { page: true });
		}
	}
	// Edge opens start_url in the side panel; the home page forwards it here.
	if (manifest.edge_side_panel) add(SIDE_PANEL_PATH, 'edge side panel', { page: true });
	if (manifest.start_url) add(manifest.start_url, 'start_url', { page: true });
	return out;
}

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(bytes) {
	const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	return { w: view.getUint32(16), h: view.getUint32(20) };
}

/** Fetch each manifest URL and compare it with what the manifest claims. */
export async function checkManifestAssets(manifest, manifestUrl, fetchImpl = fetch) {
	const errors = [];
	const assets = manifestAssetUrls(manifest, manifestUrl);
	await Promise.all(
		assets.map(async ({ url, kind, expect }) => {
			let res;
			try {
				res = await fetchImpl(url, { redirect: 'follow' });
			} catch (err) {
				errors.push(`${kind} ${url} could not be fetched: ${err.message}`);
				return;
			}
			if (!res.ok) {
				errors.push(`${kind} ${url} returned ${res.status}`);
				return;
			}
			const type = res.headers.get('content-type') || '';
			if (expect.json) {
				try {
					JSON.parse(await res.text());
				} catch {
					errors.push(`${kind} ${url} is not JSON`);
				}
				return;
			}
			if (expect.page) return;
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (!type.startsWith('image/')) {
				errors.push(`${kind} ${url} is served as ${type || 'no content type'}, not an image`);
				return;
			}
			const actual = pngSize(bytes);
			if (actual && expect.sizes?.length && !expect.sizes.some((s) => s.w === actual.w && s.h === actual.h)) {
				const claimed = expect.sizes.map((s) => `${s.w}x${s.h}`).join(' ');
				errors.push(`${kind} ${url} is ${actual.w}x${actual.h} but the manifest says ${claimed}`);
			}
		}),
	);
	return { errors, checked: assets.length };
}

/** The same owner-value rules PWABuilder's WindowsAppPackageOptions enforces, checked before the upload. */
export function validateOwnerValues(values) {
	const errors = [];
	const id = String(values.packageId || '').trim();
	if (id.length < 3 || id.length > 50) errors.push('MS_STORE_PACKAGE_ID must be 3 to 50 characters');
	if (/[^A-Za-z0-9.-]/.test(id)) errors.push('MS_STORE_PACKAGE_ID may contain only letters, digits, period and hyphen');
	if (!/^CN=\S/.test(String(values.publisherCn || '').trim())) {
		errors.push('MS_STORE_PUBLISHER_CN must be the full Package/Identity/Publisher value, starting with CN=');
	}
	if (!String(values.publisherDisplayName || '').trim()) errors.push('MS_STORE_PUBLISHER_DISPLAY_NAME is required');
	if (!String(values.appName || '').trim()) errors.push('MS_STORE_APP_NAME must be the reserved app name');
	const m = String(values.version || '').match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
	if (!m) {
		errors.push('MS_STORE_VERSION must look like 1.0.1');
	} else {
		const [maj, min, build, rev] = m.slice(1).map((v) => Number(v || 0));
		if (maj < 1) errors.push('MS_STORE_VERSION major version must be 1 or greater');
		if (rev > 0) errors.push('MS_STORE_VERSION revision must be 0 or omitted; the Store owns it');
		if (maj === 1 && min === 0 && build < 1) {
			errors.push('MS_STORE_VERSION must be 1.0.1 or greater, because the classic package takes the version below it');
		}
	}
	return errors;
}

/** The classic (Windows 10 before 1903) package must carry a lower version than the modern one. */
export function classicVersionFor(version) {
	const [maj, min, build] = version.split('.').map(Number);
	if (build > 0) return `${maj}.${min}.${build - 1}`;
	if (min > 0) return `${maj}.${min - 1}.0`;
	return `${maj - 1}.0.0`;
}

/** The request body PWABuilder's /msix/generatezip takes (WindowsAppPackageOptions). */
export function buildPackageOptions(manifest, manifestUrl, values) {
	const siteUrl = new URL(manifest.scope || '/', manifestUrl).href;
	const startUrl = new URL(manifest.start_url || '/', manifestUrl).href;
	const base = pickBaseIcon(manifest);
	return {
		name: values.appName.trim(),
		packageId: values.packageId.trim(),
		url: siteUrl,
		version: values.version,
		allowSigning: true,
		publisher: {
			displayName: values.publisherDisplayName.trim(),
			commonName: values.publisherCn.trim(),
		},
		generateModernPackage: true,
		classicPackage: { generate: true, version: classicVersionFor(values.version), url: startUrl },
		edgeHtmlPackage: { generate: false },
		manifestUrl,
		manifest,
		startUrl,
		images: {
			baseImage: base ? new URL(base.icon.src, manifestUrl).href : '',
			backgroundColor: manifest.background_color || 'transparent',
			padding: 0.0,
		},
		resourceLanguage: (manifest.lang || 'en-us').toLowerCase(),
		enableWebAppWidgets: Array.isArray(manifest.widgets) && manifest.widgets.length > 0,
		// Lets three.ws links opened elsewhere in Windows launch the installed app.
		extensions: 'appurihandler',
	};
}

export function resolveOwnerValues(env) {
	const values = Object.fromEntries(Object.entries(OWNER_ENV).map(([k, name]) => [k, env[name] || '']));
	values.version = env.MS_STORE_VERSION || '1.0.1';
	const missing = Object.entries(OWNER_ENV)
		.filter(([k]) => !values[k])
		.map(([, name]) => name);
	return { values, missing };
}

/** The upload bundle the service returns: a zip holding the .msixbundle and the classic .appxbundle. */
export function inspectPackageZip(bytes) {
	const entries = Object.keys(unzipSync(bytes, { filter: () => true }));
	const problems = [];
	if (!entries.some((e) => /\.msixbundle$/i.test(e))) problems.push('the zip holds no .msixbundle for the Store upload');
	return { entries, problems };
}

async function fetchManifest(manifestUrl, fetchImpl) {
	const res = await fetchImpl(manifestUrl);
	if (!res.ok) throw new Error(`manifest ${manifestUrl} returned ${res.status}`);
	return res.json();
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
	const check = argv.includes('--check');
	const urlFlag = argv.indexOf('--manifest-url');
	const manifestUrl = urlFlag >= 0 ? argv[urlFlag + 1] : DEFAULT_MANIFEST_URL;

	const { values, missing } = resolveOwnerValues(env);
	if (!check && missing.length) {
		console.error(`Missing ${missing.join(', ')}. Copy them from Partner Center, the reserved app, Product identity.`);
		console.error('Run with --check to validate the manifest without them.');
		return 2;
	}

	let manifest;
	try {
		manifest = await fetchManifest(manifestUrl, fetchImpl);
	} catch (err) {
		console.error(err.message);
		return 1;
	}
	const { errors, warnings } = checkStoreManifest(manifest, { manifestUrl });
	const assets = await checkManifestAssets(manifest, manifestUrl, fetchImpl);
	errors.push(...assets.errors);
	if (!check) errors.push(...validateOwnerValues(values));

	for (const w of warnings) console.warn(`warning: ${w}`);
	if (errors.length) {
		for (const e of errors) console.error(`error: ${e}`);
		return 1;
	}
	console.log(`Manifest ${manifestUrl} is Store-ready (${assets.checked} URLs fetched, ${warnings.length} warnings).`);
	if (check) return 0;

	const body = buildPackageOptions(manifest, manifestUrl, values);
	const res = await fetchImpl(PWABUILDER_WINDOWS_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'platform-identifier': 'three.ws-cli' },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		console.error(`PWABuilder returned ${res.status}: ${(await res.text()).slice(0, 2000)}`);
		return 1;
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	const { entries, problems } = inspectPackageZip(bytes);
	if (problems.length) {
		for (const p of problems) console.error(`error: ${p}`);
		return 1;
	}
	mkdirSync(OUT_DIR, { recursive: true });
	const zipPath = join(OUT_DIR, `three-ws-store-${values.version}.zip`);
	writeFileSync(zipPath, bytes);
	console.log(`Wrote ${zipPath} (${bytes.length} bytes)`);
	for (const e of entries) console.log(`  ${e}`);
	console.log(`Package name ${res.headers.get('pwabuilder-package-name') || values.packageId}, publisher ${res.headers.get('pwabuilder-package-publisher') || values.publisherCn}`);
	console.log('Upload the .msixbundle and the classic .appxbundle under Packages in the Partner Center submission.');
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().then((code) => process.exit(code));
}
