// Isomorphic core of the engine-qa grade: the thresholds and pure math that
// both the server grader (api/_lib/engine-qa.js, full report: draw calls,
// materials, texel density, triangle budget, collider) and the browser-only
// partial grader (src/engine-qa-client.js, used by Rig Doctor so a file never
// has to leave the tab for the cheap checks) must agree on. Zero imports: no
// Node builtin, no gltf-transform, nothing a bundler has to special-case for
// the browser.
//
// Every number a report cites traces back to ENGINE_QA_THRESHOLDS, never a
// literal buried in a check, so the server and the browser can never grade
// the same mesh to two different verdicts.

export const ENGINE_QA_VERSION = 'threews.engine.qa.v1';

export const ENGINE_QA_THRESHOLDS = Object.freeze({
	// One real-time frame budget on mid-tier mobile hardware. Above `warn`,
	// batching/atlasing stops being optional.
	drawCalls: Object.freeze({ good: 20, warn: 60 }),
	// Distinct materials: each one is a potential draw-call split and a texture
	// set a mobile GPU has to keep resident.
	materialCount: Object.freeze({ good: 8, warn: 20 }),
	// Triangle ceiling per LOD level. A level whose own `name` isn't one of
	// these keys falls back to LOD0's ceiling (the most permissive) rather
	// than failing on an unrecognized label.
	triangleBudget: Object.freeze({ LOD0: 100_000, LOD1: 40_000, LOD2: 12_000 }),
	// Game-ready texel density window (texels per meter of surface). Below the
	// floor, textures visibly smear up close; above the ceiling, the asset is
	// paying for resolution the eye can't resolve at normal viewing distance.
	texelDensity: Object.freeze({ minPxPerMeter: 128, maxPxPerMeter: 2048 }),
	// A mesh collider heavier than this belongs on a convex-hull or primitive
	// proxy instead: not because physics engines refuse it, but because the
	// broad-phase cost stops being worth the precision.
	colliderTriangleBudget: 5_000,
});

export function worstVerdict(verdicts) {
	const real = verdicts.filter((v) => v !== 'skip');
	if (real.includes('fail')) return 'fail';
	if (real.includes('warn')) return 'warn';
	if (real.length === 0) return 'skip';
	return 'pass';
}

export function verdictFromBand(value, { good, warn }) {
	if (value <= good) return 'pass';
	if (value <= warn) return 'warn';
	return 'fail';
}

/**
 * Grade each LOD level's triangle count against ENGINE_QA_THRESHOLDS.triangleBudget
 * and confirm the chain is monotonically decreasing (highest to lowest detail).
 *
 * @param {Array<{ name: string, triangleCount: number }>|null} lods
 */
export function gradeTriangleBudget(lods) {
	if (!Array.isArray(lods) || lods.length === 0) {
		return { value: null, verdict: 'skip', reason: 'no LOD chain supplied' };
	}

	const perLevel = lods.map((level) => {
		const budget = ENGINE_QA_THRESHOLDS.triangleBudget[level.name] ?? ENGINE_QA_THRESHOLDS.triangleBudget.LOD0;
		return {
			name: level.name,
			triangleCount: level.triangleCount,
			budget,
			verdict: level.triangleCount <= budget ? 'pass' : 'fail',
		};
	});

	let monotonicDecrease = true;
	for (let i = 1; i < lods.length; i++) {
		if (lods[i].triangleCount > lods[i - 1].triangleCount) monotonicDecrease = false;
	}

	return {
		value: perLevel,
		monotonicDecrease,
		verdict: worstVerdict([...perLevel.map((l) => l.verdict), monotonicDecrease ? 'pass' : 'fail']),
	};
}
