// check-rules holds every changed prompts/**/*.md to the 50,000-character
// prompt limit, judged on the whole file in whichever version the mode reads
// (working tree, index, or pushed ref). Machine-written _generated evidence and
// unchanged legacy files are out of scope.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'check-rules.mjs');

let repo;
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const run = (...args) =>
	spawnSync(process.execPath, ['scripts/check-rules.mjs', ...args], { cwd: repo, encoding: 'utf8' });
const write = (rel, body) => {
	mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
	writeFileSync(path.join(repo, rel), body);
};
const prose = (chars) => `# Order\n\n${'word '.repeat(Math.ceil(chars / 5))}\n`;

beforeEach(() => {
	repo = mkdtempSync(path.join(tmpdir(), 'check-rules-size-'));
	git('init', '-q');
	git('config', 'user.email', 'test@example.invalid');
	git('config', 'user.name', 'test');
	mkdirSync(path.join(repo, 'scripts'));
	copyFileSync(SCRIPT, path.join(repo, 'scripts', 'check-rules.mjs'));
	write('prompts/finish/100-order.md', prose(1_000));
	git('add', '.');
	git('commit', '-q', '-m', 'test: seed repository');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('check-rules prompt-size', () => {
	it('fails a changed work order that grows past 50,000 characters', () => {
		write('prompts/finish/100-order.md', prose(50_100));
		const r = run();
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/prompts\/finish\/100-order\.md:1 {2}\[prompt-size\]/);
		expect(r.stderr).toMatch(/reference long source material by repo path/);
	});

	it('passes a changed work order under the limit', () => {
		write('prompts/finish/100-order.md', prose(49_000));
		const r = run();
		expect(r.status).toBe(0);
	});

	it('checks untracked prompt files, and points progress logs at the splitter', () => {
		write('prompts/finish/_context/demo-PROGRESS.md', prose(60_000));
		const r = run();
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/node scripts\/split-progress-log\.mjs prompts\/finish\/_context\/demo-PROGRESS\.md/);
	});

	it('judges the staged version in --staged mode', () => {
		write('prompts/finish/100-order.md', prose(60_000));
		git('add', 'prompts/finish/100-order.md');
		write('prompts/finish/100-order.md', prose(1_000));
		const r = run('--staged');
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/\[prompt-size\]/);
	});

	it('judges the pushed ref in --base mode', () => {
		const baseSha = git('rev-parse', 'HEAD').trim();
		write('prompts/finish/100-order.md', prose(60_000));
		git('commit', '-q', '-am', 'docs(prompts): grow the demo order past the paste limit');
		const r = run('--base', baseSha, '--head', 'HEAD');
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/\[prompt-size\]/);
	});

	it('ignores machine-written _generated evidence and files outside prompts/', () => {
		write('prompts/quality-bar/_generated/report.md', prose(80_000));
		write('docs/big.md', prose(80_000));
		const r = run();
		expect(r.stderr).not.toMatch(/\[prompt-size\]/);
	});

	it('does not fail a deleted prompt file', () => {
		git('rm', '-q', 'prompts/finish/100-order.md');
		const r = run('--staged');
		expect(r.status).toBe(0);
	});
});
