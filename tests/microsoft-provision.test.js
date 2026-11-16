// scripts/microsoft-provision.mjs (integrations/microsoft/provisioning).
//
// Three layers:
//   1. The pure diff engine, fed Graph and ARM objects in the shapes Microsoft
//      documents (tests/fixtures/microsoft-provision/graph-service-principal.json
//      is a trimmed Microsoft Graph service principal).
//   2. The drift check: the real repo scan must match resources.json, and a
//      scope or redirect added to code without the manifest must fail.
//   3. A full --apply against FakeMicrosoftCloud (the HTTP boundary only), with
//      every log line captured to prove no secret is ever printed, the local
//      files are mode 600, and a rerun changes nothing.

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakeMicrosoftCloud } from './fixtures/microsoft-provision/fake-cloud.mjs';
import { restClient, HttpError } from '../integrations/microsoft/provisioning/lib/azure.mjs';
import { scanMicrosoftAuthText, scanRepo, driftProblems, staleEntries } from '../integrations/microsoft/provisioning/lib/code-scan.mjs';
import { OP, appSpec, buildPlan, desiredApplication, diffApplication, diffBot, desiredBot, formatPlan, permissionIdProblems, resourceNames, roleAssignmentName, secretDecision, summarize, updateEnvVarsArg } from '../integrations/microsoft/provisioning/lib/diff.mjs';
import { apply, cloudRunChecks, formatHandoff, plan, productionChecks } from '../integrations/microsoft/provisioning/lib/provision.mjs';
import { SecretStore, assertOutsideRepo } from '../integrations/microsoft/provisioning/lib/secret-store.mjs';

const REPO = resolve(import.meta.dirname, '..');
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'integrations/microsoft/provisioning/resources.json'), 'utf8'));
const GRAPH_SP = JSON.parse(readFileSync(join(REPO, 'tests/fixtures/microsoft-provision/graph-service-principal.json'), 'utf8'));
const NOW = Date.parse('2026-11-16T12:00:00Z');
const DAY = 86_400_000;

const sso = appSpec(MANIFEST, 'sso');
const bot = appSpec(MANIFEST, 'bot');

/** A live application as Graph returns it after the provisioner created it. */
function liveFromDesired(spec, extra = {}) {
	const d = desiredApplication(MANIFEST, spec);
	return { id: 'obj-1', appId: 'app-1', uniqueName: spec.uniqueName, passwordCredentials: [], optionalClaims: null, groupMembershipClaims: null, api: { requestedAccessTokenVersion: null }, requiredResourceAccess: [], ...d, ...extra };
}

describe('resources.json', () => {
	it('lists every permission with a Graph id Microsoft publishes', () => {
		expect(permissionIdProblems(MANIFEST, GRAPH_SP)).toEqual([]);
	});

	it('flags a wrong permission id and a permission Graph does not publish', () => {
		const broken = structuredClone(MANIFEST);
		broken.apps.find((a) => a.key === 'sso').permissions[0].id = '00000000-0000-0000-0000-000000000001';
		broken.apps.find((a) => a.key === 'sso').permissions.push({ name: 'Made.Up', type: 'Scope', id: '00000000-0000-0000-0000-000000000002', usedBy: [] });
		const problems = permissionIdProblems(broken, GRAPH_SP);
		expect(problems).toEqual(['openid: resources.json has 00000000-0000-0000-0000-000000000001, Microsoft Graph publishes 37f7f235-527c-4136-accd-4a02d197296e', 'Made.Up is not a published delegated permission of Microsoft Graph']);
	});
});

describe('drift: code vs resources.json', () => {
	const scan = scanRepo(REPO);

	it('the manifest covers every redirect, scope, audience and MS_* env var the code uses', () => {
		expect(driftProblems(MANIFEST, scan)).toEqual([]);
	});

	it('every manifest entry is still used by the file it names', () => {
		expect(staleEntries(MANIFEST, scan)).toEqual([]);
	});

	it('finds the scopes, redirects and audiences in the real Entra sign-in module', () => {
		const text = readFileSync(join(REPO, 'api/_lib/entra-oidc.js'), 'utf8');
		const found = scanMicrosoftAuthText(text);
		expect([...found.permissions].sort()).toEqual(['User.Read', 'email', 'offline_access', 'openid', 'profile']);
		expect([...found.redirects]).toContain('/api/auth/microsoft/callback');
	});

	it('fails when code requests a new scope or redirect that resources.json does not list', () => {
		const files = ['api/_lib/entra-oidc.js', 'api/_lib/new-feature.js'];
		const real = readFileSync(join(REPO, 'api/_lib/entra-oidc.js'), 'utf8');
		const added = ["const AUTHORITY = 'https://login.microsoftonline.com/common/v2.0';", "const SCOPES = 'openid Mail.Read';", "const redirect = `${origin}/api/outlook/connect/callback`;"].join('\n');
		const s = scanRepo(REPO, { files, read: (f) => (f === files[0] ? real : added) });
		expect(driftProblems(MANIFEST, s)).toEqual(['redirect URI /api/outlook/connect/callback (in api/_lib/new-feature.js) is not in resources.json', 'Microsoft scope or permission Mail.Read (in api/_lib/new-feature.js) is not in resources.json']);
	});

	it('finds the OneDrive SPA redirect and scopes, and covers the personal-account picker scope as implicit', () => {
		const found = scanMicrosoftAuthText(readFileSync(join(REPO, 'src/microsoft-graph/onedrive-core.js'), 'utf8'));
		expect([...found.redirects]).toEqual(['/auth/microsoft/redirect']);
		expect([...found.permissions].sort()).toEqual(['Files.ReadWrite', 'OneDrive.ReadWrite']);
		// A /api/.../callback path never doubles as an SPA redirect.
		expect([...scanMicrosoftAuthText("// login.microsoftonline.com\nconst r = '/api/auth/microsoft/callback';").redirects]).toEqual(['/api/auth/microsoft/callback']);
		const dropped = structuredClone(MANIFEST);
		delete appSpec(dropped, 'sso').implicitScopes;
		delete appSpec(dropped, 'sso').spaRedirectUris;
		const s = scanRepo(REPO, { files: ['src/microsoft-graph/onedrive-core.js'] });
		expect(driftProblems(dropped, s)).toEqual(['redirect URI /auth/microsoft/redirect (in src/microsoft-graph/onedrive-core.js) is not in resources.json', 'Microsoft scope or permission OneDrive.ReadWrite (in src/microsoft-graph/onedrive-core.js) is not in resources.json']);
	});

	it('ignores scopes that only appear in comments and files that never talk to Microsoft identity', () => {
		expect(scanMicrosoftAuthText("// login.microsoftonline.com\n// scope: 'Mail.Read'\n").permissions.size).toBe(0);
		expect(scanMicrosoftAuthText("const scope = 'Mail.Read';").permissions.size).toBe(0);
	});
});

describe('diffApplication', () => {
	it('creates a missing app with every redirect and permission', () => {
		const d = diffApplication(MANIFEST, sso, null);
		expect(d.op).toBe(OP.CREATE);
		expect(d.patch.uniqueName).toBe('threews-entra-sso');
		expect(d.patch.web.redirectUris).toEqual(['https://three.ws/api/microsoft-marketplace/sso/callback', 'https://three.ws/api/auth/microsoft/callback', 'https://three.ws/api/microsoft-365/connect/callback']);
		expect(d.patch.requiredResourceAccess[0].resourceAccess).toHaveLength(8);
		expect(d.changes).toContain('permission ExternalItem.ReadWrite.OwnedBy (application)');
		expect(d.patch.spa).toEqual({ redirectUris: ['https://three.ws/auth/microsoft/redirect'] });
		expect(d.changes).toContain('spa redirect https://three.ws/auth/microsoft/redirect');
		expect(d.changes).toContain('permission Files.ReadWrite (delegated)');
	});

	it('adds the SPA redirect beside an operator-added one and leaves the web platform alone', () => {
		const live = liveFromDesired(sso, { spa: { redirectUris: ['http://localhost:3136/auth/microsoft/redirect'] } });
		const d = diffApplication(MANIFEST, sso, live);
		expect(d.op).toBe(OP.UPDATE);
		expect(d.changes).toEqual(['add spa redirect https://three.ws/auth/microsoft/redirect']);
		expect(d.patch).toEqual({ spa: { redirectUris: ['http://localhost:3136/auth/microsoft/redirect', 'https://three.ws/auth/microsoft/redirect'] } });
		expect(d.extras).toEqual(['spa redirect http://localhost:3136/auth/microsoft/redirect']);
	});

	it('is ok when the live app already matches', () => {
		const live = liveFromDesired(sso);
		const d = diffApplication(MANIFEST, sso, live);
		expect(d).toEqual({ op: OP.OK, changes: [], patch: {}, extras: [] });
	});

	it('adds what is missing and keeps what an operator added by hand', () => {
		const live = liveFromDesired(sso, {
			web: { redirectUris: ['https://three.ws/api/auth/microsoft/callback', 'http://localhost:3127/api/auth/microsoft/callback'] },
			requiredResourceAccess: [{ resourceAppId: MANIFEST.graph.appId, resourceAccess: [{ id: '37f7f235-527c-4136-accd-4a02d197296e', type: 'Scope' }, { id: 'df021288-bdef-4463-88db-98f22de89214', type: 'Role' }] }],
		});
		const d = diffApplication(MANIFEST, sso, live);
		expect(d.op).toBe(OP.UPDATE);
		expect(d.patch.web.redirectUris).toEqual(['https://three.ws/api/auth/microsoft/callback', 'http://localhost:3127/api/auth/microsoft/callback', 'https://three.ws/api/microsoft-marketplace/sso/callback', 'https://three.ws/api/microsoft-365/connect/callback']);
		const access = d.patch.requiredResourceAccess[0].resourceAccess.map((a) => a.id);
		expect(access).toContain('df021288-bdef-4463-88db-98f22de89214');
		expect(access).toHaveLength(9);
		expect(d.extras).toEqual(['redirect http://localhost:3127/api/auth/microsoft/callback', `permission ${MANIFEST.graph.appId}|df021288-bdef-4463-88db-98f22de89214|Role`]);
		expect(d.patch.displayName).toBeUndefined();
	});

	it('reconciles audience, optional claims, group claims and token version', () => {
		const live = liveFromDesired(sso, { signInAudience: 'AzureADMyOrg', optionalClaims: { idToken: [{ name: 'email', essential: false, additionalProperties: [] }], accessToken: [], saml2Token: [] }, groupMembershipClaims: 'None', api: { requestedAccessTokenVersion: null } });
		const d = diffApplication(MANIFEST, sso, live);
		expect(d.changes).toEqual(['signInAudience AzureADMyOrg -> AzureADandPersonalMicrosoftAccount', 'add optional claim xms_edov (idToken)', 'groupMembershipClaims None -> DirectoryRole', 'requestedAccessTokenVersion null -> 2']);
		expect(d.patch.optionalClaims.idToken.map((c) => c.name)).toEqual(['email', 'xms_edov']);
		expect(d.patch.api).toEqual({ requestedAccessTokenVersion: 2 });
	});

	it('treats groupMembershipClaims All as covering DirectoryRole', () => {
		expect(diffApplication(MANIFEST, sso, liveFromDesired(sso, { groupMembershipClaims: 'All' })).op).toBe(OP.OK);
	});
});

describe('secretDecision', () => {
	const cred = (days, keyId = 'k1', displayName = 'three.ws provisioner') => ({ keyId, displayName, endDateTime: new Date(NOW + days * DAY).toISOString() });

	it('creates a secret for a new app with the stated expiry', () => {
		expect(secretDecision(bot, null, null, { now: NOW })).toEqual({ op: OP.CREATE, reason: 'new secret valid until 2027-11-16' });
	});

	it('keeps a valid secret whose value is stored under the same keyId', () => {
		const d = secretDecision(bot, { passwordCredentials: [cred(200)] }, { keyId: 'k1' }, { now: NOW });
		expect(d.op).toBe(OP.OK);
		expect(d.keyId).toBe('k1');
	});

	it('rotates inside the 30-day window, when the value is lost, and on --rotate-secrets', () => {
		expect(secretDecision(bot, { passwordCredentials: [cred(12)] }, { keyId: 'k1' }, { now: NOW }).reason).toMatch(/12 days left/);
		expect(secretDecision(bot, { passwordCredentials: [cred(200)] }, null, { now: NOW }).reason).toMatch(/in neither the Key Vault nor the local secrets file/);
		expect(secretDecision(bot, { passwordCredentials: [cred(200)] }, { keyId: 'k1' }, { now: NOW, rotate: true }).op).toBe(OP.CREATE);
	});

	it('ignores secrets it did not create and picks the newest of its own', () => {
		expect(secretDecision(bot, { passwordCredentials: [cred(300, 'k9', 'made in the portal')] }, { keyId: 'k9' }, { now: NOW }).op).toBe(OP.CREATE);
		expect(secretDecision(bot, { passwordCredentials: [cred(40, 'old'), cred(300, 'new')] }, { keyId: 'new' }, { now: NOW }).keyId).toBe('new');
	});
});

describe('Azure pieces', () => {
	it('blocks a bot bound to a different app instead of silently rebinding it', () => {
		const desired = desiredBot(MANIFEST, { botAppId: 'app-b', tenantId: 't', botName: 'b' });
		expect(diffBot(desired, { properties: { ...desired.properties } }).op).toBe(OP.OK);
		expect(diffBot(desired, { properties: { ...desired.properties, endpoint: 'https://old.example/api/messages' } }).op).toBe(OP.UPDATE);
		expect(diffBot(desired, { properties: { ...desired.properties, msaAppId: 'other' } }).op).toBe(OP.BLOCKED);
	});

	it('derives stable globally-unique names and role assignment GUIDs', () => {
		const a = resourceNames(MANIFEST, { tenantId: 't1', subscriptionId: 's1' });
		expect(a).toEqual(resourceNames(MANIFEST, { tenantId: 't1', subscriptionId: 's1' }));
		expect(a.vaults.ops).toMatch(/^threews-ops-[0-9a-f]{6}$/);
		expect(a.vaults.ops.length).toBeLessThanOrEqual(24);
		expect(resourceNames(MANIFEST, { tenantId: 't2', subscriptionId: 's1' }).vaults.ops).not.toBe(a.vaults.ops);
		const g = roleAssignmentName('/subscriptions/s/x', 'p', 'r');
		expect(g).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(roleAssignmentName('/SUBSCRIPTIONS/S/X', 'P', 'R')).toBe(g);
	});
});

describe('updateEnvVarsArg', () => {
	it('joins with commas when no value contains one', () => {
		expect(updateEnvVarsArg({ A: '1', B: 'x~y' })).toBe('A=1,B=x~y');
	});
	it('switches to a gcloud ^D^ delimiter when a value contains a comma', () => {
		expect(updateEnvVarsArg({ A: 'a,b', B: 'c' })).toBe('^@^A=a,b@B=c');
		expect(updateEnvVarsArg({ A: 'a,b@', B: 'c' })).toBe('^|^A=a,b@|B=c');
	});
	it('refuses a newline', () => {
		expect(() => updateEnvVarsArg({ A: 'a\nb' })).toThrow(/newline/);
	});
});

describe('SecretStore', () => {
	it('refuses a directory inside the repository', () => {
		expect(() => new SecretStore(join(REPO, '.secrets'), REPO)).toThrow(/refusing to write secrets inside the repository/);
		expect(() => assertOutsideRepo(REPO, REPO)).toThrow();
		expect(() => assertOutsideRepo(`${REPO}-sibling`, REPO)).not.toThrow();
	});
});

describe('apply against a Microsoft tenant (FakeMicrosoftCloud at the HTTP boundary)', () => {
	let cloud, dir, lines, ctx;

	const makeCtx = (overrides = {}) => ({
		manifest: MANIFEST,
		rest: restClient({ token: cloud.token(), fetchImpl: cloud.fetch, sleep: async () => {} }),
		account: cloud.account(),
		subscriptionId: cloud.subscriptionId,
		names: {},
		store: new SecretStore(dir, REPO),
		rotate: false,
		copilotRedirectUri: null,
		registerOauthClient: async () => {
			throw new Error('not expected');
		},
		now: () => NOW,
		sleep: async () => {},
		log: (...l) => lines.push(...l.map(String)),
		...overrides,
	});

	beforeEach(() => {
		cloud = new FakeMicrosoftCloud();
		dir = mkdtempSync(join(tmpdir(), 'ms-provision-'));
		lines = [];
		ctx = makeCtx();
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('plans everything in an empty tenant', async () => {
		const { actions } = await plan(ctx);
		const s = summarize(actions);
		expect(s).toEqual({ create: 27, update: 0, ok: 0, blocked: 0, manual: 5 });
		const text = formatPlan(actions);
		expect(text).toContain('+ create  three.ws (threews-entra-sso)');
		expect(text).toContain('waits on the redirect URI Microsoft issues');
		expect(cloud.calls.every((c) => c.method === 'GET' || c.path.endsWith('/checkNameAvailability'))).toBe(true);
	});

	it('creates every resource, never prints a secret, writes 600-mode files, and a rerun changes nothing', async () => {
		const copilotSecret = `cs_${'z'.repeat(40)}`;
		ctx = makeCtx({ copilotRedirectUri: 'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect', registerOauthClient: async (args) => ({ client_id: 'mcp_client_123', client_secret: copilotSecret, ...{ args } }) });
		const result = await apply(ctx);

		// Entra apps, secrets and Azure resources exist.
		const apps = [...cloud.apps.values()];
		expect(apps.map((a) => a.uniqueName).sort()).toEqual(['threews-entra-sso', 'threews-marketplace-fulfillment', 'threews-teams-bot']);
		const ssoApp = apps.find((a) => a.uniqueName === 'threews-entra-sso');
		expect(ssoApp.web.redirectUris).toHaveLength(3);
		expect(ssoApp.spa.redirectUris).toEqual(['https://three.ws/auth/microsoft/redirect']);
		expect(ssoApp.signInAudience).toBe('AzureADandPersonalMicrosoftAccount');
		expect(apps.every((a) => a.passwordCredentials.length === 1 && a.passwordCredentials[0].endDateTime === new Date(NOW + 365 * DAY).toISOString())).toBe(true);
		expect(cloud.issuedSecrets).toHaveLength(3);
		const botRes = [...cloud.arm.values()].find((r) => r.kind === 'azurebot');
		expect(botRes.properties.endpoint).toBe('https://three.ws/api/microsoft-teams/messages');
		expect(botRes.properties.msaAppId).toBe(apps.find((a) => a.uniqueName === 'threews-teams-bot').appId);
		expect([...cloud.arm.keys()].filter((k) => k.includes('/channels/')).map((k) => k.split('/').pop()).sort()).toEqual(['m365extensions', 'msteamschannel']);
		const roleAssignments = [...cloud.arm.values()].filter((r) => r.type === 'Microsoft.Authorization/roleAssignments');
		expect(roleAssignments).toHaveLength(3);
		expect(roleAssignments.filter((r) => r.properties.roleDefinitionId.endsWith('4633458b-17de-408a-b874-0445c86b69e6')).every((r) => r.properties.scope.includes('threews-copilot-'))).toBe(true);

		// Secrets live in Key Vault and the local store, and nowhere in the output.
		const vaultValues = [...cloud.secrets.values()].map((s) => s.value);
		for (const secret of [...cloud.issuedSecrets, copilotSecret]) {
			expect(vaultValues).toContain(secret);
			for (const line of lines) expect(line.includes(secret)).toBe(false);
		}
		const output = lines.join('\n');
		expect(output).toContain('MS_ENTRA_SSO_CLIENT_SECRET=<secret, in');
		expect(output).toContain(`--update-env-vars "$(cat '${result.envFile}')"`);
		expect(output).not.toContain('--set-env-vars');
		expect(output).toContain(`client_id=${ssoApp.appId}`);

		const mode = (p) => (statSync(p).mode & 0o777).toString(8);
		expect(mode(dir)).toBe('700');
		expect(mode(ctx.store.file)).toBe('600');
		expect(mode(result.envFile)).toBe('600');
		const envArg = readFileSync(result.envFile, 'utf8');
		for (const k of MANIFEST.env.cloudRun) expect(envArg).toContain(`${k}=`);
		for (const secret of cloud.issuedSecrets) expect(envArg).toContain(secret);

		// The apply already re-planned; a fresh plan with a fresh store proves idempotency.
		expect(output).toContain('Re-plan after apply: 0 to create, 0 to change, 0 blocked');
		const again = await plan(makeCtx());
		expect(summarize(again.actions)).toMatchObject({ create: 0, update: 0, blocked: 0, manual: 3 });

		// A second apply issues no new secrets and writes nothing new.
		const writesBefore = cloud.calls.filter((c) => c.method !== 'GET').length;
		await apply(makeCtx());
		const newWrites = cloud.calls.slice().filter((c) => c.method !== 'GET').length - writesBefore;
		expect(cloud.issuedSecrets).toHaveLength(3);
		expect(newWrites).toBe(0);
	});

	it('restores a lost local secrets file from Key Vault without issuing a new secret', async () => {
		await apply(ctx);
		rmSync(dir, { recursive: true, force: true });
		lines = [];
		await apply(makeCtx());
		expect(cloud.issuedSecrets).toHaveLength(3);
		expect(lines.join('\n')).toContain('restored MS_TEAMS_BOT_APP_PASSWORD from Key Vault');
		for (const secret of cloud.issuedSecrets) for (const line of lines) expect(line.includes(secret)).toBe(false);
	});

	it('adopts an app found by display name and keeps what an operator added', async () => {
		const seeded = cloud.seedApp({ displayName: 'three.ws Bot', web: { redirectUris: ['https://token.botframework.com/.auth/web/redirect'] } });
		const { actions } = await plan(ctx);
		const a = actions.find((x) => x.target.startsWith('three.ws Bot ('));
		expect(a.details[0]).toBe(`adopting the existing app ${seeded.appId} found by display name`);
		expect(a.details).toContain('kept (unmanaged): redirect https://token.botframework.com/.auth/web/redirect');
		await apply(ctx);
		expect(cloud.apps.get(seeded.id).web.redirectUris).toEqual(['https://token.botframework.com/.auth/web/redirect']);
	});

	it('refuses to apply when two unclaimed apps share a display name', async () => {
		cloud.seedApp({ displayName: 'three.ws' });
		cloud.seedApp({ displayName: 'three.ws' });
		await expect(apply(ctx)).rejects.toThrow(/blocked items/);
		expect(lines.join('\n')).toContain('2 apps are named "three.ws"');
		expect(cloud.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
	});

	it('creates the Entra apps and secrets without a subscription and names what waits', async () => {
		ctx = makeCtx({ subscriptionId: null });
		const { actions } = await plan(ctx);
		expect(actions.find((a) => a.target === 'subscription').op).toBe(OP.BLOCKED);
		await apply(ctx);
		expect(cloud.apps.size).toBe(3);
		expect(cloud.arm.size).toBe(0);
		for (const secret of cloud.issuedSecrets) for (const line of lines) expect(line.includes(secret)).toBe(false);
	});
});

describe('handoff and checks', () => {
	it('prints no gcloud line until every value exists, and never the secret value', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ms-provision-'));
		try {
			const store = new SecretStore(dir, REPO);
			store.put('MS_TEAMS_BOT_APP_PASSWORD', { value: 'TOP~SECRET~VALUE', keyId: 'k', appId: 'a', expires: null });
			const state = { account: { tenantId: 'tid' }, apps: { bot: { app: { appId: 'bot-app' } } }, azure: null };
			const text = formatHandoff({ manifest: MANIFEST, store }, state, { envFile: '/x/cloud-run.env' });
			expect(text).not.toContain('TOP~SECRET~VALUE');
			expect(text).toContain('MS_TEAMS_BOT_APP_PASSWORD=<secret, in');
			expect(text).not.toContain('gcloud run services update');
			const checks = cloudRunChecks(MANIFEST, state, store, { MS_TEAMS_BOT_APP_ID: 'bot-app', MS_TEAMS_BOT_APP_PASSWORD: 'stale' });
			const pw = checks.find((c) => c.check === 'Cloud Run MS_TEAMS_BOT_APP_PASSWORD');
			expect(pw).toEqual({ check: 'Cloud Run MS_TEAMS_BOT_APP_PASSWORD', ok: false, detail: 'differs from the stored secret (rerun the printed gcloud line)' });
			expect(JSON.stringify(checks)).not.toContain('TOP~SECRET~VALUE');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('reads the production status endpoints', async () => {
		const responses = {
			'/api/microsoft-marketplace/status': [200, { ready: false, sso: false, missing: ['MS_MARKETPLACE_TENANT_ID'] }],
			'/api/config': [200, { microsoftEnabled: false }],
			'/api/microsoft-365/status': [401, { error: 'unauthorized' }],
		};
		const fetchImpl = async (url) => {
			const [status, body] = responses[new URL(url).pathname];
			return new Response(JSON.stringify(body), { status });
		};
		const checks = await productionChecks('https://three.ws', fetchImpl);
		expect(checks.map((c) => c.ok)).toEqual([false, false, false, true]);
		expect(checks[0].detail).toBe('ready=false sso=false missing=MS_MARKETPLACE_TENANT_ID');
	});

	it('redacts query strings from HTTP errors', () => {
		const e = new HttpError('GET', 'https://graph.microsoft.com/v1.0/x?$filter=secret', 403, { error: { code: 'Authorization_RequestDenied', message: 'Insufficient privileges' } });
		expect(e.message).toBe('GET https://graph.microsoft.com/v1.0/x -> 403 Authorization_RequestDenied: Insufficient privileges');
	});
});

describe('buildPlan', () => {
	it('orders groups and marks Copilot client secrets as an owner step without a redirect URI', () => {
		const state = { account: { tenantId: 't', principalId: 'p', name: 'op' }, apps: {}, secrets: {}, azure: { names: resourceNames(MANIFEST, { tenantId: 't', subscriptionId: 's' }), providers: { 'Microsoft.KeyVault': 'Registered' }, resourceGroup: { id: 'rg' }, vaults: { ops: { vault: null, roleAssignments: [], secrets: {} }, copilot: { vault: null, roleAssignments: [], secrets: {} } }, readers: {}, bot: null, channels: {} } };
		const actions = buildPlan(MANIFEST, state, { now: NOW });
		const groups = [...new Set(actions.map((a) => a.group))];
		expect(groups).toEqual(['Entra applications', 'Service principals', 'Azure resources', 'Role assignments', 'Client secrets', 'Key Vault secrets', 'Azure Bot', 'Owner steps outside Azure']);
		expect(actions.filter((a) => a.op === OP.MANUAL).map((a) => a.target)).toContain(`${state.azure.names.vaults.copilot}/ClientId`);
		expect(actions.find((a) => a.target === 'resource provider Microsoft.KeyVault').op).toBe(OP.OK);
	});
});
