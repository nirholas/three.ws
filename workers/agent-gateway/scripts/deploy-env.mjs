#!/usr/bin/env node
// Derive the gateway's Cloud Run environment from the live three-ws-api service.
//
// The gateway runs the same agent turn as the web copilot (LLM chain, market
// data, the agent's custodial wallet, the rate limiter), so it needs the same
// configuration the API runs with, and it must never drift from it: the
// agent-orders worker once pointed at stale copies of JWT_SECRET and
// WALLET_ENCRYPTION_KEY and could not decrypt a single agent key. So instead of
// a hand-kept list, every deploy copies the API's env: literals into an
// --env-vars-file, Secret Manager references into --set-secrets, by reference,
// so no secret value ever passes through this script or the build log.
//
// Two classes are left out on purpose:
//   - Cloud Run's reserved names (PORT, K_*).
//   - Platform signers: treasury, fee-payer, relayer and payout keys. A chat turn
//     signs only with the agent's own custodial key (decrypted with
//     WALLET_ENCRYPTION_KEY, which is kept). A process that reads messages from
//     the internet has no business holding the platform's money keys.
//
// Usage (Cloud Build runs exactly this; see ../cloudbuild.yaml):
//   gcloud run services describe three-ws-api --region us-central1 --format=json > api.json
//   node workers/agent-gateway/scripts/deploy-env.mjs api.json env.yaml secrets.txt [--set KEY=VALUE ...]
// Add --print to see the names (never values) that would be mirrored and dropped.

import { readFileSync, writeFileSync } from 'node:fs';

const RESERVED = /^(PORT|K_SERVICE|K_REVISION|K_CONFIGURATION|CLOUD_RUN_JOB|CLOUD_RUN_EXECUTION|CLOUD_RUN_TASK_INDEX|CLOUD_RUN_TASK_ATTEMPT|CLOUD_RUN_TASK_COUNT)$/;
const SIGNER_NAME = /(_SECRET_KEY_B64|_SECRET_BASE58|_PRIVATE_KEY|_KEYPAIR|_RELAYER_KEY|_PAYOUT_KEY|_TREASURY_SECRET|_DISTRIBUTOR_SECRET|_PAYER_SOLANA_SECRET|_WALLET_SECRET)$/;
const SIGNER_SECRET = /^wallet-/;
const KEEP = new Set(['WALLET_ENCRYPTION_KEY']);

/** Why a variable is not mirrored, or null when it is. */
export function exclusionReason(entry) {
	if (RESERVED.test(entry.name)) return 'reserved by Cloud Run';
	if (KEEP.has(entry.name)) return null;
	const secret = entry.valueFrom?.secretKeyRef?.name || '';
	if (SIGNER_SECRET.test(secret) || SIGNER_NAME.test(entry.name)) return 'platform signer';
	return null;
}

/**
 * @param {object} service  `gcloud run services describe --format=json` output
 * @param {Record<string,string>} [overrides]  literals set on top (gateway knobs)
 * @returns {{ env: Record<string,string>, secrets: Record<string,string>, excluded: Array<{name:string, reason:string}> }}
 */
export function buildDeployEnv(service, overrides = {}) {
	const container = service?.spec?.template?.spec?.containers?.[0];
	if (!container || !Array.isArray(container.env)) throw new Error('not a Cloud Run service description: spec.template.spec.containers[0].env is missing');
	const env = {};
	const secrets = {};
	const excluded = [];
	for (const entry of container.env) {
		const reason = exclusionReason(entry);
		if (reason) {
			excluded.push({ name: entry.name, reason });
			continue;
		}
		const ref = entry.valueFrom?.secretKeyRef;
		if (ref) secrets[entry.name] = `${ref.name}:${ref.key || 'latest'}`;
		else if (entry.value != null && entry.value !== '') env[entry.name] = String(entry.value);
	}
	for (const [k, v] of Object.entries(overrides)) {
		delete secrets[k];
		env[k] = String(v);
	}
	return { env, secrets, excluded };
}

/** YAML for --env-vars-file. Every value is a JSON string, which YAML reads verbatim. */
export function envYaml(env) {
	return `${Object.entries(env).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n`;
}

/** The --set-secrets value: NAME=secret:version,... */
export function secretsFlag(secrets) {
	return Object.entries(secrets).map(([k, ref]) => `${k}=${ref}`).join(',');
}

function parseArgs(argv) {
	const positional = [];
	const overrides = {};
	let print = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--print') print = true;
		else if (argv[i] === '--set') {
			const pair = argv[++i] || '';
			const eq = pair.indexOf('=');
			if (eq <= 0) throw new Error(`--set needs KEY=VALUE, got "${pair}"`);
			overrides[pair.slice(0, eq)] = pair.slice(eq + 1);
		} else positional.push(argv[i]);
	}
	return { positional, overrides, print };
}

function main() {
	const { positional: [input, envOut, secretsOut], overrides, print } = parseArgs(process.argv.slice(2));
	if (!input) throw new Error('usage: deploy-env.mjs <service.json> [env.yaml secrets.txt] [--set KEY=VALUE ...] [--print]');
	const { env, secrets, excluded } = buildDeployEnv(JSON.parse(readFileSync(input, 'utf8')), overrides);
	if (envOut) writeFileSync(envOut, envYaml(env));
	if (secretsOut) writeFileSync(secretsOut, secretsFlag(secrets));
	const summary = `mirrored ${Object.keys(env).length} literals and ${Object.keys(secrets).length} secret references; left out ${excluded.length}`;
	if (print) {
		console.log(summary);
		console.log(`literals: ${Object.keys(env).join(' ')}`);
		console.log(`secrets: ${Object.keys(secrets).join(' ')}`);
		for (const x of excluded) console.log(`left out ${x.name}: ${x.reason}`);
	} else {
		console.log(summary);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (e) {
		console.error(`deploy-env: ${e.message}`);
		process.exit(1);
	}
}
