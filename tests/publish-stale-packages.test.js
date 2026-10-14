import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	isIgnorableFile,
	commitsSince,
	classify,
	latestPublishedVersion,
} from '../scripts/lib/stale-packages.mjs';

// Recorded `npm view @three-ws/avatar-agent time --json`, measured 2026-10-08
// (see prompts/finish/_context/integrate-00-CONTEXT.md). Real package, real
// dates: the gap this fixture documents (1.2.3 published 2026-09-11, while
// commit 63be75388 landed in packages/avatar-agent-mcp on 2026-09-22) is the
// bug this whole order exists to catch.
const AVATAR_AGENT_TIME = {
	modified: '2026-09-11T17:14:12.992Z',
	'1.0.0': '2026-05-22T01:15:01.095Z',
	'1.0.1': '2026-05-22T01:24:54.060Z',
	'1.0.2': '2026-05-22T01:36:47.103Z',
	'1.0.3': '2026-05-22T10:09:00.665Z',
	'1.2.0': '2026-06-13T07:52:02.817Z',
	'1.2.1': '2026-07-04T22:24:23.210Z',
	'1.2.2': '2026-07-12T03:51:30.427Z',
	'1.2.3': '2026-09-11T17:14:12.857Z',
};

describe('isIgnorableFile', () => {
	it('ignores README and CHANGELOG at any depth', () => {
		expect(isIgnorableFile('packages/foo/README.md')).toBe(true);
		expect(isIgnorableFile('packages/foo/docs/CHANGELOG.md')).toBe(true);
	});

	it('ignores test files and test directories', () => {
		expect(isIgnorableFile('packages/foo/src/thing.test.js')).toBe(true);
		expect(isIgnorableFile('packages/foo/tests/thing.js')).toBe(true);
		expect(isIgnorableFile('packages/foo/test/thing.mjs')).toBe(true);
	});

	it('counts real source changes', () => {
		expect(isIgnorableFile('packages/foo/src/index.js')).toBe(false);
		expect(isIgnorableFile('packages/foo/package.json')).toBe(false);
	});
});

describe('latestPublishedVersion', () => {
	it('reads the last non-meta key as the latest publish', () => {
		expect(latestPublishedVersion(AVATAR_AGENT_TIME)).toBe('1.2.3');
	});
});

describe('classify', () => {
	const base = { name: '@three-ws/avatar-agent', dir: 'packages/avatar-agent-mcp', localVersion: '1.2.3' };

	it('is stale when the local version is published and source commits exist after it', () => {
		const row = classify({
			...base,
			npmTime: AVATAR_AGENT_TIME,
			commits: [{ hash: '63be75388', subject: 'feat(mcp-packages): preview-before-spend tools' }],
		});
		expect(row.status).toBe('stale');
		expect(row.commits).toBe(1);
		expect(row.publishedAt).toBe('2026-09-11T17:14:12.857Z');
		expect(row.newestCommitSubject).toMatch(/preview-before-spend/);
	});

	it('is ok when the local version is published and nothing moved after it', () => {
		const row = classify({ ...base, npmTime: AVATAR_AGENT_TIME, commits: [] });
		expect(row.status).toBe('ok');
	});

	it('is unpublished when the local version is not in the registry time map', () => {
		const row = classify({ ...base, localVersion: '9.9.9', npmTime: AVATAR_AGENT_TIME, commits: [] });
		expect(row.status).toBe('unpublished');
	});

	it('is unpublished when npm has never heard of the package (404)', () => {
		const row = classify({ ...base, npmTime: null, commits: [] });
		expect(row.status).toBe('unpublished');
	});

	it('is unreadable when the registry lookup 403s', () => {
		const row = classify({ ...base, npmTime: 'unreadable', commits: [] });
		expect(row.status).toBe('unreadable');
	});
});

describe('commitsSince against a real temporary git repo', () => {
	let repo;
	let publishedAt;

	beforeAll(() => {
		repo = mkdtempSync(join(tmpdir(), 'stale-packages-'));
		const run = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
		run(['init', '-q']);
		run(['config', 'user.email', 't@t']);
		run(['config', 'user.name', 't']);

		mkdirSync(join(repo, 'packages', 'widget', 'src'), { recursive: true });
		mkdirSync(join(repo, 'packages', 'widget', 'tests'), { recursive: true });

		// Running git this fast can land every commit in the same wall-clock
		// second, which would make the "exclusive of the publish instant"
		// boundary in commitsSince ambiguous. Space commits 10 minutes apart by
		// explicit author/committer date so the ordering is unambiguous.
		let clock = Date.parse('2026-09-01T00:00:00Z');
		const commit = (file, content, message) => {
			writeFileSync(join(repo, file), content);
			run(['add', file]);
			const at = new Date(clock).toISOString();
			clock += 10 * 60 * 1000;
			execFileSync('git', ['commit', '-q', '-m', message], {
				cwd: repo,
				encoding: 'utf8',
				env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
			});
		};

		// Published here: nothing after this point should count unless it is a
		// real source change.
		commit('packages/widget/package.json', '{"name":"widget","version":"1.0.0"}\n', 'publish 1.0.0');
		publishedAt = run(['log', '-1', '--format=%cI']).trim();

		commit('packages/widget/README.md', '# widget\nupdated docs\n', 'docs: refresh README');
		commit('packages/widget/tests/widget.test.js', 'test();\n', 'test: add coverage');
		commit('packages/widget/src/index.js', 'export const widget = 1;\n', 'feat: real behavior change');
	});

	afterAll(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	it('counts only the commit that touched real source', () => {
		const commits = commitsSince('packages/widget', publishedAt, { cwd: repo });
		expect(commits).toHaveLength(1);
		expect(commits[0].subject).toBe('feat: real behavior change');
	});

	it('finds nothing before any commit landed', () => {
		const future = new Date(Date.now() + 86400000).toISOString();
		const commits = commitsSince('packages/widget', future, { cwd: repo });
		expect(commits).toHaveLength(0);
	});
});
