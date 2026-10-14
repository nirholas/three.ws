// pump-claims-github.js
// ---------------------
// GitHub identity and token-metadata lookups for GitHub fee-claim attribution
// (api/_lib/pump-claims-attribution.js, api/_lib/pump-claims.js). Every call
// hits the real GitHub REST API and pump.fun's public coin API; nothing here
// is mocked or cached to disk. Uses the key-optional pattern already used for
// anonymous GitHub reads elsewhere in this codebase (github-trending.js,
// commit-feed-push.js): a token raises the rate limit but is never required.

import { searchPumpTokens } from './pump-search.js';

const GITHUB_API = 'https://api.github.com';
const PUMPFUN_COIN_API = 'https://frontend-api-v3.pump.fun/coins-v2';
const CACHE_TTL_MS = 10 * 60_000;

function githubHeaders() {
	const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (token) headers.authorization = `Bearer ${token}`;
	return headers;
}

const userByIdCache = new Map();
const repoCache = new Map();

function cached(cache, key) {
	const hit = cache.get(key);
	if (!hit) return undefined;
	if (Date.now() > hit.expiresAt) {
		cache.delete(key);
		return undefined;
	}
	return hit.value;
}

function setCached(cache, key, value, ttlMs = CACHE_TTL_MS) {
	cache.set(key, { value, expiresAt: Date.now() + ttlMs });
	if (cache.size > 500) {
		const now = Date.now();
		for (const [k, v] of cache) if (now > v.expiresAt) cache.delete(k);
	}
}

async function githubGet(path) {
	try {
		const resp = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders(), signal: AbortSignal.timeout(8000) });
		if (!resp.ok) return null;
		return await resp.json();
	} catch {
		return null;
	}
}

/**
 * Resolve a numeric GitHub user id to its login and account age. The REST API
 * has no direct "get user by numeric id" route for anonymous callers, so this
 * walks the public user list starting just below the id (the same resolution
 * the owner's pumpfun-github-claims bot uses) and confirms the exact id match.
 * @param {string} userId
 * @returns {Promise<{login:string, createdAt:string}|null>}
 */
export async function resolveGithubUserById(userId) {
	const cacheKey = String(userId);
	const hit = cached(userByIdCache, cacheKey);
	if (hit !== undefined) return hit;

	const numId = Number(userId);
	let result = null;
	if (Number.isInteger(numId) && numId > 0) {
		const since = Math.max(0, numId - 1);
		const list = await githubGet(`/users?since=${since}&per_page=20`);
		const match = Array.isArray(list) ? list.find((u) => Number(u.id) === numId) : null;
		if (match?.login) {
			const profile = await githubGet(`/users/${encodeURIComponent(match.login)}`);
			if (profile) result = { login: String(profile.login), createdAt: String(profile.created_at || '') };
		}
	}
	setCached(userByIdCache, cacheKey, result, result ? CACHE_TTL_MS : 30_000);
	return result;
}

const GITHUB_URL_RE = /https?:\/\/github\.com\/([a-z0-9-]+)\/([a-z0-9._-]+)/gi;

/** Every distinct owner/repo pair named in free text (description, website, socials). */
export function extractGithubRepoRefs(text) {
	const out = [];
	const seen = new Set();
	for (const match of String(text || '').matchAll(GITHUB_URL_RE)) {
		const owner = match[1];
		const repo = match[2].replace(/\.git$/i, '');
		const key = `${owner}/${repo}`.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ owner, repo });
	}
	return out;
}

/**
 * The repository owner and creation date for the first GitHub repo linked in
 * a coin's metadata (description, website, or socials), plus the coin's
 * creator wallet, display name, and USD market cap for the impersonation
 * check. Returns a partial object (all fields optional) rather than null, so
 * a coin with some fields resolvable still contributes evidence.
 * @param {string} mint
 */
export async function resolveCoinGithubContext(mint) {
	let coin;
	try {
		const resp = await fetch(`${PUMPFUN_COIN_API}/${encodeURIComponent(mint)}`, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(7000),
		});
		coin = resp.ok ? await resp.json() : null;
	} catch {
		coin = null;
	}
	if (!coin) return {};

	const text = [coin.description, coin.website, coin.twitter, coin.telegram, coin.metadata_uri]
		.filter(Boolean)
		.join(' ');
	const refs = extractGithubRepoRefs(text);
	const [ref] = refs;
	const out = {
		creatorWallet: coin.creator ? String(coin.creator) : undefined,
		tokenName: coin.name ? String(coin.name) : undefined,
		usdMarketCap: typeof coin.usd_market_cap === 'number' ? coin.usd_market_cap : undefined,
	};
	if (!ref) return out;

	const cacheKey = `${ref.owner}/${ref.repo}`.toLowerCase();
	let repo = cached(repoCache, cacheKey);
	if (repo === undefined) {
		const raw = await githubGet(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`);
		repo = raw ? { owner: String(raw.owner?.login || ref.owner), createdAt: String(raw.created_at || '') } : null;
		setCached(repoCache, cacheKey, repo);
	}
	if (repo) {
		out.repoOwner = repo.owner;
		out.repoCreatedAt = repo.createdAt;
	}
	return out;
}

/**
 * Other coins sharing a name, largest market cap first, for the impersonation
 * copycat check. Excludes the mint being evaluated.
 * @param {string} name
 * @param {string} excludeMint
 */
export async function resolveSameNameTokens(name, excludeMint) {
	if (!name) return [];
	const matches = await searchPumpTokens(name, 10);
	return matches
		.filter((t) => t.mint !== excludeMint && typeof t.usd_market_cap === 'number')
		.map((t) => ({ mint: t.mint, usdMarketCap: t.usd_market_cap }))
		.sort((a, b) => b.usdMarketCap - a.usdMarketCap);
}
