// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { el } from '../src/game/gacha-dom.js';

describe('gacha el()', () => {
	it('applies CSS custom properties from a style object (tier colours)', () => {
		const pill = el('span', { class: 'ga-tier-pill', style: { '--ga-tier': '#ffb020', '--ga-glow': 'rgba(255,176,32,0.6)' } }, 'Epic');
		expect(pill.style.getPropertyValue('--ga-tier')).toBe('#ffb020');
		expect(pill.style.getPropertyValue('--ga-glow')).toBe('rgba(255,176,32,0.6)');
	});

	it('still applies ordinary camelCase style properties', () => {
		const n = el('div', { style: { backgroundColor: 'rgb(1, 2, 3)', width: '40px' } });
		expect(n.style.backgroundColor).toBe('rgb(1, 2, 3)');
		expect(n.style.width).toBe('40px');
	});

	it('skips null and false style values', () => {
		const n = el('div', { style: { '--ga-tier': null, width: false } });
		expect(n.style.getPropertyValue('--ga-tier')).toBe('');
		expect(n.style.width).toBe('');
	});

	it('handles class, text, hidden, listeners, attributes and kids', () => {
		let clicked = 0;
		const n = el('button', { class: 'a b', hidden: true, onclick: () => clicked++, 'aria-label': 'Go', 'aria-pressed': true, title: null }, ['x', null, el('i')]);
		expect(n.className).toBe('a b');
		expect(n.hidden).toBe(true);
		expect(n.getAttribute('aria-label')).toBe('Go');
		expect(n.getAttribute('aria-pressed')).toBe('');
		expect(n.hasAttribute('title')).toBe(false);
		expect(n.childNodes.length).toBe(2);
		n.click();
		expect(clicked).toBe(1);
	});
});
