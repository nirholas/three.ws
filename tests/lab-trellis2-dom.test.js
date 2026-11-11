// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { el, fill } from '../src/lab-trellis2/dom.js';

describe('TRELLIS.2 lab DOM helpers', () => {
	it('fill leaves out optional children instead of printing "null"', () => {
		// The run-error view passes null when the error has no action link, and
		// the progress view passes null when no lane is known. replaceChildren
		// stringifies null, which showed "null" beside the Retry button.
		const box = el('div');
		fill(box, el('strong', { text: 'This run did not finish' }), null, false, undefined, el('button', {}, 'Retry'));
		expect(box.textContent).toBe('This run did not finishRetry');
		expect(box.childNodes).toHaveLength(2);
	});

	it('fill replaces what was there before', () => {
		const box = el('div', {}, 'old');
		fill(box, el('span', { text: 'new' }));
		expect(box.textContent).toBe('new');
	});

	it('el skips null children and null attributes', () => {
		const a = el('a', { href: null, class: 'x', hidden: false }, null, 'go');
		expect(a.outerHTML).toBe('<a class="x">go</a>');
	});
});
