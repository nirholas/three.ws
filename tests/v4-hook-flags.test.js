import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	callbacksFromMask,
	formatMask,
	identifyHookForge,
	maskFromPermissions,
	permissionMask,
	permissionsFromAddress,
} from '../scripts/lib/v4-hook-flags.mjs';
import { AGENT_NATIVE, countCatalogRows, renderCatalog } from '../scripts/gen-hookforge-catalog.mjs';

const snapshot = JSON.parse(readFileSync(new URL('../data/hookforge-registry.json', import.meta.url), 'utf8'));
const addr = (low) => '0x' + 'ab'.repeat(18) + low.toString(16).padStart(4, '0');

describe('v4 hook permission bits', () => {
	it('decodes the SkinHook mask (beforeInitialize, afterSwap, afterSwapReturnsDelta)', () => {
		expect(permissionMask(addr(0x2044))).toBe(0x2044);
		expect(callbacksFromMask(0x2044)).toEqual(['afterSwapReturnsDelta', 'afterSwap', 'beforeInitialize']);
	});

	it('decodes the AgentTierHook mask (beforeInitialize, beforeSwap)', () => {
		expect(callbacksFromMask(permissionMask(addr(0x2080)))).toEqual(['beforeSwap', 'beforeInitialize']);
	});

	it('ignores address bits above the low fourteen', () => {
		expect(permissionMask(addr(0xc080))).toBe(0x0080);
	});

	it('round-trips a manifest permissions object through the mask', () => {
		const permissions = permissionsFromAddress(addr(0x1080));
		expect(maskFromPermissions(permissions)).toBe(0x1080);
		expect(formatMask(0x80)).toBe('0x0080');
	});

	it('rejects a malformed address', () => {
		expect(() => permissionMask('0x1234')).toThrow();
	});
});

describe('HookForge recognition', () => {
	it('matches by hookName in any casing or punctuation', () => {
		expect(identifyHookForge(snapshot, addr(0x1080), 'anti-snipe-ramp')?.slug).toBe('anti-snipe-ramp');
		expect(identifyHookForge(snapshot, addr(0x1080), 'AntiSnipeRamp')?.slug).toBe('anti-snipe-ramp');
	});

	it('matches a published deployment address on its own chain only', () => {
		const hook = snapshot.hooks.find((h) => h.slug === 'anti-snipe-ramp');
		const d = hook.deployments.find((x) => x.chainId === 4663);
		expect(identifyHookForge(snapshot, d.address.toLowerCase(), null, 4663)?.slug).toBe('anti-snipe-ramp');
		expect(identifyHookForge(snapshot, d.address, null, 8453)).toBeNull();
	});

	it('does not match an unrelated hook', () => {
		expect(identifyHookForge(snapshot, addr(0x80), 'DeadBuybackHook', 4663)).toBeNull();
		expect(identifyHookForge(snapshot, addr(0x80), null, 4663)).toBeNull();
	});
});

describe('HookForge catalog', () => {
	it('names only hooks that exist in the snapshot', () => {
		for (const slug of Object.keys(AGENT_NATIVE)) {
			expect(snapshot.hooks.some((h) => h.slug === slug)).toBe(true);
		}
	});

	it('renders exactly one row per registry hook', () => {
		const block = renderCatalog(snapshot);
		expect(countCatalogRows(block)).toBe(snapshot.count);
		expect(snapshot.hooks).toHaveLength(snapshot.count);
	});
});
