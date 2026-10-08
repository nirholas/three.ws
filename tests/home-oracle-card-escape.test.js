// @vitest-environment jsdom
//
// Regression guard: the homepage Oracle strip renders pump.fun coin names and
// symbols, which are chosen by whoever launches the coin. The card builder used
// to interpolate them straight into innerHTML, so a coin named with markup put
// that markup on three.ws's front page for every visitor once it scored high
// enough to surface. The builder is authored inline in pages/home.html, so the
// test lifts the IIFE out of the page source and runs it against a stubbed feed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '..', 'pages/home.html'), 'utf8');

function liftOracleIife() {
	const m = source.match(/\(async function initHomeOracle\(\) \{[\s\S]*?\n\t\}\)\(\);/);
	if (!m) throw new Error('initHomeOracle IIFE not found in pages/home.html');
	return m[0];
}

describe('homepage Oracle strip escapes coin metadata', () => {
	let realFetch;

	beforeEach(() => {
		realFetch = globalThis.fetch;
		document.body.innerHTML = '<div id="hoc-items"></div>';
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		document.body.innerHTML = '';
	});

	it('renders a hostile name, symbol and tier as text', async () => {
		const hostile = '<iframe srcdoc="x"></iframe><form id="phish"></form>';
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				items: [
					{
						mint: 'THREEsynthetic1111111111111111111111111111',
						name: hostile,
						symbol: '<b id="sym">x</b>',
						tier: '"><img id="tier">',
						score: 80,
						pillars: { pedigree: 50, structure: 50, narrative: 50, momentum: 50 },
					},
				],
			}),
		}));

		await new Function(`return ${liftOracleIife().replace(/;\s*$/, '')}`)();

		const host = document.getElementById('hoc-items');
		expect(host.querySelector('iframe')).toBeNull();
		expect(host.querySelector('form')).toBeNull();
		expect(host.querySelector('#sym')).toBeNull();
		expect(host.querySelector('#tier')).toBeNull();
		expect(host.querySelector('.hoc-name').textContent).toBe(hostile);
		expect(host.querySelector('.hoc-sym').textContent).toBe('$<B ID="SYM">X</B>');
		expect(host.querySelector('.hoc-tier').className).toBe('hoc-tier t-watch');
	});
});
