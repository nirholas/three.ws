#!/usr/bin/env node
// Turn Forge pay-to-keep on or off on the production Cloud Run service.
// Usage: npm run forge:pay-to-keep -- on|off|status [--dry-run]
// Uses --update-env-vars (never --set-env-vars, which replaces the whole env set).
import { spawnSync } from 'node:child_process';

const SERVICE = 'three-ws-api';
const REGION = 'us-central1';
const PROJECT = 'aerial-vehicle-466722-p5';

const [mode, ...flags] = process.argv.slice(2);
const dry = flags.includes('--dry-run');

function usage() {
	console.error('Usage: npm run forge:pay-to-keep -- on|off|status [--dry-run]');
	process.exit(2);
}

function gcloud(args) {
	return spawnSync('gcloud', [...args, '--project', PROJECT], { encoding: 'utf8' });
}

if (mode === 'status') {
	const r = gcloud([
		'run', 'services', 'describe', SERVICE, '--region', REGION,
		'--format', 'value(spec.template.spec.containers[0].env)',
	]);
	if (r.status !== 0) {
		console.error(r.stderr || 'gcloud describe failed');
		process.exit(1);
	}
	const m = /'name': 'FORGE_PAY_TO_KEEP', 'value': '([^']*)'/.exec(r.stdout);
	console.log(`FORGE_PAY_TO_KEEP=${m ? m[1] : '(unset, pay-to-keep is off)'}`);
	process.exit(0);
}

if (mode !== 'on' && mode !== 'off') usage();

const value = mode === 'on' ? '1' : '0';
const args = [
	'run', 'services', 'update', SERVICE, '--region', REGION,
	'--update-env-vars', `FORGE_PAY_TO_KEEP=${value}`,
];
if (dry) {
	console.log(`gcloud ${args.join(' ')} --project ${PROJECT}`);
	process.exit(0);
}
const r = gcloud(args);
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status ?? 1);
