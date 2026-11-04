#!/usr/bin/env node
// Pre-ship gate for the agent-gateway worker (`npm run gateway:ship-check`).
//
//   1. Runs the worker's own vitest suite.
//   2. Derives the Cloud Run env exactly as the deploy's derive-env step does
//      (live three-ws-api service -> deploy-env.mjs, with the same --set
//      overrides as cloudbuild.yaml) and prints the names it would mirror and
//      leave out. Values are never read: secret references stay references.
//   3. Checks that the derived env configures at least one chat adapter, and
//      names the ones that would be skipped and why.
//   4. Prints the ship command and the one post-deploy step.
//
// Exit 0 means the worker is ready to ship; it deploys nothing.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeService } from '../../../scripts/lib/service-env.mjs';
import { buildDeployEnv } from './deploy-env.mjs';

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(workerDir, '../..');
const SHIP =
	'gcloud builds submit --config workers/agent-gateway/cloudbuild.yaml . --region us-central1 ' +
	'--project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s)';

const failures = [];
const step = (title) => console.log(`\n== ${title}`);

// The overrides cloudbuild.yaml passes to deploy-env.mjs, read from its own
// substitutions so this preview cannot drift from the real deploy.
function cloudbuildOverrides() {
	const yaml = readFileSync(resolve(workerDir, 'cloudbuild.yaml'), 'utf8');
	const sub = (name) => yaml.match(new RegExp(`^\\s+${name}:\\s*"?([^"\\n]+)"?`, 'm'))?.[1];
	const overrides = {};
	for (const m of yaml.matchAll(/- --set\n\s+- (\w+)=\$\{(_\w+)\}/g)) {
		const value = sub(m[2]);
		if (value === undefined) throw new Error(`cloudbuild.yaml sets ${m[1]} from ${m[2]}, which has no default`);
		overrides[m[1]] = value;
	}
	return overrides;
}

step('worker test suite');
if (spawnSync(process.execPath, ['-e', "require.resolve('grammy')"], { cwd: workerDir }).status !== 0) {
	failures.push('worker dependencies are not installed: run `npm ci` in workers/agent-gateway');
} else {
	const run = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.config.js'], { cwd: workerDir, stdio: 'inherit' });
	if (run.status !== 0) failures.push(`worker tests failed (exit ${run.status})`);
}

step('deploy env preview (derived from the live three-ws-api service, names only)');
let derived = null;
try {
	const service = JSON.parse(describeService({ service: 'three-ws-api' }));
	const overrides = cloudbuildOverrides();
	derived = buildDeployEnv(service, overrides);
	const literals = Object.keys(derived.env);
	const secrets = Object.keys(derived.secrets);
	console.log(`mirrored ${literals.length} literals and ${secrets.length} secret references; left out ${derived.excluded.length}`);
	console.log(`overrides from cloudbuild.yaml: ${Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(' ')}`);
	for (const x of derived.excluded) console.log(`  left out ${x.name}: ${x.reason}`);
} catch (err) {
	failures.push(`could not derive the deploy env: ${err.message}`);
}

step('chat adapters the deployed worker would boot');
if (derived) {
	try {
		const { FACTORIES } = await import('../src/adapters/index.js');
		// Presence is what configured() checks; a secret reference resolves to a
		// value inside the container, so mark every derived name as present.
		const present = Object.fromEntries(
			[...Object.keys(derived.env), ...Object.keys(derived.secrets)].map((k) => [k, derived.env[k] ?? 'secret-ref']),
		);
		const wanted = present.GATEWAY_PLATFORMS ? present.GATEWAY_PLATFORMS.split(',').map((s) => s.trim()) : Object.keys(FACTORIES);
		let booting = 0;
		for (const [platform, f] of Object.entries(FACTORIES)) {
			if (!wanted.includes(platform)) {
				console.log(`  ${platform.padEnd(9)} skipped: excluded by GATEWAY_PLATFORMS`);
				continue;
			}
			const check = f.configured(present);
			if (check.ok) booting++;
			console.log(`  ${platform.padEnd(9)} ${check.ok ? 'boots' : `skipped: missing ${check.missing.join(', ')}`}`);
		}
		if (!booting) failures.push('no chat adapter would boot: the worker would answer /healthz 503');
	} catch (err) {
		failures.push(`could not load the adapter registry: ${err.message}`);
	}
}

if (failures.length) {
	console.log('\nNOT READY');
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}

console.log(`\nREADY. Ship (owner-approved deploys only), from ${repoRoot}:\n\n  ${SHIP}\n`);
console.log('Then point Telegram at the receiver so updates reach gateway_inbox (prints nothing secret):\n');
console.log('  npm --prefix workers/agent-gateway run webhook:telegram\n');
console.log('Verify with: node workers/agent-gateway/scripts/live-smoke.mjs');
