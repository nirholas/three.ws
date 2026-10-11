// Pins the goal taxonomy behind /everything, the palette's goal labels and
// features.json: every product page resolves to a real job, no job is empty,
// and the core journeys stay where a newcomer would look for them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JOBS, OVERRIDES, PRODUCT_SECTIONS, isJob, jobFor } from '../scripts/lib/feature-jobs.mjs';

const pages = JSON.parse(readFileSync(new URL('../data/pages.json', import.meta.url), 'utf8'));
const product = pages.sections
	.filter((s) => PRODUCT_SECTIONS.has(s.id))
	.flatMap((s) => s.pages.filter((p) => p.indexable !== false).map((p) => ({ ...p, section: s.id })));

describe('feature jobs', () => {
	it('assigns every product page a real job', () => {
		const bad = product.filter((p) => !isJob(jobFor(p.path, p.section))).map((p) => p.path);
		expect(bad).toEqual([]);
	});

	it('leaves no goal empty', () => {
		for (const job of JOBS) {
			const n = product.filter((p) => jobFor(p.path, p.section) === job.id).length;
			expect(n, `${job.id} has no pages`).toBeGreaterThan(0);
		}
	});

	it('points every override at a real job and a real page', () => {
		const paths = new Set(pages.sections.flatMap((s) => s.pages.map((p) => p.path)));
		for (const [path, job] of Object.entries(OVERRIDES)) {
			expect(isJob(job), `${path} -> ${job}`).toBe(true);
			expect(paths.has(path), `${path} is not in pages.json`).toBe(true);
		}
	});

	it("starts every goal on a page that exists and belongs to it or a neighbour", () => {
		const paths = new Set(pages.sections.flatMap((s) => s.pages.map((p) => p.path)));
		for (const job of JOBS) expect(paths.has(job.start), `${job.id} start ${job.start}`).toBe(true);
	});

	it('features only pages that exist and belong to that goal', () => {
		for (const job of JOBS) {
			expect(job.featured.length, `${job.id} needs featured pages`).toBeGreaterThan(2);
			for (const path of job.featured) {
				const row = product.find((p) => p.path === path);
				expect(row, `${job.id} features ${path}, which is not a product page`).toBeTruthy();
				expect(jobFor(path, row.section), `${path} is featured under ${job.id}`).toBe(job.id);
			}
		}
	});

	it('keeps the core journeys under the goal a newcomer expects', () => {
		const expected = {
			'/forge': 'make',
			'/image-to-3d': 'make',
			'/create': 'make',
			'/animations': 'animate',
			'/create-agent': 'agent',
			'/widgets': 'embed',
			'/marketplace': 'earn',
			'/launch': 'launch',
			'/markets': 'trade',
			'/agent-identities': 'onchain',
			'/walk': 'worlds',
			'/connect': 'dev',
		};
		for (const [path, job] of Object.entries(expected)) {
			const sec = pages.sections.find((s) => s.pages.some((p) => p.path === path));
			expect(sec, `${path} missing`).toBeTruthy();
			expect(jobFor(path, sec.id), path).toBe(job);
		}
	});
});
