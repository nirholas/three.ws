/**
 * The community skills registry, read-only and public.
 *
 *   GET /api/skills/community                 list: ?q= &tag= &author= &limit=
 *   GET /api/skills/community/:slug           one skill with its full SKILL.md
 *   GET /api/skills/community/:slug?format=md the raw SKILL.md as text/markdown
 *
 * Source: community-skills/registry.json and the skill folders beside it,
 * validated by `npm run build:pages` and baked into the image, so a response
 * only changes with a deploy and can be cached at the edge. Importing a skill
 * onto an agent is POST /api/agents/:id/custom-skills { source: 'community', slug }.
 *
 * External sources (docs/community-skill-sources.md): when the operator sets
 * COMMUNITY_SKILL_SOURCES, the list response gains an `external` object and the
 * detail route also resolves external slugs. Those skills carry
 * origin: "external", their source repository, pinned commit and license, are
 * never merged into `skills`, and install only through the scan and approval
 * flow (POST /api/skill-imports/scan). With the variable unset the response is
 * byte-for-byte what it was before.
 */

import { cors, json, text, method, wrap, error } from '../_lib/http.js';
import { searchCommunitySkills, getCommunitySkill, loadRegistry } from '../_lib/community-skills.js';
import { loadExternalSkills, filterExternal, publicExternal } from '../_lib/community-skill-sources.js';

const CACHE = { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' };

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const slug = url.searchParams.get('slug') || (parts[2] === 'community' ? parts[3] : null) || null;

	if (!slug) {
		const limit = Number.parseInt(url.searchParams.get('limit') || '100', 10);
		const result = searchCommunitySkills({
			q: url.searchParams.get('q') || '',
			tag: url.searchParams.get('tag') || '',
			author: url.searchParams.get('author') || '',
			limit: Number.isFinite(limit) ? limit : 100,
		});
		const external = await loadExternalSkills({ reservedSlugs: new Set(loadRegistry().skills.map((s) => s.slug)) });
		if (!external.enabled) return json(res, 200, result, CACHE);
		const matched = filterExternal(external.skills, {
			q: url.searchParams.get('q') || '',
			tag: url.searchParams.get('tag') || '',
			author: url.searchParams.get('author') || '',
		});
		return json(res, 200, { ...result, external: { count: matched.length, total: external.count, sources: external.sources, skills: matched.map(publicExternal) } }, CACHE);
	}

	let skill = getCommunitySkill(slug);
	if (!skill) {
		const external = await loadExternalSkills({ reservedSlugs: new Set(loadRegistry().skills.map((s) => s.slug)) });
		skill = external.skills.find((s) => s.slug === slug) || null;
	}
	if (!skill) return error(res, 404, 'not_found', `no community skill "${slug}"`);
	if (url.searchParams.get('format') === 'md') {
		return text(res, 200, skill.content, { ...CACHE, 'content-type': 'text/markdown; charset=utf-8' });
	}
	return json(res, 200, { skill }, CACHE);
});
