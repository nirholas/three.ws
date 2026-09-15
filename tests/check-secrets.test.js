import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function scannerRepo() {
	const root = mkdtempSync(join(tmpdir(), 'threews-secret-scan-'));
	mkdirSync(join(root, 'scripts'));
	copyFileSync(join(REPO, 'scripts', 'check-secrets.mjs'), join(root, 'scripts', 'check-secrets.mjs'));
	writeFileSync(join(root, 'README.md'), '# scanner fixture\n');
	execFileSync('git', ['init', '-q'], { cwd: root });
	execFileSync('git', ['config', 'user.email', 'scanner@example.invalid'], { cwd: root });
	execFileSync('git', ['config', 'user.name', 'Scanner Test'], { cwd: root });
	execFileSync('git', ['add', 'README.md', 'scripts/check-secrets.mjs'], { cwd: root });
	execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
	return root;
}

function scanAddedLine(line) {
	const root = scannerRepo();
	writeFileSync(join(root, 'leak.txt'), `${line}\n`);
	return spawnSync('node', ['scripts/check-secrets.mjs'], {
		cwd: root,
		encoding: 'utf8',
	});
}

describe('credential leak guard', () => {
	it.each([
		['Cloudflare legacy token', `cfat_${'Ab7_'.repeat(12)}`, 'provider-api-key'],
		['Cloudflare current token', `cfut_${'Xy9_'.repeat(12)}`, 'provider-api-key'],
		['GitHub fine-grained token', `github_pat_${'Az7_'.repeat(18)}`, 'provider-api-key'],
		['npm automation token', `npm_${'Q7wE'.repeat(9)}`, 'provider-api-key'],
		['R2 access key id', `Access Key ID: ${'9f4e8d2c7b6a1053'.repeat(2)}`, 'r2-access-key'],
		['R2 secret access key', `Secret Access Key: ${'9f4e8d2c7b6a1053'.repeat(4)}`, 'r2-secret-key'],
	])('rejects a %s', (_label, line, finding) => {
		const result = scanAddedLine(line);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(`[${finding}]`);
	});

	it('allows documented placeholders', () => {
		const result = scanAddedLine('S3_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY');
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('OK');
	});
});
