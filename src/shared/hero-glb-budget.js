// Byte budget for hero 3D models that load while a page is still becoming
// interactive. A hero avatar is fetched, parsed and uploaded to the GPU on the
// critical path, so its file size is a first-order performance decision:
// a 4.6 MB model on the homepage hero cost ~20 s of total blocking time on
// Lighthouse desktop. 2.5 MB still buys a rigged, textured, animated humanoid.
export const HERO_GLB_BUDGET_BYTES = 2_500_000;

// Pick which candidates a hero may show. `budget` is a TOTAL across everything
// shown together (a carousel loads each slide), not a per-model cap.
// Candidates are taken in their given (curated) order while they fit; an
// unknown size counts as zero so an unsized model is tried rather than dropped.
// When nothing fits, return the single smallest sized candidate, because an
// over-budget hero that renders beats an empty stage.
export function pickHeroSet(candidates, { max = 3, budget = HERO_GLB_BUDGET_BYTES, sizeOf = (c) => c.sizeBytes } = {}) {
	const list = Array.isArray(candidates) ? candidates : [];
	const picked = [];
	let used = 0;
	for (const c of list) {
		if (picked.length >= max) break;
		const size = Number(sizeOf(c)) > 0 ? Number(sizeOf(c)) : 0;
		if (used + size <= budget) {
			picked.push(c);
			used += size;
		}
	}
	if (picked.length) return picked;
	const sized = list.filter((c) => Number(sizeOf(c)) > 0);
	if (!sized.length) return list.slice(0, 1);
	return [sized.reduce((a, b) => (Number(sizeOf(b)) < Number(sizeOf(a)) ? b : a))];
}
