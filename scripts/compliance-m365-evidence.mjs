#!/usr/bin/env node
// npm run compliance:m365-evidence [-- --out <dir>] [-- --skip gcloud,db,github]
//
// Collects the machine-producible evidence for the Microsoft 365 Certification
// control matrix (docs/compliance/m365-certification/controls.md) into a dated
// folder OUTSIDE the repository (default ~/.cache/three-ws/m365-evidence/<UTC
// date>). Everything is read-only against production: a dependency audit, TLS
// and security-header scans of https://three.ws, IAM bindings of the runtime
// and build service accounts, the Cloud Run configuration with environment
// variable NAMES only, log retention, the backup bucket and its latest restore
// report, GitHub repository protections, and the admin users with their
// two-step verification status.
//
// Each collector is independent: one that cannot run (no gcloud login, no
// database URL) is recorded in manifest.json as "skipped" or "failed" with the
// reason, and the rest still run. Before the manifest is written every file is
// scanned for credential signatures; a hit deletes nothing but fails the run
// (exit 1) and is named in the manifest, so a folder with a secret in it is
// never mistaken for a clean one.
//
// Exit codes: 0 all collectors ran and the scan is clean, 1 a collector failed
// or the secret scan hit, 2 bad arguments.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
	adminMfaSummary,
	bindingsForMembers,
	evidenceFolderName,
	redactRunService,
	scanForSecrets,
} from './lib/m365-evidence.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'aerial-vehicle-466722-p5';
const REGION = 'us-central1';
const SERVICE = 'three-ws-api';
const SITE = 'three.ws';
const SERVICE_ACCOUNTS = ['serviceAccount:three-ws@', 'serviceAccount:three-ws-build@'];
const REPO = 'nirholas/three.ws';

const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(name);
	return i === -1 ? null : args[i + 1];
};
const skip = new Set((flag('--skip') || '').split(',').filter(Boolean));
const known = new Set(['audit', 'tls', 'headers', 'gcloud', 'db', 'github']);
for (const s of skip) {
	if (!known.has(s)) {
		console.error(`unknown --skip value "${s}" (use: ${[...known].join(', ')})`);
		process.exit(2);
	}
}
const outDir = path.resolve(flag('--out') || path.join(os.homedir(), '.cache', 'three-ws', 'm365-evidence', evidenceFolderName()));
if (outDir === ROOT || outDir.startsWith(ROOT + path.sep)) {
	console.error(`refusing to write evidence inside the repository: ${outDir}`);
	process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const results = [];
const write = (name, data) => {
	const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
	writeFileSync(path.join(outDir, name), body);
	return name;
};

async function collector(id, title, fn) {
	if (skip.has(id)) {
		results.push({ id, title, status: 'skipped', reason: 'excluded with --skip' });
		return;
	}
	try {
		const out = await fn();
		results.push({ id, title, status: out.skipped ? 'skipped' : 'ok', reason: out.skipped, files: out.files ?? [], summary: out.summary });
	} catch (e) {
		results.push({ id, title, status: 'failed', reason: String(e.message || e).split('\n')[0].slice(0, 300), files: [] });
	}
}

async function cmd(file, argv, opts = {}) {
	const { stdout } = await run(file, argv, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout: 180000, ...opts });
	return stdout;
}

const gcloud = (argv) => cmd('gcloud', [...argv, `--project=${PROJECT}`, '--format=json']).then((s) => (s.trim() ? JSON.parse(s) : []));

async function gcloudReady() {
	try {
		const acct = (await cmd('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'])).trim();
		return acct ? null : 'no active gcloud account';
	} catch {
		return 'gcloud is not installed or not logged in';
	}
}

// 1. Dependency audit. Exit code 1 from npm audit means "vulnerabilities found",
// which is evidence, not a failure of the collector.
await collector('audit', 'Dependency audit (npm audit, production and dev)', async () => {
	const files = [];
	let summary = {};
	for (const [label, extra] of [['all', []], ['production', ['--omit=dev']]]) {
		let stdout;
		try {
			stdout = await cmd('npm', ['audit', '--json', ...extra]);
		} catch (e) {
			stdout = e.stdout;
			if (!stdout) throw new Error(`npm audit gave no output: ${e.message}`);
		}
		const report = JSON.parse(stdout);
		files.push(write(`dependency-audit-${label}.json`, report));
		summary[label] = report.metadata?.vulnerabilities ?? report.error ?? {};
	}
	return { files, summary };
});

// 2. TLS: protocol versions accepted, certificate, cipher, compression.
function tlsProbe(version) {
	return new Promise((resolve) => {
		const sock = tls.connect({ host: SITE, port: 443, servername: SITE, minVersion: version, maxVersion: version, timeout: 15000 }, () => {
			resolve({ version, accepted: true, protocol: sock.getProtocol(), cipher: sock.getCipher()?.name });
			sock.end();
		});
		sock.on('error', (e) => resolve({ version, accepted: false, reason: e.code || e.message }));
		sock.on('timeout', () => {
			resolve({ version, accepted: false, reason: 'timeout' });
			sock.destroy();
		});
	});
}

await collector('tls', 'TLS configuration of three.ws', async () => {
	const probes = [];
	for (const v of ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']) probes.push(await tlsProbe(v));
	const cert = await new Promise((resolve, reject) => {
		const sock = tls.connect({ host: SITE, port: 443, servername: SITE }, () => {
			const c = sock.getPeerCertificate();
			resolve({
				subject: c.subject,
				issuer: c.issuer,
				validFrom: c.valid_from,
				validTo: c.valid_to,
				fingerprint256: c.fingerprint256,
				subjectAltName: c.subjectaltname,
				negotiated: sock.getProtocol(),
			});
			sock.end();
		});
		sock.on('error', reject);
	});
	let compression = 'unknown (openssl not available)';
	try {
		const out = await cmd('sh', ['-c', `echo | openssl s_client -connect ${SITE}:443 -servername ${SITE} 2>/dev/null`]);
		compression = /Compression:\s*NONE/i.test(out) ? 'NONE' : (out.match(/Compression:.*/i) || ['not reported'])[0];
	} catch {}
	const head = await fetch(`https://${SITE}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(20000) });
	const hsts = head.headers.get('strict-transport-security');
	const maxAge = Number((hsts || '').match(/max-age=(\d+)/i)?.[1] || 0);
	const report = { host: SITE, probes, certificate: cert, tlsCompression: compression, hsts, hstsMaxAgeDays: Math.floor(maxAge / 86400) };
	const accepted = probes.filter((p) => p.accepted).map((p) => p.version);
	const summary = {
		accepted,
		legacyAccepted: accepted.filter((v) => v === 'TLSv1' || v === 'TLSv1.1'),
		tlsCompression: compression,
		hstsMaxAgeDays: report.hstsMaxAgeDays,
		certificateExpires: cert.validTo,
	};
	return { files: [write('tls-three-ws.json', report)], summary };
});

// 3. Security headers (the repository's own regression check, JSON mode).
await collector('headers', 'HTTP security header scan of production', async () => {
	let stdout;
	try {
		stdout = await cmd('node', ['scripts/audit-security-headers.mjs', '--base', `https://${SITE}`, '--json']);
	} catch (e) {
		stdout = e.stdout;
		if (!stdout) throw e;
	}
	const report = JSON.parse(stdout);
	const failing = (report.results ?? report.responses ?? []).filter((r) => (r.problems ?? []).length || r.loadError).length;
	return { files: [write('security-headers-production.json', report)], summary: { failingResponses: failing } };
});

// 4. Google Cloud: IAM, service accounts and keys, Cloud Run, logging, backups.
await collector('gcloud', 'Google Cloud configuration (IAM, Cloud Run, logging, backups)', async () => {
	const why = await gcloudReady();
	if (why) return { skipped: why };
	const files = [];
	const policy = await gcloud(['projects', 'get-iam-policy', PROJECT]);
	const bindings = bindingsForMembers(policy, SERVICE_ACCOUNTS);
	files.push(write('iam-service-account-bindings.json', bindings));
	const owners = (policy.bindings ?? []).filter((b) => /^roles\/(owner|editor)$/.test(b.role)).map((b) => ({ role: b.role, members: b.members }));
	files.push(write('iam-owner-editor-bindings.json', owners));
	const sas = await gcloud(['iam', 'service-accounts', 'list']);
	files.push(write('service-accounts.json', sas.map((s) => ({ email: s.email, displayName: s.displayName, disabled: Boolean(s.disabled) }))));
	const keys = {};
	for (const sa of sas) {
		const k = await gcloud(['iam', 'service-accounts', 'keys', 'list', `--iam-account=${sa.email}`, '--managed-by=user']);
		if (k.length) keys[sa.email] = k.map((x) => ({ keyId: String(x.name).split('/').pop(), validAfterTime: x.validAfterTime, validBeforeTime: x.validBeforeTime, keyAlgorithm: x.keyAlgorithm }));
	}
	files.push(write('service-account-user-managed-keys.json', keys));
	const svc = await gcloud(['run', 'services', 'describe', SERVICE, `--region=${REGION}`]);
	files.push(write('cloud-run-three-ws-api.json', redactRunService(svc)));
	// Non-secret switches whose absence means "the secure default in code applies".
	const envList = svc?.spec?.template?.spec?.containers?.[0]?.env ?? [];
	const flagsOfInterest = ['ADMIN_MFA_ENFORCE', 'ADMIN_IDLE_TIMEOUT_MIN'];
	const flagValues = Object.fromEntries(flagsOfInterest.map((n) => [n, envList.find((e) => e.name === n)?.value ?? '(not set: code default applies)']));
	files.push(write('runtime-security-flags.json', flagValues));
	const buckets = await gcloud(['logging', 'buckets', 'list']);
	files.push(write('log-buckets.json', buckets.map((b) => ({ name: b.name, retentionDays: b.retentionDays, locked: Boolean(b.locked) }))));
	const sinks = await gcloud(['logging', 'sinks', 'list']);
	files.push(write('log-sinks.json', sinks.map((s) => ({ name: s.name, destination: s.destination, filter: s.filter }))));
	const policies = await gcloud(['alpha', 'monitoring', 'policies', 'list']).catch(() => null);
	if (policies) files.push(write('alert-policies.json', policies.map((p) => ({ displayName: p.displayName, enabled: p.enabled }))));
	const bucket = await gcloud(['storage', 'buckets', 'describe', 'gs://three-ws-db-backups']);
	files.push(
		write('backup-bucket.json', {
			name: bucket.name,
			location: bucket.location,
			retentionPolicy: bucket.retention_policy ?? null,
			lifecycle: bucket.lifecycle_config ?? null,
			softDelete: bucket.soft_delete_policy ?? null,
			publicAccessPrevention: bucket.public_access_prevention ?? null,
			uniformBucketLevelAccess: bucket.uniform_bucket_level_access ?? null,
		}),
	);
	const latest = await cmd('gcloud', ['storage', 'cat', 'gs://three-ws-db-backups/neondb/latest.json', `--project=${PROJECT}`]);
	const report = JSON.parse(latest);
	files.push(write('backup-latest-report.json', report));
	const jobs = await gcloud(['scheduler', 'jobs', 'list', `--location=${REGION}`]);
	const backupJob = jobs.find((j) => /db-backup/.test(j.name));
	files.push(write('backup-scheduler-job.json', backupJob ? { name: backupJob.name, schedule: backupJob.schedule, timeZone: backupJob.timeZone, state: backupJob.state, lastAttemptTime: backupJob.lastAttemptTime } : null));
	return {
		files,
		summary: {
			serviceAccountsWithBindings: Object.keys(bindings).length,
			ownerEditorMembers: owners.flatMap((o) => o.members).length,
			userManagedKeys: Object.values(keys).reduce((n, k) => n + k.length, 0),
			logBuckets: buckets.map((b) => `${String(b.name).split('/').pop()}:${b.retentionDays}d`),
			latestBackupOk: report.ok,
			measuredRtoSeconds: report.measured_rto_seconds ?? null,
		},
	};
});

// 5. Admin users and their two-step verification status (read-only SQL).
await collector('db', 'Admin users and two-step verification status', async () => {
	let url = process.env.DATABASE_URL;
	if (!url) {
		const envFile = path.join(ROOT, '.env.local');
		if (existsSync(envFile)) url = readFileSync(envFile, 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1];
	}
	if (!url) return { skipped: 'DATABASE_URL is not set (env or .env.local)' };
	const { neon } = await import('@neondatabase/serverless');
	const sql = neon(url);
	// Admins are users flagged is_admin plus the wallets named in the
	// ADMIN_ADDRESSES environment variable (public addresses) and the built-in
	// platform-owner address (api/_lib/admin.js). Read the variable from the
	// Cloud Run service when gcloud is available.
	const addresses = new Set(['9MjzHaTB6Jko4YKo9mDzJSaGnktzhbebgsnqPpYWnXC7']);
	if (!(await gcloudReady())) {
		const svc = await gcloud(['run', 'services', 'describe', SERVICE, `--region=${REGION}`]);
		const env = svc?.spec?.template?.spec?.containers?.[0]?.env ?? [];
		for (const a of String(env.find((e) => e.name === 'ADMIN_ADDRESSES')?.value || '').split(',')) if (a.trim()) addresses.add(a.trim());
	}
	const list = [...addresses];
	const rows = await sql`
		select u.id, u.created_at, (m.enabled_at is not null) as mfa_enabled
		from users u
		left join user_mfa m on m.user_id = u.id
		where u.deleted_at is null
		  and (u.is_admin = true
		       or u.wallet_address = any(${list})
		       or exists (select 1 from user_wallets w where w.user_id = u.id and w.address = any(${list})))
		order by u.created_at`;
	const summary = adminMfaSummary(rows);
	return { files: [write('admin-users-mfa.json', summary)], summary: { admins: summary.total, withoutMfa: summary.withoutMfa } };
});

// 6. GitHub repository protections (read-only, through the gh CLI).
await collector('github', 'GitHub repository protection and scanning settings', async () => {
	try {
		await cmd('gh', ['auth', 'status']);
	} catch {
		return { skipped: 'gh is not installed or not logged in' };
	}
	const repo = JSON.parse(await cmd('gh', ['api', `repos/${REPO}`]));
	let protection = { enabled: false };
	try {
		protection = { enabled: true, ...JSON.parse(await cmd('gh', ['api', `repos/${REPO}/branches/main/protection`])) };
	} catch (e) {
		if (!/404|not protected/i.test(`${e.stderr || ''}${e.message}`)) throw e;
	}
	const report = {
		repository: REPO,
		visibility: repo.visibility,
		defaultBranch: repo.default_branch,
		securityAndAnalysis: repo.security_and_analysis,
		branchProtection: protection,
	};
	return {
		files: [write('github-repository-controls.json', report)],
		summary: { branchProtected: protection.enabled, secretScanning: repo.security_and_analysis?.secret_scanning?.status, dependabot: repo.security_and_analysis?.dependabot_security_updates?.status },
	};
});

// Secret scan over everything written so far, then the manifest.
const written = readdirSync(outDir).filter((f) => f !== 'manifest.json' && f !== 'README.txt');
const hits = [];
const hashes = {};
for (const f of written) {
	const body = readFileSync(path.join(outDir, f));
	hashes[f] = createHash('sha256').update(body).digest('hex');
	for (const name of scanForSecrets(body.toString('utf8'))) hits.push({ file: f, pattern: name });
}
const failed = results.filter((r) => r.status === 'failed');
const manifest = {
	generatedAt: new Date().toISOString(),
	project: PROJECT,
	site: SITE,
	readOnly: true,
	collectors: results,
	files: Object.fromEntries(written.map((f) => [f, { bytes: statSync(path.join(outDir, f)).size, sha256: hashes[f] }])),
	secretScan: { clean: hits.length === 0, hits },
};
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
	path.join(outDir, 'README.txt'),
	'Evidence for the Microsoft 365 Certification control matrix (docs/compliance/m365-certification/controls.md).\nGenerated read-only by scripts/compliance-m365-evidence.mjs. Keep outside git. manifest.json lists each collector, its status and the sha256 of every file.\n',
);

for (const r of results) console.log(`${r.status.padEnd(8)} ${r.id.padEnd(8)} ${r.title}${r.reason ? ` (${r.reason})` : ''}`);
console.log(`\n${written.length} file(s) in ${outDir}`);
console.log(hits.length ? `SECRET SCAN HIT: ${hits.map((h) => `${h.file}:${h.pattern}`).join(', ')}` : 'secret scan clean');
process.exit(failed.length || hits.length ? 1 : 0);
