import { describe, it, expect, beforeEach } from 'vitest';

// We test `setReport` and `setResponse` in isolation. They are pure given input.
// `validate()` itself requires browser APIs (fetch, THREE.Cache) — out of scope here.

// Import by patching out the browser-only bits. `validator.js` imports
// `three` and `gltf-validator` at module-load; those have no side effects in node.
import { Validator } from '../../src/validator.js';

function makeReport({
	errors = [],
	warnings = [],
	infos = [],
	hints = [],
	generator = 'test-gen 1.0',
} = {}) {
	const messages = [
		...errors.map((m) => ({ severity: 0, ...m })),
		...warnings.map((m) => ({ severity: 1, ...m })),
		...infos.map((m) => ({ severity: 2, ...m })),
		...hints.map((m) => ({ severity: 3, ...m })),
	];
	return {
		info: { generator },
		issues: {
			numErrors: errors.length,
			numWarnings: warnings.length,
			numInfos: infos.length,
			numHints: hints.length,
			messages,
			maxSeverity: -1,
		},
	};
}

describe('Validator.setReport', () => {
	let validator;

	beforeEach(() => {
		validator = new Validator(null);
	});

	it('splits messages by severity', () => {
		const report = makeReport({
			errors: [{ code: 'E1', message: 'err', pointer: '/a' }],
			warnings: [{ code: 'W1', message: 'warn', pointer: '/b' }],
			infos: [{ code: 'I1', message: 'info', pointer: '/c' }],
			hints: [{ code: 'H1', message: 'hint', pointer: '/d' }],
		});

		validator.setReport(report, null);

		expect(validator.report.errors).toHaveLength(1);
		expect(validator.report.warnings).toHaveLength(1);
		expect(validator.report.infos).toHaveLength(1);
		expect(validator.report.hints).toHaveLength(1);
	});

	it('sets maxSeverity to the most severe non-empty level', () => {
		const onlyHints = makeReport({ hints: [{ code: 'H1', message: 'h', pointer: '' }] });
		validator.setReport(onlyHints, null);
		expect(validator.report.issues.maxSeverity).toBe(3);

		const withWarning = makeReport({
			warnings: [{ code: 'W1', message: 'w', pointer: '' }],
			hints: [{ code: 'H1', message: 'h', pointer: '' }],
		});
		validator.setReport(withWarning, null);
		expect(validator.report.issues.maxSeverity).toBe(1);

		const withError = makeReport({
			errors: [{ code: 'E1', message: 'e', pointer: '' }],
			warnings: [{ code: 'W1', message: 'w', pointer: '' }],
		});
		validator.setReport(withError, null);
		expect(validator.report.issues.maxSeverity).toBe(0);
	});

	it('leaves maxSeverity at -1 when there are no issues', () => {
		const clean = makeReport();
		validator.setReport(clean, null);
		expect(validator.report.issues.maxSeverity).toBe(-1);
	});

	it('copies generator onto the report', () => {
		const report = makeReport({ generator: 'Blender 4.0' });
		validator.setReport(report, null);
		expect(validator.report.generator).toBe('Blender 4.0');
	});

	it('uses empty string when info.generator is missing', () => {
		const report = {
			info: {},
			issues: {
				numErrors: 0,
				numWarnings: 0,
				numInfos: 0,
				numHints: 0,
				messages: [],
				maxSeverity: -1,
			},
		};
		validator.setReport(report, null);
		expect(validator.report.generator).toBe('');
	});

	it('aggregates multiple ACCESSOR_NON_UNIT errors on the same pointer', () => {
		const report = makeReport({
			errors: [
				{ code: 'ACCESSOR_NON_UNIT', message: 'not unit', pointer: '/meshes/0' },
				{ code: 'ACCESSOR_NON_UNIT', message: 'not unit', pointer: '/meshes/0' },
				{ code: 'ACCESSOR_NON_UNIT', message: 'not unit', pointer: '/meshes/0' },
			],
		});
		validator.setReport(report, null);

		expect(validator.report.errors).toHaveLength(1);
		const [aggregated] = validator.report.errors;
		expect(aggregated.code).toBe('ACCESSOR_NON_UNIT');
		expect(aggregated.pointer).toBe('/meshes/0');
		expect(aggregated.message).toMatch(/3 accessor elements/);
		expect(aggregated.message).toMatch(/\[AGGREGATED\]/);
	});

	it('aggregates per pointer independently when one pointer repeats', () => {
		const report = makeReport({
			errors: [
				{ code: 'ACCESSOR_NON_UNIT', message: 'not unit', pointer: '/meshes/0' },
				{ code: 'ACCESSOR_NON_UNIT', message: 'not unit', pointer: '/meshes/0' },
				{ code: 'ACCESSOR_NON_UNIT', message: 'not unit', pointer: '/meshes/1' },
			],
		});
		validator.setReport(report, null);
		// /meshes/0 occurs twice → one aggregated entry replaces the two originals.
		// /meshes/1 occurs once → the original is kept as-is, no aggregation.
		const aggregated = validator.report.errors.filter((e) => /\[AGGREGATED\]/.test(e.message));
		expect(aggregated).toHaveLength(1);
		expect(aggregated[0].pointer).toBe('/meshes/0');
		expect(aggregated[0].message).toMatch(/2 accessor elements/);
		const singles = validator.report.errors.filter((e) => !/\[AGGREGATED\]/.test(e.message));
		expect(singles).toHaveLength(1);
		expect(singles[0].pointer).toBe('/meshes/1');
	});

	it('aggregates ACCESSOR_ANIMATION_INPUT_NON_INCREASING', () => {
		const report = makeReport({
			errors: [
				{ code: 'ACCESSOR_ANIMATION_INPUT_NON_INCREASING', message: 'bad', pointer: '/a' },
				{ code: 'ACCESSOR_ANIMATION_INPUT_NON_INCREASING', message: 'bad', pointer: '/a' },
				{ code: 'ACCESSOR_ANIMATION_INPUT_NON_INCREASING', message: 'bad', pointer: '/a' },
			],
		});
		validator.setReport(report, null);
		expect(validator.report.errors).toHaveLength(1);
		expect(validator.report.errors[0].message).toMatch(/3 animation input/);
	});

	it('leaves unaggregated error codes untouched', () => {
		const report = makeReport({
			errors: [
				{ code: 'SOME_OTHER_CODE', message: 'x', pointer: '/a' },
				{ code: 'SOME_OTHER_CODE', message: 'x', pointer: '/a' },
			],
		});
		validator.setReport(report, null);
		expect(validator.report.errors).toHaveLength(2);
	});
});

describe('Validator.setResponse', () => {
	let validator;

	beforeEach(() => {
		validator = new Validator(null);
		validator.setReport(
			{
				info: { generator: 'x' },
				issues: {
					numErrors: 0,
					numWarnings: 0,
					numInfos: 0,
					numHints: 0,
					messages: [],
					maxSeverity: -1,
				},
			},
			null,
		);
	});

	it('no-ops when response is falsy', () => {
		validator.setResponse(null);
		expect(validator.report.info.extras).toBeUndefined();
	});

	it('no-ops when parser json is missing', () => {
		validator.setResponse({ parser: {} });
		expect(validator.report.info.extras).toBeUndefined();
	});

	it('extracts asset extras when present', () => {
		const response = {
			parser: {
				json: {
					asset: {
						extras: {
							author: 'Jane',
							license: 'CC-BY',
							source: 'https://example.com/',
							title: 'My Model',
						},
					},
				},
			},
		};
		validator.setResponse(response);
		expect(validator.report.info.extras.title).toBe('My Model');
		expect(validator.report.info.extras.author).toBe('Jane');
		expect(validator.report.info.extras.license).toBe('CC-BY');
	});

	it('escapes HTML-unsafe characters in extras', () => {
		const response = {
			parser: {
				json: {
					asset: {
						extras: { author: '<script>alert(1)</script>' },
					},
				},
			},
		};
		validator.setResponse(response);
		expect(validator.report.info.extras.author).not.toMatch(/<script>/);
		expect(validator.report.info.extras.author).toMatch(/&lt;script&gt;/);
	});

	it('linkifies URLs in extras', () => {
		const response = {
			parser: {
				json: {
					asset: {
						extras: { source: 'See https://example.com/asset for more.' },
					},
				},
			},
		};
		validator.setResponse(response);
		expect(validator.report.info.extras.source).toMatch(
			/<a[^>]+href="https:\/\/example\.com\/asset"/,
		);
	});

	it('linkifies email addresses', () => {
		const response = {
			parser: {
				json: {
					asset: { extras: { author: 'Jane Doe <jane@example.com>' } },
				},
			},
		};
		validator.setResponse(response);
		expect(validator.report.info.extras.author).toMatch(/href="mailto:jane@example\.com"/);
	});

	it('leaves extras undefined when asset.extras is missing', () => {
		const response = { parser: { json: { asset: {} } } };
		validator.setResponse(response);
		expect(validator.report.info.extras).toBeUndefined();
	});
});

describe('Validator.setReportException', () => {
	it('clears the report on error', () => {
		const validator = new Validator(null);
		validator.report = { dummy: true };
		validator.setReportException(new Error('boom'));
		expect(validator.report).toBeNull();
	});
});
