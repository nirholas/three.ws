// Tests for the deploy-worktree reclaimer's pure decision logic
// (scripts/clean-deploy-worktrees.mjs).
//
// The script deletes directories, so the two functions that decide WHAT gets
// deleted are the ones worth pinning: the porcelain parser that identifies a
// detached scratch worktree, and the dirty-file counter that vetoes removal.
// A parser bug here loses uncommitted work, which is the one thing in a deploy
// worktree that cannot be regenerated.

import { describe, it, expect } from 'vitest';
import { parseWorktrees, dirtyCount } from '../scripts/clean-deploy-worktrees.mjs';

describe('parseWorktrees', () => {
	it('separates the main worktree from detached deploy scratch trees', () => {
		const porcelain = [
			'worktree /workspaces/three.ws',
			'HEAD 87e5c4cf5e577c9d7a36740b0ee22d16ea2ee43b',
			'branch refs/heads/main',
			'',
			'worktree /workspaces/.deploy-wt',
			'HEAD d7d9035d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			'detached',
			'',
		].join('\n');
		const wts = parseWorktrees(porcelain);
		expect(wts).toHaveLength(2);
		expect(wts[0].path).toBe('/workspaces/three.ws');
		expect(wts[0].branch).toBe('refs/heads/main');
		expect(wts[0].detached).toBe(false);
		expect(wts[1].path).toBe('/workspaces/.deploy-wt');
		expect(wts[1].detached).toBe(true);
		expect(wts[1].branch).toBe(null);
	});

	it('reads a bare repository entry without inventing a branch', () => {
		const wts = parseWorktrees('worktree /srv/repo.git\nbare\n');
		expect(wts).toHaveLength(1);
		expect(wts[0].bare).toBe(true);
		expect(wts[0].head).toBe(null);
	});

	it('returns nothing for empty input rather than a phantom entry', () => {
		expect(parseWorktrees('')).toEqual([]);
		expect(parseWorktrees('\n\n')).toEqual([]);
	});

	it('ignores stray lines that precede the first worktree header', () => {
		const wts = parseWorktrees('garbage\nHEAD abc\nworktree /a\ndetached\n');
		expect(wts).toHaveLength(1);
		expect(wts[0].path).toBe('/a');
	});
});

describe('dirtyCount', () => {
	it('counts tracked modifications outside the generated set, which veto removal', () => {
		expect(dirtyCount(' M src/agent.js\n M api/pump.js\n')).toBe(2);
	});

	it('ignores the tracked files every build rewrites in place', () => {
		// build:pages injects og:image/twitter:image into every pages/*.html and
		// regenerates these index and feed JSONs on every run, so a worktree that
		// merely finished a build is dirty with nothing but regenerable output.
		// Counting it as work made three worktrees holding 11.3 GB unreclaimable.
		const porcelain = [
			' M pages/wardrobe.html',
			' M public/changelog.json',
			' M public/changelog-recent.json',
			' M public/features.json',
			' M data/examples.json',
			' M public/examples.json',
			' M public/atlas-index.json',
			' M public/mcp-catalog.json',
			' M public/locales/localized-pages.json',
			'MM CHANGELOG.md',
		].join('\n');
		expect(dirtyCount(porcelain)).toBe(0);
	});

	it('still vetoes a deletion or rename of a generated file', () => {
		// Only an in-place rewrite is generator output. Removing or renaming one
		// is a deliberate act no build performs, so it stays real work.
		expect(dirtyCount(' D public/features.json\nR  pages/a.html -> pages/b.html\n')).toBe(2);
	});

	it('does not extend the generated set to neighbouring paths', () => {
		expect(dirtyCount(' M pages/sub/dir.html\n M public/changelog.js\n M data/pages.json\n')).toBe(3);
	});

	it('counts staged and deleted files too', () => {
		expect(dirtyCount('A  new.js\n D gone.js\nR  a.js -> b.js\n')).toBe(3);
	});

	it('ignores the untracked node_modules the deploy runbook hardlinks in', () => {
		// Staging a worktree hardlinks node_modules, chat/node_modules and
		// character-studio/build into it. None of that is work, and treating it
		// as work would make every correctly-staged worktree unreclaimable.
		const porcelain = [
			'?? node_modules/',
			'?? chat/node_modules/',
			'?? character-studio/build/',
			'?? dist/',
		].join('\n');
		expect(dirtyCount(porcelain)).toBe(0);
	});

	it('still counts untracked files that are real work', () => {
		expect(dirtyCount('?? scripts/my-new-script.mjs\n?? node_modules/\n')).toBe(1);
	});

	it('does not mistake a path merely containing "dist" for build output', () => {
		expect(dirtyCount('?? src/distance-field.js\n')).toBe(1);
	});

	it('reads empty porcelain as clean', () => {
		expect(dirtyCount('')).toBe(0);
	});
});
