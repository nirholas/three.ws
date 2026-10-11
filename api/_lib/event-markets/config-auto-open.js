// Auto-open tunables. One source of truth: data/event-market-autoopen.json.

import { readFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync(new URL('../../../data/event-market-autoopen.json', import.meta.url), 'utf8'));

export const eventMarketsAutoOpen = Object.freeze({
	minEntrants: Number(raw.minEntrants),
	maxOutcomes: Number(raw.maxOutcomes),
	lockFractions: Object.freeze({ ...raw.lockFractions }),
	bountyResolveGraceDays: Number(raw.bountyResolveGraceDays),
	manualLockMinutes: Number(raw.manualLockMinutes),
});
