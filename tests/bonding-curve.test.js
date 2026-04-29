// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBondingCurve } from '../src/components/bonding-curve.js';

describe('mountBondingCurve', () => {
	let container;

	beforeEach(() => {
		container = document.createElement('div');
	});

	it('renders an SVG element', () => {
		mountBondingCurve(container, { progressPct: 0 });
		const svg = container.querySelector('svg');
		expect(svg).toBeTruthy();
		expect(svg.tagName.toLowerCase()).toBe('svg');
	});

	it('SVG contains a curve path and a marker', () => {
		mountBondingCurve(container, { progressPct: 25 });
		expect(container.querySelector('.bc-marker')).toBeTruthy();
		expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(1);
	});

	it('update({ progressPct: 50 }) moves the marker to a new x position', () => {
		const { update } = mountBondingCurve(container, { progressPct: 10 });
		const marker = container.querySelector('.bc-marker');
		const before = marker.style.transform;

		update({ progressPct: 50 });

		expect(marker.style.transform).not.toBe(before);
		expect(marker.style.transform).toMatch(/translate/);
	});

	it('update moves the circle cy to reflect the new curve position', () => {
		const { update } = mountBondingCurve(container, { progressPct: 10 });
		const circle = container.querySelector('.bc-marker circle');
		const cyBefore = circle.getAttribute('cy');

		update({ progressPct: 80 });

		expect(circle.getAttribute('cy')).not.toBe(cyBefore);
	});

	it('destroy() empties the container', () => {
		const { destroy } = mountBondingCurve(container, { progressPct: 30 });
		destroy();
		expect(container.innerHTML).toBe('');
	});

	it('renders with default opts', () => {
		mountBondingCurve(container);
		expect(container.querySelector('svg')).toBeTruthy();
	});

	it('shows graduation cap label', () => {
		mountBondingCurve(container, { graduationCapUsd: 69_000 });
		expect(container.innerHTML).toContain('69');
	});
});
