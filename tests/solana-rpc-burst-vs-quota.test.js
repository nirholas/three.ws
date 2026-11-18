import { describe, it, expect } from 'vitest';
import {
	markEndpointCooldown,
	clearEndpointStreak,
	isEndpointCooling,
} from '../api/_lib/solana/connection.js';

// Helius answers a per-second burst with `429 max usage reached`, the same text it
// uses once the plan's credits are gone. Treating the first sighting as a spent
// quota benched the paid primary for 6h after one burst (production, 2026-11-03:
// both paid lanes cooling, every Solana-backed endpoint 503). The first sighting
// is now a short probe window, and each repeat widens it one rung (30s, 2m, 10m,
// 30m, then a 1h cap). A spent plan costs one re-probe an hour; a burst never
// costs the paid primary 6h.
const SIX_HOURS = 6 * 3_600_000;
const body = 'max usage reached';

describe('ambiguous "max usage reached" 429', () => {
	it('parks a first sighting for a short probe window, not the 6h quota window', () => {
		const url = 'https://burst-first.example/rpc';
		const ms = markEndpointCooldown(url, 429, body);
		expect(ms).toBeLessThanOrEqual(60_000);
		expect(isEndpointCooling(url)).toBe(true);
	});

	it('escalates gradually when the probe fails again instead of jumping to 6h', () => {
		// 2026-11-18: under sustained load Helius tripped the burst limiter twice in a
		// row, the second trip benched it for 6h, and a lane that answered getSlot
		// 200 sat idle while due-diligence, holders and networth 503'd on the free
		// pool. Each repeat now widens the window one rung at a time.
		const url = 'https://burst-repeat.example/rpc';
		const windows = [];
		for (let i = 0; i < 4; i++) windows.push(markEndpointCooldown(url, 429, body));
		for (let i = 1; i < windows.length; i++) expect(windows[i]).toBeGreaterThan(windows[i - 1]);
		expect(windows[1]).toBeLessThan(SIX_HOURS);
		expect(windows[3]).toBeLessThan(SIX_HOURS);
	});

	it('caps a long ambiguous streak at a 1h re-probe, never the 6h quota window', () => {
		const url = 'https://burst-streak.example/rpc';
		let ms = 0;
		for (let i = 0; i < 12; i++) ms = markEndpointCooldown(url, 429, body);
		expect(ms).toBe(3_600_000);
	});

	it('forgets the streak once the lane serves a request, so the next burst is a probe again', () => {
		const url = 'https://burst-recovered.example/rpc';
		markEndpointCooldown(url, 429, body);
		clearEndpointStreak(url);
		const ms = markEndpointCooldown(url, 429, body);
		expect(ms).toBeLessThanOrEqual(60_000);
	});

	it('still parks an unambiguous daily-cap signal for 6h on the first sighting', () => {
		const ms = markEndpointCooldown('https://qn-daily.example/rpc', 429, 'daily request limit reached - upgrade your account');
		expect(ms).toBeGreaterThanOrEqual(SIX_HOURS);
	});
});
