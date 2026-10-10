// External skill registries: where importable SKILL.md skills come from.
//
// A registry is either a public GitHub repository (optionally a subdirectory
// of one) or a skill-registry manifest URL (specs/skill-registry-manifest.md).
// This module only reads: it resolves a registry to a pinned index of skills
// and fetches one skill's exact bytes. Scanning lives in skill-import-scan.js
// and the owner-approval store in skill-import-store.js.
//
// Pinning and caching, the parts other code depends on:
//   - a GitHub index is resolved against one commit sha. Every body is fetched
//     from raw.githubusercontent.com at that sha and checked against the git
//     blob sha the tree reported, so the bytes are exactly what the commit holds
//   - a manifest entry must carry a sha256; its body is checked against it
//   - the index is cached for INDEX_TTL_MS per registry; bodies are cached by
//     content address (git blob sha or sha256), so a cache hit is always valid
//   - GitHub commit lookups send If-None-Match, so an unchanged repository costs
//     no API rate limit; set GITHUB_TOKEN to lift the anonymous 60/hour cap

import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { parse as parseYaml } from 'yaml';
import { fetchSafePublicUrl } from './ssrf-guard.js';
import { parseSkillMarkdown } from '../../community-skills/tools/registry.mjs';
import { CustomSkillError } from './agent-custom-skills.js';

export const INDEX_TTL_MS = 5 * 60 * 1000;
export const MAX_SKILL_BYTES = 64 * 1024;
export const MAX_MANIFEST_BYTES = 512 * 1024;
export const MAX_SKILLS_PER_REGISTRY = 200;
const MAX_LICENSE_BYTES = 16 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const FETCH_CONCURRENCY = 6;
const MANIFEST_SCHEMA = 'three.ws/skill-registry@1';

export const CATEGORIES = Object.freeze(['defi', 'intelligence', 'social', 'infrastructure', 'security', 'data', 'other']);

/** Registries every owner can browse without adding anything. */
export const BUILTIN_REGISTRY_INPUTS = Object.freeze([
	{ input: 'https://github.com/nirholas/three.ws/tree/main/community-skills/skills', label: 'three.ws community skills' },
	{ input: 'https://github.com/anthropics/skills/tree/main/skills', label: 'Anthropic agent skills' },
	{ input: 'published', label: 'Published on three.ws' },
]);

// ── Registry descriptors ────────────────────────────────────────────────────

const GH_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GH_REPO = /^[A-Za-z0-9._-]{1,100}$/;

function cleanSubpath(p) {
	const parts = String(p || '')
		.split('/')
		.map((s) => s.trim())
		.filter(Boolean);
	if (parts.some((s) => s === '.' || s === '..')) throw new CustomSkillError(400, 'invalid_registry', 'registry path may not contain . or ..');
	return parts.join('/');
}

function githubDescriptor(owner, repo, ref, subpath) {
	if (!GH_OWNER.test(owner) || !GH_REPO.test(repo) || repo === '.' || repo === '..') {
		throw new CustomSkillError(400, 'invalid_registry', 'not a valid GitHub owner/repo');
	}
	const sub = cleanSubpath(subpath);
	const id = `${owner}/${repo}`.toLowerCase();
	return {
		kind: 'github',
		key: `github:${id}${sub ? `/${sub}` : ''}`,
		owner,
		repo: repo.replace(/\.git$/, ''),
		ref: ref || null,
		subpath: sub,
		label: `${owner}/${repo}${sub ? `/${sub}` : ''}`,
		url: `https://github.com/${owner}/${repo}${ref ? `/tree/${ref}${sub ? `/${sub}` : ''}` : ''}`,
	};
}

/**
 * Turn what an owner typed into a registry descriptor. Accepts `owner/repo`,
 * `owner/repo/sub/dir`, a github.com repository or tree URL, an https manifest
 * URL, or the word `published` (skills published on three.ws).
 */
export function parseRegistryInput(input) {
	const raw = String(input || '').trim();
	if (!raw) throw new CustomSkillError(400, 'invalid_registry', 'registry is required');
	if (raw === 'published') {
		return { kind: 'published', key: 'published', label: 'Published on three.ws', url: '/api/skill-imports/published/manifest.json' };
	}
	const short = raw.match(/^([^/\s:]+)\/([^/\s]+)(?:\/(.+))?$/);
	if (short && !/^https?:/i.test(raw) && GH_OWNER.test(short[1])) {
		return githubDescriptor(short[1], short[2], null, short[3]);
	}
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new CustomSkillError(400, 'invalid_registry', 'registry must be owner/repo, a GitHub URL, or an https manifest URL');
	}
	if (url.protocol !== 'https:') throw new CustomSkillError(400, 'invalid_registry', 'registry URLs must be https');
	if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
		const seg = url.pathname.split('/').filter(Boolean);
		if (seg.length < 2) throw new CustomSkillError(400, 'invalid_registry', 'GitHub URL must name a repository');
		const [owner, repo, kind, ref, ...rest] = seg;
		if (kind && kind !== 'tree') throw new CustomSkillError(400, 'invalid_registry', 'use a repository or /tree/<ref>/<dir> URL');
		return githubDescriptor(owner, repo, ref || null, rest.join('/'));
	}
	url.hash = '';
	return { kind: 'manifest', key: `manifest:${url.toString()}`, label: url.hostname, url: url.toString() };
}

// ── Fetching ────────────────────────────────────────────────────────────────

async function readCapped(res, maxBytes, what) {
	const declared = Number(res.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new CustomSkillError(413, 'too_large', `${what} is ${declared} bytes; the limit is ${maxBytes}`);
	}
	if (!res.body) return Buffer.alloc(0);
	const chunks = [];
	let total = 0;
	for await (const chunk of res.body) {
		total += chunk.length;
		if (total > maxBytes) throw new CustomSkillError(413, 'too_large', `${what} exceeds ${maxBytes} bytes`);
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

async function getUrl(url, { headers = {}, maxBytes, what }) {
	let res;
	try {
		res = await fetchSafePublicUrl(url, { headers: { 'user-agent': 'three.ws-skill-import', ...headers }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	} catch (err) {
		throw new CustomSkillError(502, 'upstream_unreachable', `could not reach ${new URL(url).hostname}: ${err.message}`);
	}
	return res.status === 304 ? { res, body: null } : { res, body: res.ok ? await readCapped(res, maxBytes, what) : null };
}

function githubHeaders(accept = 'application/vnd.github+json') {
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	return { accept, 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

function githubFailure(res, what) {
	if (res.status === 404) return new CustomSkillError(404, 'registry_not_found', `${what} not found or not public`);
	if (res.status === 403 || res.status === 429) {
		const reset = Number(res.headers.get('x-ratelimit-reset'));
		const when = Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : 'shortly';
		return new CustomSkillError(503, 'github_rate_limited', `GitHub rate limit reached; try again after ${when}`);
	}
	return new CustomSkillError(502, 'upstream_error', `GitHub answered ${res.status} for ${what}`);
}

async function githubJson(path, what) {
	const { res, body } = await getUrl(`https://api.github.com${path}`, { headers: githubHeaders(), maxBytes: 8 * 1024 * 1024, what });
	if (!res.ok) throw githubFailure(res, what);
	return JSON.parse(body.toString('utf8'));
}

// repo metadata (default branch, licence) changes rarely: cache an hour.
const repoCache = new LRUCache({ max: 500, ttl: 60 * 60 * 1000 });
// commit sha per ref, with the ETag that makes a recheck free.
const refCache = new Map();
// trees are immutable per commit sha.
const treeCache = new LRUCache({ max: 200 });
// bodies are immutable per content address.
const bodyCache = new LRUCache({ maxSize: 32 * 1024 * 1024, sizeCalculation: (v) => Math.max(1, v.length) });
const indexCache = new Map();

async function githubRepo(reg) {
	const k = `${reg.owner}/${reg.repo}`.toLowerCase();
	const hit = repoCache.get(k);
	if (hit) return hit;
	const repo = await githubJson(`/repos/${reg.owner}/${reg.repo}`, `${reg.owner}/${reg.repo}`);
	if (repo.private) throw new CustomSkillError(400, 'invalid_registry', 'only public repositories can be registries');
	const out = {
		full_name: repo.full_name,
		html_url: repo.html_url,
		default_branch: repo.default_branch,
		license_spdx: repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null,
		owner_login: repo.owner?.login || reg.owner,
	};
	repoCache.set(k, out);
	return out;
}

async function githubCommit(reg, ref) {
	const k = `${reg.owner}/${reg.repo}@${ref}`.toLowerCase();
	const prev = refCache.get(k);
	const headers = githubHeaders('application/vnd.github.sha');
	if (prev?.etag) headers['if-none-match'] = prev.etag;
	const { res, body } = await getUrl(`https://api.github.com/repos/${reg.owner}/${reg.repo}/commits/${encodeURIComponent(ref)}`, {
		headers,
		maxBytes: 1024,
		what: `${reg.label}@${ref}`,
	});
	if (res.status === 304 && prev) return prev.sha;
	if (!res.ok) throw githubFailure(res, `${reg.label}@${ref}`);
	const sha = body.toString('utf8').trim();
	if (!/^[0-9a-f]{40}$/.test(sha)) throw new CustomSkillError(502, 'upstream_error', 'GitHub returned an unexpected commit id');
	refCache.set(k, { sha, etag: res.headers.get('etag') });
	return sha;
}

async function githubTree(reg, commit) {
	const k = `${reg.owner}/${reg.repo}@${commit}`.toLowerCase();
	const hit = treeCache.get(k);
	if (hit) return hit;
	const tree = await githubJson(`/repos/${reg.owner}/${reg.repo}/git/trees/${commit}?recursive=1`, `${reg.label} tree`);
	const out = { truncated: !!tree.truncated, entries: (tree.tree || []).filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha, size: e.size })) };
	treeCache.set(k, out);
	return out;
}

/** Git's blob id for some bytes: sha1("blob <len>\0" + bytes). */
export function gitBlobSha(buf) {
	return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

export function sha256Hex(text) {
	return createHash('sha256').update(text).digest('hex');
}

async function githubBlob(reg, commit, entry, maxBytes) {
	const k = `git:${entry.sha}`;
	const hit = bodyCache.get(k);
	if (hit) return hit;
	if (entry.size > maxBytes) throw new CustomSkillError(413, 'too_large', `${entry.path} is ${entry.size} bytes; the limit is ${maxBytes}`);
	const path = entry.path.split('/').map(encodeURIComponent).join('/');
	const url = `https://raw.githubusercontent.com/${reg.owner}/${reg.repo}/${commit}/${path}`;
	const { res, body } = await getUrl(url, { maxBytes, what: entry.path });
	if (!res.ok) throw new CustomSkillError(502, 'upstream_error', `raw.githubusercontent.com answered ${res.status} for ${entry.path}`);
	if (gitBlobSha(body) !== entry.sha) {
		throw new CustomSkillError(502, 'integrity_mismatch', `${entry.path} did not match its git blob ${entry.sha.slice(0, 12)}; refusing it`);
	}
	const text = body.toString('utf8');
	bodyCache.set(k, text);
	return text;
}

async function mapLimit(items, n, fn) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(n, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i], i);
			}
		}),
	);
	return out;
}

// ── Licences ────────────────────────────────────────────────────────────────

const PERMISSIVE = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'CC-BY-4.0', 'Zlib', 'BlueOak-1.0.0'];
const COPYLEFT = ['MPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'CC-BY-SA-4.0', 'EPL-2.0'];

const LICENSE_PATTERNS = [
	['AGPL-3.0', /\bAGPL[- ]?(?:v?3)|GNU AFFERO GENERAL PUBLIC LICENSE/i],
	['LGPL-3.0', /\bLGPL[- ]?(?:v?3)|GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i],
	['LGPL-2.1', /\bLGPL[- ]?(?:v?2)|GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2/i],
	['GPL-3.0', /\bGPL[- ]?(?:v?3)|GNU GENERAL PUBLIC LICENSE\s+Version 3/i],
	['GPL-2.0', /\bGPL[- ]?(?:v?2)|GNU GENERAL PUBLIC LICENSE\s+Version 2/i],
	['MPL-2.0', /\bMPL[- ]?2|Mozilla Public License,? (?:Version|v\.?) ?2/i],
	['EPL-2.0', /\bEPL[- ]?2|Eclipse Public License/i],
	['CC-BY-SA-4.0', /CC[- ]BY[- ]SA|Attribution-ShareAlike/i],
	['Apache-2.0', /\bApache(?:[- ]License)?,?[- ]?(?:Version )?2(?:\.0)?\b/i],
	['MIT', /\bMIT\b(?: License)?|Permission is hereby granted, free of charge/i],
	['BSD-3-Clause', /\bBSD[- ]3|Neither the name of/i],
	['BSD-2-Clause', /\bBSD[- ]2|Redistribution and use in source and binary forms/i],
	['ISC', /\bISC\b/],
	['0BSD', /\b0BSD\b/],
	['Unlicense', /\bUnlicense\b|free and unencumbered software released into the public domain/i],
	['CC0-1.0', /\bCC0\b|CC0 1\.0 Universal/i],
	['CC-BY-4.0', /\bCC[- ]BY[- ]4|Creative Commons Attribution 4\.0/i],
	['Zlib', /\bzlib License\b/i],
	['BlueOak-1.0.0', /Blue Oak Model License/i],
];

function licenseClass(spdx) {
	if (PERMISSIVE.includes(spdx)) return 'permissive';
	if (COPYLEFT.includes(spdx)) return 'copyleft';
	return 'unknown';
}

/**
 * Classify a licence statement (an SPDX id, a frontmatter line, or a whole
 * LICENSE file). Returns { spdx, class } where class is permissive, copyleft,
 * proprietary or unknown.
 */
export function classifyLicense(text) {
	const t = String(text || '').trim();
	if (!t) return { spdx: null, class: 'unknown' };
	const exact = [...PERMISSIVE, ...COPYLEFT].find((id) => id.toLowerCase() === t.toLowerCase());
	if (exact) return { spdx: exact, class: licenseClass(exact) };
	if (/^\s*(?:proprietary|all rights reserved|commercial|confidential)/i.test(t)) return { spdx: null, class: 'proprietary' };
	const head = t.slice(0, 4000).replace(/\s+/g, ' ');
	for (const [id, re] of LICENSE_PATTERNS) if (re.test(head)) return { spdx: id, class: licenseClass(id) };
	if (/proprietary|all rights reserved|may not be (?:copied|redistributed)|not licensed/i.test(head)) return { spdx: null, class: 'proprietary' };
	return { spdx: null, class: 'unknown' };
}

/** Listing policy for a classified licence. */
export function licensePolicy(lic) {
	if (lic.class === 'permissive') return { listed: true, notice: null };
	if (lic.class === 'copyleft') return { listed: true, notice: `${lic.spdx} is copyleft: a modified copy you publish must keep the same licence.` };
	if (lic.class === 'proprietary') return { listed: false, reason: 'proprietary licence: the author has not granted reuse' };
	return { listed: false, reason: 'no recognisable open-source licence on the skill or its repository' };
}

// ── Skill metadata ──────────────────────────────────────────────────────────

const CATEGORY_HINTS = [
	['security', /\b(security|audit|vulnerab|exploit|rug|scam|phish|threat|malware|safety|honeypot)/i],
	['defi', /\b(defi|swap|liquidity|lend|borrow|yield|perp|dex|amm|stak(e|ing)|vault|trade|trading|position|dca|token)/i],
	['social', /\b(social|tweet|post(s|ing)?\b|telegram|discord|community|farcaster|reply|engagement|newsletter)/i],
	['intelligence', /\b(research|analy[sz]|signal|alpha|sentiment|insight|forecast|scor(e|ing)|monitor|whale)/i],
	['data', /\b(data|csv|sql|spreadsheet|xlsx|pdf|document|chart|index|candles|query|dataset|ocr)/i],
	['infrastructure', /\b(infra|deploy|rpc|node|server|mcp|api|sdk|cli|devops|build|webhook|docker|validator)/i],
];

/**
 * Category from an explicit value, else a keyword score over the name (x3),
 * tags (x2) and description (x1). Ties go to the earlier category in the list.
 */
export function categorize({ category, name, description, tags = [] }) {
	const explicit = String(category || '').trim().toLowerCase();
	if (CATEGORIES.includes(explicit)) return explicit;
	const count = (re, text) => (String(text || '').match(new RegExp(re.source, 'gi')) || []).length;
	let best = 'other';
	let bestScore = 0;
	for (const [cat, re] of CATEGORY_HINTS) {
		const score = count(re, String(name).replace(/[-_]/g, ' ')) * 3 + count(re, tags.join(' ')) * 2 + count(re, description);
		if (score > bestScore) {
			best = cat;
			bestScore = score;
		}
	}
	return best;
}

function asStringList(v) {
	if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
	if (typeof v === 'string') return v.replace(/[[\]"']/g, ' ').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
	return [];
}

/**
 * Split a SKILL.md into frontmatter and body with a real YAML parser (aliases
 * refused, so a crafted file cannot expand). Falls back to the registry's
 * line parser for frontmatter YAML rejects. Returns null when there is none.
 */
export function parseSkillFile(text) {
	const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!m) return null;
	try {
		const data = parseYaml(m[1], { maxAliasCount: 0 });
		if (data && typeof data === 'object' && !Array.isArray(data)) return { data, body: String(text).slice(m[0].length).trim() };
	} catch {
		// fall through to the tolerant line parser
	}
	return parseSkillMarkdown(text);
}

/**
 * Normalise a parsed SKILL.md (+ optional metadata.json) into the fields the
 * importer uses. `requested_tools` comes from the Agent Skills `allowed-tools`
 * field; `requested_permissions` from a `permissions` field when present.
 */
export function skillManifest({ frontmatter = {}, metadata = {}, fallbackSlug }) {
	const meta = frontmatter.metadata && typeof frontmatter.metadata === 'object' ? frontmatter.metadata : {};
	const name = String(metadata.name || frontmatter.name || fallbackSlug || '').trim();
	const description = String(frontmatter.description || metadata.description || '').trim();
	const tags = asStringList(metadata.tags || meta.tags || frontmatter.tags).map((t) => t.toLowerCase()).slice(0, 8);
	return {
		name,
		slug_hint: String(frontmatter.name || fallbackSlug || name),
		description,
		author: String(metadata.author || meta.author || frontmatter.author || '').trim() || null,
		version: String(metadata.version || meta.version || frontmatter.version || '').trim() || null,
		license_text: String(frontmatter.license || metadata.license || meta.license || '').trim() || null,
		tags,
		category: String(metadata.category || meta.category || frontmatter.category || '').trim() || null,
		requested_tools: asStringList(frontmatter['allowed-tools'] || frontmatter.allowed_tools || meta['allowed-tools']),
		requested_permissions: asStringList(frontmatter.permissions || metadata.permissions || meta.permissions),
	};
}

// ── Indexes ─────────────────────────────────────────────────────────────────

function skillFilesIn(tree, dir) {
	const prefix = dir ? `${dir}/` : '';
	return tree.entries.filter((e) => e.path.startsWith(prefix) && e.path !== `${prefix}SKILL.md`).map((e) => ({ path: e.path.slice(prefix.length), size: e.size, sha: e.sha }));
}

async function githubSkillEntry(reg, repo, commit, tree, skillPath) {
	const dir = skillPath.replace(/\/?SKILL\.md$/, '');
	const entry = tree.entries.find((e) => e.path === skillPath);
	const files = skillFilesIn(tree, dir).filter((f) => !f.path.includes('/') || /^(scripts|handlers?|bin|src|references|assets)\//.test(f.path));
	const text = await githubBlob(reg, commit, entry, MAX_SKILL_BYTES);
	const parsed = parseSkillFile(text);
	let metadata = {};
	const metaEntry = tree.entries.find((e) => e.path === `${dir ? `${dir}/` : ''}metadata.json`);
	if (metaEntry && metaEntry.size <= 16 * 1024) {
		try {
			metadata = JSON.parse(await githubBlob(reg, commit, metaEntry, 16 * 1024));
		} catch {
			metadata = {};
		}
	}
	const slugBase = dir.split('/').pop() || reg.repo;
	const manifest = skillManifest({ frontmatter: parsed?.data || {}, metadata, fallbackSlug: slugBase });

	let license = classifyLicense(manifest.license_text);
	let licenseSource = manifest.license_text ? 'skill' : null;
	if (license.class === 'unknown') {
		const licFile = tree.entries.find((e) => new RegExp(`^${dir ? `${escapeRe(dir)}/` : ''}(?:LICEN[CS]E|COPYING)(?:\\.(?:txt|md))?$`, 'i').test(e.path));
		if (licFile) {
			const fileLic = classifyLicense(await githubBlob(reg, commit, licFile, MAX_LICENSE_BYTES).catch(() => ''));
			if (fileLic.class !== 'unknown') {
				license = fileLic;
				licenseSource = licFile.path;
			}
		}
	}
	if (license.class === 'unknown' && !manifest.license_text && repo.license_spdx) {
		license = classifyLicense(repo.license_spdx);
		licenseSource = 'repository';
	}

	return {
		key: `${reg.key}#${dir || '.'}`,
		registry: { key: reg.key, kind: reg.kind, label: reg.label },
		path: skillPath,
		dir,
		slug: slugBase.toLowerCase(),
		parse_ok: !!parsed,
		...manifest,
		category: categorize(manifest),
		license: { ...license, source: licenseSource, statement: manifest.license_text },
		files,
		pin: { commit, blob_sha: entry.sha },
		source_url: `https://github.com/${repo.full_name}/blob/${commit}/${skillPath}`,
		repo_url: repo.html_url,
		bytes: entry.size,
	};
}

function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function githubIndex(reg) {
	const repo = await githubRepo(reg);
	const ref = reg.ref || repo.default_branch;
	const commit = await githubCommit(reg, ref);
	const tree = await githubTree(reg, commit);
	const prefix = reg.subpath ? `${reg.subpath}/` : '';
	const skillPaths = tree.entries
		.map((e) => e.path)
		.filter((p) => (prefix ? p.startsWith(prefix) : true) && /(^|\/)SKILL\.md$/.test(p))
		.filter((p) => p.slice(prefix.length).split('/').length <= 4)
		.sort()
		.slice(0, MAX_SKILLS_PER_REGISTRY);
	const skills = [];
	const errors = [];
	await mapLimit(skillPaths, FETCH_CONCURRENCY, async (p) => {
		try {
			skills.push(await githubSkillEntry(reg, repo, commit, tree, p));
		} catch (err) {
			errors.push({ path: p, error: err.message });
		}
	});
	skills.sort((a, b) => a.path.localeCompare(b.path));
	return {
		registry: { ...reg, ref, repo_url: repo.html_url, license_spdx: repo.license_spdx },
		commit,
		truncated: tree.truncated,
		skills,
		errors,
	};
}

const SHA256_RE = /^[0-9a-f]{64}$/;

async function manifestIndex(reg) {
	const { res, body } = await getUrl(reg.url, { headers: { accept: 'application/json' }, maxBytes: MAX_MANIFEST_BYTES, what: 'registry manifest' });
	if (!res.ok) throw new CustomSkillError(502, 'upstream_error', `manifest answered ${res.status}`);
	let doc;
	try {
		doc = JSON.parse(body.toString('utf8'));
	} catch {
		throw new CustomSkillError(422, 'invalid_manifest', 'registry manifest is not valid JSON');
	}
	return manifestDocIndex(reg, doc, sha256Hex(body));
}

/** Index a parsed manifest document. Exported for the published registry and tests. */
export function manifestDocIndex(reg, doc, revision) {
	if (!doc || typeof doc !== 'object' || doc.schema !== MANIFEST_SCHEMA || !Array.isArray(doc.skills)) {
		throw new CustomSkillError(422, 'invalid_manifest', `registry manifest must have "schema": "${MANIFEST_SCHEMA}" and a "skills" array`);
	}
	const skills = [];
	const errors = [];
	for (const s of doc.skills.slice(0, MAX_SKILLS_PER_REGISTRY)) {
		const slug = String(s?.slug || '').trim().toLowerCase();
		let url;
		try {
			url = new URL(String(s?.url || ''), reg.url.startsWith('/') ? 'https://three.ws' : reg.url);
		} catch {
			url = null;
		}
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !url || url.protocol !== 'https:' || !SHA256_RE.test(String(s?.sha256 || ''))) {
			errors.push({ path: slug || '(unnamed)', error: 'entry needs a kebab-case slug, an https url and a sha256' });
			continue;
		}
		const manifest = skillManifest({ frontmatter: {}, metadata: s, fallbackSlug: slug });
		manifest.requested_tools = asStringList(s['allowed-tools'] || s.allowed_tools);
		const license = classifyLicense(s.license);
		skills.push({
			key: `${reg.key}#${slug}`,
			registry: { key: reg.key, kind: reg.kind, label: reg.label },
			path: slug,
			dir: slug,
			slug,
			parse_ok: true,
			...manifest,
			category: categorize(manifest),
			license: { ...license, source: s.license ? 'manifest' : null, statement: s.license || null },
			files: [],
			pin: { sha256: s.sha256, revision: s.revision || null },
			source_url: url.toString(),
			repo_url: typeof s.source_repo === 'string' ? s.source_repo : doc.homepage || null,
			upstream_commit: typeof s.commit === 'string' ? s.commit : null,
			bytes: Number(s.bytes) || null,
			installs_hint: null,
		});
	}
	return { registry: { ...reg, name: doc.name || reg.label, homepage: doc.homepage || null }, commit: revision, truncated: false, skills, errors };
}

/**
 * The pinned index of one registry, cached for INDEX_TTL_MS. `published` is
 * resolved by the caller-supplied loader (the store owns that table).
 */
export async function registryIndex(reg, { fresh = false, loadPublished } = {}) {
	const hit = indexCache.get(reg.key);
	if (!fresh && hit && Date.now() - hit.at < INDEX_TTL_MS) return { ...hit.index, cached: true, fetched_at: new Date(hit.at).toISOString() };
	let index;
	if (reg.kind === 'github') index = await githubIndex(reg);
	else if (reg.kind === 'manifest') index = await manifestIndex(reg);
	else if (reg.kind === 'published') index = manifestDocIndex(reg, await loadPublished(), null);
	else throw new CustomSkillError(400, 'invalid_registry', `unknown registry kind ${reg.kind}`);
	const at = Date.now();
	indexCache.set(reg.key, { at, index });
	return { ...index, cached: false, fetched_at: new Date(at).toISOString() };
}

/**
 * The exact bytes of one indexed skill at its pin. Verified against the git
 * blob sha or the manifest sha256 before it is returned.
 */
export async function fetchSkillBody(reg, entry, { loadPublishedBody } = {}) {
	if (reg.kind === 'github') {
		return githubBlob(reg, entry.pin.commit, { path: entry.path, sha: entry.pin.blob_sha, size: entry.bytes }, MAX_SKILL_BYTES);
	}
	const k = `sha256:${entry.pin.sha256}`;
	const hit = bodyCache.get(k);
	if (hit) return hit;
	let text;
	if (reg.kind === 'published') {
		text = await loadPublishedBody(entry.slug);
	} else {
		const { res, body } = await getUrl(entry.source_url, { maxBytes: MAX_SKILL_BYTES, what: `${entry.slug}/SKILL.md` });
		if (!res.ok) throw new CustomSkillError(502, 'upstream_error', `skill url answered ${res.status}`);
		text = body.toString('utf8');
	}
	if (sha256Hex(text) !== entry.pin.sha256) {
		throw new CustomSkillError(502, 'integrity_mismatch', `${entry.slug} did not match its published sha256; refusing it`);
	}
	bodyCache.set(k, text);
	return text;
}

/** Drop a registry's cached index (after adding or removing it). */
export function forgetIndex(key) {
	indexCache.delete(key);
}
