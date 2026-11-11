// Microsoft Store (PWA) packaging: the manifest rules, the asset fetch check,
// the owner-value rules PWABuilder enforces, and the request body sent to it.
// Asset checks read the real files in public/ through a filesystem-backed fetch.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import {
	pickBaseIcon,
	checkStoreManifest,
	manifestAssetUrls,
	pngSize,
	checkManifestAssets,
	validateOwnerValues,
	classicVersionFor,
	buildPackageOptions,
	resolveOwnerValues,
	inspectPackageZip,
	main,
} from '../scripts/package-microsoft-store-pwa.mjs';

const MANIFEST_URL = 'https://three.ws/manifest.webmanifest';
const PUBLIC = join(process.cwd(), 'public');

// The fields the Store reads, with the asset paths and sizes vite.config.js declares.
function manifest(overrides = {}) {
	return {
		name: 'three.ws',
		short_name: 'three.ws',
		description: 'Create 3D AI agents and embed them anywhere.',
		lang: 'en',
		background_color: '#080814',
		display: 'standalone',
		display_override: ['window-controls-overlay', 'standalone', 'browser'],
		scope: '/',
		id: '/?source=pwa',
		start_url: '/?source=pwa',
		icons: [
			{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
			{ src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
		],
		screenshots: [
			{ src: 'screenshots/landing.png', sizes: '1440x900', type: 'image/png', form_factor: 'wide' },
			{ src: 'screenshots/features.png', sizes: '1400x900', type: 'image/png', form_factor: 'wide' },
		],
		shortcuts: [
			{ name: 'Create Avatar', url: '/create?source=pwa-shortcut', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
		],
		widgets: [
			{
				name: 'Agent glance',
				tag: 'agent-glance',
				ms_ac_template: '/api/glance/template',
				icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
				screenshots: [{ src: 'screenshots/glance-widget.png', sizes: '480x200' }],
			},
		],
		file_handlers: [
			{
				action: '/app?source=file-handler',
				accept: { 'model/gltf-binary': ['.glb'], 'model/gltf+json': ['.gltf'], 'model/vrm': ['.vrm'] },
				icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
				launch_type: 'single-client',
			},
		],
		protocol_handlers: [{ protocol: 'web+threews', url: '/open?link=%s' }],
		launch_handler: { client_mode: ['navigate-existing', 'auto'] },
		edge_side_panel: { preferred_width: 400 },
		...overrides,
	};
}

// Serves https://three.ws/<path> from public/, the JSON template from a string, pages as 200.
function publicFetch({ template = '{"type":"AdaptiveCard"}' } = {}) {
	return async (url) => {
		const { pathname } = new URL(url);
		if (pathname === '/api/glance/template') return new Response(template, { headers: { 'content-type': 'application/json' } });
		const file = join(PUBLIC, pathname);
		if (pathname.endsWith('.png')) {
			if (!existsSync(file)) return new Response('not found', { status: 404 });
			return new Response(readFileSync(file), { headers: { 'content-type': 'image/png' } });
		}
		return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
	};
}

const OWNER = {
	packageId: 'ThreeWs.ThreeWs',
	publisherCn: 'CN=4F1E2A3B-1111-2222-3333-444455556666',
	publisherDisplayName: 'three.ws',
	appName: 'three.ws',
	version: '1.0.1',
};

describe('checkStoreManifest', () => {
	it('passes the manifest three.ws ships', () => {
		const { errors, warnings } = checkStoreManifest(manifest(), { manifestUrl: MANIFEST_URL });
		expect(errors).toEqual([]);
		expect(warnings).toEqual([]);
	});

	it('requires a standalone display mode', () => {
		const { errors } = checkStoreManifest(manifest({ display: 'browser', display_override: [] }));
		expect(errors.join()).toMatch(/display must be standalone/);
	});

	it('accepts window-controls-overlay through display_override', () => {
		const { errors } = checkStoreManifest(manifest({ display: 'browser', display_override: ['window-controls-overlay'] }));
		expect(errors).toEqual([]);
	});

	it('requires a 512px square PNG with purpose any', () => {
		const onlyMaskable = manifest({ icons: [{ src: 'm.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] });
		expect(checkStoreManifest(onlyMaskable).errors.join()).toMatch(/no square PNG icon/);
		const small = manifest({ icons: [{ src: 'a.png', sizes: '192x192', type: 'image/png' }] });
		expect(checkStoreManifest(small).errors.join()).toMatch(/192px/);
	});

	it('rejects a start_url outside scope', () => {
		const { errors } = checkStoreManifest(manifest({ scope: '/app/', start_url: '/?source=pwa' }), { manifestUrl: MANIFEST_URL });
		expect(errors.join()).toMatch(/outside scope/);
	});

	// Lets --check validate a local build before deploy; loopback is a secure context.
	it('accepts a loopback http start_url but no other http origin', () => {
		expect(checkStoreManifest(manifest(), { manifestUrl: 'http://localhost:3106/manifest.webmanifest' }).errors).toEqual([]);
		expect(checkStoreManifest(manifest(), { manifestUrl: 'http://127.0.0.1:3106/manifest.webmanifest' }).errors).toEqual([]);
		expect(checkStoreManifest(manifest(), { manifestUrl: 'http://three.ws/manifest.webmanifest' }).errors).toContain('start_url must be https');
	});

	it('warns, not fails, when id is missing', () => {
		const { errors, warnings } = checkStoreManifest(manifest({ id: undefined }));
		expect(errors).toEqual([]);
		expect(warnings.join()).toMatch(/id is not set/);
	});

	it('requires an Adaptive Card template on every widget', () => {
		const m = manifest();
		delete m.widgets[0].ms_ac_template;
		expect(checkStoreManifest(m).errors.join()).toMatch(/ms_ac_template/);
	});
});

describe('Windows and Edge members', () => {
	const errs = (overrides) => checkStoreManifest(manifest(overrides), { manifestUrl: MANIFEST_URL }).errors;

	it('requires a file handler for every model format the viewer opens', () => {
		const fh = [{ action: '/app?source=file-handler', accept: { 'model/gltf-binary': ['.glb'] } }];
		expect(errs({ file_handlers: fh })).toEqual(['file_handlers do not accept .gltf, .vrm; Explorer will not offer three.ws for them']);
		expect(errs({ file_handlers: undefined })).toContain('file_handlers do not accept .glb, .gltf, .vrm; Explorer will not offer three.ws for them');
	});

	it('rejects a file handler outside scope, without a dot, or with a bad launch_type', () => {
		const e = errs({
			file_handlers: [
				{ action: 'https://evil.example/app', accept: { 'model/gltf-binary': ['glb', '.gltf', '.vrm'] }, launch_type: 'many' },
			],
		});
		expect(e).toContain('file handler action https://evil.example/app is outside scope https://three.ws/');
		expect(e).toContain('file handler extension "glb" must start with a period');
		expect(e).toContain('file handler launch_type "many" must be single-client or multiple-clients');
	});

	it('requires a valid web+threews protocol handler that substitutes %s inside scope', () => {
		expect(errs({ protocol_handlers: undefined })).toContain('protocol_handlers has no web+threews entry; web+threews: links will not open the app');
		const e = errs({
			protocol_handlers: [
				{ protocol: 'web+threews', url: '/open' },
				{ protocol: 'threews', url: '/open?link=%s' },
				{ protocol: 'web+Three1', url: '/open?link=%s' },
				{ protocol: 'web+other', url: 'https://evil.example/?l=%s' },
			],
		});
		expect(e).toContain('protocol handler web+threews url /open has no %s placeholder for the link');
		expect(e).toContain('protocol "threews" is not web+ followed by lowercase letters, nor a safelisted scheme');
		expect(e).toContain('protocol "web+Three1" is not web+ followed by lowercase letters, nor a safelisted scheme');
		expect(e).toContain('protocol handler web+other url https://evil.example/?l=%s is outside scope https://three.ws/');
		expect(errs({ protocol_handlers: [{ protocol: 'web+threews', url: '/open?link=%s' }, { protocol: 'mailto', url: '/open?link=%s' }] })).toEqual([]);
	});

	it('validates launch_handler client_mode and edge_side_panel width', () => {
		expect(errs({ launch_handler: { client_mode: ['focus-existing', 'reuse'] } })).toEqual([
			'launch_handler client_mode "reuse" must be one of auto, focus-existing, navigate-existing, navigate-new',
		]);
		expect(errs({ launch_handler: { client_mode: 'navigate-new' } })).toEqual([]);
		expect(errs({ edge_side_panel: { preferred_width: '400px' } })).toEqual(['edge_side_panel preferred_width must be a positive number of pixels']);
		expect(errs({ edge_side_panel: {} })).toEqual([]);
	});

	it('lists the side panel route, file handler action and protocol target as pages to fetch', () => {
		const pages = manifestAssetUrls(manifest(), MANIFEST_URL).filter((a) => a.expect.page);
		const byKind = Object.fromEntries(pages.map((a) => [a.kind, a.url]));
		expect(byKind['edge side panel']).toBe('https://three.ws/sidebar');
		expect(byKind['file handler action']).toBe('https://three.ws/app?source=file-handler');
		expect(byKind['protocol handler web+threews']).toBe('https://three.ws/open?link=web%2Bthreews%3A%2F%2Fforge');
	});
});

describe('pickBaseIcon', () => {
	it('picks the largest square any-purpose PNG', () => {
		expect(pickBaseIcon(manifest())).toMatchObject({ size: 512, icon: { src: 'pwa-512x512.png' } });
	});
});

describe('manifest assets', () => {
	it('lists icons, screenshots, shortcuts, widget assets and start_url as absolute URLs', () => {
		const urls = manifestAssetUrls(manifest(), MANIFEST_URL).map((a) => a.url);
		expect(urls).toContain('https://three.ws/pwa-512x512.png');
		expect(urls).toContain('https://three.ws/screenshots/glance-widget.png');
		expect(urls).toContain('https://three.ws/api/glance/template');
		expect(urls).toContain('https://three.ws/create?source=pwa-shortcut');
		expect(urls).toContain('https://three.ws/?source=pwa');
	});

	it('reads PNG dimensions from the IHDR chunk', () => {
		expect(pngSize(readFileSync(join(PUBLIC, 'pwa-512x512.png')))).toEqual({ w: 512, h: 512 });
		expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
	});

	it('passes when every declared size matches the real file in public/', async () => {
		const { errors, checked } = await checkManifestAssets(manifest(), MANIFEST_URL, publicFetch());
		expect(errors).toEqual([]);
		expect(checked).toBeGreaterThan(8);
	});

	// The defect this check exists for: production declared 1280x800 for
	// screenshots that are 1440x900, so installers dropped them.
	it('catches a screenshot whose declared size is not the file size', async () => {
		const m = manifest({ screenshots: [{ src: 'screenshots/landing.png', sizes: '1280x800', type: 'image/png' }] });
		const { errors } = await checkManifestAssets(m, MANIFEST_URL, publicFetch());
		expect(errors).toEqual([
			'screenshot https://three.ws/screenshots/landing.png is 1440x900 but the manifest says 1280x800',
		]);
	});

	it('catches a missing asset and a template that is not JSON', async () => {
		const m = manifest({ icons: [...manifest().icons, { src: 'gone.png', sizes: '48x48', type: 'image/png' }] });
		const { errors } = await checkManifestAssets(m, MANIFEST_URL, publicFetch({ template: '<html>' }));
		expect(errors).toContain('icon https://three.ws/gone.png returned 404');
		expect(errors).toContain('widget Agent glance template https://three.ws/api/glance/template is not JSON');
	});
});

describe('owner values', () => {
	it('accepts the Partner Center product identity shape', () => {
		expect(validateOwnerValues(OWNER)).toEqual([]);
	});

	it('mirrors the PWABuilder package id, publisher and version rules', () => {
		const errs = validateOwnerValues({ ...OWNER, packageId: 'a_b', publisherCn: '4F1E', version: '0.9.0.3' });
		expect(errs.join('\n')).toMatch(/letters, digits, period and hyphen/);
		expect(errs.join('\n')).toMatch(/starting with CN=/);
		expect(errs.join('\n')).toMatch(/major version/);
		expect(errs.join('\n')).toMatch(/revision must be 0/);
		expect(validateOwnerValues({ ...OWNER, version: '1.0.0' }).join()).toMatch(/1\.0\.1 or greater/);
	});

	it('reports which env values are missing and defaults the version', () => {
		const { values, missing } = resolveOwnerValues({ MS_STORE_PACKAGE_ID: 'ThreeWs.ThreeWs' });
		expect(values.version).toBe('1.0.1');
		expect(missing).toEqual(['MS_STORE_PUBLISHER_CN', 'MS_STORE_PUBLISHER_DISPLAY_NAME', 'MS_STORE_APP_NAME']);
	});

	it('gives the classic package a lower version than the modern one', () => {
		expect(classicVersionFor('1.0.1')).toBe('1.0.0');
		expect(classicVersionFor('1.2.0')).toBe('1.1.0');
		expect(classicVersionFor('2.0.0')).toBe('1.0.0');
	});
});

describe('buildPackageOptions', () => {
	it('builds the WindowsAppPackageOptions body PWABuilder takes', () => {
		const body = buildPackageOptions(manifest(), MANIFEST_URL, OWNER);
		expect(body).toMatchObject({
			name: 'three.ws',
			packageId: 'ThreeWs.ThreeWs',
			url: 'https://three.ws/',
			version: '1.0.1',
			allowSigning: true,
			publisher: { displayName: 'three.ws', commonName: OWNER.publisherCn },
			generateModernPackage: true,
			classicPackage: { generate: true, version: '1.0.0', url: 'https://three.ws/?source=pwa' },
			manifestUrl: MANIFEST_URL,
			startUrl: 'https://three.ws/?source=pwa',
			images: { baseImage: 'https://three.ws/pwa-512x512.png', backgroundColor: '#080814' },
			resourceLanguage: 'en',
			enableWebAppWidgets: true,
		});
	});
});

describe('package zip', () => {
	it('requires the .msixbundle the Store upload takes', () => {
		const good = zipSync({ 'three.ws.msixbundle': new Uint8Array([1]), 'three.ws.classic.appxbundle': new Uint8Array([2]) });
		expect(inspectPackageZip(good).problems).toEqual([]);
		const bad = zipSync({ 'readme.txt': new Uint8Array([1]) });
		expect(inspectPackageZip(bad).problems.join()).toMatch(/no \.msixbundle/);
	});
});

describe('main', () => {
	const fetchFor = (m) => {
		const assets = publicFetch();
		return async (url, init) => {
			if (url === MANIFEST_URL) return Response.json(m);
			return assets(url, init);
		};
	};

	it('exits 2 without the owner values unless --check', async () => {
		expect(await main([], {}, fetchFor(manifest()))).toBe(2);
	});

	it('--check exits 0 for a Store-ready manifest and 1 for a broken one', async () => {
		expect(await main(['--check'], {}, fetchFor(manifest()))).toBe(0);
		const broken = manifest({ screenshots: [{ src: 'screenshots/landing.png', sizes: '1280x800' }] });
		expect(await main(['--check'], {}, fetchFor(broken))).toBe(1);
	});
});
