// Featured Anatomy designs: hand-written cutaways kept in the repo, not the
// database, so every label and number is reviewable in git and each fact is
// traced to a public source (docs/anatomy/rocket-engines-sources.md, audited in
// docs/anatomy/rocket-engines-review.md). They load without a database, keep
// fixed permalinks, lead the /anatomy gallery, and are the only designs whose
// tour is narrated by Grok (their facts are verified).
//
// Ids are fixed UUIDs so /anatomy/<id> stays the one URL shape for every
// machine and old links never break.

import { normalizeSpec, specStats } from '../../../../src/anatomy/spec.js';
import { FFSC_ENGINE_SPEC } from './ffsc-engine.js';
import { LAUNCH_STACK_SPEC } from './launch-stack.js';

const SITE = process.env.PUBLIC_BASE_URL || 'https://three.ws';

const ENTRIES = [
	{
		id: '85160213-4c15-4b00-ba96-5990b9385249',
		slug: 'ffsc-engine',
		spec: FFSC_ENGINE_SPEC,
		ogImage: '/anatomy/og/ffsc-engine.png',
		createdAt: '2026-11-20T00:00:00.000Z',
		shareText: 'How a full-flow staged-combustion rocket engine works: two preburners, two turbopumps, and every drop of propellant driving a turbine before it burns. An interactive cutaway you can spin, explode and slice.',
	},
	{
		id: 'd72da3e9-8aae-47cd-a96c-45ccd33bf1a0',
		slug: 'launch-stack',
		spec: LAUNCH_STACK_SPEC,
		ogImage: '/anatomy/og/launch-stack.png',
		createdAt: '2026-11-20T00:00:00.000Z',
		shareText: 'A fully reusable two-stage super-heavy launch system, as an interactive cutaway: the booster engine ring, hot staging, boostback and the tower catch, step by step.',
	},
];

let built = null;

function build() {
	if (built) return built;
	built = ENTRIES.map((entry) => {
		const { spec, warnings } = normalizeSpec(entry.spec, { strict: true });
		if (warnings.length) console.warn(`[anatomy/featured] ${entry.slug} normalized with warnings:`, warnings);
		return {
			id: entry.id,
			slug: entry.slug,
			title: spec.title,
			subtitle: spec.subtitle,
			prompt: null,
			spec,
			stats: specStats(spec),
			source: 'featured',
			model: null,
			views: 0,
			creatorUsername: null,
			createdAt: entry.createdAt,
			featured: true,
			ogImage: entry.ogImage,
			ogImageUrl: `${SITE}${entry.ogImage}`,
			shareText: entry.shareText,
		};
	});
	return built;
}

/** The featured design with this id (full spec), or null. */
export function featuredDesign(id) {
	return build().find((d) => d.id === String(id || '').toLowerCase()) || null;
}

/** Every featured design without its spec, for the gallery. */
export function featuredList() {
	return build().map(({ spec: _spec, ...rest }) => rest);
}

export function isFeaturedId(id) {
	return Boolean(featuredDesign(id));
}
