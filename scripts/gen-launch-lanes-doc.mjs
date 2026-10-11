#!/usr/bin/env node
// Regenerate the lane tables in docs/launch-lanes.md from the live lane config.
//
//   npm run docs:launch-lanes            rewrite the block between the markers
//   npm run docs:launch-lanes -- --check exit 1 when the doc is out of date
//
// The tables are built by lanesMarkdown() from launchLanes(), the same function
// behind GET /api/launches/lanes, so the doc cannot disagree with the wizard.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchLanes, lanesMarkdown } from '../api/_lib/launch-lanes.js';

const DOC = resolve(import.meta.dirname, '../docs/launch-lanes.md');
const START = '<!-- lanes:start -->';
const END = '<!-- lanes:end -->';

const doc = readFileSync(DOC, 'utf8');
const a = doc.indexOf(START);
const b = doc.indexOf(END);
if (a < 0 || b < a) {
	console.error(`docs/launch-lanes.md must contain ${START} and ${END}`);
	process.exit(2);
}
const next = `${doc.slice(0, a + START.length)}\n\n${lanesMarkdown(await launchLanes())}\n\n${doc.slice(b)}`;

if (process.argv.includes('--check')) {
	if (next !== doc) {
		console.error('docs/launch-lanes.md is out of date. Run: npm run docs:launch-lanes');
		process.exit(1);
	}
	console.log('docs/launch-lanes.md is current');
} else {
	writeFileSync(DOC, next);
	console.log('docs/launch-lanes.md updated');
}
process.exit(0);
