#!/usr/bin/env node
// Put a production xAI key on the three-ws-api Cloud Run service in one command.
//
// Without GROK_API_KEY the Grok rung of every LLM failover chain is empty, the
// Sentiment Scout's xAI x_search fallback is dormant, and the xAI remote MCP
// end-to-end proof (npm run e2e:xai-mcp) can only dry-run. See
// docs/ops/llm-lanes.md.
//
// What it does, in order, stopping at the first failure:
//   1. Reads the key from stdin (piped) or a hidden prompt. Never from argv, so
//      it stays out of shell history and process listings.
//   2. Checks the key against GET https://api.x.ai/v1/models BEFORE storing
//      anything, so a typo never reaches production.
//   3. Creates the Secret Manager secret `grok-api-key` if it is missing and adds
//      the key as a new version (fed over stdin, never a command-line value).
//   4. Grants the runtime service account roles/secretmanager.secretAccessor on
//      that one secret (never project-wide).
//   5. Runs `gcloud run services update three-ws-api --update-secrets
//      GROK_API_KEY=grok-api-key:latest`. --update-secrets only touches that one
//      name; it never replaces the rest of the env the way --set-env-vars does.
//   6. Reads GROK_API_KEY back off the service (following the secret reference),
//      confirms it is the key just stored, and calls GET /v1/models with it.
//   7. Runs `npm run e2e:xai-mcp` live against production (skip: --skip-e2e).
//
// Usage:
//   pbpaste | npm run setup:xai-key            # macOS clipboard
//   npm run setup:xai-key                      # hidden prompt
//   npm run setup:xai-key -- --dry-run         # print the plan, touch nothing
//
// The key is only ever sent to api.x.ai and to Secret Manager; it is never
// printed.

import { execFileSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/gcloud-path.mjs';
import { serviceEnvValue, DEFAULT_PROJECT, DEFAULT_REGION, DEFAULT_SERVICE } from './lib/service-env.mjs';

export const SECRET_NAME = 'grok-api-key';
export const ENV_NAME = 'GROK_API_KEY';
export const RUNTIME_SA = `three-ws@${DEFAULT_PROJECT}.iam.gserviceaccount.com`;
export const MODELS_URL = 'https://api.x.ai/v1/models';
const TIMEOUT_MS = 20_000;

/** GET /v1/models with the key. Resolves { ok, status, count, detail }. */
export async function checkKey(key, fetchImpl = fetch) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetchImpl(MODELS_URL, {
			headers: { authorization: `Bearer ${key}` },
			signal: controller.signal,
		});
		const text = await res.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			json = null;
		}
		const ids = Array.isArray(json?.data) ? json.data.map((m) => m?.id).filter(Boolean) : [];
		if (res.status === 200 && ids.length) return { ok: true, status: 200, count: ids.length, ids };
		const detail = json?.error?.message || json?.error || json?.code || text.slice(0, 300);
		return { ok: false, status: res.status, count: ids.length, detail: String(detail) };
	} finally {
		clearTimeout(timer);
	}
}

/** The gcloud argv for each mutating step, so the plan and the run never drift. */
export function plan({ project = DEFAULT_PROJECT, region = DEFAULT_REGION, service = DEFAULT_SERVICE } = {}) {
	return {
		describeSecret: ['secrets', 'describe', SECRET_NAME, '--format=value(name)', `--project=${project}`],
		createSecret: ['secrets', 'create', SECRET_NAME, '--replication-policy=automatic', `--project=${project}`],
		addVersion: ['secrets', 'versions', 'add', SECRET_NAME, '--data-file=-', `--project=${project}`],
		grantAccessor: [
			'secrets',
			'add-iam-policy-binding',
			SECRET_NAME,
			`--member=serviceAccount:${RUNTIME_SA}`,
			'--role=roles/secretmanager.secretAccessor',
			'--condition=None',
			`--project=${project}`,
		],
		updateService: [
			'run',
			'services',
			'update',
			service,
			`--region=${region}`,
			`--project=${project}`,
			`--update-secrets=${ENV_NAME}=${SECRET_NAME}:latest`,
		],
	};
}

/**
 * Store, wire and verify. Every external effect is injected so a test can drive
 * the whole sequence without gcloud or the network.
 *   gcloud(args, { input })  runs gcloud, throws on a non-zero exit
 *   readBack()               returns GROK_API_KEY as the service resolves it
 *   fetchImpl                fetch, for the two /v1/models checks
 */
export async function installKey(rawKey, { gcloud, readBack, fetchImpl = fetch, log = console.log, opts = {} }) {
	const key = String(rawKey || '').trim();
	if (!key) throw new Error('No key on stdin. Pipe it in or type it at the prompt.');

	const pre = await checkKey(key, fetchImpl);
	if (!pre.ok) {
		throw new Error(`xAI rejected the key (HTTP ${pre.status}: ${pre.detail}). Nothing was stored.`);
	}
	log(`1/5 key accepted by xAI: ${pre.count} models visible`);

	const steps = plan(opts);
	let exists = true;
	try {
		gcloud(steps.describeSecret);
	} catch {
		exists = false;
	}
	if (!exists) gcloud(steps.createSecret);
	gcloud(steps.addVersion, { input: key });
	log(`2/5 ${exists ? 'added a new version to' : 'created'} secret ${SECRET_NAME}`);

	gcloud(steps.grantAccessor);
	log(`3/5 granted secretAccessor on ${SECRET_NAME} to ${RUNTIME_SA}`);

	gcloud(steps.updateService);
	log(`4/5 ${opts.service || DEFAULT_SERVICE} now reads ${ENV_NAME} from ${SECRET_NAME}:latest`);

	const live = readBack();
	if (live !== key) {
		throw new Error(
			`${ENV_NAME} on the service does not resolve to the key just stored (${live ? 'different value' : 'unreadable'}). ` +
				'Check the service revision and the secretAccessor binding.',
		);
	}
	const post = await checkKey(live, fetchImpl);
	if (!post.ok) throw new Error(`The service's key failed GET /v1/models (HTTP ${post.status}: ${post.detail}).`);
	log(`5/5 service key verified: GET /v1/models HTTP 200, ${post.count} models`);
	return { models: post.ids, created: !exists };
}

async function readKeyFromStdin() {
	if (!process.stdin.isTTY) {
		const chunks = [];
		for await (const chunk of process.stdin) chunks.push(chunk);
		return Buffer.concat(chunks).toString('utf8');
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
	process.stdout.write('xAI API key (input hidden): ');
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

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes('--help') || argv.includes('-h')) {
		const header = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('\n\n')[0];
		process.stdout.write(header.split('\n').slice(1).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
		return 0;
	}
	if (argv.includes('--dry-run')) {
		const steps = plan();
		console.log(`GET ${MODELS_URL}  (key check, before anything is stored)`);
		for (const [name, args] of Object.entries(steps)) {
			const suffix = name === 'addVersion' ? '   <- key on stdin' : '';
			console.log(`${name.padEnd(15)} gcloud ${args.join(' ')}${suffix}`);
		}
		console.log(`readBack        ${ENV_NAME} off ${DEFAULT_SERVICE}, compared to the stored key, then GET ${MODELS_URL}`);
		console.log('e2e             npm run e2e:xai-mcp');
		return 0;
	}

	const raw = await readKeyFromStdin();
	await installKey(raw, {
		gcloud: runGcloud,
		readBack: () => serviceEnvValue(ENV_NAME),
	});

	if (argv.includes('--skip-e2e')) return 0;
	console.log('\nRunning the live xAI remote MCP proof: npm run e2e:xai-mcp');
	const e2e = spawnSync('npm', ['run', 'e2e:xai-mcp'], { stdio: 'inherit' });
	return e2e.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main()
		.then((code) => process.exit(code))
		.catch((err) => {
			console.error(err?.message || String(err));
			process.exit(1);
		});
}
