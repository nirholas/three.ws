// Tunables for the live odds feed. The values live in data/event-markets-feed.json
// so a move threshold or a connection cap changes without touching code.

import { readFileSync } from 'node:fs';

export const feedConfig = Object.freeze(
	JSON.parse(readFileSync(new URL('../../../data/event-markets-feed.json', import.meta.url), 'utf8')),
);
