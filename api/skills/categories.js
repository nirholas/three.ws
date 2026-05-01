import { sql } from '../_lib/db.js';
import { json, error, method, wrap } from '../_lib/http.js';

function toLabel(slug) {
	return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET'])) return;

	const rows = await sql`
		select category, count(*)::int as count
		from marketplace_skills
		where is_public = true
		group by category
		having count(*) > 0
		order by count desc
	`;

	const categories = rows.map((r) => ({
		slug: r.category,
		label: toLabel(r.category),
		count: r.count,
	}));

	json(res, 200, { categories }, { 'cache-control': 'public, max-age=60' });
});
