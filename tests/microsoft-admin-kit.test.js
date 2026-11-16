// IT admin deployment kit: the generators, the committed output, the web app
// install readiness, and the admin consent page logic. Reads the real
// vite.config.js, manifests and public/ assets; nothing is mocked.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	extractViteManifest,
	installReadiness,
	webAppForceList,
	extensionForceList,
	regFile,
	policyJson,
	EDGE_UPDATE_URL,
} from '../scripts/lib/microsoft-admin-kit.mjs';
import { buildKit, loadInputs } from '../scripts/microsoft-admin-kit.mjs';
import {
	normalizeTenant,
	buildConsentUrl,
	parseConsentRedirect,
	permissionRows,
	PERMISSION_COPY,
	CONSENT_SCOPE,
} from '../src/enterprise-admin-consent-model.js';

const root = process.cwd();
const publicHas = (src) => existsSync(join(root, 'public', src.replace(/^\//, '')));
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

describe('web app install readiness', () => {
	const manifest = extractViteManifest(readFileSync(join(root, 'vite.config.js'), 'utf8'));

	it('reads the manifest vite-plugin-pwa will generate', () => {
		expect(manifest.id).toBe('/?source=pwa');
		expect(manifest.start_url).toBe('/?source=pwa');
		expect(manifest.scope).toBe('/');
	});

	it('has everything Edge needs to install it as an app, with every icon file served', () => {
		expect(installReadiness(manifest, { assetExists: publicHas })).toEqual([]);
	});

	it('names each gap', () => {
		const problems = installReadiness({ icons: [{ src: 'a.png', type: 'image/png', sizes: '192x192' }], display: 'browser' }, { assetExists: () => false });
		expect(problems).toEqual(
			expect.arrayContaining([
				'name or short_name is required',
				'id is required so a policy-installed app keeps one identity',
				'start_url is required',
				'scope is required',
				'display must open the app in its own window (standalone)',
				'needs a PNG icon with purpose "any" at 512px or larger',
				'needs a maskable PNG icon at 512px or larger',
				'icon a.png is not served from public/',
			]),
		);
	});

	it('rejects a start_url outside the scope', () => {
		const problems = installReadiness({ ...manifest, scope: '/app/', start_url: '/other' }, { assetExists: publicHas });
		expect(problems).toContain('start_url is outside scope');
	});
});

describe('extractViteManifest', () => {
	it('survives braces inside strings and comments', () => {
		const src = "VitePWA({ x: 1, manifest: { name: 'a } b', // } comment\n /* { */ id: '/x', nested: { k: [1, 2] } }, workbox: {} })";
		expect(extractViteManifest(src)).toEqual({ name: 'a } b', id: '/x', nested: { k: [1, 2] } });
	});

	it('fails loudly when the block is missing', () => {
		expect(() => extractViteManifest('export default {}')).toThrow(/VitePWA/);
	});
});

describe('policy values', () => {
	const manifest = { short_name: 'three.ws', start_url: '/?source=pwa' };
	const exts = [
		{ key: 'a', name: 'Alpha', version: '1.0.0' },
		{ key: 'b', name: 'Beta', version: '2.0.0' },
	];
	const goodId = 'a'.repeat(32);

	it('builds the web app entry from the manifest start_url', () => {
		expect(webAppForceList(manifest, 'https://three.ws')).toEqual([
			{ url: 'https://three.ws/?source=pwa', launch_container: 'window', create_desktop_shortcut: true, fallback_app_name: 'three.ws' },
		]);
	});

	it('force-installs published extensions and reports unpublished ones as pending', () => {
		const { entries, pending } = extensionForceList(exts, { a: goodId, b: null });
		expect(entries.map((e) => e.policy)).toEqual([`${goodId};${EDGE_UPDATE_URL}`]);
		expect(pending.map((p) => p.key)).toEqual(['b']);
	});

	it('refuses an id that is not a 32 character Edge id', () => {
		expect(() => extensionForceList(exts, { a: 'nope', b: null })).toThrow(/32 character/);
	});

	it('escapes the JSON for the registry and uses CRLF', () => {
		const reg = regFile({ webApps: webAppForceList(manifest, 'https://three.ws'), extensionEntries: [] });
		expect(reg.startsWith('Windows Registry Editor Version 5.00\r\n')).toBe(true);
		expect(reg).toContain('"WebAppInstallForceList"="[{\\"url\\":\\"https://three.ws/?source=pwa\\"');
		expect(reg).not.toContain('ExtensionInstallForcelist');
	});

	it('omits the extension policy when nothing is published, includes it when something is', () => {
		const apps = webAppForceList(manifest, 'https://three.ws');
		expect(JSON.parse(policyJson({ webApps: apps, extensionEntries: [] }))).not.toHaveProperty('ExtensionInstallForcelist');
		const { entries } = extensionForceList(exts, { a: goodId, b: null });
		expect(JSON.parse(policyJson({ webApps: apps, extensionEntries: entries })).ExtensionInstallForcelist).toEqual([`${goodId};${EDGE_UPDATE_URL}`]);
	});
});

describe('generated kit', () => {
	const kit = buildKit();

	it('is deterministic', () => {
		expect(buildKit()).toEqual(kit);
	});

	it('matches the committed files byte for byte (run node scripts/microsoft-admin-kit.mjs)', () => {
		for (const [name, text] of Object.entries(kit)) {
			expect(readFileSync(join(root, 'integrations/microsoft/admin-kit', name), 'utf8'), name).toBe(text);
		}
	});

	it('contains valid JSON and no tenant-specific value', () => {
		expect(() => JSON.parse(kit['edge-policies.json'])).not.toThrow();
		for (const text of Object.values(kit)) expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?<!0{12})(?<!1{12})/i);
	});

	it('gives both scripts a dry run and a rollback', () => {
		for (const name of ['Set-ThreeWsEdgePolicy.ps1', 'Deploy-ThreeWsTeams.ps1']) {
			expect(kit[name]).toContain('SupportsShouldProcess');
			expect(kit[name]).toContain('[switch]$Remove');
		}
	});

	it('uses no em or en dash anywhere', () => {
		for (const text of Object.values(kit)) expect(text).not.toMatch(/[\u2013\u2014]/);
	});

	it('lists every extension from its real manifest', () => {
		for (const ext of loadInputs().extensions) expect(kit['README.md']).toContain(ext.name);
	});
});

describe('admin consent page logic', () => {
	it('builds a v2.0 tenant-wide consent URL', () => {
		const url = new URL(buildConsentUrl({ clientId: 'cid', redirectUri: 'https://three.ws/enterprise/admin-consent', tenant: TENANT }));
		expect(url.origin + url.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/v2.0/adminconsent`);
		expect(url.searchParams.get('client_id')).toBe('cid');
		expect(url.searchParams.get('scope')).toBe(CONSENT_SCOPE);
		expect(url.searchParams.get('redirect_uri')).toBe('https://three.ws/enterprise/admin-consent');
	});

	it('accepts empty, a tenant id and a domain, and rejects anything that could escape the path', () => {
		expect(normalizeTenant('')).toBe('organizations');
		expect(normalizeTenant(` ${TENANT.toUpperCase()} `)).toBe(TENANT);
		expect(normalizeTenant('Contoso.com')).toBe('contoso.com');
		for (const bad of ['evil.com/../x', 'a b', 'localhost', 'x?y=1', '//host']) expect(normalizeTenant(bad), bad).toBeNull();
	});

	it('reads the success redirect', () => {
		expect(parseConsentRedirect(`?tenant=${TENANT}&admin_consent=True`)).toEqual({ kind: 'success', tenantId: TENANT });
	});

	it('reads failures: declined, not an admin, anything else', () => {
		expect(parseConsentRedirect('?error=access_denied&error_description=AADSTS65004%3A+declined').code).toBe('declined');
		expect(parseConsentRedirect('?error=consent_required&error_description=AADSTS90094%3A+An+administrator+must+grant').code).toBe('admin_required');
		expect(parseConsentRedirect('?error=server_error&error_description=boom%0D%0Atrace').detail).toBe('boom');
	});

	it('does not claim success without a real tenant', () => {
		expect(parseConsentRedirect('?admin_consent=True').kind).toBe('error');
		expect(parseConsentRedirect('?tenant=not-a-guid&admin_consent=True').kind).toBe('error');
		expect(parseConsentRedirect('').kind).toBe('none');
	});

	it('explains every scope the sign-in flow requests', async () => {
		const { SCOPES } = await import('../api/_lib/entra-oidc.js');
		for (const scope of SCOPES.split(' ')) expect(PERMISSION_COPY, scope).toHaveProperty(scope);
		expect(permissionRows(['openid'])[0].title).toBe('Sign in');
	});
});

describe('admin consent wiring', () => {
	it('config comes from the Entra app env and the page redirect URI', async () => {
		const prev = process.env.MS_ENTRA_SSO_CLIENT_ID;
		const prevSecret = process.env.MS_ENTRA_SSO_CLIENT_SECRET;
		process.env.MS_ENTRA_SSO_CLIENT_ID = TENANT;
		process.env.MS_ENTRA_SSO_CLIENT_SECRET = 'secret';
		try {
			const { adminConsentConfig } = await import('../api/enterprise/admin-consent-config.js');
			const cfg = adminConsentConfig('https://three.ws');
			expect(cfg).toEqual({ clientId: TENANT, redirectUri: 'https://three.ws/enterprise/admin-consent', scopes: ['openid', 'profile', 'email', 'offline_access', 'User.Read'] });
			expect(JSON.stringify(cfg)).not.toContain('secret');
			delete process.env.MS_ENTRA_SSO_CLIENT_ID;
			expect(adminConsentConfig('https://three.ws')).toBeNull();
		} finally {
			if (prev === undefined) delete process.env.MS_ENTRA_SSO_CLIENT_ID;
			else process.env.MS_ENTRA_SSO_CLIENT_ID = prev;
			if (prevSecret === undefined) delete process.env.MS_ENTRA_SSO_CLIENT_SECRET;
			else process.env.MS_ENTRA_SSO_CLIENT_SECRET = prevSecret;
		}
	});

	it('routes, build input, page registry and trust link are in place', () => {
		const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
		expect(vercel.routes.find((r) => r.src === '/enterprise/admin-consent/?')?.dest).toBe('/enterprise-admin-consent.html');
		expect(readFileSync(join(root, 'vite.config.js'), 'utf8')).toContain("'enterprise-admin-consent': resolve(__dirname, 'pages/enterprise-admin-consent.html')");
		const pages = readFileSync(join(root, 'data/pages.json'), 'utf8');
		expect(pages).toContain('"/enterprise/admin-consent"');
		expect(pages).toContain('"/docs/microsoft-admin-deployment"');
		const trust = readFileSync(join(root, 'pages/trust.html'), 'utf8');
		expect(trust).toContain('href="/enterprise/admin-consent"');
		expect(trust).toContain('href="/docs/microsoft-admin-deployment"');
	});
});
