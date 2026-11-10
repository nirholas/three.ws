import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	ensureBinary,
	formatReport,
	sha256Hex,
	summarizeFindings,
	verifyChecksum,
} from '../scripts/audit-secrets-history.mjs';
import { summarizeKnip } from '../scripts/audit-dead-code.mjs';

describe('checksum gate', () => {
	it('accepts a matching digest', () => {
		const buf = Buffer.from('gitleaks');
		expect(() => verifyChecksum(buf, sha256Hex(buf))).not.toThrow();
	});

	it('fails closed on a mismatch', () => {
		expect(() => verifyChecksum(Buffer.from('tampered'), sha256Hex(Buffer.from('gitleaks')))).toThrow(/checksum mismatch/);
	});

	it('never extracts or caches an archive whose checksum is wrong', async () => {
		const cacheDir = mkdtempSync(join(tmpdir(), 'gl-cache-'));
		const prev = process.env.GITLEAKS_BIN;
		delete process.env.GITLEAKS_BIN;
		try {
			await expect(
				ensureBinary({
					cacheDir,
					key: 'test-x',
					pinned: { 'test-x': { file: 'x.tar.gz', sha256: sha256Hex(Buffer.from('expected')) } },
					fetchBytes: async () => Buffer.from('evil bytes'),
				}),
			).rejects.toThrow(/checksum mismatch/);
			expect(existsSync(join(cacheDir, 'gitleaks-8.30.1'))).toBe(false);
		} finally {
			if (prev !== undefined) process.env.GITLEAKS_BIN = prev;
			rmSync(cacheDir, { recursive: true, force: true });
		}
	});
});

describe('redaction', () => {
	it('drops the matched secret from findings and the printed report', () => {
		const secret = 'AKIAIOSFODNN7EXAMPLE9999';
		const raw = [{ RuleID: 'aws-access-token', File: 'a.env', StartLine: 3, Commit: 'abcdef1234567890', Secret: secret, Match: `key=${secret}`, Date: '2026-01-01' }];
		const summary = summarizeFindings(raw);
		const out = JSON.stringify(summary) + formatReport({ findings: summary, commits: 1 });
		expect(out).not.toContain(secret);
		expect(out).toContain('aws-access-token');
		expect(out).toContain('a.env:3');
	});

	it('reports a clean scan without findings', () => {
		expect(formatReport({ findings: [], commits: 12 })).toMatch(/no findings across 12 commits/);
	});
});

describe('end to end against a temp repo', () => {
	const binary = process.env.GITLEAKS_BIN || join(process.cwd(), '.cache', 'gitleaks', 'gitleaks-8.30.1', 'gitleaks');
	const have = existsSync(binary);

	it.skipIf(!have)('flags a leaked key, hides it, and respects the allowlist', async () => {
		const { scanHistory } = await import('../scripts/audit-secrets-history.mjs');
		const repo = mkdtempSync(join(tmpdir(), 'gl-repo-'));
		const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
		try {
			git('init', '-q');
			git('config', 'user.email', 't@example.com');
			git('config', 'user.name', 't');
			const leaked = 'ghp_' + 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5';
			writeFileSync(join(repo, 'leak.txt'), `token=${leaked}\n`);
			git('add', 'leak.txt');
			git('commit', '-qm', 'add leak');
			const config = join(repo, 'cfg.toml');
			writeFileSync(config, '[extend]\nuseDefault = true\n');
			const hit = scanHistory({ binary, repo, config, log: true });
			expect(hit.findings.length).toBeGreaterThan(0);
			expect(JSON.stringify(hit)).not.toContain(leaked);

			writeFileSync(config, `[extend]\nuseDefault = true\n[allowlist]\nregexes = ['''${leaked}''']\n`);
			const clean = scanHistory({ binary, repo, config, log: true });
			expect(clean.findings.length).toBe(0);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

describe('dead-code summary', () => {
	it('counts findings per category', () => {
		const report = { issues: [{ files: [{ name: 'a' }], exports: [{}, {}], dependencies: [{}], devDependencies: [] }, { files: [], exports: [{}] }] };
		expect(summarizeKnip(report)).toEqual({ files: 1, dependencies: 1, devDependencies: 0, exports: 3 });
	});
});
