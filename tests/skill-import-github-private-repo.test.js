// The skill importer sends the platform GitHub token to api.github.com. A
// private repo readable by that token must never be imported, because the
// resulting draft bundle is served without a session.
import { describe, it, expect } from 'vitest';
import { discoverGithubSource, GithubDiscoveryError } from '../packages/skill-import/src/github.js';

function fetchFor(repoInfo) {
	const calls = [];
	const fetchUrl = async (url, init) => {
		calls.push(url);
		if (url === 'https://api.github.com/repos/o/r') return Response.json(repoInfo);
		if (url.startsWith('https://raw.githubusercontent.com/')) return new Response('', { status: 404 });
		if (url.endsWith('/readme')) {
			return Response.json({ content: Buffer.from('# secret readme').toString('base64'), encoding: 'base64', html_url: 'https://github.com/o/r' });
		}
		return new Response('', { status: 404 });
	};
	return { fetchUrl, calls };
}

describe('discoverGithubSource private repo guard', () => {
	it('refuses a private repo before reading its README', async () => {
		const { fetchUrl, calls } = fetchFor({ name: 'r', default_branch: 'main', private: true });
		await expect(discoverGithubSource('o/r', { fetchUrl, githubToken: 'tok' })).rejects.toBeInstanceOf(GithubDiscoveryError);
		expect(calls.some((u) => u.endsWith('/readme'))).toBe(false);
	});

	it('still imports a public repo README', async () => {
		const { fetchUrl } = fetchFor({ name: 'r', default_branch: 'main', private: false });
		const out = await discoverGithubSource('o/r', { fetchUrl, githubToken: 'tok' });
		expect(out.kind).toBe('readme');
		expect(out.text).toContain('secret readme');
	});
});
