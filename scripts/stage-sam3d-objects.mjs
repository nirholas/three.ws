#!/usr/bin/env node
// Stage the SAM 3D Objects checkpoints into the model-weights bucket, after the
// account owner has accepted the SAM License. One command:
//
//   HF_TOKEN=hf_... npm run stage:sam3d-objects -- --accept-sam-license
//
// What it does, in order:
//   1. Refuses to run without --accept-sam-license. That flag is the owner
//      saying "I have read the SAM License and I accept it for this account".
//      It is never implied, never defaulted, and never set by CI.
//   2. Checks the Hugging Face token can read facebook/sam-3d-objects (the repo
//      is gated by manual approval). If not, it prints exactly where to request
//      access and exits.
//   3. Streams every file under checkpoints/ from Hugging Face straight into
//      gs://<bucket>/sam3d-objects/hf/ (no local disk), skipping objects that
//      already exist at the right size, and verifies sizes after the copy.
//   4. Copies the upstream LICENSE next to the weights, because the licence
//      requires a copy of the agreement to travel with the SAM Materials.
//   5. Creates the Artifact Registry repository the worker image is pushed to
//      when it does not exist yet.
//
// The token reaches curl through the environment, never argv. Options:
//   --dry-run     print what would be copied, change nothing
//   --bucket X    default three-ws-model-weights
//   --prefix X    default sam3d-objects
//   --project X   default aerial-vehicle-466722-p5
//   --region X    default us-central1

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = 'facebook/sam-3d-objects';
export const LICENSE_URL = 'https://github.com/facebookresearch/sam-3d-objects/blob/main/LICENSE';
export const ACCESS_URL = `https://huggingface.co/${REPO}`;

export const LICENSE_SUMMARY = [
	'SAM License (Meta, last updated November 19, 2025). Read the full text: ' + LICENSE_URL,
	'  - Use, reproduce, modify and distribute are allowed, royalty-free, subject to the agreement.',
	'  - Anyone you give the SAM Materials to receives them under this same agreement, with a copy of it.',
	'  - Use must comply with Trade Controls (sanctions and export controls). You must not be a target of',
	'    them. No ITAR, military, warfare, nuclear, espionage or weapons end uses.',
	'  - No reverse engineering, decompiling or discovering the underlying components of the SAM Materials.',
	'  - Research publications that use the SAM Materials must acknowledge it.',
	'  - Provided as is, no warranty, no support, no liability.',
	'  - The weights are gated on Hugging Face by manual approval and are refused in comprehensively',
	'    sanctioned jurisdictions.',
];

/** Parse argv into options. Pure, so it is unit-tested. */
export function parseArgs(argv, env = {}) {
	const opts = {
		accept: false,
		dryRun: false,
		bucket: 'three-ws-model-weights',
		prefix: 'sam3d-objects',
		project: 'aerial-vehicle-466722-p5',
		region: 'us-central1',
		token: env.HF_TOKEN || '',
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--accept-sam-license') opts.accept = true;
		else if (a === '--dry-run') opts.dryRun = true;
		else if (['--bucket', '--prefix', '--project', '--region'].includes(a)) {
			const value = argv[++i];
			if (!value || value.startsWith('--')) throw new Error(`${a} needs a value`);
			opts[a.slice(2)] = value;
		} else throw new Error(`unknown option ${a}`);
	}
	for (const key of ['bucket', 'prefix', 'project', 'region']) {
		if (!/^[a-z0-9][a-z0-9._-]*$/i.test(opts[key])) throw new Error(`--${key} has unexpected characters`);
	}
	return opts;
}

/**
 * Turn the Hugging Face file listing into the copy plan. Only files under
 * checkpoints/ are weights; the plan keeps their relative layout under hf/ and
 * adds the upstream LICENSE. Pure, so it is unit-tested.
 */
export function planCopies(siblings, bucket, prefix) {
	const dest = `gs://${bucket}/${prefix}`;
	const plan = [];
	for (const s of siblings) {
		const path = s.rfilename;
		if (path === 'LICENSE') plan.push({ path, size: s.size || 0, dest: `${dest}/LICENSE` });
		else if (path.startsWith('checkpoints/') && !path.endsWith('.gitattributes'))
			plan.push({ path, size: s.size || 0, dest: `${dest}/hf/${path.slice('checkpoints/'.length)}` });
	}
	if (!plan.some((p) => p.path === 'checkpoints/pipeline.yaml'))
		throw new Error('checkpoints/pipeline.yaml is not in the repository listing; upstream layout changed');
	return plan;
}

function run(cmd, args, options = {}) {
	return spawnSync(cmd, args, { encoding: 'utf8', ...options });
}

async function main() {
	const opts = parseArgs(process.argv.slice(2), process.env);
	console.log(LICENSE_SUMMARY.join('\n') + '\n');
	if (!opts.accept) {
		console.error(
			'Not staging: the SAM License has not been accepted.\n' +
				`1. Read it: ${LICENSE_URL}\n` +
				`2. Request access with your Hugging Face account (manual approval): ${ACCESS_URL}\n` +
				'3. Re-run with --accept-sam-license once you accept it for this account.',
		);
		process.exit(2);
	}
	if (!opts.token) {
		console.error(`HF_TOKEN is not set. Create a read token for the account that was approved for ${REPO} and re-run.`);
		process.exit(2);
	}
	const auth = { Authorization: `Bearer ${opts.token}` };

	const probe = await fetch(`https://huggingface.co/${REPO}/resolve/main/LICENSE`, { headers: auth, redirect: 'follow' });
	if (probe.status === 401 || probe.status === 403) {
		console.error(`The token cannot read ${REPO} (HTTP ${probe.status}). Request access and wait for approval: ${ACCESS_URL}`);
		process.exit(2);
	}
	if (!probe.ok) {
		console.error(`Hugging Face answered HTTP ${probe.status} for ${REPO}. Retry shortly.`);
		process.exit(1);
	}

	const listing = await fetch(`https://huggingface.co/api/models/${REPO}?blobs=true`, { headers: auth });
	if (!listing.ok) {
		console.error(`Could not list ${REPO} (HTTP ${listing.status}).`);
		process.exit(1);
	}
	const plan = planCopies((await listing.json()).siblings || [], opts.bucket, opts.prefix);
	const totalGb = plan.reduce((n, p) => n + p.size, 0) / 2 ** 30;
	console.log(`${plan.length} files, ${totalGb.toFixed(1)} GiB -> gs://${opts.bucket}/${opts.prefix}/`);
	if (opts.dryRun) {
		for (const p of plan) console.log(`would copy ${p.path} -> ${p.dest} (${p.size} bytes)`);
		return;
	}

	const gcloud = run('gcloud', ['--version']);
	if (gcloud.status !== 0) {
		console.error('gcloud is not installed or not on PATH. Install the Google Cloud CLI and run `gcloud auth login`.');
		process.exit(1);
	}

	const repoCheck = run('gcloud', ['artifacts', 'repositories', 'describe', 'model-sam3d-objects', `--location=${opts.region}`, `--project=${opts.project}`]);
	if (repoCheck.status !== 0) {
		console.log('creating Artifact Registry repository model-sam3d-objects');
		const created = run('gcloud', ['artifacts', 'repositories', 'create', 'model-sam3d-objects', '--repository-format=docker', `--location=${opts.region}`, `--project=${opts.project}`], { stdio: 'inherit' });
		if (created.status !== 0) process.exit(1);
	}

	const remoteSize = (uri) => {
		const r = run('gcloud', ['storage', 'objects', 'describe', uri, '--format=value(size)']);
		return r.status === 0 ? r.stdout.trim() : '';
	};
	for (const p of plan) {
		if (p.size && remoteSize(p.dest) === String(p.size)) {
			console.log(`skip  ${p.dest}`);
			continue;
		}
		console.log(`copy  ${p.path} -> ${p.dest} (${p.size} bytes)`);
		const url = `https://huggingface.co/${REPO}/resolve/main/${p.path.split('/').map(encodeURIComponent).join('/')}`;
		const piped = run('bash', ['-o', 'pipefail', '-c', 'curl -fsSL -H "Authorization: Bearer $HF_TOKEN" "$SRC" | gcloud storage cp - "$DEST" --quiet'], {
			stdio: ['ignore', 'inherit', 'inherit'],
			env: { ...process.env, HF_TOKEN: opts.token, SRC: url, DEST: p.dest },
		});
		if (piped.status !== 0) {
			console.error(`FAIL  ${p.dest}: copy exited ${piped.status}`);
			process.exit(1);
		}
		const got = remoteSize(p.dest);
		if (p.size && got !== String(p.size)) {
			console.error(`FAIL  ${p.dest}: expected ${p.size} bytes, bucket has ${got || 'none'}`);
			process.exit(1);
		}
	}

	console.log(
		`\nSAM 3D Objects checkpoints staged at gs://${opts.bucket}/${opts.prefix}/hf/.\n` +
			'Next: build and deploy the worker (needs a 32 GB+ GPU class, see workers/model-sam3d-objects/README.md):\n' +
			'  gcloud builds submit --config workers/model-sam3d-objects/cloudbuild.yaml --substitutions=SHORT_SHA=manual$(date +%s) .\n' +
			'then point the platform at it:\n' +
			'  gcloud run services update three-ws-api --region us-central1 --update-env-vars MODEL_SAM3D_URL=<service url>',
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err.message || err);
		process.exit(1);
	});
}
