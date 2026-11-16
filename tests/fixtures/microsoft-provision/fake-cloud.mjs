// An in-memory Microsoft tenant and Azure subscription that answers the exact
// REST calls integrations/microsoft/provisioning/lib/azure.mjs makes, with the
// response shapes Microsoft documents:
//   Graph v1.0  application, servicePrincipal, passwordCredential (addPassword),
//               /me, PATCH applications(uniqueName=...) with Prefer: create-if-missing
//   ARM         providers, resourcegroups, Microsoft.KeyVault/vaults (+ checkNameAvailability),
//               Microsoft.Authorization/roleAssignments, Microsoft.BotService/botServices (+ channels)
//   Key Vault   secrets GET/PUT (api-version 7.4)
// It is the HTTP boundary only: every byte of provisioner logic above it runs
// for real. `calls` records each request (method, path, body) for assertions.

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const GRAPH_SP = JSON.parse(readFileSync(new URL('./graph-service-principal.json', import.meta.url), 'utf8'));

const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const notFound = (code = 'ResourceNotFound') => json(404, { error: { code, message: 'The requested resource was not found.' } });

export class FakeMicrosoftCloud {
	constructor({ tenantId = randomUUID(), subscriptionId = randomUUID(), user = 'owner@contoso.onmicrosoft.com' } = {}) {
		this.tenantId = tenantId;
		this.subscriptionId = subscriptionId;
		this.user = { id: randomUUID(), userPrincipalName: user };
		this.apps = new Map(); // object id -> application
		this.sps = new Map([[GRAPH_SP.appId, GRAPH_SP]]); // appId -> servicePrincipal
		this.providers = new Map([['microsoft.keyvault', 'NotRegistered'], ['microsoft.botservice', 'NotRegistered']]);
		this.arm = new Map(); // lowercased resource id -> resource
		this.secrets = new Map(); // `${vault}/${name}` -> { value, tags, attributes }
		this.issuedSecrets = []; // every secretText and vault value created, for leak assertions
		this.calls = [];
	}

	account() {
		return { tenantId: this.tenantId, subscriptionId: this.subscriptionId, subscriptionName: 'Pay-As-You-Go', user: { name: this.user.userPrincipalName, type: 'user' } };
	}

	token() {
		return async (resource) => `fake-token-for-${resource}`;
	}

	fetch = async (url, init = {}) => {
		const u = new URL(url);
		const method = init.method || 'GET';
		const body = init.body ? JSON.parse(init.body) : undefined;
		const path = decodeURIComponent(u.pathname);
		this.calls.push({ method, host: u.host, path, body });
		if (u.host === 'graph.microsoft.com') return this.#graph(method, path, u.searchParams, body, init.headers || {});
		if (u.host === 'management.azure.com') return this.#arm(method, path, body);
		if (u.host.endsWith('.vault.azure.net')) return this.#vault(method, u.host.split('.')[0], path, body);
		throw new Error(`fake cloud: no route for ${method} ${url}`);
	};

	#graph(method, path, params, body, headers) {
		const p = path.replace(/^\/v1\.0/, '');
		let m;
		if (p === '/me' && method === 'GET') return json(200, this.user);
		if ((m = p.match(/^\/servicePrincipals\(appId='([^']+)'\)$/)) && method === 'GET') {
			const sp = this.sps.get(m[1]);
			return sp ? json(200, sp) : notFound('Request_ResourceNotFound');
		}
		if (p === '/servicePrincipals' && method === 'POST') {
			const known = [...this.apps.values()].find((a) => a.appId === body.appId);
			const sp = { id: randomUUID(), appId: body.appId, displayName: known?.displayName || 'Microsoft first-party app', appRoles: [], oauth2PermissionScopes: [] };
			this.sps.set(body.appId, sp);
			return json(201, sp);
		}
		if ((m = p.match(/^\/applications\(uniqueName='([^']+)'\)$/))) {
			const app = [...this.apps.values()].find((a) => a.uniqueName === m[1]);
			if (method === 'GET') return app ? json(200, app) : notFound('Request_ResourceNotFound');
			if (method === 'PATCH') {
				if (app) {
					Object.assign(app, body);
					return json(204);
				}
				if (String(headers.prefer || '').toLowerCase() !== 'create-if-missing') return notFound('Request_ResourceNotFound');
				const created = this.#newApp({ ...body, uniqueName: m[1] });
				return json(201, created);
			}
		}
		if (p === '/applications' && method === 'GET') {
			const filter = params.get('$filter') || '';
			const name = filter.match(/^displayName eq '(.*)'$/)?.[1]?.replace(/''/g, "'");
			return json(200, { value: [...this.apps.values()].filter((a) => a.displayName === name) });
		}
		if ((m = p.match(/^\/applications\/([^/]+)$/)) && method === 'PATCH') {
			const app = this.apps.get(m[1]);
			if (!app) return notFound('Request_ResourceNotFound');
			Object.assign(app, body);
			return json(204);
		}
		if ((m = p.match(/^\/applications\/([^/]+)\/addPassword$/)) && method === 'POST') {
			const app = this.apps.get(m[1]);
			if (!app) return notFound('Request_ResourceNotFound');
			const secretText = `${randomBytes(3).toString('hex')}8Q~${randomBytes(18).toString('base64url')}`;
			const cred = { customKeyIdentifier: null, displayName: body.passwordCredential.displayName, endDateTime: body.passwordCredential.endDateTime, hint: secretText.slice(0, 3), keyId: randomUUID(), startDateTime: new Date().toISOString() };
			app.passwordCredentials.push(cred);
			this.issuedSecrets.push(secretText);
			return json(200, { ...cred, secretText });
		}
		throw new Error(`fake cloud: no Graph route for ${method} ${path}`);
	}

	/** Seed or create an application with Graph's defaults. */
	#newApp(fields) {
		const app = {
			id: randomUUID(),
			appId: randomUUID(),
			displayName: null,
			uniqueName: null,
			signInAudience: 'AzureADMyOrg',
			web: { redirectUris: [], homePageUrl: null, logoutUrl: null, implicitGrantSettings: { enableAccessTokenIssuance: false, enableIdTokenIssuance: false } },
			requiredResourceAccess: [],
			optionalClaims: null,
			groupMembershipClaims: null,
			api: { requestedAccessTokenVersion: null, oauth2PermissionScopes: [] },
			passwordCredentials: [],
			...fields,
		};
		this.apps.set(app.id, app);
		return app;
	}

	seedApp(fields) {
		return this.#newApp(fields);
	}

	#arm(method, path, body) {
		const lower = path.toLowerCase();
		const sub = `/subscriptions/${this.subscriptionId}`.toLowerCase();
		let m;
		if ((m = lower.match(/^\/subscriptions\/[^/]+\/providers\/([^/]+)$/)) && method === 'GET') return json(200, { namespace: m[1], registrationState: this.providers.get(m[1]) || 'NotRegistered' });
		if ((m = lower.match(/^\/subscriptions\/[^/]+\/providers\/([^/]+)\/register$/)) && method === 'POST') {
			this.providers.set(m[1], 'Registered');
			return json(200, { namespace: m[1], registrationState: 'Registering' });
		}
		if (lower === `${sub}/providers/microsoft.keyvault/checknameavailability` && method === 'POST') {
			const taken = [...this.arm.keys()].some((k) => k.endsWith(`/microsoft.keyvault/vaults/${body.name.toLowerCase()}`));
			return json(200, taken ? { nameAvailable: false, reason: 'AlreadyExists', message: `The vault name '${body.name}' is already in use.` } : { nameAvailable: true });
		}
		if ((m = lower.match(/^(.*)\/providers\/microsoft\.authorization\/roleassignments$/)) && method === 'GET') {
			const scope = m[1];
			return json(200, { value: [...this.arm.entries()].filter(([k]) => k.startsWith(`${scope}/providers/microsoft.authorization/roleassignments/`)).map(([, v]) => v) });
		}
		if ((m = lower.match(/^(.*)\/providers\/microsoft\.authorization\/roleassignments\/([^/]+)$/)) && method === 'PUT') {
			if (this.arm.has(lower)) return json(409, { error: { code: 'RoleAssignmentExists', message: 'The role assignment already exists.' } });
			const ra = { id: path, name: m[2], type: 'Microsoft.Authorization/roleAssignments', properties: { ...body.properties, scope: path.split('/providers/Microsoft.Authorization')[0] } };
			this.arm.set(lower, ra);
			return json(201, ra);
		}
		if (method === 'GET') {
			const r = this.arm.get(lower);
			return r ? json(200, r) : notFound(lower.includes('/resourcegroups/') && !lower.includes('/providers/') ? 'ResourceGroupNotFound' : 'ResourceNotFound');
		}
		if (method === 'PUT') {
			const name = path.split('/').pop();
			const existing = this.arm.get(lower);
			const resource = { ...(existing || {}), ...body, id: path, name };
			if (lower.includes('/microsoft.keyvault/vaults/')) resource.properties = { ...resource.properties, vaultUri: `https://${name}.vault.azure.net/` };
			this.arm.set(lower, resource);
			return json(existing ? 200 : 201, resource);
		}
		throw new Error(`fake cloud: no ARM route for ${method} ${path}`);
	}

	#vault(method, vault, path, body) {
		const m = path.match(/^\/secrets\/([^/]+)$/);
		if (!m) throw new Error(`fake cloud: no Key Vault route for ${method} ${path}`);
		const exists = [...this.arm.keys()].some((k) => k.endsWith(`/microsoft.keyvault/vaults/${vault}`));
		if (!exists) return json(404, { error: { code: 'VaultNotFound', message: 'vault not found' } });
		const key = `${vault}/${m[1]}`;
		if (method === 'GET') {
			const s = this.secrets.get(key);
			return s ? json(200, { value: s.value, id: `https://${vault}.vault.azure.net/secrets/${m[1]}/${s.version}`, attributes: s.attributes, tags: s.tags }) : json(404, { error: { code: 'SecretNotFound', message: `A secret with (name/id) ${m[1]} was not found in this key vault.` } });
		}
		if (method === 'PUT') {
			const s = { value: body.value, tags: body.tags || {}, attributes: { enabled: true, ...(body.attributes || {}) }, version: randomBytes(16).toString('hex') };
			this.secrets.set(key, s);
			return json(200, { value: s.value, id: `https://${vault}.vault.azure.net/secrets/${m[1]}/${s.version}`, attributes: s.attributes, tags: s.tags });
		}
		throw new Error(`fake cloud: no Key Vault route for ${method} ${path}`);
	}
}
