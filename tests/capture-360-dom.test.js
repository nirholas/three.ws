// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { h } from '../src/capture-360-dom.js';

describe('capture-360 h()', () => {
	it('skips null and false children instead of printing them', () => {
		const el = h('div', {}, 'Training', null, false, h('span', {}, 'x'), undefined);
		expect(el.textContent).toBe('Trainingx');
	});
	it('keeps zero and empty-string children, and sets attributes and listeners', () => {
		let clicked = 0;
		const el = h('button', { class: 'pc-btn', type: 'button', disabled: false, onclick: () => clicked++ }, 0, '');
		expect(el.textContent).toBe('0');
		expect(el.className).toBe('pc-btn');
		expect(el.hasAttribute('disabled')).toBe(false);
		el.click();
		expect(clicked).toBe(1);
	});
});
