import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('demo surfaces keep house defaults', () => {
	it('the animation gallery preview stages the house rig, not a real-person likeness', () => {
		const src = read('src/animations-live-preview.js');
		expect(src).not.toContain('cz.glb');
		expect(src).toContain("from './default-stage-avatar.js'");
	});

	it('the avatar-engines sticky filter bar is opaque so headings cannot bleed through', () => {
		const html = read('pages/avatar-engines.html');
		const rule = html.slice(html.indexOf('.ae-controls {'), html.indexOf('.ae-controls-inner'));
		expect(rule).toContain('position: sticky');
		expect(rule).not.toMatch(/background:[^;]*transparent/);
	});

	it('render-lab does not mirror data-tip into a second native tooltip on wide screens', () => {
		const src = read('src/render-lab.js');
		expect(src).not.toMatch(/setAttribute\('title', el\.getAttribute\('data-tip'\)\)/);
		expect(src).toContain('aria-description');
	});

	it('restyle states its preset count in the page body, not only the meta description', () => {
		expect(read('pages/restyle.html')).toContain('id="preset-count"');
		expect(read('src/restyle.js')).toContain('MATERIAL_PRESET_NAMES.length} PBR material presets');
	});
});
