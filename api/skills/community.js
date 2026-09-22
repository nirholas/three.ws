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
 */

import { cors, json, text, method, wrap, error } from '../_lib/http.js';
import { searchCommunitySkills, getCommunitySkill } from '../_lib/community-skills.js';

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
		return json(res, 200, result, CACHE);
	}

	const skill = getCommunitySkill(slug);
	if (!skill) return error(res, 404, 'not_found', `no community skill "${slug}"`);
	if (url.searchParams.get('format') === 'md') {
		return text(res, 200, skill.content, { ...CACHE, 'content-type': 'text/markdown; charset=utf-8' });
	}
	return json(res, 200, { skill }, CACHE);
});
