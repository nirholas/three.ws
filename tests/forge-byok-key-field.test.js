// @vitest-environment jsdom
// The key field on the Forge surfaces: not an autofill target, clearable on
// demand, and the page copy says exactly what happens to the key.
import { describe, it, expect, beforeEach } from 'vitest';
import { byokUseNote, mountByokKeyField } from '../src/shared/byok-key-ui.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');

function field(value = '') {
	document.body.innerHTML = '<div class="row"><input id="k" type="password" autocomplete="off"></div>';
	const input = document.getElementById('k');
	input.value = value;
	return input;
}

describe('mountByokKeyField', () => {
	beforeEach(() => {
		document.head.innerHTML = '';
	});

	it('turns off autofill and password-manager capture', () => {
		const input = field();
		mountByokKeyField(input);
		expect(input.getAttribute('autocomplete')).toBe('new-password');
		expect(input.hasAttribute('data-1p-ignore')).toBe(true);
		expect(input.getAttribute('data-lpignore')).toBe('true');
	});

	it('shows Clear only while there is something to clear', () => {
		const input = field();
		mountByokKeyField(input);
		const clear = document.querySelector('.byok-clear');
		expect(clear.hidden).toBe(true);
		input.value = 'tsk_something_long_enough';
		input.dispatchEvent(new Event('input'));
		expect(clear.hidden).toBe(false);
	});

	it('Clear empties the field, tells the page through an input event, and refocuses', () => {
		const input = field('tsk_something_long_enough');
		mountByokKeyField(input);
		let seen = null;
		input.addEventListener('input', () => {
			seen = input.value;
		});
		input.setAttribute('aria-invalid', 'true');
		document.querySelector('.byok-clear').click();
		expect(input.value).toBe('');
		expect(seen).toBe('');
		expect(input.hasAttribute('aria-invalid')).toBe(false);
		expect(document.activeElement).toBe(input);
		expect(document.querySelector('.byok-clear').hidden).toBe(true);
	});

	it('is idempotent: mounting twice adds one button and one style', () => {
		const input = field();
		mountByokKeyField(input);
		mountByokKeyField(input);
		expect(document.querySelectorAll('.byok-clear')).toHaveLength(1);
		expect(document.querySelectorAll('#byok-clear-style')).toHaveLength(1);
	});

	it('tolerates a missing input', () => {
		expect(() => mountByokKeyField(null)()).not.toThrow();
	});
});

describe('the promise the page makes about the key', () => {
	it('says where it goes and how long it lives', () => {
		const note = byokUseNote('Meshy AI');
		expect(note).toMatch(/HTTPS/);
		expect(note).toMatch(/only to Meshy AI/);
		expect(note).toMatch(/memory/);
		expect(note).toMatch(/never stored/);
	});

	it('is not prefilled and is a password field on every surface that has one', () => {
		for (const page of ['pages/forge.html', 'pages/forge-studio.html']) {
			const html = read(page);
			const tag = html.match(/<input[^>]*id="provider-key"[^>]*>/s)[0];
			expect(tag).toMatch(/type="password"/);
			expect(tag).toMatch(/autocomplete="new-password"/);
			expect(tag).not.toMatch(/\bvalue=/);
			expect(tag).not.toMatch(/kept in this browser/);
		}
		const home = read('pages/home.html');
		const tag = home.match(/<input[^>]*data-hf-byok-key[^>]*>/s)[0];
		expect(tag).toMatch(/type="password"/);
		expect(tag).not.toMatch(/\bvalue=/);
	});

	it('the page code never writes the key to browser storage', () => {
		for (const file of ['src/forge.js', 'src/forge-studio/forge.js', 'src/home-forge-controls.js']) {
			const src = read(file);
			const writesStorage = /(?:local|session)Storage\.setItem\([^)]*(?:providerKey|byokKey|provider[-_]key)/i.test(src);
			expect(writesStorage, file).toBe(false);
		}
	});
});
