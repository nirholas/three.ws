// Entrant kit and referral settings, read from data/event-markets-referrals.json
// so the docs, the kit page and the credit rule share one number.

import { readFileSync } from 'node:fs';

let cached;

export function entrantConfig() {
	cached ??= JSON.parse(readFileSync(new URL('../../../data/event-markets-referrals.json', import.meta.url), 'utf8'));
	return cached;
}
