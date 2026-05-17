// GET /api/seed/github?handle=<user>
//
// Public GitHub footprint connector for the three.ws memory-seeding demo.
// Returns the user's profile, top repos by stars, and an excerpt from the
// top repo's README. The aggregate payload is what the synthesizer turns
// into a markdown memory seed.
//
// Uses @octokit/rest with an optional GITHUB_TOKEN for higher rate limits;
// no auth is required to read the public endpoints we hit, so the demo
// works against unauthenticated GitHub in development.

import { Octokit } from '@octokit/rest';
import { cors, json, method, wrap, error } from '../_lib/http.js';

const HANDLE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

let _octokit = null;
function octokit() {
	if (_octokit) return _octokit;
	const auth = process.env.GITHUB_TOKEN || undefined;
	_octokit = new Octokit({ auth, userAgent: 'three.ws-memory-seed/1.0' });
	return _octokit;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const handle = (url.searchParams.get('handle') || '').trim();
	if (!handle) return error(res, 400, 'invalid_request', 'handle query param required');
	if (!HANDLE_RE.test(handle))
		return error(res, 400, 'invalid_handle', 'GitHub handle has invalid characters');

	const gh = octokit();

	let profile;
	try {
		const r = await gh.request('GET /users/{username}', { username: handle });
		profile = r.data;
	} catch (err) {
		if (err.status === 404)
			return error(res, 404, 'not_found', `no GitHub user named "${handle}"`);
		return error(res, 502, 'upstream_error', `GitHub profile fetch failed: ${err.message}`);
	}

	let repos = [];
	try {
		const r = await gh.request('GET /users/{username}/repos', {
			username: handle,
			sort: 'updated',
			per_page: 100,
			type: 'owner',
		});
		repos = (r.data || [])
			.filter((repo) => !repo.fork)
			.sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
			.slice(0, 10)
			.map((repo) => ({
				name: repo.name,
				description: repo.description || '',
				stars: repo.stargazers_count || 0,
				language: repo.language || null,
				html_url: repo.html_url,
			}));
	} catch (err) {
		// Profile is the primary signal; repo failures don't abort.
		console.warn('[seed/github] repos fetch failed', err.message);
	}

	let topReadmeExcerpt = '';
	for (const repo of repos) {
		try {
			const r = await gh.request('GET /repos/{owner}/{repo}/readme', {
				owner: handle,
				repo: repo.name,
				headers: { accept: 'application/vnd.github.raw+json' },
			});
			// data is a string when accept is raw; fall back to base64 decode otherwise.
			const raw =
				typeof r.data === 'string'
					? r.data
					: Buffer.from(r.data.content || '', 'base64').toString('utf8');
			topReadmeExcerpt = raw.replace(/\r\n/g, '\n').trim().slice(0, 1500);
			break;
		} catch {
			// try next repo
		}
	}

	res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=600');
	return json(res, 200, {
		ok: true,
		handle: profile.login,
		avatar_url: profile.avatar_url || null,
		name: profile.name || null,
		bio: profile.bio || '',
		location: profile.location || null,
		company: profile.company || null,
		blog: profile.blog || null,
		followers: profile.followers ?? 0,
		following: profile.following ?? 0,
		public_repos: profile.public_repos ?? 0,
		created_at: profile.created_at || null,
		top_repos: repos,
		top_readme_excerpt: topReadmeExcerpt,
	});
});
