// @vitest-environment jsdom
//
// The signed-in console pill shows the visitor's display name, and nav.css caps
// its width with an ellipsis so a long name cannot push the header row past the
// viewport (a 17-character username overflowed the page by 13px at 1280px).
// Once truncated, the full name has to stay reachable: nav-auth mirrors it into
// the title attribute, and removes that title again on sign-out.

import { describe, it, expect, beforeEach } from 'vitest';
import navAuth from '../public/nav-auth.js';

const { applyAuthState } = navAuth;

function pill(attrs = '') {
	document.body.innerHTML = `<a class="console" data-auth-name ${attrs}>Console →</a>`;
	return document.querySelector('.console');
}

describe('nav-auth display-name title', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('mirrors the signed-in display name into the title', () => {
		const el = pill();
		applyAuthState(document, true, 'qa-audit-28738536');
		expect(el.textContent).toBe('qa-audit-28738536');
		expect(el.getAttribute('title')).toBe('qa-audit-28738536');
	});

	it('drops the name title on sign-out', () => {
		const el = pill();
		applyAuthState(document, true, 'Ada Lovelace');
		applyAuthState(document, false, null);
		expect(el.textContent).toBe('Console →');
		expect(el.hasAttribute('title')).toBe(false);
	});

	it('restores an authored title on sign-out instead of deleting it', () => {
		const el = pill('title="Open your console"');
		applyAuthState(document, true, 'Ada Lovelace');
		expect(el.getAttribute('title')).toBe('Ada Lovelace');
		applyAuthState(document, false, null);
		expect(el.getAttribute('title')).toBe('Open your console');
	});
});
