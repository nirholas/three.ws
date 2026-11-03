// @vitest-environment jsdom
//
// The companion's "tell your agent what is wrong" control (src/feedback-companion.js)
// is styled by a stylesheet the module injects. That sheet used to be injected
// only when the report panel was first built, so until a visitor opened the
// panel the control rendered as an unstyled default button: a grey square with
// a "!" in it, out of line with its sibling discs.

import { describe, it, expect, afterEach } from 'vitest';
import { installFeedback } from '../src/feedback-companion.js';

describe('feedback companion control', () => {
	let api;
	afterEach(() => {
		api?.uninstall();
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	});

	it('is styled as soon as it is mounted, before the panel ever opens', () => {
		const host = document.createElement('div');
		host.className = 'walk-companion';
		document.body.appendChild(host);
		api = installFeedback({ getHostEl: () => host });
		const btn = host.querySelector('.walk-companion-feedback');
		expect(btn).not.toBeNull();
		expect(document.querySelector('.fb-panel')).toBeNull();
		const sheet = document.getElementById('walk-companion-feedback-style');
		expect(sheet).not.toBeNull();
		expect(getComputedStyle(btn).position).toBe('absolute');
	});
});
