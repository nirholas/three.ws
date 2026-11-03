// The docs audit walks the disk, so a gitignored local export (the root-level
// three-ws-notebooklm*.md bundles) used to be audited as if it were a tracked
// doc and fail the gate with thousands of findings nobody could fix in git.
// dropGitIgnored is the filter that keeps such files out.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { dropGitIgnored } from '../scripts/lib/git-ignored.mjs';

let repo;

beforeAll(() => {
	repo = mkdtempSync(join(tmpdir(), 'git-ignored-'));
	execFileSync('git', ['init', '-q'], { cwd: repo });
	writeFileSync(join(repo, '.gitignore'), '/bundle*.md\nexports/\n');
	mkdirSync(join(repo, 'docs'));
	mkdirSync(join(repo, 'exports'));
	for (const f of ['README.md', 'bundle-part-01.md', 'docs/guide.md', 'exports/vol-1.md']) {
		writeFileSync(join(repo, f), '# x\n');
	}
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('dropGitIgnored', () => {
	it('keeps tracked and untracked-but-not-ignored files and drops ignored ones', () => {
		const kept = dropGitIgnored(repo, ['README.md', 'bundle-part-01.md', 'docs/guide.md', 'exports/vol-1.md']);
		expect(kept).toEqual(['README.md', 'docs/guide.md']);
	});

	it('returns the list unchanged when the directory is not a git checkout', () => {
		const plain = mkdtempSync(join(tmpdir(), 'git-ignored-plain-'));
		try {
			expect(dropGitIgnored(plain, ['a.md', 'b.md'])).toEqual(['a.md', 'b.md']);
		} finally {
			rmSync(plain, { recursive: true, force: true });
		}
	});

	it('handles an empty list without spawning git', () => {
		expect(dropGitIgnored(repo, [])).toEqual([]);
	});
});
