// @vitest-environment jsdom
//
// The Forge page's seed field: it accepts what the API accepts (one shared
// contract, api/_lib/forge-seed.js), refuses junk with a message before any
// request leaves, survives a reload, and the seed it hands to a run is the seed
// it then shows.

import { beforeEach, describe, expect, it } from 'vitest';
import { mountSeedField, parseSeedInput, SEED_STORAGE_KEY } from '../src/forge-seed-field.js';
import { parseSeed } from '../api/_lib/forge-seed.js';

describe('parseSeedInput', () => {
	it.each([
		['', null],
		['   ', null],
		['0', 0],
		['1', 1],
		['2147483647', 2147483647],
		['2147483648', 2147483648],
		['4294967295', 4294967295],
		[' 42 ', 42],
		['007', 7],
		['1,234,567', 1234567],
		['1 234 567', 1234567],
		['1_234_567', 1234567],
		['4,294,967,295', 4294967295],
	])('accepts %j as %j', (text, seed) => {
		expect(parseSeedInput(text)).toEqual({ seed });
	});

	it.each([
		['4294967296', /too large/],
		['99999999999999999999999', /too large/],
		['-1', /negative/],
		['1.5', /whole numbers/],
		['NaN', /0 to 4294967295/],
		['abc', /0 to 4294967295/],
		['12a3', /0 to 4294967295/],
		['1e5', /0 to 4294967295/],
		['0x10', /0 to 4294967295/],
		['1,23', /whole numbers/],
		['12,34,567', /0 to 4294967295/],
	])('refuses %j with a message naming the problem', (text, re) => {
		const out = parseSeedInput(text);
		expect(out.seed).toBeNull();
		expect(out.error).toMatch(re);
	});

	it('agrees with the API on every value the page sends', () => {
		for (const text of ['0', '1', '2147483647', '2147483648', '4294967295', '4294967296', '-1', '1.5', 'NaN', 'x']) {
			const page = parseSeedInput(text);
			const api = parseSeed(text);
			expect(page.seed).toBe(api.seed);
			expect(Boolean(page.error)).toBe(Boolean(api.error));
		}
	});
});

function memoryStorage(initial = {}) {
	const m = new Map(Object.entries(initial));
	return {
		getItem: (k) => (m.has(k) ? m.get(k) : null),
		setItem: (k, v) => m.set(k, String(v)),
		removeItem: (k) => m.delete(k),
		map: m,
	};
}

function mount(storage = memoryStorage()) {
	document.body.innerHTML = '<input id="s"><p id="m"></p>';
	const input = document.getElementById('s');
	const msg = document.getElementById('m');
	return { input, msg, storage, field: mountSeedField({ input, msg, storage }) };
}

function type(input, value) {
	input.value = value;
	input.dispatchEvent(new Event('input'));
	input.dispatchEvent(new Event('change'));
}

describe('mountSeedField', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('mints a fresh in-range seed per run when empty', () => {
		const { field } = mount();
		const mint = () => 4294967295;
		expect(field.seedForSubmit(mint)).toBe(4294967295);
	});

	it('locks every run to the typed seed and persists it', () => {
		const { input, field, storage } = mount();
		type(input, '1,234,567');
		expect(input.value).toBe('1234567');
		expect(storage.map.get(SEED_STORAGE_KEY)).toBe('1234567');
		expect(field.seedForSubmit(() => 9)).toBe(1234567);
		expect(field.seedForSubmit(() => 9)).toBe(1234567);
	});

	it('restores the stored seed on reload', () => {
		const storage = memoryStorage({ [SEED_STORAGE_KEY]: '2147483648' });
		const { input, field, msg } = mount(storage);
		expect(input.value).toBe('2147483648');
		expect(msg.dataset.state).toBe('locked');
		expect(field.seedForSubmit(() => 9)).toBe(2147483648);
	});

	it('refuses junk: shows the error, marks the field invalid, blocks the run', () => {
		const { input, msg, field, storage } = mount();
		type(input, '4294967296');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(msg.dataset.state).toBe('error');
		expect(msg.textContent).toMatch(/too large/);
		expect(field.seedForSubmit(() => 9)).toBeNull();
		expect(storage.map.has(SEED_STORAGE_KEY)).toBe(false);
		expect(document.activeElement).toBe(input);
	});

	it('clearing the field goes back to random seeds and forgets the stored one', () => {
		const { input, field, storage } = mount(memoryStorage({ [SEED_STORAGE_KEY]: '5' }));
		type(input, '');
		expect(storage.map.has(SEED_STORAGE_KEY)).toBe(false);
		expect(field.seedForSubmit(() => 77)).toBe(77);
	});

	it('shows the seed a run used, and "Use this seed" locks exactly that value', () => {
		const { input, msg, field, storage } = mount();
		const used = field.seedForSubmit(() => 3141592653);
		field.noteUsed(used);
		expect(msg.dataset.state).toBe('used');
		expect(msg.textContent).toContain('3141592653');
		msg.querySelector('button').click();
		expect(input.value).toBe('3141592653');
		expect(storage.map.get(SEED_STORAGE_KEY)).toBe('3141592653');
		expect(field.seedForSubmit(() => 1)).toBe(3141592653);
	});

	it('a stored value that no longer parses is shown with its error, not dropped', () => {
		const { input, msg } = mount(memoryStorage({ [SEED_STORAGE_KEY]: 'banana' }));
		expect(input.value).toBe('banana');
		expect(msg.dataset.state).toBe('error');
	});
});
