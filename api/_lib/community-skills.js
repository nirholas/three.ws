// Read side of the community skills registry (community-skills/ in this repo,
// mirrored to nirholas/three-ws-skills).
//
// The registry ships inside the image: registry.json is regenerated and
// validated by `npm run build:pages`, and the skill folders sit beside it. Both
// are immutable for the life of a process, so they are read once and cached.
// Nothing here trusts a caller-supplied path: a slug must match the registry
// before any file under it is opened.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseSkillMarkdown } from '../../community-skills/tools/registry.mjs';

const ROOT = fileURLToPath(new URL('../../community-skills/', import.meta.url));
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let registryCache = null;
const detailCache = new Map();

/** The full registry.json object. */
export function loadRegistry() {
	if (!registryCache) registryCache = JSON.parse(readFileSync(join(ROOT, 'registry.json'), 'utf8'));
	return registryCache;
}

/** Registry row for one slug, or null. */
export function findCommunitySkill(slug) {
	if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
	return loadRegistry().skills.find((s) => s.slug === slug) || null;
}

/**
 * Filter the registry. `q` matches name, description, slug and tags; `tag` and
 * `author` are exact (case-insensitive). Order is the registry's (by slug)
 * unless `sort=name`.
 */
export function searchCommunitySkills({ q = '', tag = '', author = '', limit = 100 } = {}) {
	const registry = loadRegistry();
	const needle = String(q || '').trim().toLowerCase();
	const wantTag = String(tag || '').trim().toLowerCase();
	const wantAuthor = String(author || '').trim().toLowerCase();
	const skills = registry.skills.filter((s) => {
		if (wantTag && !s.tags.includes(wantTag)) return false;
		if (wantAuthor && s.author.toLowerCase() !== wantAuthor) return false;
		if (!needle) return true;
		const hay = `${s.slug} ${s.name} ${s.description} ${s.tags.join(' ')} ${s.author}`.toLowerCase();
		return needle.split(/\s+/).every((word) => hay.includes(word));
	});
	return {
		count: skills.length,
		total: registry.count,
		tags: registry.tags,
		authors: registry.authors,
		source: registry.source,
		mirror: registry.mirror,
		skills: skills.slice(0, Math.max(1, Math.min(500, limit))),
	};
}

/**
 * One skill with its SKILL.md. `content` is the full file (frontmatter
 * included) for preview and download; `body` is the instruction text an agent
 * receives on import. Returns null for an unknown slug.
 */
export function getCommunitySkill(slug) {
	const entry = findCommunitySkill(slug);
	if (!entry) return null;
	if (detailCache.has(slug)) return detailCache.get(slug);
	const dir = join(ROOT, entry.path);
	const content = readFileSync(join(dir, 'SKILL.md'), 'utf8');
	const parsed = parseSkillMarkdown(content);
	const listDir = (name) =>
		existsSync(join(dir, name)) ? readdirSync(join(dir, name)).sort().map((f) => `${name}/${f}`) : [];
	const detail = {
		...entry,
		content,
		body: parsed ? parsed.body : content,
		trigger: parsed?.data?.description || entry.description,
		references: listDir('references'),
		scripts: listDir('scripts'),
		source_url: `${loadRegistry().source}/${entry.path}`,
	};
	detailCache.set(slug, detail);
	return detail;
}
