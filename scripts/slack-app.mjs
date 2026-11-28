#!/usr/bin/env node
// Create (or update) the three.ws Slack app from integrations/slack/manifest.json
// and wire it into production in one command.
//
// What it does, in order, stopping at the first failure:
//   1. Reads a Slack app configuration token from stdin (piped) or a hidden
//      prompt. Never from argv. Generate one at https://api.slack.com/apps under
//      "Your App Configuration Tokens"; it is valid for 12 hours.
//   2. Validates the manifest with apps.manifest.validate.
//   3. Creates the app with apps.manifest.create, WITHOUT event subscriptions:
//      Slack verifies the events URL the moment it is set, and that check can
//      only pass once production holds the new app's signing secret.
//   4. Stores the client id, client secret and signing secret Slack returns in
//      Secret Manager (slack-client-id, slack-client-secret,
//      slack-signing-secret), each fed over stdin, and grants the runtime
//      service account secretAccessor on each one (never project-wide).
//   5. Runs `gcloud run services update three-ws-api --update-secrets ...` for
//      the three names. --update-secrets touches only those names; it never
//      replaces the rest of the env the way --set-env-vars does. The
//      agent-gateway worker mirrors three-ws-api's env on its next deploy.
//   6. Proves the live receiver holds the signing secret: a signed
//      url_verification POST must echo its challenge.
//   7. Applies the full manifest with apps.manifest.update, which turns on
//      event subscriptions (Slack verifies the URL against the now-configured
//      receiver).
//   8. Probes GET /api/gateway/slack?leg=install for a redirect to Slack's
//      OAuth consent screen carrying the new client id.
//
// With --app-id the app already exists: it validates and applies the manifest
// to that app and runs the install probe. No credentials change.
//
// Usage:
//   pbpaste | npm run slack:app                  # create and wire the app
//   npm run slack:app -- --app-id A0123456789    # re-apply the manifest
//   npm run slack:app -- --dry-run               # print the plan, touch nothing
//   --origin https://staging.example             # point the manifest elsewhere
//
// The token and the app's secrets are only ever sent to slack.com and Secret
// Manager; none of them is printed.

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/gcloud-path.mjs';
import { DEFAULT_PROJECT, DEFAULT_REGION, DEFAULT_SERVICE } from './lib/service-env.mjs';

export const MANIFEST_PATH = fileURLToPath(new URL('../integrations/slack/manifest.json', import.meta.url));
export const MANIFEST_ORIGIN = 'https://three.ws';
export const RUNTIME_SA = `three-ws@${DEFAULT_PROJECT}.iam.gserviceaccount.com`;
export const RECEIVER_PATH = '/api/gateway/slack';
/** Env name on the service -> Secret Manager secret -> field of apps.manifest.create's credentials. */
export const SECRETS = [
	{ env: 'SLACK_CLIENT_ID', secret: 'slack-client-id', field: 'client_id' },
	{ env: 'SLACK_CLIENT_SECRET', secret: 'slack-client-secret', field: 'client_secret' },
	{ env: 'SLACK_SIGNING_SECRET', secret: 'slack-signing-secret', field: 'signing_secret' },
];
const TIMEOUT_MS = 20_000;

/** The manifest, with every https://three.ws URL moved to `origin`. */
export function loadManifest({ origin = MANIFEST_ORIGIN, path = MANIFEST_PATH } = {}) {
	const raw = readFileSync(path, 'utf8');
	const target = String(origin).replace(/\/+$/, '');
	if (!/^https:\/\/[^/\s]+$/.test(target)) throw new Error(`--origin must be an https origin, got ${origin}`);
	const manifest = JSON.parse(raw.split(MANIFEST_ORIGIN).join(target));
	return manifest;
}

/** The manifest without event subscriptions, for the first create. */
export function withoutEvents(manifest) {
	const copy = structuredClone(manifest);
	if (copy.settings) delete copy.settings.event_subscriptions;
	return copy;
}

export class SlackApiError extends Error {
	constructor(method, json) {
		const details = Array.isArray(json?.errors)
			? json.errors.map((e) => `${e.pointer || ''} ${e.message || ''}`.trim()).join('; ')
			: '';
		super(`${method} failed: ${json?.error || 'unknown_error'}${details ? ` (${details})` : ''}`);
		this.code = json?.error || 'unknown_error';
		this.errors = json?.errors || [];
	}
}

/** POST a Slack Web API method with the configuration token. Resolves the JSON body. */
export async function slackApi(method, token, params, fetchImpl = fetch) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetchImpl(`https://slack.com/api/${method}`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
			},
			body: new URLSearchParams(params).toString(),
			signal: controller.signal,
		});
		let json = null;
		try {
			json = await res.json();
		} catch {
			json = null;
		}
		if (!json?.ok) throw new SlackApiError(method, json || { error: `http_${res.status}` });
		return json;
	} finally {
		clearTimeout(timer);
	}
}

/** The gcloud argv for every mutating step, so the plan and the run never drift. */
export function plan({ project = DEFAULT_PROJECT, region = DEFAULT_REGION, service = DEFAULT_SERVICE } = {}) {
	const perSecret = SECRETS.map(({ secret }) => ({
		secret,
		describe: ['secrets', 'describe', secret, '--format=value(name)', `--project=${project}`],
		create: ['secrets', 'create', secret, '--replication-policy=automatic', `--project=${project}`],
		addVersion: ['secrets', 'versions', 'add', secret, '--data-file=-', `--project=${project}`],
		grant: [
			'secrets',
			'add-iam-policy-binding',
			secret,
			`--member=serviceAccount:${RUNTIME_SA}`,
			'--role=roles/secretmanager.secretAccessor',
			'--condition=None',
			`--project=${project}`,
		],
	}));
	return {
		secrets: perSecret,
		updateService: [
			'run',
			'services',
			'update',
			service,
			`--region=${region}`,
			`--project=${project}`,
			`--update-secrets=${SECRETS.map((s) => `${s.env}=${s.secret}:latest`).join(',')}`,
		],
	};
}

/** Slack's v0 request signature over a body, as the receiver checks it. */
export function signSlackBody(signingSecret, body, ts = Math.floor(Date.now() / 1000)) {
	const mac = createHmac('sha256', signingSecret).update(`v0:${ts}:${body}`).digest('hex');
	return { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': `v0=${mac}` };
}

/** A signed url_verification POST; true when the live receiver echoes the challenge. */
export async function receiverAccepts(origin, signingSecret, fetchImpl = fetch) {
	const challenge = `tws-setup-${Date.now().toString(36)}`;
	const body = JSON.stringify({ type: 'url_verification', challenge, token: 'setup-probe' });
	const res = await fetchImpl(`${origin}${RECEIVER_PATH}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...signSlackBody(signingSecret, body) },
		body,
	});
	const text = await res.text();
	return { ok: res.status === 200 && text.trim() === challenge, status: res.status };
}

/**
 * GET ?leg=install without following the redirect. `ok` means the redirect is
 * Slack's consent screen (and, when a client id is given, carries it).
 */
export async function probeInstall(origin, clientId = null, fetchImpl = fetch) {
	const res = await fetchImpl(`${origin}${RECEIVER_PATH}?leg=install`, { redirect: 'manual' });
	const location = res.headers.get('location') || '';
	let target = null;
	try {
		target = new URL(location, origin);
	} catch {
		target = null;
	}
	const toSlack = target?.origin === 'https://slack.com' && target.pathname === '/oauth/v2/authorize';
	const idMatches = !clientId || target?.searchParams.get('client_id') === clientId;
	let reason = null;
	if (!toSlack) {
		if (target?.pathname === '/login') reason = 'production still runs the install code that requires a three.ws sign-in; deploy the API';
		else if (target?.searchParams.get('install') === 'not_configured') reason = 'the service does not see SLACK_CLIENT_ID and SLACK_CLIENT_SECRET yet';
		else reason = `unexpected response: HTTP ${res.status} ${location || '(no location)'}`;
	} else if (!idMatches) {
		reason = 'the redirect carries a different client id than the app just created';
	}
	return { ok: toSlack && idMatches, status: res.status, location, reason };
}

/**
 * The whole sequence. Every external effect is injected so a test can drive it
 * without gcloud, Slack or production:
 *   gcloud(args, { input })   runs gcloud, throws on a non-zero exit
 *   fetchImpl                 fetch, for slack.com and the production probes
 *   wait(ms)                  real delay between receiver retries
 */
export async function setupSlackApp(rawToken, {
	gcloud,
	fetchImpl = fetch,
	wait = (ms) => new Promise((r) => setTimeout(r, ms)),
	log = console.log,
	appId = null,
	origin = MANIFEST_ORIGIN,
	opts = {},
}) {
	const token = String(rawToken || '').trim();
	if (!token) throw new Error('No configuration token on stdin. Pipe it in or type it at the prompt.');
	if (!/^xoxe\.xoxp-/.test(token)) {
		throw new Error('That is not an app configuration token (they start with xoxe.xoxp-). Generate one at https://api.slack.com/apps, "Your App Configuration Tokens".');
	}

	const manifest = loadManifest({ origin });
	const full = JSON.stringify(manifest);
	await slackApi('apps.manifest.validate', token, appId ? { manifest: full, app_id: appId } : { manifest: full }, fetchImpl);
	log('1 manifest valid');

	if (appId) {
		await slackApi('apps.manifest.update', token, { app_id: appId, manifest: full }, fetchImpl);
		log(`2 manifest applied to ${appId}`);
		const probe = await probeInstall(origin, null, fetchImpl);
		log(probe.ok ? `3 install link redirects to Slack: ${origin}${RECEIVER_PATH}?leg=install` : `3 install link not ready: ${probe.reason}`);
		return { appId, created: false, installReady: probe.ok, installProbe: probe };
	}

	const created = await slackApi('apps.manifest.create', token, { manifest: JSON.stringify(withoutEvents(manifest)) }, fetchImpl);
	const newAppId = created.app_id;
	const creds = created.credentials || {};
	for (const s of SECRETS) {
		if (!creds[s.field]) throw new Error(`apps.manifest.create returned no ${s.field}; app ${newAppId} exists, re-run with --app-id after setting the secrets by hand.`);
	}
	log(`2 created app ${newAppId}`);

	const steps = plan(opts);
	for (const [i, step] of steps.secrets.entries()) {
		let exists = true;
		try {
			gcloud(step.describe);
		} catch {
			exists = false;
		}
		if (!exists) gcloud(step.create);
		gcloud(step.addVersion, { input: creds[SECRETS[i].field] });
		gcloud(step.grant);
	}
	log(`3 stored ${SECRETS.map((s) => s.secret).join(', ')} and granted ${RUNTIME_SA}`);

	gcloud(steps.updateService);
	log(`4 ${opts.service || DEFAULT_SERVICE} now reads ${SECRETS.map((s) => s.env).join(', ')}`);

	let receiver = { ok: false, status: 0 };
	for (let attempt = 0; attempt < 6 && !receiver.ok; attempt++) {
		if (attempt) await wait(10_000);
		receiver = await receiverAccepts(origin, creds.signing_secret, fetchImpl).catch(() => ({ ok: false, status: 0 }));
	}
	if (!receiver.ok) {
		throw new Error(`The live receiver did not accept a request signed with the new secret (last HTTP ${receiver.status}). App ${newAppId} and its secrets are in place; once the receiver answers, finish with: npm run slack:app -- --app-id ${newAppId}`);
	}
	log('5 live receiver verifies requests signed with the new signing secret');

	await slackApi('apps.manifest.update', token, { app_id: newAppId, manifest: full }, fetchImpl);
	log('6 event subscriptions on: Slack verified the events URL');

	const probe = await probeInstall(origin, creds.client_id, fetchImpl);
	log(probe.ok ? `7 install link redirects to Slack's consent screen: ${origin}${RECEIVER_PATH}?leg=install` : `7 install link not ready: ${probe.reason}`);
	return { appId: newAppId, created: true, installReady: probe.ok, installProbe: probe };
}

export function remainingSteps(appId, origin = MANIFEST_ORIGIN) {
	return [
		`App settings: https://api.slack.com/apps/${appId}`,
		'- Basic Information, Display Information: upload integrations/slack/assets/icon-1024.png as the app icon.',
		`- Manage Distribution: activate public distribution and set the Direct Install URL to ${origin}${RECEIVER_PATH}?leg=install`,
		'- Deploy the agent-gateway worker so replies leave (it mirrors three-ws-api env): see workers/agent-gateway/README.md.',
		'- Marketplace submission checklist: integrations/slack/MARKETPLACE.md',
	];
}

async function readTokenFromStdin() {
	if (!process.stdin.isTTY) {
		const chunks = [];
		for await (const chunk of process.stdin) chunks.push(chunk);
		return Buffer.concat(chunks).toString('utf8');
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
	process.stdout.write('Slack app configuration token (input hidden): ');
	rl._writeToOutput = () => {};
	const answer = await new Promise((res) => rl.question('', res));
	rl.close();
	process.stdout.write('\n');
	return answer;
}

function runGcloud(args, { input } = {}) {
	return execFileSync('gcloud', args, {
		encoding: 'utf8',
		input,
		stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
		maxBuffer: 16 * 1024 * 1024,
	});
}

function argValue(argv, name) {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : null;
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes('--help') || argv.includes('-h')) {
		const header = readFileSync(new URL(import.meta.url), 'utf8').split('\n\n')[0];
		process.stdout.write(header.split('\n').slice(1).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
		return 0;
	}
	const appId = argValue(argv, '--app-id');
	if (appId && !/^A[A-Z0-9]{6,20}$/.test(appId)) throw new Error(`--app-id looks wrong: ${appId}`);
	const origin = (argValue(argv, '--origin') || MANIFEST_ORIGIN).replace(/\/+$/, '');

	if (argv.includes('--dry-run')) {
		const manifest = loadManifest({ origin });
		console.log(`manifest        ${MANIFEST_PATH} (${manifest.oauth_config.scopes.bot.length} bot scopes, ${manifest.settings.event_subscriptions.bot_events.length} events, urls on ${origin})`);
		console.log('validate        POST https://slack.com/api/apps.manifest.validate');
		if (appId) {
			console.log(`update          POST https://slack.com/api/apps.manifest.update  app_id=${appId}`);
		} else {
			console.log('create          POST https://slack.com/api/apps.manifest.create  (manifest without event_subscriptions)');
			const steps = plan();
			for (const s of steps.secrets) {
				console.log(`secret          gcloud ${s.describe.join(' ')}  (create if missing)`);
				console.log(`                gcloud ${s.addVersion.join(' ')}   <- value on stdin`);
				console.log(`                gcloud ${s.grant.join(' ')}`);
			}
			console.log(`updateService   gcloud ${steps.updateService.join(' ')}`);
			console.log(`receiver        POST ${origin}${RECEIVER_PATH}  signed url_verification, must echo the challenge`);
			console.log('update          POST https://slack.com/api/apps.manifest.update  (full manifest: events on)');
		}
		console.log(`probe           GET ${origin}${RECEIVER_PATH}?leg=install  must redirect to https://slack.com/oauth/v2/authorize`);
		return 0;
	}

	const token = await readTokenFromStdin();
	const result = await setupSlackApp(token, { gcloud: runGcloud, appId, origin });
	console.log(`\nNext, by hand (Slack exposes no API for these):\n${remainingSteps(result.appId, origin).join('\n')}`);
	return result.installReady ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main()
		.then((code) => process.exit(code))
		.catch((err) => {
			console.error(err?.message || String(err));
			process.exit(1);
		});
}
