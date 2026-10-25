// Parametrized regression test for the 2026-10-24 cron-budget-wiring bug class,
// found first in api/cron/x402-ring-leak-scan.js and api/cron/[name].js
// (tests/x402-ring-leak-scan-run.test.js, tests/cron-dispatcher-routing.test.js):
// vercel.json declared `maxDuration: 300` for a route, but the handler never
// passed `maxDurationMs` into wrapCron() (api/_lib/http.js), so wrapCron fell
// back to its DEFAULT_CRON_MAX_DURATION_MS (120s) and answered 503 cron_timeout
// on every run once the workload crossed 120s.
//
// A follow-up sweep found the identical gap, unfixed, in ten more standalone
// cron handlers that each declare 300s in vercel.json. This file pins all ten
// so the class cannot regress silently; scripts/check-cron-budget-wiring.mjs
// generalizes the same check across the whole api/cron/ tree for every future
// cron.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { globSync } from 'glob';

import { DEFAULT_CRON_MAX_DURATION_MS } from '../api/_lib/http.js';

const ROOT = join(import.meta.dirname, '..');

const FILES = [
	'api/cron/economy-reconcile.js',
	'api/cron/x402-prepaid-settle.js',
	'api/cron/fact-check-benchmark.js',
	'api/cron/avaturn-seed-cron.js',
	'api/cron/strategy-fanout.js',
	'api/cron/gmgn-seed.js',
	'api/cron/recompute-reputation.js',
	'api/cron/smart-money-graph.js',
	'api/cron/sketchfab-showcase.js',
	'api/cron/forge-smoke.js',
];

/**
 * vercel.json's declared maxDuration for a cron route. `functions` resolves by
 * specificity, not key order (the broad `api/**\/*.js` catch-all at the bottom
 * covers every route at 30s; a named/exact key elsewhere overrides it for the
 * files it lists), so named keys are applied after wildcard keys and win.
 */
function declaredMaxDuration(cronPath) {
	const { functions } = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
	const entries = Object.entries(functions).filter(([, c]) => typeof c.maxDuration === 'number');
	const [wildcard, named] = [entries.filter(([k]) => k.includes('*')), entries.filter(([k]) => !k.includes('*'))];

	let declared;
	for (const [key, config] of [...wildcard, ...named]) {
		const pattern = key.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
		if (globSync(pattern, { cwd: ROOT }).includes(cronPath)) declared = config.maxDuration;
	}
	if (declared == null) throw new Error(`no vercel.json functions entry declares a maxDuration for ${cronPath}`);
	return declared;
}

describe.each(FILES)('cron budget wiring: %s', (cronPath) => {
	it('declares a maxDuration matching vercel.json and wires it into wrapCron, so wrapCron does not truncate the run at the 120s default', async () => {
		const declaredSeconds = declaredMaxDuration(cronPath);
		expect(declaredSeconds * 1000).toBeGreaterThan(DEFAULT_CRON_MAX_DURATION_MS);

		const mod = await import(pathToFileURL(join(ROOT, cronPath)).href);
		expect(mod.maxDuration, `${cronPath} must export a maxDuration constant`).toBe(declaredSeconds);
		expect(mod.maxDuration * 1000).toBeGreaterThan(DEFAULT_CRON_MAX_DURATION_MS);

		const src = readFileSync(join(ROOT, cronPath), 'utf8');
		expect(
			/maxDurationMs\s*:\s*maxDuration\s*\*\s*1000/.test(src),
			`${cronPath} exports maxDuration but never passes { maxDurationMs: maxDuration * 1000 } into its wrapCron(...) call`,
		).toBe(true);
	});
});
