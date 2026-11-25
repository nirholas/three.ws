import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('../scripts/check-merge-conflicts.mjs', import.meta.url));
const OPEN = '<'.repeat(7);

function sourceTree(t) {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'three-ws-source-build-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(path.join(directory, '.gitignore'), 'node_modules/\ndist/\n');
	writeFileSync(path.join(directory, 'app.js'), 'export const ready = true;\n');
	return directory;
}

function check(directory) {
	return spawnSync(process.execPath, [checker], { cwd: directory, encoding: 'utf8' });
}

test('the source-only Docker context can run the conflict guard without Git metadata', (t) => {
	const result = check(sourceTree(t));
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /no unresolved merge-conflict markers/);
});

test('the source-only guard rejects an unterminated conflict and identifies its line', (t) => {
	const directory = sourceTree(t);
	writeFileSync(path.join(directory, 'app.js'), `export const ready = true;\n${OPEN} unresolved\n`);
	const result = check(directory);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /app\.js\s+\(line 2\)/);
	assert.match(result.stderr, /no closing marker/);
});

test('the source-only guard excludes installed dependencies, output, and binary assets', (t) => {
	const directory = sourceTree(t);
	for (const name of ['node_modules', 'dist']) {
		mkdirSync(path.join(directory, name));
		writeFileSync(path.join(directory, name, 'dependency.js'), `${OPEN} ignored dependency\n`);
	}
	writeFileSync(path.join(directory, 'asset.bin'), Buffer.from(`\0${OPEN} binary\n${OPEN} binary\n`));
	const result = check(directory);
	assert.equal(result.status, 0, result.stderr);
});

test('Git checkouts still inspect tracked source and ignore unrelated untracked files', (t) => {
	const directory = sourceTree(t);
	const init = spawnSync('git', ['init', '-q'], { cwd: directory, encoding: 'utf8' });
	assert.equal(init.status, 0, init.stderr);
	const stage = spawnSync('git', ['add', '--', '.gitignore', 'app.js'], { cwd: directory, encoding: 'utf8' });
	assert.equal(stage.status, 0, stage.stderr);
	writeFileSync(path.join(directory, 'untracked.js'), `${OPEN} unrelated\n`);
	assert.equal(check(directory).status, 0);
	writeFileSync(path.join(directory, 'app.js'), `${OPEN} tracked conflict\n`);
	const result = check(directory);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /app\.js/);
	assert.doesNotMatch(result.stderr, /untracked\.js/);
});

test('the Cloudflare image installs Git before running the guarded build', () => {
	const dockerfile = readFileSync(new URL('../deploy/cloudflare/Dockerfile', import.meta.url), 'utf8');
	const packages = dockerfile.match(/apt-get install[\s\S]*?(?=&&)/)?.[0] || '';
	assert.match(packages, /\bgit\b/);
	assert.ok(dockerfile.indexOf('apt-get install') < dockerfile.indexOf('RUN npm run build:gcp'));
});
