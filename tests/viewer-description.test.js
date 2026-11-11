import { describe, it, expect } from 'vitest';
import { describe3dCanvas, KEYBOARD_HINT } from '../src/shared/viewer-description.js';

describe('describe3dCanvas', () => {
	it('names the agent and ends with the keyboard hint', () => {
		const label = describe3dCanvas({ name: 'Risk Auditor 9', description: 'Tracks grant programs and surfaces opportunities for builders.' });
		expect(label).toBe(`Risk Auditor 9, 3D avatar. Tracks grant programs and surfaces opportunities for builders. ${KEYBOARD_HINT}`);
	});

	it('falls back to a generic viewer name when nothing is known', () => {
		expect(describe3dCanvas({})).toBe(`3D model viewer. ${KEYBOARD_HINT}`);
		expect(describe3dCanvas({ name: '   ' })).toBe(`3D model viewer. ${KEYBOARD_HINT}`);
	});

	it('lets an explicit alt win and still appends the keyboard hint once', () => {
		expect(describe3dCanvas({ alt: 'A knight in silver armour', name: 'Ignored' })).toBe(`A knight in silver armour. ${KEYBOARD_HINT}`);
		const already = `Robot. ${KEYBOARD_HINT}`;
		expect(describe3dCanvas({ alt: already })).toBe(already);
	});

	it('keeps long descriptions to one sentence and a bounded length', () => {
		const long = 'First sentence is the summary. ' + 'x'.repeat(400);
		expect(describe3dCanvas({ name: 'A', description: long })).toBe(`A, 3D avatar. First sentence is the summary. ${KEYBOARD_HINT}`);
		const run = 'y'.repeat(400);
		const label = describe3dCanvas({ name: 'B', description: run });
		expect(label.length).toBeLessThan(260);
		expect(label).toContain('…');
	});

	it('uses the kind it is given', () => {
		expect(describe3dCanvas({ name: 'Chair', kind: '3D model' })).toBe(`Chair, 3D model. ${KEYBOARD_HINT}`);
	});
});
