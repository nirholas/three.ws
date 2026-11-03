import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildReleaseNotes, runWeeklyRelease, weeklyIdentity, deployedSha, otherProjectMatcher, excludeTermsFromEnv } from '../api/_lib/github-release.js';
import { loadXFilter } from '../api/_lib/changelog-push.js';

const e = (over = {}) => ({ date: '2026-11-02', title: 'Parties in play', summary: 'Team up with friends. More detail here.', tags: ['feature'], link: '/play', ...over });
const NOW = new Date('2026-11-03T15:00:12Z');
const SHA = 'a'.repeat(40);

function fakeGithub({ releases = [], existingTag = false, createStatus = 201 } = {}) {
	const calls = [];
	const fetchImpl = vi.fn(async (url, init = {}) => {
		const path = url.replace('https://api.github.com', '');
		const method = init.method || 'GET';
		calls.push({ path, method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
		const reply = (status, body) => ({ status, ok: status < 300, json: async () => body });
		if (path.startsWith('/repos/nirholas/three.ws/releases/tags/')) return existingTag ? reply(200, {}) : reply(404, { message: 'Not Found' });
		if (method === 'GET' && path.startsWith('/repos/nirholas/three.ws/releases?')) return reply(200, releases);
		if (method === 'POST') return createStatus === 201 ? reply(201, { html_url: 'https://github.com/nirholas/three.ws/releases/tag/x' }) : reply(createStatus, { message: 'Validation Failed', errors: [{ code: 'already_exists' }] });
		return reply(500, {});
	});
	return { fetchImpl, calls };
}

describe('buildReleaseNotes', () => {
	const opts = { from: '2026-10-28', to: '2026-11-03', title: 'Week of 2026-11-03' };
	it('keeps window entries, groups by section, and links relative paths', () => {
		const n = buildReleaseNotes([e(), e({ title: 'Old', date: '2026-10-01' }), e({ title: 'Better', tags: ['improvement'] })], opts);
		expect(n.total).toBe(2);
		expect(n.name).toBe('three.ws Week of 2026-11-03');
		expect(n.body).toContain('## New');
		expect(n.body).toContain('## Improved');
		expect(n.body).toContain('[Open](https://three.ws/play)');
		expect(n.body).not.toContain('Old');
	});
	it('applies the X public filter and drops other tickers but keeps $THREE', () => {
		const n = buildReleaseNotes([e({ title: 'Keeps $THREE' }), e({ title: 'Mentions $SYNTHX' }), e({ title: 'Security hardening', tags: ['security'] })], opts);
		expect(n.body).toContain('Keeps $THREE');
		expect(n.body).not.toContain('$SYNTHX');
		expect(n.body).not.toContain('Security hardening');
		expect(n.kept).toBe(1);
	});
	it('drops entries naming a supplied term', () => {
		expect(otherProjectMatcher(['Acme'])(e({ summary: 'works with acme now' }))).toBe(true);
		expect(buildReleaseNotes([e({ summary: 'Integrates Acme.' })], { ...opts, terms: ['Acme'] }).kept).toBe(0);
	});
	it('is the same implementation the script imports', () => {
		const src = execFileSync('grep', ['-c', "api/_lib/github-release.js", 'scripts/github-release.mjs'], { encoding: 'utf8' });
		expect(Number(src)).toBeGreaterThan(0);
		const cron = execFileSync('grep', ['-c', "_lib/github-release.js", 'api/cron/github-release.js'], { encoding: 'utf8' });
		expect(Number(cron)).toBeGreaterThan(0);
	});
});

describe('excludeTermsFromEnv', () => {
	it('splits on commas and newlines, trims, and drops blanks', () => {
		expect(excludeTermsFromEnv(' Alpha Swap, betacoin \n\n,Gamma ')).toEqual(['Alpha Swap', 'betacoin', 'Gamma']);
	});
	it('returns no terms when the variable is unset or empty', () => {
		expect(excludeTermsFromEnv(undefined)).toEqual([]);
		expect(excludeTermsFromEnv('  ')).toEqual([]);
	});
	it('feeds the name matcher so a named project drops out of the notes', () => {
		const n = buildReleaseNotes([e({ title: 'Keeps the forge' }), e({ title: 'Routes through Alpha Swap' })], { from: '2026-10-28', to: '2026-11-03', title: 'Week of 2026-11-03', terms: excludeTermsFromEnv('Alpha Swap') });
		expect(n.body).toContain('Keeps the forge');
		expect(n.body).not.toContain('Alpha Swap');
	});
});

describe('weeklyIdentity', () => {
	it('derives tag and title from the UTC date', () => {
		expect(weeklyIdentity(new Date('2026-11-03T23:59:59Z'))).toEqual({ day: '2026-11-03', tag: 'v2026.11.03', title: 'Week of 2026-11-03' });
	});
});

describe('runWeeklyRelease', () => {
	const filter = loadXFilter();
	it('skips with a clear status when the token is missing', async () => {
		const { fetchImpl } = fakeGithub();
		const r = await runWeeklyRelease({ token: undefined, now: NOW, entries: [e()], fetchImpl });
		expect(r).toMatchObject({ ok: true, skipped: 'missing_token' });
		expect(r.detail).toContain('GITHUB_RELEASE_TOKEN');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
	it('skips when the tag already has a release', async () => {
		const { fetchImpl, calls } = fakeGithub({ existingTag: true });
		const r = await runWeeklyRelease({ token: 't', now: NOW, entries: [e()], fetchImpl, filter });
		expect(r).toMatchObject({ skipped: 'tag_exists', tag: 'v2026.11.03' });
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
	});
	it('windows from the day after the latest v* release, ignoring forge and draft releases', async () => {
		const releases = [
			{ tag_name: 'forge-v0.5.0', published_at: '2026-11-01T10:00:00Z' },
			{ tag_name: 'v2026.10.27', published_at: '2026-10-27T15:00:00Z', draft: true },
			{ tag_name: 'v1.5.2', published_at: '2026-10-20T15:00:00Z' },
			{ tag_name: 'v1.0.0', published_at: '2026-06-01T15:00:00Z' },
		];
		const { fetchImpl, calls } = fakeGithub({ releases });
		const entries = [e({ title: 'Too early', date: '2026-10-20' }), e({ title: 'In window', date: '2026-10-21' }), e({ title: 'Today', date: '2026-11-03' })];
		const r = await runWeeklyRelease({ token: 'tok', now: NOW, entries, sha: SHA, fetchImpl, filter });
		expect(r).toMatchObject({ created: true, tag: 'v2026.11.03', from: '2026-10-21', to: '2026-11-03', since: 'v1.5.2', target: SHA });
		const post = calls.find((c) => c.method === 'POST');
		expect(post.body).toMatchObject({ tag_name: 'v2026.11.03', target_commitish: SHA, name: 'three.ws Week of 2026-11-03' });
		expect(post.body.body).toContain('In window');
		expect(post.body.body).toContain('Today');
		expect(post.body.body).not.toContain('Too early');
		expect(post.headers.Authorization).toBe('Bearer tok');
	});
	it('targets main when no deployed sha is known', async () => {
		const { fetchImpl, calls } = fakeGithub();
		await runWeeklyRelease({ token: 't', now: NOW, entries: [e()], fetchImpl, filter });
		expect(calls.find((c) => c.method === 'POST').body.target_commitish).toBe('main');
	});
	it('skips with no_entries when nothing survives the filter', async () => {
		const { fetchImpl, calls } = fakeGithub();
		const r = await runWeeklyRelease({ token: 't', now: NOW, entries: [e({ tags: ['security'] }), e({ title: 'Mentions $SYNTHX' })], fetchImpl, filter });
		expect(r).toMatchObject({ ok: true, skipped: 'no_entries' });
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
	});
	it('treats a lost tag race as a skip and throws on other GitHub failures', async () => {
		const race = fakeGithub({ createStatus: 422 });
		expect(await runWeeklyRelease({ token: 't', now: NOW, entries: [e()], fetchImpl: race.fetchImpl, filter })).toMatchObject({ skipped: 'tag_race' });
		const bad = vi.fn(async () => ({ status: 401, ok: false, json: async () => ({ message: 'Bad credentials' }) }));
		await expect(runWeeklyRelease({ token: 't', now: NOW, entries: [e()], fetchImpl: bad, filter })).rejects.toThrow(/401/);
	});
});

describe('deployedSha', () => {
	let dir;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'ghrel-'));
	});
	afterEach(() => vi.restoreAllMocks());
	it('reads the commit from dist/build-info.json', () => {
		mkdirSync(join(dir, 'dist'));
		writeFileSync(join(dir, 'dist', 'build-info.json'), JSON.stringify({ commit: SHA }));
		expect(deployedSha({ cwd: dir, env: {} })).toBe(SHA);
	});
	it('falls back to COMMIT_SHA, ignores unknown, else null', () => {
		expect(deployedSha({ cwd: dir, env: { COMMIT_SHA: 'b'.repeat(40) } })).toBe('b'.repeat(40));
		mkdirSync(join(dir, 'dist'));
		writeFileSync(join(dir, 'dist', 'build-info.json'), JSON.stringify({ commit: 'unknown' }));
		expect(deployedSha({ cwd: dir, env: {} })).toBeNull();
	});
});

describe('cron handler', () => {
	it('answers 200 skipped missing_token, 401 without the secret', async () => {
		vi.stubEnv('CRON_SECRET', 'secret');
		vi.stubEnv('GITHUB_RELEASE_TOKEN', '');
		const { default: handler } = await import('../api/cron/github-release.js');
		const run = async (headers) => {
			const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; this.writableEnded = true; } };
			await handler({ method: 'GET', url: '/api/cron/github-release', headers }, res);
			return res;
		};
		const ok = await run({ authorization: 'Bearer secret' });
		expect(ok.statusCode).toBe(200);
		expect(JSON.parse(ok.body)).toMatchObject({ ok: true, skipped: 'missing_token' });
		expect((await run({})).statusCode).toBe(401);
		vi.unstubAllEnvs();
	});
});
