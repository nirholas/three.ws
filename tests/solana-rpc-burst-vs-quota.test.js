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
// is now a short probe window; a lane that fails again straight after the probe
// is genuinely out and takes the long window.
const SIX_HOURS = 6 * 3_600_000;
const body = 'max usage reached';

describe('ambiguous "max usage reached" 429', () => {
	it('parks a first sighting for a short probe window, not the 6h quota window', () => {
		const url = 'https://burst-first.example/rpc';
		const ms = markEndpointCooldown(url, 429, body);
		expect(ms).toBeLessThanOrEqual(60_000);
		expect(isEndpointCooling(url)).toBe(true);
	});

	it('escalates to the 6h quota window when the probe fails again', () => {
		const url = 'https://burst-repeat.example/rpc';
		markEndpointCooldown(url, 429, body);
		const ms = markEndpointCooldown(url, 429, body);
		expect(ms).toBeGreaterThanOrEqual(SIX_HOURS);
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
