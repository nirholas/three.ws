// @vitest-environment jsdom
//
// Meetup #3 client audit (accessibility, "hotkeys never swallow typing"): the
// director view bound a bare F to fullscreen on window, so typing "f" into any
// field on that screen (the chat bar, a search box) flipped the venue display
// in and out of fullscreen. The shortcut now ignores keys aimed at a text field.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DirectorMode } from '../src/game/director-mode.js';
import { isTypingTarget } from '../src/game/a11y.js';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

function bind() {
	vi.useFakeTimers();
	const host = { cc: { canvas: null }, _lockWake() {}, _reloadSoon() {}, _wl: true };
	DirectorMode.prototype._bindResilience.call(host);
	const fs = vi.fn(() => Promise.resolve());
	document.documentElement.requestFullscreen = fs;
	return fs;
}

describe('director F shortcut', () => {
	it('does not toggle fullscreen while typing in a field', () => {
		const fs = bind();
		const input = document.body.appendChild(document.createElement('input'));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
		expect(fs).not.toHaveBeenCalled();
	});

	it('still toggles fullscreen from the page itself', () => {
		const fs = bind();
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
		expect(fs).toHaveBeenCalled();
	});
});

describe('isTypingTarget', () => {
	it('recognises text inputs, textareas, selects and editable content', () => {
		const ed = document.createElement('div');
		ed.contentEditable = 'true';
		Object.defineProperty(ed, 'isContentEditable', { value: true });
		for (const n of [document.createElement('input'), document.createElement('textarea'), document.createElement('select'), ed]) {
			expect(isTypingTarget(n)).toBe(true);
		}
		expect(isTypingTarget(document.createElement('button'))).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
	});
});
