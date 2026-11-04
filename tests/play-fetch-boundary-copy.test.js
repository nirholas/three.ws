// Network failures at the remaining /play boundaries must show the translated
// netErrorMessage line, never the raw browser text ("Failed to fetch").

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('raw error text is replaced by netErrorMessage', () => {
	it('friends-panel', () => {
		const src = read('src/game/friends-panel.js');
		expect(src).toMatch(/import \{[^}]*netErrorMessage[^}]*\} from '\.\/net-error\.js'/);
		expect(src).not.toContain('err?.message ||');
	});
	it('npc-services', () => {
		const src = read('src/game/npc/npc-services.js');
		expect(src).toMatch(/import \{[^}]*netErrorMessage[^}]*\} from '\.\.\/net-error\.js'/);
		expect(src).toMatch(/\} else \{\s*showError\(netErrorMessage\(err, msg\)\);/);
	});
	it('coin-buy funding flow and sign-in', () => {
		const src = read('src/game/coin-buy.js');
		expect(src).toMatch(/import \{[^}]*netErrorMessage[^}]*\} from '\.\/net-error\.js'/);
		expect(src).toContain("netErrorMessage(err, 'Could not open the funding flow.')");
		expect(src).toContain("netErrorMessage(err, 'Sign-in failed.')");
	});
	// Each of these printed err.message straight into the panel, so a dropped
	// connection read "Failed to fetch" and a gateway hiccup "http 502".
	for (const [name, rel] of [
		['gacha machine pull and sell-back', 'src/game/gacha-ui.js'],
		['dance-off tip price', 'src/game/dance-off.js'],
		['signature wall signing', 'src/game/signature-wall.js'],
	]) {
		it(name, () => {
			const src = read(rel);
			expect(src).toMatch(/import \{[^}]*netErrorMessage[^}]*\} from '\.\/net-error\.js'/);
			expect(src).not.toMatch(/textContent = err\.message;/);
			expect(src).not.toMatch(/\$\{err\.message\}/);
			expect(src).not.toMatch(/\(err\.message \|\|/);
		});
	}
	// Purchases, uploads, sign-in and the holder gate printed err.message as-is,
	// so "Failed to fetch" or a bare status reached the player.
	for (const [name, rel, raw] of [
		['cosmetics shop purchase', 'src/game/cosmetics-shop.js', /Purchase failed: \$\{msg\}/],
		['boutique buy toast', 'src/game/play-systems.js', /toast\?\.\(err\?\.message \|\|/],
		['avatar upload', 'src/game/avatar-switcher.js', /_setStatus\('error', err\?\.message/],
		['play gate sign-in', 'src/game/play-gate.js', /error: err\?\.message \|\| 'Sign-in failed/],
		['spin wheel payment', 'src/game/spin-wheel-ui.js', /'Cancelled in wallet\.' : msg;/],
		['holder gate and prop upload', 'src/game/coincommunities.js', /(error: err\?\.message \|\||carryError = e\?\.message \|\||const message = err\?\.message \|\|)/],
	]) {
		it(name, () => {
			const src = read(rel);
			expect(src).toMatch(/import \{[^}]*netErrorMessage[^}]*\} from '\.\/net-error\.js'/);
			expect(src).not.toMatch(raw);
		});
	}
});

// The x402 demo round must never tell a player "No funds moved" once the
// payment has started settling, and never show raw browser text.
describe('agent commerce failure line', () => {
	let commerceFailLine;
	beforeAll(async () => {
		({ commerceFailLine } = await import('../src/game/agent-commerce.js'));
	});
	it('says no funds moved only before settlement starts', () => {
		expect(commerceFailLine(new Error(''), { active: 'built', settled: null })).toBe('Payment failed. No funds moved.');
		expect(commerceFailLine(new Error(''), { active: 'settled', settled: null })).not.toMatch(/no funds/i);
	});
	it('reports a settled payment whose result was lost', () => {
		const line = commerceFailLine(Object.assign(new Error('incomplete'), { code: 'incomplete' }), { active: 'done', settled: { tx: 'x' } });
		expect(line).toMatch(/settled/i);
		expect(line).not.toMatch(/no funds/i);
	});
	it('maps a dropped connection to the shared line', () => {
		const line = commerceFailLine(new TypeError('Failed to fetch'), { active: 'challenge', settled: null });
		expect(line).not.toMatch(/failed to fetch/i);
		expect(line).toMatch(/reach three\.ws/i);
	});
	it('keeps a real explanation from the payment service', () => {
		expect(commerceFailLine(new Error('The demo wallet is empty right now.'), { active: 'challenge', settled: null })).toBe('The demo wallet is empty right now.');
	});
});
