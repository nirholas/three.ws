import { describe, it, expect } from 'vitest';
import { worstVerdict, verdictFromBand, gradeTriangleBudget, ENGINE_QA_THRESHOLDS, ENGINE_QA_VERSION } from '../api/_lib/engine-qa-core.js';

describe('engine-qa-core: the isomorphic thresholds and pure math shared by the server grader and the browser-only client grader', () => {
	it('exposes a stable version string and frozen thresholds', () => {
		expect(ENGINE_QA_VERSION).toBe('threews.engine.qa.v1');
		expect(Object.isFrozen(ENGINE_QA_THRESHOLDS)).toBe(true);
		expect(Object.isFrozen(ENGINE_QA_THRESHOLDS.drawCalls)).toBe(true);
		expect(ENGINE_QA_THRESHOLDS.drawCalls.good).toBe(20);
	});

	it('worstVerdict ignores skip and escalates fail over warn over pass', () => {
		expect(worstVerdict(['skip', 'skip'])).toBe('skip');
		expect(worstVerdict(['pass', 'skip'])).toBe('pass');
		expect(worstVerdict(['pass', 'warn'])).toBe('warn');
		expect(worstVerdict(['pass', 'warn', 'fail'])).toBe('fail');
	});

	it('verdictFromBand bands a value against good/warn ceilings', () => {
		const band = { good: 10, warn: 20 };
		expect(verdictFromBand(5, band)).toBe('pass');
		expect(verdictFromBand(15, band)).toBe('warn');
		expect(verdictFromBand(25, band)).toBe('fail');
	});

	it('gradeTriangleBudget skips a missing chain and grades a real one against the shared budget', () => {
		expect(gradeTriangleBudget(null).verdict).toBe('skip');
		expect(gradeTriangleBudget([]).verdict).toBe('skip');

		const report = gradeTriangleBudget([
			{ name: 'LOD0', triangleCount: 50_000 },
			{ name: 'LOD1', triangleCount: 45_000 },
		]);
		expect(report.value[1].budget).toBe(ENGINE_QA_THRESHOLDS.triangleBudget.LOD1);
		expect(report.value[1].verdict).toBe('fail');
		expect(report.verdict).toBe('fail');
	});
});
