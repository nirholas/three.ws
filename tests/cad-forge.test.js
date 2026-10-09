import { describe, expect, it } from 'vitest';
import { applyParams, massGrams, paramsKey, parseDesign } from '../src/cad/params.js';
import { extractProgram, repairMessage } from '../api/_lib/cad/prompt.js';
import { CadForgeError, forgeDesign } from '../api/_lib/cad/forge.js';

const PROGRAM = `# title: Wall bracket
# summary: A pipe bracket with two screw holes.
from build123d import *
import math

WIDTH = 80  # Overall width [40..160 mm]
WALL = 2.4  # Wall thickness [1.2..6 mm]
SLOTS = 6  # Slot count [2..12 count]
BAD = 5  # Inverted range [9..3 mm]
NOT_A_PARAM = 7
WIDTH = 99  # Duplicate [1..200 mm]

result = Box(WIDTH, 20, WALL)
`;

describe('CAD Forge parameter contract', () => {
	it('parses title, summary and annotated constants into sliders', () => {
		const meta = parseDesign(PROGRAM);
		expect(meta.title).toBe('Wall bracket');
		expect(meta.summary).toBe('A pipe bracket with two screw holes.');
		expect(meta.params.map((p) => p.name)).toEqual(['WIDTH', 'WALL', 'SLOTS', 'BAD']);
		const [width, wall, slots, bad] = meta.params;
		expect(width).toMatchObject({ label: 'Overall width', value: 80, min: 40, max: 160, step: 1, unit: 'mm', line: 6 });
		expect(wall).toMatchObject({ value: 2.4, step: 0.1 });
		expect(slots).toMatchObject({ unit: 'count', step: 1 });
		expect(bad).toMatchObject({ min: 3, max: 9, value: 5 });
	});

	it('rewrites only the annotated value, clamped and snapped', () => {
		const { code, applied } = applyParams(PROGRAM, { WIDTH: 500, WALL: 3.04, SLOTS: 7.6, NOT_A_PARAM: 1, UNKNOWN: 3 });
		expect(applied).toEqual({ WIDTH: 160, WALL: 3, SLOTS: 8 });
		expect(code).toContain('WIDTH = 160  # Overall width [40..160 mm]');
		expect(code).toContain('WALL = 3  # Wall thickness [1.2..6 mm]');
		expect(code).toContain('NOT_A_PARAM = 7');
		expect(code).toContain('WIDTH = 99  # Duplicate [1..200 mm]');
		expect(parseDesign(code).params[0].value).toBe(160);
	});

	it('keys value sets independent of order', () => {
		expect(paramsKey({ A: 1, B: 2 })).toBe(paramsKey({ B: 2, A: 1 }));
		expect(paramsKey({ A: 1 })).not.toBe(paramsKey({ A: 2 }));
		expect(paramsKey({ A: 1 })).toMatch(/^[0-9a-z]{1,16}$/);
	});

	it('estimates mass from kernel volume', () => {
		expect(massGrams(1000, 1.24)).toBeCloseTo(1.24);
	});
});

describe('CAD Forge program extraction', () => {
	it('reads a fenced block, an unterminated one, and bare code', () => {
		expect(extractProgram('Here:\n```python\nresult = 1\n```\nDone')).toBe('result = 1');
		expect(extractProgram('```python\nfrom build123d import *\nresult = Box(1, 1, 1)')).toContain('Box(1, 1, 1)');
		expect(extractProgram('from build123d import *\nresult = Box(1,1,1)')).toContain('result');
		expect(extractProgram('I cannot help with that.')).toBe('');
	});

	it('quotes the failing line back to the writer', () => {
		const msg = repairMessage({ request: 'a box', code: 'a = 1\nb = oops()\n', error: { kind: 'runtime', message: 'NameError', line: 2 } });
		expect(msg).toContain('The failing line 2 is: b = oops()');
	});
});

const ok = (solids = 1) => ({ ok: true, metrics: { solids, size_mm: [1, 1, 1] }, artifacts: {} });
const fail = (message) => ({ ok: false, error: { kind: 'runtime', message, line: 3 } });
const program = (n) => ({ code: `# title: Part ${n}\nWIDTH = 10  # Width [5..20 mm]\nresult = Box(WIDTH, 1, 1)`, model: 'test-model', provider: 'test' });

function scripted(builds) {
	const writes = [];
	const queue = [...builds];
	return {
		writes,
		writeImpl: async ({ user }) => {
			writes.push(user);
			return program(writes.length);
		},
		buildImpl: async () => queue.shift(),
	};
}

describe('CAD Forge write, build, repair loop', () => {
	it('returns the first build the kernel accepts', async () => {
		const s = scripted([ok()]);
		const stages = [];
		const design = await forgeDesign({ prompt: 'a box', ...s, onEvent: (e) => stages.push(e.stage) });
		expect(design.title).toBe('Part 1');
		expect(design.params[0].name).toBe('WIDTH');
		expect(stages).toEqual(['writing', 'building', 'built']);
	});

	it('feeds kernel errors back until the part builds', async () => {
		const s = scripted([fail('fillet failed'), ok()]);
		const design = await forgeDesign({ prompt: 'a box', ...s });
		expect(design.title).toBe('Part 2');
		expect(s.writes[1]).toContain('fillet failed');
		expect(design.attempts).toHaveLength(2);
	});

	it('asks once for a connected part and keeps the first build if the repair fails', async () => {
		const s = scripted([ok(2), fail('boolean failed'), fail('again'), fail('still')]);
		const design = await forgeDesign({ prompt: 'a bracket', ...s });
		expect(s.writes[1]).toContain('2 separate solids');
		expect(design.title).toBe('Part 1');
		expect(design.build.metrics.solids).toBe(2);
	});

	it('prefers the connected repair when it builds', async () => {
		const s = scripted([ok(3), ok(1)]);
		const design = await forgeDesign({ prompt: 'a bracket', ...s });
		expect(design.title).toBe('Part 2');
		expect(design.build.metrics.solids).toBe(1);
	});

	it('keeps an accepted multi-body part when a later repair cannot reach a writer', async () => {
		let writes = 0;
		const builds = [ok(2), fail('boolean failed')];
		const design = await forgeDesign({
			prompt: 'a bracket',
			buildImpl: async () => builds.shift(),
			writeImpl: async () => {
				writes++;
				if (writes === 3) throw new CadForgeError('writer_unavailable', 'busy', 503);
				return program(writes);
			},
		});
		expect(design.title).toBe('Part 1');
		expect(design.build.metrics.solids).toBe(2);
	});

	it('gives up with the last kernel error after the repair budget', async () => {
		const s = scripted([fail('a'), fail('b'), fail('c'), fail('d')]);
		const err = await forgeDesign({ prompt: 'a box', ...s }).catch((e) => e);
		expect(err).toBeInstanceOf(CadForgeError);
		expect(err.code).toBe('design_failed');
		expect(err.status).toBe(422);
		expect(err.detail.lastError.message).toBe('d');
		expect(s.writes).toHaveLength(4);
	});
});
