// Shared schema.org helpers for the serve-time head rewriters
// (server/seo-head.mjs, server/creation-head.mjs) and the SEO audit
// (scripts/audit-seo.mjs), so every surface builds breadcrumbs and reads
// existing JSON-LD the same way. Runbook: docs/ops/bing-and-indexnow.md.

/** The @id the home page's Organization node carries (pages/desktop.html). */
export const ORGANIZATION_ID = 'https://three.ws/#organization';

/** Every schema.org type that is a SoftwareApplication or one of its subtypes. */
export const SOFTWARE_APPLICATION_TYPES = Object.freeze([
	'SoftwareApplication',
	'WebApplication',
	'MobileApplication',
	'VideoGame',
]);

/**
 * A BreadcrumbList node for a trail of `{ name, path }`, root first. Paths are
 * site-relative and resolved against `origin`.
 *
 * @param {{name: string, path: string}[]} trail
 * @param {string} origin
 */
export function breadcrumbListNode(trail, origin) {
	return {
		'@type': 'BreadcrumbList',
		itemListElement: trail.map((c, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: c.name,
			item: `${origin}${c.path}`,
		})),
	};
}

/** "start-here" -> "Start Here": the label for a path segment with no catalog title. */
export function segmentLabel(segment) {
	return String(segment)
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The breadcrumb trail for a site path: Home, then one crumb per segment. A
 * crumb is named by `titleFor(path)` when the path is a catalogued page, by its
 * title-cased segment otherwise, and the last crumb by `leafTitle`. The root
 * path has no trail.
 *
 * @param {string} pagePath   e.g. /docs/start-here
 * @param {string} leafTitle  the page's own title
 * @param {(path: string) => string|null|undefined} [titleFor]
 * @returns {{name: string, path: string}[]}
 */
export function pathTrail(pagePath, leafTitle, titleFor = () => null) {
	const segs = String(pagePath || '/').split('/').filter(Boolean);
	if (!segs.length) return [];
	const trail = [{ name: 'Home', path: '/' }];
	let acc = '';
	segs.forEach((s, i) => {
		acc += `/${s}`;
		const last = i === segs.length - 1;
		trail.push({ name: (last && leafTitle) || titleFor(acc) || segmentLabel(s), path: acc });
	});
	return trail;
}

function collectTypes(node, out) {
	if (Array.isArray(node)) {
		for (const n of node) collectTypes(n, out);
		return;
	}
	if (!node || typeof node !== 'object') return;
	const t = node['@type'];
	if (typeof t === 'string') out.add(t);
	else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.add(x);
	if (Array.isArray(node['@graph'])) collectTypes(node['@graph'], out);
}

/**
 * Parse every JSON-LD block in an HTML fragment.
 *
 * @param {string} html
 * @returns {{ blocks: any[], invalid: number }} parsed blocks, and how many failed to parse
 */
export function jsonLdBlocks(html) {
	const blocks = [];
	let invalid = 0;
	for (const m of String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		try {
			blocks.push(JSON.parse(m[1]));
		} catch {
			invalid++;
		}
	}
	return { blocks, invalid };
}

/**
 * The schema.org top-level and @graph node types declared in an HTML fragment.
 *
 * @param {string} html
 * @returns {Set<string>}
 */
export function jsonLdTypes(html) {
	const out = new Set();
	collectTypes(jsonLdBlocks(html).blocks, out);
	return out;
}

/** Every node of a given type across the parsed blocks (top level and @graph). */
export function jsonLdNodes(html, type) {
	const out = [];
	const walk = (node) => {
		if (Array.isArray(node)) return node.forEach(walk);
		if (!node || typeof node !== 'object') return;
		const t = node['@type'];
		if (t === type || (Array.isArray(t) && t.includes(type))) out.push(node);
		if (Array.isArray(node['@graph'])) walk(node['@graph']);
	};
	walk(jsonLdBlocks(html).blocks);
	return out;
}

/** JSON for an inline <script>: `<` escaped so a value can never close the tag. */
export function jsonLdScript(value) {
	return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

/** The text a reader sees in a page body: no head, scripts, styles or tags. */
export function visibleText(html) {
	return String(html || '')
		.replace(/<head[\s\S]*?<\/head>/i, '')
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<template[\s\S]*?<\/template>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&#39;|&apos;|&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
}

/**
 * FAQPage questions declared in an HTML page, split by whether the page body
 * shows them. Bing and Google treat FAQ markup for questions a reader cannot
 * see as misleading, so a FAQPage needs at least one visible question.
 *
 * @param {string} html
 * @returns {{ questions: string[], visible: string[], hidden: string[] }}
 */
export function faqVisibility(html) {
	const questions = jsonLdNodes(html, 'FAQPage')
		.flatMap((n) => (Array.isArray(n.mainEntity) ? n.mainEntity : n.mainEntity ? [n.mainEntity] : []))
		.map((q) => String(q?.name || '').trim())
		.filter(Boolean);
	const text = visibleText(html);
	const visible = questions.filter((q) => text.includes(q));
	return { questions, visible, hidden: questions.filter((q) => !text.includes(q)) };
}
