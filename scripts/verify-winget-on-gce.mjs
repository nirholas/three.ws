#!/usr/bin/env node
// Prove the ThreeWs.Agent winget manifests install a working three-ws-agent on
// real Windows: create a short-lived Windows Server VM on GCE, let
// scripts/verify-winget-on-gce.ps1 install winget if needed, run
// `winget validate` and `winget install --manifest`, then run the installed
// three-ws-agent (--version, --help, sessions, and with a short-lived key the
// production `whoami` and `doctor`), uninstall it, and report. The VM is always
// deleted and the key always revoked, success or not.
//
//   node scripts/verify-winget-on-gce.mjs --manifests <dir> [--log <file>]
//       [--zone us-central1-a] [--machine-type e2-standard-4]
//       [--image-family windows-2025] [--timeout-min 50] [--no-key]
//
// <dir> holds the three ThreeWs.Agent*.yaml files, e.g.
// distributions/winget/manifests/t/ThreeWs/Agent/<version>. winget downloads
// the installers from the URLs in them, so they must already be public.
//
// The production key belongs to the QA account (AUDIT_EMAIL / AUDIT_PASSWORD
// in .env), is read-only plus inference, expires in two hours and is revoked
// when the run ends. GCE has no Windows on Arm machines, so this runs the x64
// installer; the arm64 build is checked structurally by build-windows.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
	options: {
		manifests: { type: 'string' },
		log: { type: 'string' },
		zone: { type: 'string', default: 'us-central1-a' },
		'machine-type': { type: 'string', default: 'e2-standard-4' },
		'image-family': { type: 'string', default: 'windows-2025' },
		project: { type: 'string', default: process.env.GCP_PROJECT || 'aerial-vehicle-466722-p5' },
		origin: { type: 'string', default: 'https://three.ws' },
		'timeout-min': { type: 'string', default: '50' },
		'no-key': { type: 'boolean', default: false },
	},
});
if (!values.manifests) throw new Error('--manifests <dir> is required');
const manifestDir = resolve(values.manifests);
const files = readdirSync(manifestDir).filter((f) => /^ThreeWs\.Agent.*\.yaml$/.test(f));
if (files.length !== 3) throw new Error(`${manifestDir} should hold the 3 ThreeWs.Agent manifests, found ${files.length}`);

const transcript = [];
const log = (m) => {
	const line = `[verify-winget] ${m}`;
	transcript.push(line);
	console.log(line);
};
const gcloud = (args, opts = {}) =>
	execFileSync('gcloud', [...args, `--project=${values.project}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const origin = values.origin.replace(/\/+$/, '');
const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'verify-winget-'));
const vm = `winget-verify-${Date.now().toString(36)}`;

/** A short-lived key for the QA account, minted the same way the dashboard does. */
async function mintKey() {
	if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
	const { AUDIT_EMAIL: email, AUDIT_PASSWORD: password } = process.env;
	if (!email || !password) throw new Error('AUDIT_EMAIL / AUDIT_PASSWORD are not set (see .env); pass --no-key to skip the production checks');
	const login = await fetch(`${origin}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	if (!login.ok) throw new Error(`QA login answered ${login.status}: ${(await login.text()).slice(0, 200)}`);
	const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
	const csrf = await fetch(`${origin}/api/csrf-token`, { headers: { cookie } });
	if (!csrf.ok) throw new Error(`csrf-token answered ${csrf.status}`);
	const { token } = await csrf.json();
	const res = await fetch(`${origin}/api/api-keys`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': token },
		body: JSON.stringify({
			name: `winget verify ${vm}`,
			scope: 'profile agents:read memory:read wallet:read inference',
			expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
		}),
	});
	if (!res.ok) throw new Error(`api-keys answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const { data } = await res.json();
	return { id: data.id, token: data.token };
}

async function revokeKey(key) {
	const res = await fetch(`${origin}/api/api-keys/${key.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${key.token}` } });
	if (!res.ok) throw new Error(`revoking key ${key.id} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
	log(`revoked the short-lived key ${key.id}`);
}

/**
 * Follow serial port 1 until the startup script reports DONE. Each poll reads
 * the whole serial buffer and takes the THREEWS lines it has not reported yet:
 * a byte offset passed through --start drifts from the real stream (gcloud
 * rewrites the text it returns), which silently stalled the follower mid-run.
 */
async function followSerial(deadline) {
	let seen = 0;
	const results = new Map();
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 20_000));
		let out;
		try {
			out = execFileSync('gcloud', ['compute', 'instances', 'get-serial-port-output', vm, `--zone=${values.zone}`, '--port=1', `--project=${values.project}`], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
				maxBuffer: 64 * 1024 * 1024,
			});
		} catch (err) {
			// Serial output is unavailable for the first seconds of boot.
			if (/not ready|not found|unavailable/i.test(String(err.stderr))) continue;
			throw err;
		}
		const lines = out.split(/\r?\n/).filter((l) => l.includes('THREEWS|'));
		for (const raw of lines.slice(seen)) {
			const i = raw.indexOf('THREEWS|');
			const [, kind, step, ...rest] = raw.slice(i).split('|');
			const text = rest.join('|');
			log(`${kind.padEnd(4)} ${step}: ${text}`);
			if (kind === 'EXIT') results.set(step, Number(text));
			if (kind === 'DONE') return { summary: text, results };
		}
		seen = lines.length;
	}
	throw new Error(`timed out after ${values['timeout-min']} minutes waiting for the VM to finish`);
}

let key = null;
let created = false;
let outcome = null;
try {
	const manifests = Object.fromEntries(files.map((f) => [f, readFileSync(join(manifestDir, f), 'utf8')]));
	for (const f of files) log(`manifest ${basename(f)}`);
	for (const m of manifests['ThreeWs.Agent.installer.yaml'].matchAll(/InstallerUrl: (\S+)/g)) log(`installer ${m[1]}`);
	writeFileSync(join(tmp, 'manifests.json'), JSON.stringify(manifests));
	writeFileSync(join(tmp, 'origin.txt'), origin);
	const meta = [`windows-startup-script-ps1=${join(root, 'scripts', 'verify-winget-on-gce.ps1')}`, `winget-manifests=${join(tmp, 'manifests.json')}`, `three-ws-origin=${join(tmp, 'origin.txt')}`];
	if (!values['no-key']) {
		key = await mintKey();
		log(`minted short-lived key ${key.id} for the QA account (read scopes + inference, expires in 2h)`);
		writeFileSync(join(tmp, 'key.txt'), key.token, { mode: 0o600 });
		meta.push(`three-ws-api-key=${join(tmp, 'key.txt')}`);
	}

	log(`creating ${vm} (${values['image-family']}, ${values['machine-type']}, ${values.zone})`);
	gcloud([
		'compute', 'instances', 'create', vm,
		`--zone=${values.zone}`,
		`--machine-type=${values['machine-type']}`,
		`--image-family=${values['image-family']}`,
		'--image-project=windows-cloud',
		'--boot-disk-size=64GB',
		'--boot-disk-type=pd-balanced',
		'--no-service-account',
		'--no-scopes',
		'--labels=purpose=winget-verify',
		`--metadata-from-file=${meta.join(',')}`,
	]);
	created = true;
	log(`${vm} is booting; following serial port 1`);
	outcome = await followSerial(Date.now() + Number(values['timeout-min']) * 60_000);
} finally {
	if (created) {
		try {
			gcloud(['compute', 'instances', 'delete', vm, `--zone=${values.zone}`, '--quiet']);
			log(`deleted ${vm}`);
		} catch (err) {
			log(`DELETE FAILED for ${vm}: ${String(err.stderr || err.message).trim()}  Delete it by hand: gcloud compute instances delete ${vm} --zone=${values.zone}`);
			process.exitCode = 1;
		}
	}
	if (key) {
		try {
			await revokeKey(key);
		} catch (err) {
			log(`REVOKE FAILED: ${err.message}. Revoke key ${key.id} at ${origin}/settings/api-keys`);
			process.exitCode = 1;
		}
	}
	rmSync(tmp, { recursive: true, force: true });
	if (values.log) writeFileSync(resolve(values.log), `${transcript.join('\n')}\n`);
}

log(`summary: ${outcome.summary}`);
if (outcome.summary !== 'ok') process.exitCode = 1;
