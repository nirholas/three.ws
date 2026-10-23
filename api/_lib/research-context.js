// ResearchContext: the only handle a backtest or research module gets.
//
// It is a frozen, read-only view of a recorded dataset plus its manifest. It has
// no signing, no wallet, no order, no network and no database function, so
// research code that receives one cannot move funds even by mistake.
// tests/research-live-wall.test.js enforces the other half of the wall: no
// module in RESEARCH_MODULES may import (directly or transitively) a live
// execution module.

import { buildDatasetManifest } from './backtest-integrity.js';

/** Files that must stay on the research side of the wall. */
export const RESEARCH_MODULES = Object.freeze([
	'api/_lib/research-context.js',
	'api/_lib/backtest-integrity.js',
	'api/_lib/strategy-backtest.js',
	'api/_lib/exit-replay.js',
	'api/_lib/strategy-preview.js',
]);

/**
 * @param {object} args
 * @param {string} args.datasetId
 * @param {string} args.source
 * @param {any[]} args.rows
 * @param {(row:any)=>any} args.project
 * @param {(row:any)=>any} args.timeOf
 */
export function createResearchContext({ datasetId, source, rows, project, timeOf }) {
	const frozenRows = Object.freeze([...rows]);
	const manifest = Object.freeze(buildDatasetManifest({ id: datasetId, source, rows: frozenRows, project, timeOf }));
	return Object.freeze({
		kind: 'research',
		manifest,
		rows: frozenRows,
		/** Rows visible at or before `cutoff` (Date, ISO string or epoch ms). */
		asOf(cutoff) {
			const c = cutoff instanceof Date ? cutoff.getTime() : typeof cutoff === 'number' ? cutoff : Date.parse(cutoff);
			return frozenRows.filter((r) => {
				const t = timeOf(r);
				const ms = t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t);
				return ms <= c;
			});
		},
	});
}
