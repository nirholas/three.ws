#!/usr/bin/env node
// Register the Account Activity API webhook (api/x/webhook.js) and subscribe
// the company account to it, per docs.x.com's current Webhooks API:
//
//   POST /2/webhooks                                                   -> register, OAuth2 app-only bearer
//   GET  /2/webhooks                                                   -> list, OAuth2 app-only bearer
//   POST /2/account_activity/webhooks/:webhook_id/subscriptions/all    -> subscribe, OAuth 1.0a user context
//   DELETE /2/webhooks/:webhook_id                                    -> remove, OAuth2 app-only bearer
//
// The webhook URL must answer the CRC before X will register it, so this
// only makes sense against a deployed, publicly reachable three.ws.
// Credentials come from this process's env, falling back to the three-ws-api
// Cloud Run service (same pattern as scripts/x-mentions-probe.mjs).
//
// USAGE
//   node scripts/x-webhook-register.mjs --dry-run        # print the calls, make none
//   node scripts/x-webhook-register.mjs                  # register + subscribe for real
//   node scripts/x-webhook-register.mjs --list            # GET /2/webhooks
//   node scripts/x-webhook-register.mjs --delete <id>      # DELETE /2/webhooks/:id
//   node scripts/x-webhook-register.mjs --url <https://...> # override the webhook URL

import { serviceEnvValue } from './lib/service-env.mjs';
import { appOrigin } from '../api/_lib/gateway/format.js';

const API_BASE = 'https://api.twitter.com/2';
const TOKEN_URL = 'https://api.twitter.com/oauth2/token';
const KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];

function parseArgs(argv) {
	const out = { dryRun: false, list: false, deleteId: null, url: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dry-run') out.dryRun = true;
		else if (a === '--list') out.list = true;
		else if (a === '--delete') out.deleteId = argv[++i];
		else if (a === '--url') out.url = argv[++i];
	}
	return out;
}

function loadCreds() {
	const env = {};
	const source = {};
	for (const k of KEYS) {
		if (process.env[k]) {
			env[k] = process.env[k];
			source[k] = 'process.env';
			continue;
		}
		const v = serviceEnvValue(k);
		if (v) {
			env[k] = v;
			source[k] = 'cloud-run:three-ws-api';
		}
	}
	return { env, source };
}

async function appBearerToken(env, { dryRun }) {
	if (env.X_BEARER_TOKEN) return env.X_BEARER_TOKEN;
	if (dryRun) return '<app-only bearer, minted via POST /oauth2/token client_credentials grant>';
	if (!env.X_API_KEY || !env.X_API_SECRET) throw new Error('X_API_KEY and X_API_SECRET are required to mint an app-only bearer token');
	const basic = Buffer.from(`${encodeURIComponent(env.X_API_KEY)}:${encodeURIComponent(env.X_API_SECRET)}`).toString('base64');
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
		body: 'grant_type=client_credentials',
	});
	const body = await res.json().catch(() => null);
	if (!res.ok || !body?.access_token) throw new Error(`X token exchange failed: HTTP ${res.status} ${JSON.stringify(body)}`);
	return body.access_token;
}

function logCall(method, path, { auth, body } = {}) {
	console.log(`${method} ${API_BASE}${path}`);
	console.log(`  auth: ${auth}`);
	if (body !== undefined) console.log(`  body: ${JSON.stringify(body)}`);
}

async function bearerCall(method, path, token, { dryRun, body } = {}) {
	logCall(method, path, { auth: 'OAuth2 app-only bearer', body });
	if (dryRun) return null;
	const res = await fetch(`${API_BASE}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			...(body !== undefined ? { 'content-type': 'application/json' } : {}),
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`${method} ${path} failed: HTTP ${res.status} ${JSON.stringify(json)}`);
	return json;
}

async function oauth1Call(method, path, env, { dryRun } = {}) {
	logCall(method, path, { auth: 'OAuth 1.0a user context (the company account being subscribed)' });
	if (dryRun) return null;
	const { TwitterApi } = await import('twitter-api-v2');
	const client = new TwitterApi({
		appKey: env.X_API_KEY,
		appSecret: env.X_API_SECRET,
		accessToken: env.X_ACCESS_TOKEN,
		accessSecret: env.X_ACCESS_SECRET,
	});
	return method === 'POST' ? client.v2.post(path.replace(/^\//, '')) : client.v2.get(path.replace(/^\//, ''));
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const { env, source } = loadCreds();
	const url = args.url || `${appOrigin()}/api/x/webhook`;

	if (!args.dryRun) {
		const missing = KEYS.filter((k) => !env[k]);
		if (missing.length) throw new Error(`missing X credentials (checked process.env and the three-ws-api Cloud Run service): ${missing.join(', ')}`);
	}
	console.log(`webhook URL: ${url}`);
	if (!args.dryRun) console.log(`credential source: ${JSON.stringify(source)}`);
	console.log('');

	if (args.list) {
		const token = await appBearerToken(env, args);
		const result = await bearerCall('GET', '/webhooks', token, args);
		if (result) console.log(JSON.stringify(result, null, 2));
		return;
	}

	if (args.deleteId) {
		const token = await appBearerToken(env, args);
		const result = await bearerCall('DELETE', `/webhooks/${args.deleteId}`, token, args);
		if (result) console.log(JSON.stringify(result, null, 2));
		return;
	}

	const token = await appBearerToken(env, args);
	const registered = await bearerCall('POST', '/webhooks', token, { ...args, body: { url } });
	const webhookId = args.dryRun ? '<webhook_id from the POST /2/webhooks response above>' : registered?.data?.id;
	if (!args.dryRun && !webhookId) throw new Error(`POST /2/webhooks did not return an id: ${JSON.stringify(registered)}`);
	console.log('');

	const subscribed = await oauth1Call('POST', `/account_activity/webhooks/${webhookId}/subscriptions/all`, env, args);
	console.log('');

	if (args.dryRun) {
		console.log('Dry run: no network calls were made.');
		return;
	}
	console.log('Registered webhook:', JSON.stringify(registered, null, 2));
	console.log('Subscribed:', JSON.stringify(subscribed, null, 2));
}

main().catch((err) => {
	console.error(`x-webhook-register failed: ${err?.message || err}`);
	process.exitCode = 1;
});
