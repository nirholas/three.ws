import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIgnoredDocs, unregisteredDocs } from '../scripts/lib/docs-registry.mjs';

// audit:docs demands a data/pages.json entry for every doc production serves.
// Production builds from a clean git worktree, so a doc git ignores is never
// served and must not be demanded.
let dir;
function repo(files, gitignore) {
	dir = mkdtempSync(join(tmpdir(), 'docs-registry-'));
	mkdirSync(join(dir, 'docs'));
	for (const name of files) writeFileSync(join(dir, 'docs', name), '# Doc\n');
	if (gitignore !== undefined) {
		writeFileSync(join(dir, '.gitignore'), gitignore);
		execFileSync('git', ['init', '-q'], { cwd: dir });
	}
	return dir;
}
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('unregisteredDocs', () => {
	it('flags a served doc with no pages.json entry and skips declared, listed and generated ones', () => {
		const root = repo(['new.md', 'declared.md', 'ALL.md', 'internal.md', 'notes.txt']);
		expect(unregisteredDocs(root, { declaredPages: new Set(['/docs/declared']), skip: new Set(['ALL', 'internal']) })).toEqual(['new']);
	});

	it('skips a doc git ignores, because a clean worktree build never serves it', () => {
		const root = repo(['local-note.md', 'public.md'], 'docs/local-note.md\n');
		expect(gitIgnoredDocs(root)).toEqual(new Set(['docs/local-note.md']));
		expect(unregisteredDocs(root, { declaredPages: new Set() }).sort()).toEqual(['public']);
	});

	it('treats every doc as served outside a git checkout', () => {
		const root = repo(['local-note.md']);
		expect(gitIgnoredDocs(root)).toEqual(new Set());
		expect(unregisteredDocs(root, { declaredPages: new Set() })).toEqual(['local-note']);
	});
});
