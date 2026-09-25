// Every bounty source the refresh cron reads, in display order. Each module
// exports { id, label, venue, fetchListings() } and maps its upstream records
// through api/_lib/bounties/normalize.js conventions; adding a source is one
// new module plus one line here.

import * as program from './program.js';
import * as github from './github.js';
import * as devpost from './devpost.js';
import * as devfolio from './devfolio.js';

export const SOURCES = Object.freeze([program, github, devpost, devfolio]);

export const SOURCE_IDS = Object.freeze(SOURCES.map((s) => s.id));

export function sourceById(id) {
	return SOURCES.find((s) => s.id === id) || null;
}
