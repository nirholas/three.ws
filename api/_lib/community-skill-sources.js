// External community skill sources: public GitHub skill repositories an
// operator has chosen to trust, pinned to a commit, merged into the community
// skills API as a clearly separate "external" set.
//
// Trust model (the design constraint, not an afterthought):
//   - the list lives in runtime config (COMMUNITY_SKILL_SOURCES), never in code
//   - every source is pinned to a full commit sha; a branch name is rejected, so
//     the bytes behind a listing cannot change under a reader
//   - a skill is untrusted input. It is listed and previewable, never enabled
//     on an agent by this module. Importing is an explicit owner action that
//     goes through the scan and approval flow in skill-import-store.js
//   - a source that fails (404, timeout, rate limit) is logged and skipped; it
//     can never take the in-repo registry down, because the in-repo registry is
//     not read here
//
// COMMUNITY_SKILL_SOURCES is a JSON array:
//   [{ "repo": "owner/name", "ref": "<40-hex commit sha>", "path": "skills", "license": "<SPDX id>" }]

import { createHash } from 'node:crypto';
import { LIMITS, parseSkillMarkdown, estimateTokens } from '../../community-skills/tools/registry.mjs';

export const TTL_MS = 5 * 60 * 1000;
export const FAILURE_TTL_MS = 60 * 1000;
export const MAX_SKILLS_PER_SOURCE = 100;
export const FETCH_TIMEOUT_MS = 8000;
const CONCURRENCY = 6;

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SPDX_RE = /^[A-Za-z0-9.+-]{2,40}$/;

const defaultLog = (msg) => console.warn(`[community-skill-sources] ${msg}`);

/**
 * Parse and validate the env value. Returns { sources, problems }; an unset or
 * empty value is { sources: [], problems: [] }. An invalid entry is dropped
 * with a reason, never repaired.
 */
export function parseSources(raw) {
	const text = String(raw ?? '').trim();
	if (!text) return { sources: [], problems: [] };
	let list;
	try {
		list = JSON.parse(text);
	} catch (err) {
		return { sources: [], problems: [`COMMUNITY_SKILL_SOURCES is not valid JSON: ${err.message}`] };
	}
	if (!Array.isArray(list)) return { sources: [], problems: ['COMMUNITY_SKILL_SOURCES must be a JSON array'] };
	const sources = [];
	const problems = [];
	const seen = new Set();
	list.forEach((item, i) => {
		const at = `COMMUNITY_SKILL_SOURCES[${i}]`;
		if (!item || typeof item !== 'object') return problems.push(`${at} must be an object`);
		const { repo, ref, license } = item;
		const path = item.path === undefined ? 'skills' : item.path;
		if (typeof repo !== 'string' || !REPO_RE.test(repo)) return problems.push(`${at}.repo must be "owner/name"`);
		if (typeof ref !== 'string' || !SHA_RE.test(ref)) return problems.push(`${at}.ref must be a full 40-character commit sha (a branch or tag is not pinned)`);
		if (typeof license !== 'string' || !SPDX_RE.test(license)) return problems.push(`${at}.license must be an SPDX id such as "MIT"`);
		const parts = typeof path === 'string' ? path.split('/').filter(Boolean) : null;
		if (!parts || parts.some((p) => p === '.' || p === '..' || !/^[A-Za-z0-9._-]+$/.test(p))) {
			return problems.push(`${at}.path must be a plain relative directory`);
		}
		const key = `${repo.toLowerCase()}@${ref}/${parts.join('/')}`;
		if (seen.has(key)) return problems.push(`${at} duplicates an earlier source`);
		seen.add(key);
		sources.push({ repo, ref, path: parts.join('/'), license });
	});
	return { sources, problems };
}

function titleCase(slug) {
	return slug
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

function parseTags(value) {
	if (typeof value !== 'string') return ['external'];
	const tags = value
		.replace(/^\[|\]$/g, '')
		.split(',')
		.map((t) => t.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
		.filter((t) => TAG_RE.test(t) && t.length <= LIMITS.tagMax);
	const unique = [...new Set(tags)].slice(0, LIMITS.tagsMax);
	return unique.length ? unique : ['external'];
}

/**
 * Apply the registry's SKILL.md rules to one fetched file. Returns
 * { entry } or { reason }. The metadata.json requirement is replaced by
 * values derived from the source (author = repository owner, license = the
 * operator-declared SPDX id); the SKILL.md rules are the same.
 */
export function validateExternalSkill({ slug, text, source }) {
	if (!SLUG_RE.test(slug) || slug.length < LIMITS.slugMin || slug.length > LIMITS.slugMax) {
		return { reason: `directory name "${slug}" is not a URL-safe slug of ${LIMITS.slugMin}-${LIMITS.slugMax} characters` };
	}
	const parsed = parseSkillMarkdown(text);
	if (!parsed) return { reason: 'SKILL.md has no --- frontmatter block' };
	const { name, description, version, tags } = parsed.data;
	if (!name) return { reason: 'frontmatter is missing "name"' };
	if (name !== slug) return { reason: `frontmatter name "${name}" must equal the directory name "${slug}"` };
	if (!description) return { reason: 'frontmatter is missing "description"' };
	if (description.length < LIMITS.descriptionMin) return { reason: 'description is too short to act as a trigger' };
	if (description.length > LIMITS.descriptionMax) return { reason: `description is ${description.length} characters; the limit is ${LIMITS.descriptionMax}` };
	const len = parsed.body.length;
	if (len < LIMITS.bodyMinChars) return { reason: `body is ${len} characters; a useful skill needs at least ${LIMITS.bodyMinChars}` };
	if (len > LIMITS.bodyMaxChars) return { reason: `body is ${len} characters; the limit is ${LIMITS.bodyMaxChars}` };
	const [owner] = source.repo.split('/');
	const base = `https://github.com/${source.repo}`;
	return {
		entry: {
			slug,
			name: titleCase(slug),
			description,
			author: owner,
			tags: parseTags(tags),
			version: version && SEMVER_RE.test(version) ? version : `0.0.0-${source.ref.slice(0, 7)}`,
			license: source.license,
			origin: 'external',
			not_reviewed: true,
			source: source.repo,
			ref: source.ref,
			path: `${source.path}/${slug}`,
			source_url: `${base}/blob/${source.ref}/${source.path}/${slug}/SKILL.md`,
			tree_url: `${base}/tree/${source.ref}/${source.path}/${slug}`,
			bytes: Buffer.byteLength(text),
			tokens: estimateTokens(parsed.body),
			sha256: createHash('sha256').update(text).digest('hex'),
			import: { registry: `${base}/tree/${source.ref}/${source.path}`, skill: slug },
		},
		content: text,
		body: parsed.body,
	};
}

async function getJson(fetchImpl, url, headers) {
	const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
	return res.json();
}

async function getText(fetchImpl, url) {
	const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const text = await res.text();
	if (Buffer.byteLength(text) > LIMITS.fileMaxBytes) throw new Error(`larger than ${LIMITS.fileMaxBytes} bytes`);
	return text;
}

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]);
			}
		}),
	);
	return out;
}

/** Load one source at its pinned commit. Never throws: failure is { error }. */
export async function loadSource(source, { fetchImpl = fetch, apiBase, rawBase, token, log = defaultLog } = {}) {
	const result = { repo: source.repo, ref: source.ref, path: source.path, license: source.license, skills: [], dropped: [] };
	try {
		const headers = {
			accept: 'application/vnd.github+json',
			'user-agent': 'three.ws-community-skills',
			'x-github-api-version': '2022-11-28',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		};
		const tree = await getJson(fetchImpl, `${apiBase}/repos/${source.repo}/git/trees/${source.ref}?recursive=1`, headers);
		if (!Array.isArray(tree.tree)) throw new Error('unexpected tree response');
		if (tree.truncated) log(`${source.repo}@${source.ref.slice(0, 7)} tree listing was truncated; some skills may be missing`);
		const prefix = `${source.path}/`;
		const files = tree.tree.filter((n) => n.type === 'blob' && n.path.startsWith(prefix) && /^[^/]+\/SKILL\.md$/.test(n.path.slice(prefix.length)));
		const picked = files.slice(0, MAX_SKILLS_PER_SOURCE);
		if (files.length > picked.length) log(`${source.repo}: ${files.length - picked.length} skills beyond the ${MAX_SKILLS_PER_SOURCE} per-source cap were ignored`);
		await mapLimit(picked, CONCURRENCY, async (node) => {
			const slug = node.path.slice(prefix.length).split('/')[0];
			try {
				const text = await getText(fetchImpl, `${rawBase}/${source.repo}/${source.ref}/${node.path}`);
				const verdict = validateExternalSkill({ slug, text, source });
				if (verdict.entry) result.skills.push({ ...verdict.entry, content: verdict.content, body: verdict.body });
				else {
					result.dropped.push({ slug, reason: verdict.reason });
					log(`dropped ${source.repo}/${slug}: ${verdict.reason}`);
				}
			} catch (err) {
				result.dropped.push({ slug, reason: err.message });
				log(`dropped ${source.repo}/${slug}: ${err.message}`);
			}
		});
		result.skills.sort((a, b) => a.slug.localeCompare(b.slug));
	} catch (err) {
		result.error = err.name === 'TimeoutError' ? `timed out after ${FETCH_TIMEOUT_MS} ms` : err.message;
		result.skills = [];
		log(`source ${source.repo}@${source.ref.slice(0, 7)} failed to load: ${result.error}`);
	}
	return result;
}

const cache = { key: null, at: 0, ttl: TTL_MS, value: null };

/** Test hook: forget the cached merge. */
export function resetExternalCache() {
	cache.key = null;
	cache.value = null;
}

/**
 * The merged external set. Disabled (and free) when the env var is unset.
 * `reservedSlugs` are the in-repo slugs: an in-repo skill always wins a clash,
 * and the first source wins a clash between two sources.
 */
export async function loadExternalSkills({
	env = process.env,
	fetchImpl = fetch,
	now = Date.now,
	reservedSlugs = new Set(),
	log = defaultLog,
} = {}) {
	const raw = env.COMMUNITY_SKILL_SOURCES;
	if (!raw || !String(raw).trim()) return { enabled: false, count: 0, skills: [], sources: [] };
	const apiBase = (env.COMMUNITY_SKILL_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
	const rawBase = (env.COMMUNITY_SKILL_RAW_BASE || 'https://raw.githubusercontent.com').replace(/\/+$/, '');
	const key = `${raw}|${apiBase}|${rawBase}`;
	if (cache.key === key && cache.value && now() - cache.at < cache.ttl) return cache.value;

	const { sources, problems } = parseSources(raw);
	for (const p of problems) log(p);
	const loaded = await Promise.all(
		sources.map((s) => loadSource(s, { fetchImpl, apiBase, rawBase, token: env.GITHUB_TOKEN || env.GH_TOKEN, log })),
	);
	const taken = new Set(reservedSlugs);
	const skills = [];
	for (const src of loaded) {
		for (const skill of src.skills) {
			if (taken.has(skill.slug)) {
				src.dropped.push({ slug: skill.slug, reason: 'slug already used by an earlier skill' });
				log(`dropped ${src.repo}/${skill.slug}: slug already used by an earlier skill`);
				continue;
			}
			taken.add(skill.slug);
			skills.push(skill);
		}
	}
	const value = {
		enabled: true,
		count: skills.length,
		skills,
		problems,
		sources: loaded.map((s) => ({
			repo: s.repo,
			ref: s.ref,
			path: s.path,
			license: s.license,
			url: `https://github.com/${s.repo}/tree/${s.ref}/${s.path}`,
			loaded: !s.error,
			...(s.error ? { error: s.error } : {}),
			count: s.skills.filter((k) => skills.includes(k)).length,
			dropped: s.dropped,
		})),
	};
	cache.key = key;
	cache.at = now();
	cache.ttl = loaded.some((s) => s.error) ? FAILURE_TTL_MS : TTL_MS;
	cache.value = value;
	return value;
}

/** Public shape: the entry without the file bodies. */
export function publicExternal(skill) {
	const { content, body, ...rest } = skill;
	return rest;
}

/** Same filter semantics as the in-repo search: q words all match, tag and author are exact. */
export function filterExternal(skills, { q = '', tag = '', author = '' } = {}) {
	const needle = String(q || '').trim().toLowerCase();
	const wantTag = String(tag || '').trim().toLowerCase();
	const wantAuthor = String(author || '').trim().toLowerCase();
	return skills.filter((s) => {
		if (wantTag && !s.tags.includes(wantTag)) return false;
		if (wantAuthor && s.author.toLowerCase() !== wantAuthor) return false;
		if (!needle) return true;
		const hay = `${s.slug} ${s.name} ${s.description} ${s.tags.join(' ')} ${s.author} ${s.source}`.toLowerCase();
		return needle.split(/\s+/).every((word) => hay.includes(word));
	});
}
