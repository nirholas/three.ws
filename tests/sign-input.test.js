import { describe, expect, it } from 'vitest';

import { buildColumnExtractors, extractRow, schemaUrl, requestBody, parseRecognition, MODES } from '../src/sign-input.js';

describe('buildColumnExtractors', () => {
	it('parses the worker column naming', () => {
		const ex = buildColumnExtractors(['x_face_61', 'y_left_hand_4', 'z_pose_17', 'x_right_hand_0']);
		expect(ex[0]).toEqual({ field: 'faceLandmarks', coord: 'x', idx: 61 });
		expect(ex[1]).toEqual({ field: 'leftHandLandmarks', coord: 'y', idx: 4 });
		expect(ex[2]).toEqual({ field: 'poseLandmarks', coord: 'z', idx: 17 });
		expect(ex[3]).toEqual({ field: 'rightHandLandmarks', coord: 'x', idx: 0 });
	});

	it('rejects unknown columns', () => {
		expect(() => buildColumnExtractors(['x_torso_3'])).toThrow();
	});

	it('parses the real 390-column schema', async () => {
		const { readFileSync } = await import('node:fs');
		const args = JSON.parse(
			readFileSync('workers/model-asl-recognition/inference_args.json', 'utf8'),
		);
		const ex = buildColumnExtractors(args.selected_columns);
		expect(ex).toHaveLength(390);
	});
});

describe('extractRow', () => {
	const ex = buildColumnExtractors(['x_pose_0', 'y_left_hand_2', 'z_face_1']);

	it('reads coordinates and nulls missing groups', () => {
		const result = {
			poseLandmarks: [[{ x: 0.5, y: 0.2, z: -0.1 }]],
			faceLandmarks: [[{ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0.2, z: 0.3 }]],
			// no hands detected
		};
		expect(extractRow(result, ex)).toEqual([0.5, null, 0.3]);
	});

	it('nulls everything on an empty result', () => {
		expect(extractRow({}, ex)).toEqual([null, null, null]);
		expect(extractRow(null, ex)).toEqual([null, null, null]);
	});
});

describe('recognition modes', () => {
	it('keeps the fingerspelling request exactly as it was', () => {
		expect(schemaUrl('/api/asl-recognition', 'fingerspelling')).toBe('/api/asl-recognition');
		expect(requestBody([[1]], 'fingerspelling')).toEqual({ frames: [[1]] });
	});
	it('addresses the word-level route in signs mode', () => {
		expect(schemaUrl('/api/asl-recognition', 'signs')).toBe('/api/asl-recognition?mode=signs');
		expect(requestBody([[1]], 'signs')).toEqual({ mode: 'signs', frames: [[1]] });
		expect(MODES).toEqual(['fingerspelling', 'signs']);
	});
	it('parses a ranked signs response with the best guess as text', () => {
		const r = parseRecognition({ signs: [{ sign: 'hello', probability: 0.8 }, { sign: 'yes', probability: 0.1 }], confidence: 0.8, ms: 9 }, 'signs');
		expect(r).toMatchObject({ mode: 'signs', text: 'hello', confidence: 0.8, cleaned: false, ms: 9 });
		expect(r.signs).toHaveLength(2);
	});
	it('parses an empty signs response without throwing', () => {
		expect(parseRecognition({}, 'signs')).toMatchObject({ text: '', signs: [], confidence: null });
	});
	it('parses a fingerspelling response unchanged', () => {
		expect(parseRecognition({ text: 'hi', raw: 'h i', confidence: 0.7, cleaned: true }, 'fingerspelling')).toEqual({
			mode: 'fingerspelling', text: 'hi', raw: 'h i', confidence: 0.7, cleaned: true, ms: undefined,
		});
	});
});
