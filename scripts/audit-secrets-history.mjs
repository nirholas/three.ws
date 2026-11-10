#!/usr/bin/env node
/**
 * Full-history secret scan with gitleaks.
 *
 * scripts/check-secrets.mjs guards what is being ADDED (diff scoped, pre-push).
 * This is the other half: it walks every commit already in history, so a key
 * that landed years ago and was "deleted" in a later commit is still found. A
 * leaked key is remedied by rotating it at the provider, never by rewriting
 * history, so the output names the commit, file and rule and never the secret.
 *
 *   npm run audit:secrets-history
 *
 * First use downloads a PINNED gitleaks release into .cache/gitleaks/ and
 * verifies its SHA-256 against the table below before it is ever executed. A
 * mismatch fails closed: nothing is extracted or run. Set GITLEAKS_BIN to use a
 * binary you already trust instead. Exit 1 on any finding the allowlist in
 * .gitleaks.toml does not cover.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const GITLEAKS_VERSION = '8.30.1';
const RELEASE_BASE = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}`;

/** SHA-256 of each release archive, copied from gitleaks_8.30.1_checksums.txt. */
export const PINNED_ARCHIVES = {
	'linux-x64': { file: `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`, sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' },
	'linux-arm64': { file: `gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`, sha256: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080' },
	'darwin-x64': { file: `gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz`, sha256: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709' },
	'darwin-arm64': { file: `gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`, sha256: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5' },
};

export function sha256Hex(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

/** Throws unless `buffer` hashes to `expected`. Fails closed. */
export function verifyChecksum(buffer, expected, label = 'archive') {
	const actual = sha256Hex(buffer);
	if (actual !== String(expected).toLowerCase()) {
		throw new Error(`checksum mismatch for ${label}: expected ${expected}, got ${actual}. Refusing to run it.`);
	}
}

export function platformKey(platform = process.platform, arch = process.arch) {
	return `${platform}-${arch}`;
}

/**
 * Return the path of a trusted gitleaks binary, downloading the pinned release
 * on first use. `fetchBytes(url)` is injectable so the checksum gate is testable.
 */
export async function ensureBinary({
	cacheDir = join(ROOT, '.cache', 'gitleaks'),
	fetchBytes = async (url) => {
		const res = await fetch(url, { redirect: 'follow' });
		if (!res.ok) throw new Error(`download failed (HTTP ${res.status}): ${url}`);
		return Buffer.from(await res.arrayBuffer());
	},
	key = platformKey(),
	pinned = PINNED_ARCHIVES,
} = {}) {
	if (process.env.GITLEAKS_BIN) return process.env.GITLEAKS_BIN;
	const entry = pinned[key];
	if (!entry) throw new Error(`no pinned gitleaks build for ${key}; set GITLEAKS_BIN to a binary you trust`);
	const bin = join(cacheDir, `gitleaks-${GITLEAKS_VERSION}`, 'gitleaks');
	if (existsSync(bin)) return bin;

	const bytes = await fetchBytes(`${RELEASE_BASE}/${entry.file}`);
	verifyChecksum(bytes, entry.sha256, entry.file);

	const dir = dirname(bin);
	mkdirSync(dir, { recursive: true });
	const archive = join(dir, entry.file);
	writeFileSync(archive, bytes);
	execFileSync('tar', ['-xzf', archive, '-C', dir, 'gitleaks']);
	rmSync(archive);
	chmodSync(bin, 0o755);
	return bin;
}

/**
 * Reduce raw gitleaks findings to what is safe to print. The matched text is
 * dropped entirely, not just masked: --redact already hides it in gitleaks'
 * own output, and this keeps a future flag change from leaking it here.
 */
export function summarizeFindings(findings) {
	return (findings || []).map((f) => ({
		rule: f.RuleID,
		file: f.File,
		line: f.StartLine,
		commit: f.Commit,
		author: f.Author,
		date: f.Date,
		fingerprint: f.Fingerprint,
	}));
}

/** Run gitleaks over every commit reachable from the repo's refs. */
export function scanHistory({ binary, repo = ROOT, config = join(ROOT, '.gitleaks.toml'), log = false } = {}) {
	const work = mkdtempSync(join(tmpdir(), 'gitleaks-'));
	const reportPath = join(work, 'report.json');
	try {
		const args = [
			'detect', '--source', repo, '--redact', '--no-banner',
			'--report-format', 'json', '--report-path', reportPath,
			'--exit-code', '0',
		];
		if (existsSync(config)) args.push('--config', config);
		if (log) args.push('--log-opts', '--all');
		const run = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
		if (run.error) throw run.error;
		if (run.status !== 0) {
			const tail = String(run.stderr || '').split('\n').slice(-6).join('\n');
			throw new Error(`gitleaks exited ${run.status}:\n${tail}`);
		}
		const findings = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8') || '[]') : [];
		let commits = null;
		try {
			commits = Number(execFileSync('git', ['-C', repo, 'rev-list', '--all', '--count'], { encoding: 'utf8' }).trim()) || null;
		} catch {
			commits = null;
		}
		return { findings: summarizeFindings(findings), commits };
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

export function formatReport({ findings, commits }) {
	if (!findings.length) {
		return `secrets-history: no findings${commits ? ` across ${commits} commits` : ''}.`;
	}
	const lines = [`secrets-history: ${findings.length} finding(s). Rotate the credential at its provider; do not rewrite history.`];
	for (const f of findings) {
		lines.push(`  ${f.rule}  ${f.file}:${f.line}  commit ${String(f.commit).slice(0, 12)}  ${f.date}`);
	}
	return lines.join('\n');
}

async function main() {
	const binary = await ensureBinary();
	const result = scanHistory({ binary, log: true });
	console.log(formatReport(result));
	process.exit(result.findings.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(`secrets-history: ${err.message}`);
		process.exit(2);
	});
}
