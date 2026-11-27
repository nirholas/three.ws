// The /forge composer's multi-photo behavior that the server cannot enforce:
// the person can reorder and remove photos with the keyboard as well as the
// pointer, and the notice the server sends about photos it did not use (a
// one-image engine, or photos the checks left out) reaches the page.
// src/forge.js boots against the live DOM, so these pin the wiring in source,
// the same way tests/forge-view-slots.test.js does.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(ROOT, 'src/forge.js'), 'utf8');

describe('forge composer: photo order and notices', () => {
	it('shows the server views_note beside any lane fallback notice', () => {
		expect(src).toMatch(/job\.failover_note \|\| job\.lane_fallback\?\.reason, job\.views_note/);
		expect(src).toMatch(/if \(laneNotice\) setLaneNote\(laneNotice\)/);
	});

	it('reorders an uploaded photo with Alt+Arrow and moves focus with it', () => {
		expect(src).toMatch(/e\.altKey && step/);
		expect(src).toMatch(/swapSlots\(i, to\);\s*slotEl\(to\)\?\.focus\(\)/);
	});

	it('removes an uploaded photo with Delete', () => {
		expect(src).toMatch(/e\.key === 'Delete' \|\| e\.key === 'Backspace'[\s\S]{0,80}clearSlot\(i\)/);
	});

	it('tells assistive tech how to reorder and remove', () => {
		expect(src).toMatch(/Alt with an arrow key to reorder, Delete to remove/);
	});
});
