// The pure half of the provisioner: desired state from resources.json, and the
// diff between that and what Microsoft Graph and Azure Resource Manager report.
// No IO here; tests/microsoft-provision.test.js drives it with response shapes
// taken from Microsoft's documented schemas.
//
// Reconciliation is additive. A redirect URI or permission an operator added by
// hand is kept and reported as unmanaged, never removed, so a rerun cannot break
// a working tenant.

import { createHash } from 'node:crypto';

export const SECRET_MIN_REMAINING_DAYS = 30;
const DAY_MS = 86_400_000;

export const OP = Object.freeze({ CREATE: 'create', UPDATE: 'update', OK: 'ok', BLOCKED: 'blocked', MANUAL: 'manual' });

export function appSpec(manifest, key) {
	const spec = manifest.apps.find((a) => a.key === key);
	if (!spec) throw new Error(`resources.json has no app "${key}"`);
	return spec;
}

export function redirectUrls(manifest, spec) {
	return spec.redirectUris.map((r) => `${manifest.origin}${r.path}`);
}

/** Single-page-app platform redirect URIs (MSAL in the browser, auth code + PKCE without a secret). */
export function spaRedirectUrls(manifest, spec) {
	return (spec.spaRedirectUris || []).map((r) => `${manifest.origin}${r.path}`);
}

/** The Graph `application` body that creates the app from its manifest entry. */
export function desiredApplication(manifest, spec) {
	const body = {
		displayName: spec.displayName,
		signInAudience: spec.signInAudience,
		notes: `Managed by scripts/microsoft-provision.mjs from integrations/microsoft/provisioning/resources.json (${spec.key}). ${spec.purpose}`.slice(0, 1024),
		web: { redirectUris: redirectUrls(manifest, spec) },
	};
	const spa = spaRedirectUrls(manifest, spec);
	if (spa.length) body.spa = { redirectUris: spa };
	if (spec.permissions.length) {
		body.requiredResourceAccess = [{ resourceAppId: manifest.graph.appId, resourceAccess: spec.permissions.map((p) => ({ id: p.id, type: p.type })) }];
	}
	if (spec.optionalClaims) {
		body.optionalClaims = Object.fromEntries(Object.entries(spec.optionalClaims).map(([token, names]) => [token, names.map((name) => ({ name, essential: false, additionalProperties: [] }))]));
	}
	if (spec.groupMembershipClaims) body.groupMembershipClaims = spec.groupMembershipClaims;
	if (spec.requestedAccessTokenVersion) body.api = { requestedAccessTokenVersion: spec.requestedAccessTokenVersion };
	return body;
}

const accessKey = (resourceAppId, a) => `${resourceAppId.toLowerCase()}|${a.id.toLowerCase()}|${a.type}`;

/** Merge two requiredResourceAccess arrays (union per resource app). */
function mergeResourceAccess(live = [], desired = []) {
	const byApp = new Map();
	for (const entry of [...live, ...desired]) {
		const id = entry.resourceAppId.toLowerCase();
		if (!byApp.has(id)) byApp.set(id, { resourceAppId: entry.resourceAppId, resourceAccess: [] });
		const target = byApp.get(id);
		for (const a of entry.resourceAccess || []) {
			if (!target.resourceAccess.some((b) => accessKey(id, b) === accessKey(id, a))) target.resourceAccess.push({ id: a.id, type: a.type });
		}
	}
	return [...byApp.values()];
}

/**
 * Diff one live Graph application against its manifest entry. Returns the op,
 * readable change lines, the PATCH body (collections merged so nothing an
 * operator added is dropped) and the unmanaged extras that were kept.
 */
export function diffApplication(manifest, spec, live) {
	const desired = desiredApplication(manifest, spec);
	if (!live) return { op: OP.CREATE, changes: [`create app "${spec.displayName}" (${spec.signInAudience})`, ...desired.web.redirectUris.map((u) => `redirect ${u}`), ...(desired.spa?.redirectUris || []).map((u) => `spa redirect ${u}`), ...spec.permissions.map((p) => `permission ${p.name} (${p.type === 'Role' ? 'application' : 'delegated'})`)], patch: { ...desired, uniqueName: spec.uniqueName }, extras: [] };
	const changes = [];
	const patch = {};
	const extras = [];

	if (live.displayName !== desired.displayName) {
		changes.push(`displayName "${live.displayName}" -> "${desired.displayName}"`);
		patch.displayName = desired.displayName;
	}
	if (live.signInAudience !== desired.signInAudience) {
		changes.push(`signInAudience ${live.signInAudience} -> ${desired.signInAudience}`);
		patch.signInAudience = desired.signInAudience;
	}

	const liveUris = live.web?.redirectUris || [];
	const missingUris = desired.web.redirectUris.filter((u) => !liveUris.includes(u));
	if (missingUris.length) {
		for (const u of missingUris) changes.push(`add redirect ${u}`);
		patch.web = { redirectUris: [...liveUris, ...missingUris] };
	}
	for (const u of liveUris) if (!desired.web.redirectUris.includes(u)) extras.push(`redirect ${u}`);

	const desiredSpa = desired.spa?.redirectUris || [];
	const liveSpa = live.spa?.redirectUris || [];
	const missingSpa = desiredSpa.filter((u) => !liveSpa.includes(u));
	if (missingSpa.length) {
		for (const u of missingSpa) changes.push(`add spa redirect ${u}`);
		patch.spa = { redirectUris: [...liveSpa, ...missingSpa] };
	}
	for (const u of liveSpa) if (!desiredSpa.includes(u)) extras.push(`spa redirect ${u}`);

	const liveAccess = live.requiredResourceAccess || [];
	const liveKeys = new Set(liveAccess.flatMap((e) => (e.resourceAccess || []).map((a) => accessKey(e.resourceAppId, a))));
	const desiredAccess = desired.requiredResourceAccess || [];
	const missingPerms = spec.permissions.filter((p) => !liveKeys.has(accessKey(manifest.graph.appId, p)));
	if (missingPerms.length) {
		for (const p of missingPerms) changes.push(`add permission ${p.name} (${p.type === 'Role' ? 'application' : 'delegated'})`);
		patch.requiredResourceAccess = mergeResourceAccess(liveAccess, desiredAccess);
	}
	const desiredKeys = new Set(desiredAccess.flatMap((e) => e.resourceAccess.map((a) => accessKey(e.resourceAppId, a))));
	for (const k of liveKeys) if (!desiredKeys.has(k)) extras.push(`permission ${k}`);

	if (desired.optionalClaims) {
		const merged = { ...(live.optionalClaims || {}) };
		let touched = false;
		for (const [token, claims] of Object.entries(desired.optionalClaims)) {
			const have = merged[token] || [];
			const missing = claims.filter((c) => !have.some((h) => h.name === c.name));
			if (missing.length) {
				touched = true;
				for (const c of missing) changes.push(`add optional claim ${c.name} (${token})`);
				merged[token] = [...have, ...missing];
			}
		}
		if (touched) patch.optionalClaims = { idToken: merged.idToken || [], accessToken: merged.accessToken || [], saml2Token: merged.saml2Token || [] };
	}
	if (desired.groupMembershipClaims && !String(live.groupMembershipClaims || '').split(',').map((s) => s.trim()).some((v) => v === desired.groupMembershipClaims || v === 'All')) {
		changes.push(`groupMembershipClaims ${live.groupMembershipClaims || 'None'} -> ${desired.groupMembershipClaims}`);
		patch.groupMembershipClaims = desired.groupMembershipClaims;
	}
	if (desired.api && live.api?.requestedAccessTokenVersion !== desired.api.requestedAccessTokenVersion) {
		changes.push(`requestedAccessTokenVersion ${live.api?.requestedAccessTokenVersion ?? 'null'} -> ${desired.api.requestedAccessTokenVersion}`);
		patch.api = { requestedAccessTokenVersion: desired.api.requestedAccessTokenVersion };
	}
	return { op: changes.length ? OP.UPDATE : OP.OK, changes, patch, extras };
}

/**
 * Check every manifest permission id against the Graph service principal's
 * published scopes and roles. Any mismatch blocks --apply.
 */
export function permissionIdProblems(manifest, graphSp) {
	if (!graphSp) return [];
	const problems = [];
	for (const app of manifest.apps) {
		for (const p of app.permissions) {
			const list = p.type === 'Role' ? graphSp.appRoles || [] : graphSp.oauth2PermissionScopes || [];
			const found = list.find((x) => x.value === p.name);
			if (!found) problems.push(`${p.name} is not a published ${p.type === 'Role' ? 'application' : 'delegated'} permission of Microsoft Graph`);
			else if (found.id.toLowerCase() !== p.id.toLowerCase()) problems.push(`${p.name}: resources.json has ${p.id}, Microsoft Graph publishes ${found.id}`);
		}
	}
	return problems;
}

/** The newest provisioner-owned client secret on a live app, or null. */
export function provisionerCredential(spec, liveApp) {
	const creds = (liveApp?.passwordCredentials || []).filter((c) => c.displayName === spec.secret.displayName);
	creds.sort((a, b) => Date.parse(b.endDateTime) - Date.parse(a.endDateTime));
	return creds[0] || null;
}

/**
 * Whether the app needs a new client secret. A secret is kept only when the
 * live credential has at least SECRET_MIN_REMAINING_DAYS left and its value is
 * held in the Key Vault or the local secrets file under the same keyId.
 */
export function secretDecision(spec, liveApp, stored, { now = Date.now(), rotate = false } = {}) {
	const cred = provisionerCredential(spec, liveApp);
	const expiry = (days) => new Date(now + days * DAY_MS).toISOString();
	if (!liveApp) return { op: OP.CREATE, reason: `new secret valid until ${expiry(spec.secret.expiryDays).slice(0, 10)}` };
	if (rotate) return { op: OP.CREATE, reason: `--rotate-secrets: new secret valid until ${expiry(spec.secret.expiryDays).slice(0, 10)}` };
	if (!cred) return { op: OP.CREATE, reason: `no "${spec.secret.displayName}" secret on the app yet; new one valid until ${expiry(spec.secret.expiryDays).slice(0, 10)}` };
	const remaining = (Date.parse(cred.endDateTime) - now) / DAY_MS;
	if (remaining < SECRET_MIN_REMAINING_DAYS) return { op: OP.CREATE, reason: `secret ${cred.keyId} expires ${cred.endDateTime.slice(0, 10)} (${Math.max(0, Math.floor(remaining))} days left)` };
	if (!stored || stored.keyId !== cred.keyId) return { op: OP.CREATE, reason: `secret ${cred.keyId} exists but its value is in neither the Key Vault nor the local secrets file` };
	return { op: OP.OK, reason: `secret ${cred.keyId} valid until ${cred.endDateTime.slice(0, 10)}`, keyId: cred.keyId };
}

/** Deterministic GUID for a role assignment, so reruns PUT the same name. */
export function roleAssignmentName(scope, principalId, roleId) {
	const h = createHash('sha1').update(`${scope.toLowerCase()}|${principalId.toLowerCase()}|${roleId.toLowerCase()}`).digest('hex');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** Globally unique Azure names (Key Vault, Azure Bot) derived from the tenant and subscription. */
export function nameSuffix(tenantId, subscriptionId) {
	return createHash('sha256').update(`${tenantId}|${subscriptionId}`).digest('hex').slice(0, 6);
}

export function resourceNames(manifest, { tenantId, subscriptionId, overrides = {} }) {
	const suffix = nameSuffix(tenantId, subscriptionId);
	const vaults = Object.fromEntries(manifest.azure.vaults.map((v) => [v.key, overrides[`${v.key}Vault`] || `${v.namePrefix}-${suffix}`]));
	return {
		resourceGroup: overrides.resourceGroup || manifest.azure.resourceGroup.default,
		location: overrides.location || manifest.azure.resourceGroup.location,
		bot: overrides.bot || `${manifest.azure.bot.name}-${suffix}`,
		vaults,
	};
}

export function desiredVault(manifest, { tenantId, location }) {
	return { location, properties: { tenantId, sku: { family: 'A', name: 'standard' }, enableRbacAuthorization: true, enableSoftDelete: true, softDeleteRetentionInDays: 90 } };
}

export function diffVault(desired, live) {
	if (!live) return { op: OP.CREATE, changes: ['create Key Vault (RBAC authorization, soft delete 90 days)'] };
	const changes = [];
	if (live.properties?.tenantId !== desired.properties.tenantId) changes.push(`tenantId ${live.properties?.tenantId} differs from ${desired.properties.tenantId}`);
	if (live.properties?.enableRbacAuthorization !== true) changes.push('enableRbacAuthorization -> true');
	return { op: changes.length ? OP.UPDATE : OP.OK, changes };
}

export function desiredBot(manifest, { botAppId, tenantId, botName }) {
	const b = manifest.azure.bot;
	return {
		location: b.location,
		kind: b.kind,
		sku: { name: b.sku },
		properties: { displayName: botName, endpoint: `${manifest.origin}${b.messagingEndpointPath}`, msaAppId: botAppId, msaAppType: b.msaAppType, msaAppTenantId: tenantId },
	};
}

export function diffBot(desired, live) {
	if (!live) return { op: OP.CREATE, changes: [`create Azure Bot (${desired.sku.name}, ${desired.properties.msaAppType}), messaging endpoint ${desired.properties.endpoint}`] };
	const changes = [];
	for (const k of ['endpoint', 'msaAppId', 'msaAppType', 'msaAppTenantId']) {
		const have = live.properties?.[k];
		const want = desired.properties[k];
		if (String(have ?? '').toLowerCase() !== String(want ?? '').toLowerCase()) changes.push(`${k} ${have ?? 'unset'} -> ${want}`);
	}
	const blocked = changes.some((c) => /^msaApp(Id|Type|TenantId) /.test(c));
	return { op: blocked ? OP.BLOCKED : changes.length ? OP.UPDATE : OP.OK, changes: blocked ? [...changes, 'the bot is bound to a different app; Azure cannot rebind it, delete the bot or pass --bot-name'] : changes };
}

export function diffChannel(name, live) {
	if (!live) return { op: OP.CREATE, changes: [`enable ${name}`] };
	const enabled = live.properties?.properties?.isEnabled;
	if (enabled === false) return { op: OP.UPDATE, changes: [`${name} is disabled -> enable`] };
	return { op: OP.OK, changes: [] };
}

export function desiredChannel(name) {
	const inner = name === 'MsTeamsChannel' ? { isEnabled: true } : {};
	return { location: 'global', properties: { channelName: name, properties: inner } };
}

export function hasRoleAssignment(assignments, principalId, roleId) {
	return (assignments || []).some((a) => String(a.properties?.principalId).toLowerCase() === principalId.toLowerCase() && String(a.properties?.roleDefinitionId).toLowerCase().endsWith(`/${roleId.toLowerCase()}`));
}

/**
 * The whole plan from a read-only snapshot. Each action is
 * { group, target, op, details[] }. `state` is what readState() collected.
 */
export function buildPlan(manifest, state, { rotate = false, now = Date.now(), copilotRedirectUri = null } = {}) {
	const actions = [];
	const push = (group, target, op, details = []) => actions.push({ group, target, op, details });

	for (const problem of permissionIdProblems(manifest, state.graphSp)) push('Microsoft Graph', 'permission ids', OP.BLOCKED, [problem]);

	for (const spec of manifest.apps) {
		const entry = state.apps?.[spec.key] || { match: 'none', app: null };
		const label = `${spec.displayName} (${spec.uniqueName})`;
		if (entry.match === 'ambiguous') {
			push('Entra applications', label, OP.BLOCKED, [`${entry.candidates} apps are named "${spec.displayName}" and none has uniqueName ${spec.uniqueName}; delete the extras or rename them`]);
			continue;
		}
		const d = diffApplication(manifest, spec, entry.app);
		const details = [...d.changes];
		if (entry.match === 'displayName') details.unshift(`adopting the existing app ${entry.app.appId} found by display name`);
		for (const x of d.extras) details.push(`kept (unmanaged): ${x}`);
		push('Entra applications', label, d.op, details);
		push('Service principals', spec.displayName, entry.sp ? OP.OK : OP.CREATE, entry.sp ? [] : ['create the service principal in the publisher tenant']);
		const s = secretDecision(spec, entry.app, state.secrets?.[spec.key] || null, { now, rotate });
		push('Client secrets', `${spec.displayName} -> ${spec.secret.env}`, s.op, [s.reason]);
	}

	const az = state.azure;
	if (!az) {
		push('Azure resources', 'subscription', OP.BLOCKED, [state.azureReason || 'no Azure subscription selected: pass --subscription <id> (the Azure Bot and Key Vaults need one)']);
	} else {
		for (const [ns, st] of Object.entries(az.providers)) push('Azure resources', `resource provider ${ns}`, st === 'Registered' ? OP.OK : OP.CREATE, st === 'Registered' ? [] : [`register (now ${st})`]);
		push('Azure resources', `resource group ${az.names.resourceGroup}`, az.resourceGroup ? OP.OK : OP.CREATE, az.resourceGroup ? [] : [`create in ${az.names.location}`]);
		for (const v of manifest.azure.vaults) {
			const live = az.vaults[v.key];
			if (live?.nameTaken) {
				push('Azure resources', `Key Vault ${az.names.vaults[v.key]}`, OP.BLOCKED, [`the name is taken outside this resource group (${live.nameTaken}); pass --${v.key}-vault-name`]);
				continue;
			}
			const d = diffVault(desiredVault(manifest, { tenantId: state.account.tenantId, location: az.names.location }), live?.vault || null);
			push('Azure resources', `Key Vault ${az.names.vaults[v.key]} (${v.key})`, d.op, d.changes);
			const officer = manifest.azure.roles['Key Vault Secrets Officer'];
			const hasOfficer = hasRoleAssignment(live?.roleAssignments, state.account.principalId, officer);
			push('Role assignments', `Key Vault Secrets Officer on ${az.names.vaults[v.key]} for ${state.account.name}`, hasOfficer ? OP.OK : OP.CREATE, hasOfficer ? [] : ['so the provisioner can write secrets']);
			for (const r of v.readers) {
				const sp = az.readers[r.appId];
				const roleId = manifest.azure.roles[r.role];
				const ok = sp && hasRoleAssignment(live?.roleAssignments, sp.id, roleId);
				push('Role assignments', `${r.role} on ${az.names.vaults[v.key]} for ${r.appId}`, ok ? OP.OK : OP.CREATE, ok ? [] : [sp ? 'grant' : 'create the service principal for this Microsoft app, then grant']);
			}
			for (const name of v.secrets) {
				const have = live?.secrets?.[name];
				if (v.key === 'copilot' && (name === 'ClientId' || name === 'ClientSecret')) {
					if (have) push('Key Vault secrets', `${az.names.vaults[v.key]}/${name}`, OP.OK);
					else if (copilotRedirectUri) push('Key Vault secrets', `${az.names.vaults[v.key]}/${name}`, OP.CREATE, [`register the Microsoft Copilot OAuth client for ${copilotRedirectUri}`]);
					else push('Key Vault secrets', `${az.names.vaults[v.key]}/${name}`, OP.MANUAL, ['waits on the redirect URI Microsoft issues for the MCP connector: rerun with --copilot-redirect-uri <uri>']);
					continue;
				}
				const staticValue = v.staticSecrets?.[name];
				if (staticValue !== undefined) {
					const want = staticValue.startsWith('/') ? `${manifest.origin}${staticValue}` : staticValue;
					push('Key Vault secrets', `${az.names.vaults[v.key]}/${name}`, have?.value === want ? OP.OK : have ? OP.UPDATE : OP.CREATE, have?.value === want ? [] : [`set to ${want}`]);
					continue;
				}
				const app = manifest.apps.find((a) => a.secret.vaultSecretName === name);
				const keyId = app && state.secrets?.[app.key]?.keyId;
				const current = have && keyId && have.tags?.keyId === keyId;
				push('Key Vault secrets', `${az.names.vaults[v.key]}/${name}`, current ? OP.OK : have ? OP.UPDATE : OP.CREATE, current ? [] : ['written with the client secret above']);
			}
		}
		const botSpec = manifest.apps.find((a) => a.key === manifest.azure.bot.app);
		const botAppId = state.apps?.[botSpec.key]?.app?.appId || '<bot app id after create>';
		const db = diffBot(desiredBot(manifest, { botAppId, tenantId: state.account.tenantId, botName: az.names.bot }), az.bot);
		push('Azure Bot', az.names.bot, db.op, db.changes);
		for (const ch of manifest.azure.bot.channels) {
			const dc = diffChannel(ch.name, az.channels?.[ch.name] || null);
			push('Azure Bot', `${az.names.bot} channel ${ch.name}`, dc.op, dc.changes);
		}
	}

	for (const spec of manifest.apps) for (const step of spec.manualSteps) push('Owner steps outside Azure', spec.displayName, OP.MANUAL, [step]);
	const rank = (g) => (GROUP_ORDER.indexOf(g) + 1 || GROUP_ORDER.length + 1);
	return actions.map((a, i) => [a, i]).sort((x, y) => rank(x[0].group) - rank(y[0].group) || x[1] - y[1]).map(([a]) => a);
}

const GROUP_ORDER = ['Microsoft Graph', 'Entra applications', 'Service principals', 'Azure resources', 'Role assignments', 'Client secrets', 'Key Vault secrets', 'Azure Bot', 'Owner steps outside Azure'];

export function summarize(actions) {
	const count = (op) => actions.filter((a) => a.op === op).length;
	return { create: count(OP.CREATE), update: count(OP.UPDATE), ok: count(OP.OK), blocked: count(OP.BLOCKED), manual: count(OP.MANUAL) };
}

const MARK = { create: '+', update: '~', ok: '=', blocked: '!', manual: '>' };

export function formatPlan(actions) {
	const lines = [];
	let group = null;
	for (const a of actions) {
		if (a.group !== group) {
			group = a.group;
			lines.push('', group);
		}
		lines.push(`  ${MARK[a.op]} ${a.op.padEnd(7)} ${a.target}`);
		for (const d of a.details) lines.push(`              ${d}`);
	}
	const s = summarize(actions);
	lines.push('', `Summary: ${s.create} to create, ${s.update} to change, ${s.ok} unchanged, ${s.blocked} blocked, ${s.manual} owner steps.`);
	return lines.join('\n');
}

/**
 * The value a gcloud --update-env-vars argument needs. Picks a delimiter that
 * appears in no value (gcloud's ^D^ escape) so a secret is never split.
 */
export function updateEnvVarsArg(env) {
	const pairs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
	if (pairs.some((p) => /[\r\n]/.test(p))) throw new Error('an env value contains a newline');
	if (!pairs.some((p) => p.includes(','))) return pairs.join(',');
	const delim = ['@', '|', '#', ':', ';'].find((d) => !pairs.some((p) => p.includes(d)));
	if (!delim) throw new Error('no safe delimiter for the env values');
	return `^${delim}^${pairs.join(delim)}`;
}
