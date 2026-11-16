// Orchestration: read the live state, plan, apply, verify. Pure decisions live
// in diff.mjs and REST calls in azure.mjs; this file sequences them.
//
// Output discipline: everything goes through ctx.log. Secret values are held in
// local variables, written to Key Vault and the SecretStore, and never passed
// to ctx.log. tests/microsoft-provision.test.js captures every log line of a
// full --apply and asserts no secret appears.

import * as az from './azure.mjs';
import { OP, buildPlan, desiredBot, desiredChannel, desiredVault, diffApplication, formatPlan, hasRoleAssignment, permissionIdProblems, resourceNames, roleAssignmentName, secretDecision, summarize, updateEnvVarsArg, appSpec } from './diff.mjs';

const PROVIDERS = ['Microsoft.KeyVault', 'Microsoft.BotService'];
const DAY_MS = 86_400_000;

function vaultSpec(manifest, key) {
	return manifest.azure.vaults.find((v) => v.key === key);
}

function secretVaultFor(manifest, spec) {
	return vaultSpec(manifest, spec.secret.vault);
}

/** Collect everything the plan needs, read-only. */
export async function readState(ctx) {
	const { manifest, rest, account, store } = ctx;
	const state = { account: { tenantId: account.tenantId, subscriptionId: ctx.subscriptionId }, apps: {}, secrets: {}, azure: null };
	state.graphSp = await az.getServicePrincipal(rest, manifest.graph.appId);
	const principal = await az.signedInPrincipal(rest, account);
	Object.assign(state.account, { principalId: principal.id, principalType: principal.type, name: principal.name });

	for (const spec of manifest.apps) {
		const found = await az.findApplication(rest, spec);
		state.apps[spec.key] = { ...found, sp: found.app ? await az.getServicePrincipal(rest, found.app.appId) : null };
	}

	if (ctx.subscriptionId) {
		const s = ctx.subscriptionId;
		const names = resourceNames(manifest, { tenantId: account.tenantId, subscriptionId: s, overrides: ctx.names });
		const azure = { names, providers: {}, vaults: {}, readers: {}, bot: null, channels: {} };
		for (const ns of PROVIDERS) azure.providers[ns] = await az.providerState(rest, s, ns);
		azure.resourceGroup = await az.armGet(rest, az.rgUrl(s, names.resourceGroup));
		for (const v of manifest.azure.vaults) {
			const id = az.vaultId(s, names.resourceGroup, names.vaults[v.key]);
			const vault = azure.resourceGroup ? await az.armGet(rest, id, az.API.keyVault) : null;
			const entry = { vault, roleAssignments: [], secrets: {} };
			if (!vault) {
				const avail = await az.vaultNameAvailable(rest, s, names.vaults[v.key]);
				if (!avail.available) entry.nameTaken = avail.reason === 'AlreadyExists' ? 'it exists in another resource group, another subscription, or is soft-deleted' : avail.message || avail.reason;
			} else {
				entry.roleAssignments = await az.listRoleAssignments(rest, id);
				for (const name of v.secrets) {
					const secret = await az.getVaultSecret(rest, names.vaults[v.key], name);
					if (secret?.forbidden) entry.secretsForbidden = true;
					else if (secret) entry.secrets[name] = secret;
				}
			}
			azure.vaults[v.key] = entry;
			for (const r of v.readers) azure.readers[r.appId] = await az.getServicePrincipal(rest, r.appId);
		}
		const bid = az.botId(s, names.resourceGroup, names.bot);
		azure.bot = azure.resourceGroup ? await az.armGet(rest, bid, az.API.bot) : null;
		if (azure.bot) for (const ch of manifest.azure.bot.channels) azure.channels[ch.name] = await az.armGet(rest, `${bid}/channels/${ch.name}`, az.API.bot);
		state.azure = azure;
	} else {
		state.azureReason = 'the signed-in account has no subscription selected: pass --subscription <id> (needed for the Azure Bot and the Key Vaults); Entra apps and secrets are still planned';
	}

	for (const spec of manifest.apps) {
		const vaultEntry = state.azure?.vaults?.[spec.secret.vault];
		const inVault = vaultEntry?.secrets?.[spec.secret.vaultSecretName];
		const local = store.get(spec.secret.env);
		if (inVault?.tags?.keyId) state.secrets[spec.key] = { keyId: inVault.tags.keyId, source: 'vault' };
		else if (local?.keyId) state.secrets[spec.key] = { keyId: local.keyId, source: 'local' };
	}
	return state;
}

export async function plan(ctx) {
	const state = await readState(ctx);
	return { state, actions: buildPlan(ctx.manifest, state, { rotate: ctx.rotate, now: ctx.now(), copilotRedirectUri: ctx.copilotRedirectUri }) };
}

/** Non-secret env values and the names of the secret ones, from a state snapshot. */
export function envValues(manifest, state, store) {
	const values = {};
	const secretNames = new Set();
	for (const spec of manifest.apps) {
		const app = state.apps[spec.key]?.app;
		if (app) values[spec.env.clientId] = app.appId;
		if (spec.env.tenantId) values[spec.env.tenantId] = state.account.tenantId;
		const stored = store.get(spec.secret.env);
		if (stored?.value) {
			values[spec.secret.env] = stored.value;
			secretNames.add(spec.secret.env);
		}
	}
	const copilot = vaultSpec(manifest, 'copilot');
	if (state.azure && copilot) values[copilot.env] = `${az.vaultUri(state.azure.names.vaults.copilot)}/`;
	return { values, secretNames };
}

function cloudRunEnv(manifest, values) {
	return Object.fromEntries(manifest.env.cloudRun.filter((k) => values[k] !== undefined).map((k) => [k, values[k]]));
}

/**
 * The closing block of --plan and --apply: non-secret values in full, secret
 * values by name only, the gcloud line that reads them from the 600-mode file,
 * the package build line and the admin consent URLs.
 */
export function formatHandoff(ctx, state, { envFile }) {
	const { manifest, store } = ctx;
	const { values, secretNames } = envValues(manifest, state, store);
	const lines = ['', 'Production env (three-ws-api):'];
	for (const k of manifest.env.cloudRun) {
		if (secretNames.has(k)) lines.push(`  ${k}=<secret, in ${store.file}>`);
		else if (values[k]) lines.push(`  ${k}=${values[k]}`);
		else lines.push(`  ${k}  (not available yet: run --apply)`);
	}
	const complete = manifest.env.cloudRun.every((k) => values[k]);
	if (envFile && complete) {
		lines.push('', 'Apply it (reads the values from the 600-mode file, so no secret is typed or echoed; --update-env-vars keeps every other variable):', `  gcloud run services update three-ws-api --region us-central1 --update-env-vars "$(cat '${envFile}')"`);
	}
	const sso = state.apps.sso?.app?.appId;
	const bot = state.apps.bot?.app?.appId;
	const kv = values[vaultSpec(manifest, 'copilot')?.env];
	if (kv && bot) lines.push('', 'Teams and Copilot app package (MS_APP_ID comes from the Partner Center offer):', `  MS_APP_ID=<Partner Center app GUID> MS_DEVELOPER_NAME="<legal entity, 32 chars max>" MS_KEYVAULT_URL=${kv} MS_TEAMS_BOT_APP_ID=${bot} npm run package:microsoft-app`);
	if (sso) {
		const spec = appSpec(manifest, 'sso');
		const redirect = `${manifest.origin}${spec.adminConsent.redirectPath}`;
		lines.push(
			'',
			'Admin consent for the multitenant app:',
			`  Customer tenants: a tenant admin signs in to three.ws and opens ${manifest.origin}/api/microsoft-365/connect/start (adds the state the callback checks).`,
			`  Direct URL for any tenant admin: ${az.LOGIN}/organizations/v2.0/adminconsent?client_id=${sso}&scope=${encodeURIComponent('https://graph.microsoft.com/.default')}&redirect_uri=${encodeURIComponent(redirect)}`,
			'  (Microsoft records the grant; three.ws then shows state_mismatch because the URL did not start in the app, which is expected.)',
		);
	}
	return lines.join('\n');
}

async function reconcileApps(ctx, state) {
	const { manifest, rest, log } = ctx;
	for (const spec of manifest.apps) {
		const found = state.apps[spec.key];
		const d = diffApplication(manifest, spec, found.app);
		if (d.op !== OP.OK) log(`${d.op === OP.CREATE ? 'creating' : 'updating'} app ${spec.uniqueName}: ${d.changes.join('; ')}`);
		const app = await az.upsertApplication(rest, spec, found, d.op === OP.OK ? {} : d.patch);
		const sp = await az.ensureServicePrincipal(rest, app.appId);
		if (!found.sp) log(`service principal for ${spec.uniqueName}: ${sp.id}`);
		state.apps[spec.key] = { match: found.match === 'none' ? 'uniqueName' : found.match, app, sp };
	}
}

async function reconcileAzure(ctx, state) {
	const { manifest, rest, log } = ctx;
	const s = ctx.subscriptionId;
	const az_ = state.azure;
	const { names } = az_;
	for (const ns of PROVIDERS) {
		if (az_.providers[ns] !== 'Registered') {
			log(`registering resource provider ${ns}`);
			await az.registerProvider(rest, s, ns, { sleep: ctx.sleep });
		}
	}
	if (!az_.resourceGroup) {
		log(`creating resource group ${names.resourceGroup} in ${names.location}`);
		await rest.arm.put(az.rgUrl(s, names.resourceGroup), { location: names.location, tags: { 'managed-by': 'three.ws microsoft-provision' } });
	}
	for (const v of manifest.azure.vaults) {
		const id = az.vaultId(s, names.resourceGroup, names.vaults[v.key]);
		const entry = az_.vaults[v.key];
		const desired = desiredVault(manifest, { tenantId: state.account.tenantId, location: names.location });
		if (!entry.vault || entry.vault.properties?.enableRbacAuthorization !== true) {
			log(`${entry.vault ? 'updating' : 'creating'} Key Vault ${names.vaults[v.key]}`);
			const body = entry.vault ? { ...entry.vault, properties: { ...entry.vault.properties, enableRbacAuthorization: true } } : { ...desired, tags: { 'managed-by': 'three.ws microsoft-provision', purpose: v.key } };
			await rest.arm.put(`${az.ARM}${id}?api-version=${az.API.keyVault}`, body);
			entry.vault = await az.armGet(rest, id, az.API.keyVault);
		}
		const officer = manifest.azure.roles['Key Vault Secrets Officer'];
		if (!hasRoleAssignment(entry.roleAssignments, state.account.principalId, officer)) {
			log(`granting Key Vault Secrets Officer on ${names.vaults[v.key]} to ${state.account.name}`);
			await az.putRoleAssignment(rest, { subscriptionId: s, scopeId: id, name: roleAssignmentName(id, state.account.principalId, officer), roleId: officer, principalId: state.account.principalId, principalType: state.account.principalType });
		}
		for (const r of v.readers) {
			const sp = az_.readers[r.appId] || (await az.ensureServicePrincipal(rest, r.appId));
			az_.readers[r.appId] = sp;
			const roleId = manifest.azure.roles[r.role];
			if (!hasRoleAssignment(entry.roleAssignments, sp.id, roleId)) {
				log(`granting ${r.role} on ${names.vaults[v.key]} to ${r.appId}`);
				await az.putRoleAssignment(rest, { subscriptionId: s, scopeId: id, name: roleAssignmentName(id, sp.id, roleId), roleId, principalId: sp.id, principalType: 'ServicePrincipal' });
			}
		}
		entry.roleAssignments = await az.listRoleAssignments(rest, id);
	}
}

async function reconcileSecrets(ctx, state) {
	const { manifest, rest, log, store } = ctx;
	for (const spec of manifest.apps) {
		const app = state.apps[spec.key].app;
		const vault = state.azure ? state.azure.names.vaults[spec.secret.vault] : null;
		const inVault = state.azure?.vaults?.[spec.secret.vault]?.secrets?.[spec.secret.vaultSecretName] || null;
		const local = store.get(spec.secret.env);
		const stored = state.secrets[spec.key] || null;
		const decision = secretDecision(spec, app, stored, { now: ctx.now(), rotate: ctx.rotate });
		let record;
		if (decision.op === OP.CREATE) {
			const end = new Date(ctx.now() + spec.secret.expiryDays * DAY_MS).toISOString();
			log(`creating client secret for ${spec.uniqueName} (${decision.reason})`);
			const created = await az.addPassword(rest, app.id, spec.secret.displayName, end);
			record = { value: created.secretText, keyId: created.keyId, appId: app.appId, expires: created.endDateTime };
			store.put(spec.secret.env, record);
			log(`  stored in ${store.file} (mode 600) as ${spec.secret.env}, keyId ${created.keyId}, expires ${created.endDateTime.slice(0, 10)}`);
		} else if (local?.keyId === decision.keyId && local.value) {
			record = local;
		} else if (inVault?.tags?.keyId === decision.keyId && inVault.value) {
			record = { value: inVault.value, keyId: inVault.tags.keyId, appId: app.appId, expires: inVault.tags.expires || null };
			store.put(spec.secret.env, record);
			log(`restored ${spec.secret.env} from Key Vault ${vault} to ${store.file}`);
		}
		if (!record) throw new Error(`${spec.secret.env}: secret ${decision.keyId} is recorded but its value is readable from neither ${store.file} nor Key Vault ${vault || '(no subscription)'}; rerun with --rotate-secrets to issue a new one`);
		state.secrets[spec.key] = { keyId: record.keyId, source: 'local' };
		if (vault && inVault?.tags?.keyId !== record.keyId) {
			await az.setVaultSecret(rest, vault, spec.secret.vaultSecretName, record.value, { tags: { keyId: record.keyId, appId: record.appId, env: spec.secret.env, expires: record.expires || '' }, expires: record.expires });
			log(`  written to Key Vault ${vault} as ${spec.secret.vaultSecretName}`);
		}
	}
}

async function reconcileCopilotVault(ctx, state) {
	const { manifest, rest, log, store } = ctx;
	const v = vaultSpec(manifest, 'copilot');
	const name = state.azure.names.vaults.copilot;
	const have = state.azure.vaults.copilot.secrets;
	for (const [secret, raw] of Object.entries(v.staticSecrets)) {
		const want = raw.startsWith('/') ? `${manifest.origin}${raw}` : raw;
		if (have[secret]?.value !== want) {
			await az.setVaultSecret(rest, name, secret, want);
			log(`Key Vault ${name}/${secret} = ${want}`);
		}
	}
	if (have.ClientId && have.ClientSecret) return;
	if (!ctx.copilotRedirectUri) {
		log(`Key Vault ${name}/ClientId and ClientSecret wait on the redirect URI Microsoft issues; rerun with --copilot-redirect-uri <uri>`);
		return;
	}
	log(`registering the Microsoft Copilot OAuth client for ${ctx.copilotRedirectUri} (${v.oauthClient.script})`);
	const client = await ctx.registerOauthClient({ name: v.oauthClient.name, redirectUri: ctx.copilotRedirectUri, scope: v.staticSecrets.Scopes });
	store.put('COPILOT_OAUTH_CLIENT', { value: client.client_secret, keyId: client.client_id, appId: client.client_id, expires: null });
	await az.setVaultSecret(rest, name, 'ClientId', client.client_id);
	await az.setVaultSecret(rest, name, 'ClientSecret', client.client_secret);
	log(`Key Vault ${name}/ClientId = ${client.client_id}; ClientSecret written (also in ${store.file})`);
}

async function reconcileBot(ctx, state) {
	const { manifest, rest, log } = ctx;
	const s = ctx.subscriptionId;
	const { names } = state.azure;
	const bid = az.botId(s, names.resourceGroup, names.bot);
	const botApp = state.apps[manifest.azure.bot.app].app;
	const desired = desiredBot(manifest, { botAppId: botApp.appId, tenantId: state.account.tenantId, botName: names.bot });
	const live = state.azure.bot;
	const needs = !live || ['endpoint'].some((k) => live.properties?.[k] !== desired.properties[k]);
	if (needs) {
		log(`${live ? 'updating' : 'creating'} Azure Bot ${names.bot} -> ${desired.properties.endpoint}`);
		await rest.arm.put(`${az.ARM}${bid}?api-version=${az.API.bot}`, live ? { ...live, properties: { ...live.properties, endpoint: desired.properties.endpoint } } : desired);
	}
	for (const ch of manifest.azure.bot.channels) {
		const have = state.azure.channels?.[ch.name];
		if (!have || have.properties?.properties?.isEnabled === false) {
			log(`enabling ${ch.name} on ${names.bot}`);
			await rest.arm.put(`${az.ARM}${bid}/channels/${ch.name}?api-version=${az.API.bot}`, desiredChannel(ch.name));
		}
	}
}

/** Create or reconcile everything, then re-plan to prove a rerun changes nothing. */
export async function apply(ctx) {
	const { manifest, log } = ctx;
	const first = await plan(ctx);
	const idProblems = permissionIdProblems(manifest, first.state.graphSp);
	const blocked = first.actions.filter((a) => a.op === OP.BLOCKED && a.target !== 'subscription');
	if (idProblems.length || blocked.length) {
		log(formatPlan(first.actions));
		throw new Error('blocked items above must be resolved before --apply');
	}
	const state = first.state;
	await reconcileApps(ctx, state);
	if (state.azure) await reconcileAzure(ctx, state);
	await reconcileSecrets(ctx, state);
	if (state.azure) {
		await reconcileCopilotVault(ctx, state);
		await reconcileBot(ctx, state);
	}
	const after = await plan(ctx);
	const { values } = envValues(manifest, after.state, ctx.store);
	const env = cloudRunEnv(manifest, values);
	const envFile = Object.keys(env).length === manifest.env.cloudRun.length ? ctx.store.writeEnvArg(updateEnvVarsArg(env)) : null;
	const s = summarize(after.actions);
	log('', `Re-plan after apply: ${s.create} to create, ${s.update} to change, ${s.blocked} blocked (a rerun changes nothing when the first two are 0).`);
	log(formatPlan(after.actions));
	log(formatHandoff(ctx, after.state, { envFile }));
	return { actions: after.actions, envFile };
}

/** Public production probes, no credentials needed. */
export async function productionChecks(origin, fetchImpl = globalThis.fetch) {
	const out = [];
	const get = async (path) => {
		try {
			const r = await fetchImpl(`${origin}${path}`, { headers: { accept: 'application/json' } });
			let body = null;
			try {
				body = await r.json();
			} catch {
				body = null;
			}
			return { status: r.status, body };
		} catch (err) {
			return { status: 0, body: null, error: err.message };
		}
	};
	const mk = await get('/api/microsoft-marketplace/status');
	out.push({ check: '/api/microsoft-marketplace/status ready', ok: mk.body?.ready === true, detail: mk.body ? `ready=${mk.body.ready} sso=${mk.body.sso}${mk.body.missing?.length ? ` missing=${mk.body.missing.join(',')}` : ''}` : `HTTP ${mk.status}` });
	out.push({ check: '/api/microsoft-marketplace/status sso', ok: mk.body?.sso === true, detail: `sso=${mk.body?.sso}` });
	const cfg = await get('/api/config');
	out.push({ check: 'Sign in with Microsoft on /login (/api/config microsoftEnabled)', ok: cfg.body?.microsoftEnabled === true, detail: `microsoftEnabled=${cfg.body?.microsoftEnabled}` });
	const m365 = await get('/api/microsoft-365/status');
	const m365Ok = m365.status === 200 || m365.status === 401;
	out.push({ check: '/api/microsoft-365/status reachable', ok: m365Ok, detail: m365.status === 401 ? 'HTTP 401: per-account connector state; sign in and open Settings > Microsoft 365 to see configured/missing' : `HTTP ${m365.status}${m365.body?.missing?.length ? ` missing=${m365.body.missing.join(',')}` : ''}` });
	return out;
}

/** Compare the Cloud Run env (names and non-secret ids) with the live resources. */
export function cloudRunChecks(manifest, state, store, serviceEnv) {
	if (!serviceEnv) return [{ check: 'Cloud Run env', ok: false, detail: 'could not read (gcloud not signed in); run: gcloud run services describe three-ws-api --region us-central1' }];
	const { values, secretNames } = envValues(manifest, state, store);
	return manifest.env.cloudRun.map((k) => {
		const have = serviceEnv[k];
		if (have === undefined) return { check: `Cloud Run ${k}`, ok: false, detail: 'not set' };
		if (!values[k]) return { check: `Cloud Run ${k}`, ok: true, detail: 'set (no live value to compare)' };
		if (secretNames.has(k)) return { check: `Cloud Run ${k}`, ok: have === values[k], detail: have === values[k] ? 'matches the stored secret' : 'differs from the stored secret (rerun the printed gcloud line)' };
		return { check: `Cloud Run ${k}`, ok: have === values[k], detail: have === values[k] ? values[k] : `${have} (live resource is ${values[k]})` };
	});
}

export function formatChecks(checks) {
	return checks.map((c) => `  ${c.ok ? 'pass' : 'todo'}  ${c.check}${c.detail ? `: ${c.detail}` : ''}`).join('\n');
}
