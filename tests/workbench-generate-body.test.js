// src/workbench/runner.js generateBody(): the Workbench generate node's params
// (src/workbench/workflows.js) map onto a /api/forge POST body. Covers the
// pose and bbox passthrough added alongside api/forge-batch.js, since both
// are additive, off-by-default fields and a typo here would silently drop
// them rather than error.

import { describe, expect, it } from 'vitest';
import { generateBody } from '../src/workbench/runner.js';

const baseParams = { tier: 'standard' };
const prompted = { prompt: 'a red chair' };

describe('generateBody', () => {
	it('omits pose and bbox when unset', () => {
		const body = generateBody(baseParams, prompted);
		expect(body).not.toHaveProperty('pose');
		expect(body).not.toHaveProperty('bbox');
	});

	it('forwards a requested pose', () => {
		const body = generateBody({ ...baseParams, pose: 't' }, prompted);
		expect(body.pose).toBe('t');
	});

	it('forwards a complete bbox as [x, y, z]', () => {
		const body = generateBody({ ...baseParams, bbox_x: 2, bbox_y: 3, bbox_z: 1.5 }, prompted);
		expect(body.bbox).toEqual([2, 3, 1.5]);
	});

	it('drops bbox when only some axes are set', () => {
		const body = generateBody({ ...baseParams, bbox_x: 2, bbox_y: '', bbox_z: 1.5 }, prompted);
		expect(body).not.toHaveProperty('bbox');
	});

	it('drops bbox when an axis is zero or negative', () => {
		const body = generateBody({ ...baseParams, bbox_x: 0, bbox_y: 3, bbox_z: 1.5 }, prompted);
		expect(body).not.toHaveProperty('bbox');
	});

	it('still forwards target_polycount and seed unchanged', () => {
		const body = generateBody({ ...baseParams, target_polycount: 20000, seed: 7 }, prompted);
		expect(body.target_polycount).toBe(20000);
		expect(body.seed).toBe(7);
	});
});
