// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('public/easter-eggs.js', 'utf8');
const press = (key, target = document.body) =>
	target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('public/easter-eggs.js', () => {
	beforeEach(() => {
		delete window.__threeEggs;
		document.body.innerHTML = '';
		localStorage.clear();
		window.matchMedia = () => ({ matches: false });
		(0, eval)(src);
	});

	it('the Konami code shows the toast and records the discovery', () => {
		['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'].forEach((k) => press(k));
		expect(document.querySelector('.twx-egg-toast').textContent).toMatch(/Konami/);
		expect(JSON.parse(localStorage.getItem('twx_eggs'))).toContain('konami');
	});

	it('typing "three" fires the burst, but never while typing in a field', () => {
		const input = document.createElement('input');
		document.body.append(input);
		[...'three'].forEach((k) => press(k, input));
		expect(document.querySelector('.twx-egg-toast')).toBeNull();
		[...'three'].forEach((k) => press(k));
		expect(document.querySelector('.twx-egg-toast').textContent).toMatch(/three/);
	});

	it('seven quick logo clicks flip the logo', () => {
		document.body.innerHTML = '<a href="/"><img alt="logo"></a>';
		const img = document.querySelector('img');
		for (let i = 0; i < 7; i++) img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(img.classList.contains('twx-egg-flip')).toBe(true);
	});
});
