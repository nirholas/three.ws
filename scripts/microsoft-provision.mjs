#!/usr/bin/env node
// One command for every Microsoft-side resource three.ws needs: the Entra app
// registrations (Marketplace fulfillment, multitenant sign-in and Microsoft 365
// connector, Teams bot identity), their redirect URIs, Graph permissions and
// client secrets, the Azure Bot with its Teams and Microsoft 365 channels, and
// the Key Vaults. Desired state: integrations/microsoft/provisioning/resources.json.
// Docs: integrations/microsoft/provisioning/README.md.
//
//   npm run microsoft:provision                 plan (default): read live state, print the diff
//   npm run microsoft:provision -- --apply      create or reconcile; rerunning changes nothing
//   npm run microsoft:provision -- --verify     check live resources and production, list what remains
//
// Options:
//   --subscription <id>        Azure subscription for the bot and vaults (default: the az default)
//   --tenant <id>              tenant to request tokens for (default: the az login tenant)
//   --resource-group <name>    default three-ws-microsoft
//   --location <region>        default eastus (the bot itself is global)
//   --bot-name <name>          default three-ws-bot-<suffix>
//   --ops-vault-name <name>    default threews-ops-<suffix>
//   --copilot-vault-name <n>   default threews-copilot-<suffix>
//   --copilot-redirect-uri <u> register the Microsoft Copilot OAuth client and store it in the Copilot vault
//   --secrets-dir <dir>        default ~/.config/three-ws/microsoft-provision (must be outside the repo)
//   --rotate-secrets           issue new client secrets even when the current ones are valid
//
// Auth: the operator's own `az login` session. No secret is ever printed:
// client secrets go to Key Vault and to <secrets-dir>/secrets.json (mode 600),
// and the printed gcloud command reads them from <secrets-dir>/cloud-run.env.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AzureCliMissing, NotSignedIn, cliTokens, readAccount, restClient, runAz } from '../integrations/microsoft/provisioning/lib/azure.mjs';
import { buildPlan, formatPlan, summarize } from '../integrations/microsoft/provisioning/lib/diff.mjs';
import { apply, cloudRunChecks, formatChecks, formatHandoff, plan, productionChecks } from '../integrations/microsoft/provisioning/lib/provision.mjs';
import { SecretStore, defaultSecretsDir } from '../integrations/microsoft/provisioning/lib/secret-store.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'integrations/microsoft/provisioning/resources.json'), 'utf8'));
const GCP_PROJECT = 'aerial-vehicle-466722-p5';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
	const i = argv.indexOf(n);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const log = (...lines) => {
	for (const l of lines) process.stdout.write(`${l}\n`);
};

function usage() {
	const head = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 30);
	log(...head.filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')));
}

const AZ_INSTALL = [
	'Azure CLI (az) is not installed. Install it, then rerun:',
	'  macOS:   brew install azure-cli',
	'  Windows: winget install -e --id Microsoft.AzureCLI',
	'  Linux:   curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash   (or, user-local: pip install --user azure-cli)',
	'Docs: https://learn.microsoft.com/cli/azure/install-azure-cli',
];

function loginHelp(detail) {
	return [
		`Not signed in to Azure${detail ? ` (${detail})` : ''}.`,
		'',
		'Sign in as a Global Administrator or Application Administrator of the publisher tenant (the tenant',
		'that owns the Partner Center account), with Owner or Contributor + User Access Administrator on the',
		'subscription that will hold the bot and vaults:',
		'  az login --tenant <publisher tenant id or domain>',
		'  az account set --subscription <subscription id>      (or pass --subscription to this command)',
		'No subscription yet? `az login --tenant <tenant> --allow-no-subscriptions` still lets this command',
		'create the three Entra apps and their secrets; the bot and vaults wait for --subscription.',
		'Then rerun: npm run microsoft:provision -- --plan',
	];
}

function registerOauthClient({ name, redirectUri, scope }) {
	return new Promise((resolvePromise, reject) => {
		const run = (env) =>
			execFile(process.execPath, [join(REPO, 'scripts/oauth-register-client.mjs'), '--name', name, '--redirect-uri', redirectUri, '--scope', scope, '--apply'], { env, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
				if (err) return reject(new Error(`oauth-register-client failed: ${String(stderr).trim().split('\n')[0]}`));
				try {
					resolvePromise(JSON.parse(stdout));
				} catch {
					reject(new Error('oauth-register-client printed no JSON'));
				}
			});
		if (process.env.DATABASE_URL) return run(process.env);
		execFile(process.execPath, [join(REPO, 'scripts/read-service-env.mjs'), '^DATABASE_URL$', '--raw'], { maxBuffer: 1 << 20 }, (err, stdout) => {
			const url = String(stdout || '').trim();
			if (err || !url) return reject(new Error('DATABASE_URL is not set and could not be read from Cloud Run (node scripts/read-service-env.mjs)'));
			run({ ...process.env, DATABASE_URL: url });
		});
	});
}

function readCloudRunEnv() {
	return new Promise((resolvePromise) => {
		execFile('gcloud', ['run', 'services', 'describe', 'three-ws-api', '--region', 'us-central1', '--project', GCP_PROJECT, '--format', 'json'], { maxBuffer: 32 << 20 }, (err, stdout) => {
			if (err) return resolvePromise(null);
			try {
				const svc = JSON.parse(stdout);
				const env = {};
				for (const e of svc.spec?.template?.spec?.containers?.[0]?.env || []) env[e.name] = e.value ?? (e.valueFrom ? '<secret ref>' : '');
				resolvePromise(env);
			} catch {
				resolvePromise(null);
			}
		});
	});
}

function unsignedPlan(store) {
	const vaults = Object.fromEntries(MANIFEST.azure.vaults.map((v) => [v.key, `${v.namePrefix}-<suffix>`]));
	const names = { resourceGroup: opt('--resource-group') || MANIFEST.azure.resourceGroup.default, location: opt('--location') || MANIFEST.azure.resourceGroup.location, bot: opt('--bot-name') || `${MANIFEST.azure.bot.name}-<suffix>`, vaults };
	const azure = { names, providers: { 'Microsoft.KeyVault': 'unchecked until az login', 'Microsoft.BotService': 'unchecked until az login' }, resourceGroup: null, vaults: Object.fromEntries(MANIFEST.azure.vaults.map((v) => [v.key, { vault: null, roleAssignments: [], secrets: {} }])), readers: {}, bot: null, channels: {} };
	const state = { account: { tenantId: '<tenant>', name: 'the signed-in operator' }, apps: {}, secrets: {}, azure };
	for (const spec of MANIFEST.apps) {
		const local = store.get(spec.secret.env);
		if (local?.keyId) state.secrets[spec.key] = { keyId: local.keyId };
	}
	return buildPlan(MANIFEST, state, { rotate: flag('--rotate-secrets') });
}

async function main() {
	if (flag('--help') || flag('-h')) return usage();
	const mode = flag('--apply') ? 'apply' : flag('--verify') ? 'verify' : 'plan';
	const store = new SecretStore(opt('--secrets-dir') || defaultSecretsDir(), REPO);
	const prodChecks = mode === 'verify' ? productionChecks(MANIFEST.origin) : null;

	let account;
	try {
		account = await readAccount();
	} catch (err) {
		if (err instanceof AzureCliMissing) {
			log(...AZ_INSTALL);
			if (prodChecks) log('', 'Production (no Azure login needed):', formatChecks(await prodChecks));
			process.exitCode = 3;
			return;
		}
		if (err instanceof NotSignedIn) {
			log(...loginHelp(err.message));
			if (mode === 'verify') {
				log('', 'Production (no Azure login needed):', formatChecks(await prodChecks));
			} else {
				log('', 'Until then, this is what --apply would set up in an empty tenant:', formatPlan(unsignedPlan(store)));
			}
			process.exitCode = 2;
			return;
		}
		throw err;
	}

	const tenantId = opt('--tenant') || account.tenantId;
	const token = cliTokens({ az: runAz, tenantId: opt('--tenant') });
	const ctx = {
		manifest: MANIFEST,
		rest: restClient({ token }),
		account: { ...account, tenantId },
		subscriptionId: opt('--subscription') || account.subscriptionId,
		names: { resourceGroup: opt('--resource-group'), location: opt('--location'), bot: opt('--bot-name'), opsVault: opt('--ops-vault-name'), copilotVault: opt('--copilot-vault-name') },
		store,
		rotate: flag('--rotate-secrets'),
		copilotRedirectUri: opt('--copilot-redirect-uri'),
		registerOauthClient,
		now: () => Date.now(),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		log,
	};
	for (const k of Object.keys(ctx.names)) if (!ctx.names[k]) delete ctx.names[k];
	log(`Tenant ${tenantId}, signed in as ${account.user.name}${ctx.subscriptionId ? `, subscription ${ctx.subscriptionId}` : ', no subscription'}`);

	if (mode === 'apply') {
		await apply(ctx);
		return;
	}
	const { state, actions } = await plan(ctx);
	log(formatPlan(actions));
	if (mode === 'plan') {
		log(formatHandoff(ctx, state, { envFile: null }));
		const s = summarize(actions);
		if (s.create || s.update) log('', 'Run with --apply to make these changes.');
		return;
	}
	const s = summarize(actions);
	const checks = [
		{ check: 'live resources match resources.json', ok: s.create === 0 && s.update === 0 && s.blocked === 0, detail: `${s.create} to create, ${s.update} to change, ${s.blocked} blocked` },
		...cloudRunChecks(MANIFEST, state, store, await readCloudRunEnv()),
		...(await prodChecks),
	];
	log('', 'Verify:', formatChecks(checks));
	const remaining = checks.filter((c) => !c.ok);
	const manual = actions.filter((a) => a.op === 'manual');
	if (remaining.length || manual.length) {
		log('', 'What remains:');
		for (const c of remaining) log(`  - ${c.check}: ${c.detail}`);
		for (const a of manual) for (const d of a.details) log(`  - ${a.target}: ${d}`);
	}
	process.exitCode = remaining.length ? 1 : 0;
}

main().catch((err) => {
	process.stderr.write(`microsoft-provision: ${err.message}\n`);
	process.exitCode = 1;
});
