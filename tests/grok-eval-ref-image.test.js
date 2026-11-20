// Unit tests for the pure pieces of scripts/grok-eval-ref-image.mjs: the
// reference-image analyzer (fed real PNGs rendered with sharp), the objective
// score, and the concurrency gate that serializes the image step.

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { analyzeReferenceImage, objectiveScore, createGate } from '../scripts/grok-eval-ref-image.mjs';

async function png(svgBody, size = 512) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#ffffff"/>${svgBody}</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('analyzeReferenceImage', () => {
	it('passes one centered subject on a clean white ground', async () => {
		const a = await analyzeReferenceImage(await png('<circle cx="256" cy="256" r="150" fill="#b03020"/>'));
		expect(a.checks.bgClean).toBe(true);
		expect(a.checks.singleSubject).toBe(true);
		expect(a.checks.centered).toBe(true);
		expect(a.checks.saneFill).toBe(true);
		expect(a.checks.notCropped).toBe(true);
	});

	it('flags two separate subjects', async () => {
		const a = await analyzeReferenceImage(
			await png('<circle cx="140" cy="256" r="90" fill="#203080"/><circle cx="372" cy="256" r="90" fill="#203080"/>'),
		);
		expect(a.checks.singleSubject).toBe(false);
	});

	it('flags a subject cut off by the frame edge', async () => {
		const a = await analyzeReferenceImage(await png('<rect x="300" y="100" width="300" height="300" fill="#207040"/>'));
		expect(a.checks.notCropped).toBe(false);
		expect(a.checks.centered).toBe(false);
	});

	it('flags a tiny subject as a bad fill', async () => {
		const a = await analyzeReferenceImage(await png('<circle cx="256" cy="256" r="12" fill="#111111"/>'));
		expect(a.checks.saneFill).toBe(false);
	});
});

describe('objectiveScore', () => {
	it('scores 100 when every check passes and 0 when none do', () => {
		const full = {
			image: { checks: { bgClean: true, singleSubject: true, centered: true, saneFill: true, notCropped: true } },
			mesh: { ok: true, metrics: { closed: true } },
			render: { ok: true },
		};
		expect(objectiveScore(full)).toBe(100);
		expect(objectiveScore({})).toBe(0);
	});

	it('drops exactly the weight of a failed stage', () => {
		const row = {
			image: { checks: { bgClean: true, singleSubject: true, centered: true, saneFill: true, notCropped: true } },
			mesh: { ok: true, metrics: { closed: false } },
			render: { ok: false },
		};
		expect(objectiveScore(row)).toBe(75);
	});
});

describe('createGate', () => {
	it('never runs more than n tasks at once and keeps FIFO order', async () => {
		const gate = createGate(1);
		let active = 0;
		let peak = 0;
		const order = [];
		const task = (id) =>
			gate(async () => {
				active++;
				peak = Math.max(peak, active);
				await new Promise((r) => setImmediate(r));
				order.push(id);
				active--;
				return id;
			});
		const out = await Promise.all([task('a'), task('b'), task('c')]);
		expect(out).toEqual(['a', 'b', 'c']);
		expect(order).toEqual(['a', 'b', 'c']);
		expect(peak).toBe(1);
	});

	it('releases the slot when a task throws', async () => {
		const gate = createGate(1);
		await expect(gate(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
		await expect(gate(async () => 'next')).resolves.toBe('next');
	});
});
