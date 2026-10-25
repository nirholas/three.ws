// GitHub repo -> either an OpenAPI spec (preferred) or a README fallback.
//
// Reads go through the GitHub REST API and raw.githubusercontent.com only
// (never `git clone`/a codeload tarball at runtime): both are plain HTTPS
// GETs the caller's SSRF-guarded `fetchUrl` can validate per request.

import { looksLikeOpenApi } from './openapi.js';

const SPEC_CANDIDATES = [
	'openapi.json',
	'openapi.yaml',
	'openapi.yml',
	'swagger.json',
	'swagger.yaml',
	'docs/openapi.json',
	'docs/openapi.yaml',
	'api/openapi.json',
	'api/openapi.yaml',
	'.well-known/openapi.json',
];

export class GithubDiscoveryError extends Error {}

/** Parse "owner/repo" out of a github.com URL or an "owner/repo" shorthand. */
export function parseGithubRepo(input) {
	const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(input.trim());
	if (shorthand) return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/, '') };
	let url;
	try {
		url = new URL(input);
	} catch {
		throw new GithubDiscoveryError(`not a URL or "owner/repo": ${input}`);
	}
	if (!/github\.com$/i.test(url.hostname)) {
		throw new GithubDiscoveryError(`not a github.com URL: ${input}`);
	}
	const [owner, repo] = url.pathname.split('/').filter(Boolean);
	if (!owner || !repo) throw new GithubDiscoveryError(`could not parse owner/repo from: ${input}`);
	return { owner, repo: repo.replace(/\.git$/, '') };
}

function authHeaders(githubToken) {
	const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'three-ws-skill-import' };
	if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
	return headers;
}

/**
 * @param {string} input github.com URL or "owner/repo"
 * @param {{fetchUrl: typeof fetch, githubToken?: string}} opts
 * @returns {Promise<
 *   | { kind: 'openapi', text: string, sourceUrl: string, repoName: string }
 *   | { kind: 'readme', text: string, sourceUrl: string, repoName: string }
 * >}
 */
export async function discoverGithubSource(input, { fetchUrl, githubToken } = {}) {
	const { owner, repo } = parseGithubRepo(input);
	const headers = authHeaders(githubToken);

	const repoRes = await fetchUrl(`https://api.github.com/repos/${owner}/${repo}`, { headers });
	if (!repoRes.ok) {
		throw new GithubDiscoveryError(`GitHub repo lookup failed: ${repoRes.status} ${owner}/${repo}`);
	}
	const repoInfo = await repoRes.json();
	// The platform token can read private repos, and the imported bundle is
	// served without a session, so only public repos may be imported.
	if (repoInfo.private !== false) {
		throw new GithubDiscoveryError(`${owner}/${repo} is not a public repository`);
	}
	const branch = repoInfo.default_branch || 'main';

	for (const candidate of SPEC_CANDIDATES) {
		const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${candidate}`;
		const res = await fetchUrl(rawUrl, { headers: { 'User-Agent': 'three-ws-skill-import' } });
		if (!res.ok) continue;
		const text = await res.text();
		if (looksLikeOpenApi(text)) {
			return { kind: 'openapi', text, sourceUrl: rawUrl, repoName: repoInfo.name };
		}
	}

	const readmeRes = await fetchUrl(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers });
	if (!readmeRes.ok) {
		throw new GithubDiscoveryError(`no OpenAPI spec and no README for ${owner}/${repo}`);
	}
	const readmeJson = await readmeRes.json();
	const text = Buffer.from(readmeJson.content || '', readmeJson.encoding || 'base64').toString('utf8');
	return {
		kind: 'readme',
		text,
		sourceUrl: readmeJson.html_url || `https://github.com/${owner}/${repo}`,
		repoName: repoInfo.name,
	};
}
