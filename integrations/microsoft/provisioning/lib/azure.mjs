// IO half: the operator's Azure CLI session for identity and tokens, and plain
// REST calls to Microsoft Graph, Azure Resource Manager and the Key Vault data
// plane. The CLI is used only for `az account show` and
// `az account get-access-token`; every read and write is a documented REST
// call, so the same code runs under tests with a recorded transport.
//
// Secrets travel only in request bodies to Graph (addPassword response) and
// Key Vault (PUT secret). They never appear in argv, logs or thrown messages.

import { execFile } from 'node:child_process';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
export const ARM = 'https://management.azure.com';
export const LOGIN = 'https://login.microsoftonline.com';
export const RESOURCES = Object.freeze({ graph: 'https://graph.microsoft.com', arm: 'https://management.azure.com', vault: 'https://vault.azure.net' });
export const API = Object.freeze({ resourceGroups: '2021-04-01', providers: '2021-04-01', keyVault: '2023-07-01', bot: '2022-09-15', roleAssignments: '2022-04-01', vaultData: '7.4' });

export class AzureCliMissing extends Error {}
export class NotSignedIn extends Error {}

export class HttpError extends Error {
	constructor(method, url, status, body) {
		const code = body?.error?.code || body?.code || '';
		const msg = body?.error?.message || body?.message || '';
		super(`${method} ${redactUrl(url)} -> ${status}${code ? ` ${code}` : ''}${msg ? `: ${String(msg).slice(0, 300)}` : ''}`);
		this.status = status;
		this.code = code;
	}
}

function redactUrl(url) {
	return String(url).split('?')[0];
}

/** Run the Azure CLI. Resolves stdout; maps "not installed" and "not signed in". */
export function runAz(args, { azPath = process.env.AZ_PATH || 'az', exec = execFile } = {}) {
	return new Promise((resolvePromise, reject) => {
		exec(azPath, [...args, '--only-show-errors'], { maxBuffer: 16 * 1024 * 1024, env: { ...process.env, AZURE_CORE_COLLECT_TELEMETRY: 'false' } }, (err, stdout, stderr) => {
			if (err?.code === 'ENOENT') return reject(new AzureCliMissing('Azure CLI (az) is not installed'));
			if (err) {
				const text = String(stderr || err.message);
				if (/az login|Please run 'az login'|AADSTS50173|AADSTS70043|refresh token has expired|No subscription found/i.test(text)) return reject(new NotSignedIn(text.trim().split('\n')[0]));
				return reject(new Error(`az ${args.slice(0, 2).join(' ')} failed: ${text.trim().split('\n')[0]}`));
			}
			resolvePromise(String(stdout));
		});
	});
}

/** The signed-in account: tenant, default subscription, and who is signed in. */
export async function readAccount(az = runAz) {
	const out = await az(['account', 'show', '-o', 'json']);
	const a = JSON.parse(out);
	const noSub = a.id === a.tenantId && /N\/A\(tenant level account\)/i.test(a.name || '');
	return { tenantId: a.tenantId, subscriptionId: noSub ? null : a.id, subscriptionName: noSub ? null : a.name, user: { name: a.user?.name, type: a.user?.type } };
}

/** Token provider over `az account get-access-token`, cached per resource. */
export function cliTokens({ az = runAz, tenantId = null } = {}) {
	const cache = new Map();
	return async (resource) => {
		const hit = cache.get(resource);
		if (hit && hit.expires - Date.now() > 120_000) return hit.token;
		const args = ['account', 'get-access-token', '--resource', resource, '-o', 'json'];
		if (tenantId) args.push('--tenant', tenantId);
		const t = JSON.parse(await az(args));
		const expires = t.expires_on ? Number(t.expires_on) * 1000 : Date.parse(t.expiresOn);
		cache.set(resource, { token: t.accessToken, expires });
		return t.accessToken;
	};
}

const RETRY = new Set([429, 500, 502, 503, 504]);

/**
 * A JSON REST client bound to a token provider. `retryOn` adds statuses to
 * retry (Key Vault answers 403 until a fresh role assignment propagates).
 */
export function restClient({ token, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxAttempts = 5 } = {}) {
	async function call(resource, method, url, { body, headers = {}, okStatuses = [], retryOn = [], attempts = maxAttempts } = {}) {
		for (let attempt = 1; ; attempt++) {
			const res = await fetchImpl(url, {
				method,
				headers: { authorization: `Bearer ${await token(resource)}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
			const text = await res.text();
			let json = null;
			try {
				json = text ? JSON.parse(text) : null;
			} catch {
				json = { message: text.slice(0, 300) };
			}
			if (res.ok || okStatuses.includes(res.status)) return { status: res.status, json, headers: res.headers };
			if ((RETRY.has(res.status) || retryOn.includes(res.status)) && attempt < attempts) {
				const ra = Number(res.headers?.get?.('retry-after'));
				await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30_000, 2000 * 2 ** (attempt - 1)));
				continue;
			}
			throw new HttpError(method, url, res.status, json);
		}
	}
	const bind = (resource) => ({
		get: (url, o) => call(resource, 'GET', url, o),
		put: (url, body, o) => call(resource, 'PUT', url, { ...o, body }),
		patch: (url, body, o) => call(resource, 'PATCH', url, { ...o, body }),
		post: (url, body, o) => call(resource, 'POST', url, { ...o, body }),
	});
	return { graph: bind(RESOURCES.graph), arm: bind(RESOURCES.arm), vault: bind(RESOURCES.vault) };
}

const q = (s) => encodeURIComponent(String(s).replace(/'/g, "''"));
const APP_SELECT = 'id,appId,displayName,uniqueName,signInAudience,web,requiredResourceAccess,optionalClaims,groupMembershipClaims,api,passwordCredentials';

// ── Microsoft Graph ─────────────────────────────────────────────────────────

export async function findApplication(rest, spec) {
	const byUnique = await rest.graph.get(`${GRAPH}/applications(uniqueName='${q(spec.uniqueName)}')?$select=${APP_SELECT}`, { okStatuses: [404] });
	if (byUnique.status === 200) return { match: 'uniqueName', app: byUnique.json };
	const byName = await rest.graph.get(`${GRAPH}/applications?$filter=displayName eq '${q(spec.displayName)}'&$select=${APP_SELECT}`);
	const candidates = (byName.json?.value || []).filter((a) => !a.uniqueName);
	if (candidates.length === 1) return { match: 'displayName', app: candidates[0] };
	if (candidates.length > 1) return { match: 'ambiguous', app: null, candidates: candidates.length };
	return { match: 'none', app: null };
}

export async function upsertApplication(rest, spec, found, patch) {
	if (!Object.keys(patch).length) return found.app;
	if (found.match === 'displayName') {
		await rest.graph.patch(`${GRAPH}/applications/${found.app.id}`, patch);
	} else {
		const { uniqueName, ...rest_ } = patch;
		await rest.graph.patch(`${GRAPH}/applications(uniqueName='${q(spec.uniqueName)}')`, found.app ? rest_ : { ...rest_, uniqueName: spec.uniqueName }, { headers: { prefer: 'create-if-missing' } });
	}
	const again = await findApplication(rest, spec);
	if (!again.app) throw new Error(`Graph accepted the write but ${spec.uniqueName} is not readable yet`);
	return again.app;
}

export async function getServicePrincipal(rest, appId) {
	const r = await rest.graph.get(`${GRAPH}/servicePrincipals(appId='${q(appId)}')?$select=id,appId,displayName,appRoles,oauth2PermissionScopes`, { okStatuses: [404] });
	return r.status === 200 ? r.json : null;
}

export async function ensureServicePrincipal(rest, appId) {
	const sp = await getServicePrincipal(rest, appId);
	if (sp) return sp;
	const created = await rest.graph.post(`${GRAPH}/servicePrincipals`, { appId }, { retryOn: [400, 404], attempts: 6 });
	return created.json;
}

/** addPassword. Returns { keyId, secretText, endDateTime }; the caller must not log secretText. */
export async function addPassword(rest, appObjectId, displayName, endDateTime) {
	const r = await rest.graph.post(`${GRAPH}/applications/${appObjectId}/addPassword`, { passwordCredential: { displayName, endDateTime } });
	return { keyId: r.json.keyId, secretText: r.json.secretText, endDateTime: r.json.endDateTime };
}

export async function signedInPrincipal(rest, account) {
	if (account.user.type === 'servicePrincipal') {
		const sp = await getServicePrincipal(rest, account.user.name);
		return { id: sp?.id, type: 'ServicePrincipal', name: account.user.name };
	}
	const me = await rest.graph.get(`${GRAPH}/me?$select=id,userPrincipalName`);
	return { id: me.json.id, type: 'User', name: me.json.userPrincipalName || account.user.name };
}

// ── Azure Resource Manager ──────────────────────────────────────────────────

export const sub = (s) => `${ARM}/subscriptions/${s}`;
export const rgUrl = (s, rg) => `${sub(s)}/resourcegroups/${rg}?api-version=${API.resourceGroups}`;
export const vaultId = (s, rg, name) => `/subscriptions/${s}/resourceGroups/${rg}/providers/Microsoft.KeyVault/vaults/${name}`;
export const botId = (s, rg, name) => `/subscriptions/${s}/resourceGroups/${rg}/providers/Microsoft.BotService/botServices/${name}`;

export async function armGet(rest, idOrUrl, apiVersion) {
	const url = idOrUrl.startsWith('http') ? idOrUrl : `${ARM}${idOrUrl}?api-version=${apiVersion}`;
	const r = await rest.arm.get(url, { okStatuses: [404] });
	return r.status === 404 ? null : r.json;
}

export async function providerState(rest, s, namespace) {
	const r = await rest.arm.get(`${sub(s)}/providers/${namespace}?api-version=${API.providers}`);
	return r.json.registrationState;
}

export async function registerProvider(rest, s, namespace, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
	await rest.arm.post(`${sub(s)}/providers/${namespace}/register?api-version=${API.providers}`, {});
	for (let i = 0; i < 60; i++) {
		if ((await providerState(rest, s, namespace)) === 'Registered') return;
		await sleep(5000);
	}
	throw new Error(`${namespace} did not finish registering within 5 minutes`);
}

export async function vaultNameAvailable(rest, s, name) {
	const r = await rest.arm.post(`${sub(s)}/providers/Microsoft.KeyVault/checkNameAvailability?api-version=${API.keyVault}`, { name, type: 'Microsoft.KeyVault/vaults' });
	return { available: r.json.nameAvailable, reason: r.json.reason, message: r.json.message };
}

export async function listRoleAssignments(rest, scopeId) {
	const r = await rest.arm.get(`${ARM}${scopeId}/providers/Microsoft.Authorization/roleAssignments?api-version=${API.roleAssignments}&$filter=atScope()`);
	return r.json?.value || [];
}

export async function putRoleAssignment(rest, { subscriptionId, scopeId, name, roleId, principalId, principalType }) {
	return rest.arm.put(
		`${ARM}${scopeId}/providers/Microsoft.Authorization/roleAssignments/${name}?api-version=${API.roleAssignments}`,
		{ properties: { roleDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`, principalId, principalType } },
		{ okStatuses: [409], retryOn: [400], attempts: 6 },
	);
}

// ── Key Vault data plane ────────────────────────────────────────────────────

export const vaultUri = (name) => `https://${name}.vault.azure.net`;

/** Read a secret's metadata and value; null when absent. 403 maps to { forbidden: true }. */
export async function getVaultSecret(rest, vaultName, name) {
	const r = await rest.vault.get(`${vaultUri(vaultName)}/secrets/${name}?api-version=${API.vaultData}`, { okStatuses: [403, 404], attempts: 2 });
	if (r.status === 404) return null;
	if (r.status === 403) return { forbidden: true };
	return { value: r.json.value, tags: r.json.tags || {}, id: r.json.id };
}

export async function setVaultSecret(rest, vaultName, name, value, { tags = {}, expires = null, contentType = 'text/plain' } = {}) {
	const body = { value, contentType, tags };
	if (expires) body.attributes = { exp: Math.floor(Date.parse(expires) / 1000) };
	await rest.vault.put(`${vaultUri(vaultName)}/secrets/${name}?api-version=${API.vaultData}`, body, { retryOn: [403], attempts: 10 });
}
