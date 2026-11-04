// Accepted-error baseline for `npm run audit:console`.
//
// scripts/audit-console.baseline.json maps route -> viewport -> the number of
// console errors the sweep is allowed to report for it. The target is an empty
// map. A route/viewport whose error count rises above its baseline (a missing
// entry means zero) is a regression and fails the sweep; a count that falls is
// an improvement and is reported so the baseline can be ratcheted down with
// `--update-baseline`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function loadBaseline(file) {
	if (!existsSync(file)) return { routes: {} };
	const data = JSON.parse(readFileSync(file, 'utf8'));
	if (!data || typeof data.routes !== 'object' || data.routes === null || Array.isArray(data.routes)) {
		throw new Error(`${file}: expected an object with a "routes" map`);
	}
	return { routes: data.routes };
}

/**
 * Compare measured counts with the baseline. Only the routes and viewports in
 * `current` are judged, so a partial sweep never reports an unmeasured route as
 * fixed.
 *
 * @param {{routes: Record<string, Record<string, number>>}} baseline
 * @param {Record<string, Record<string, number>>} current  route -> viewport -> error count
 */
export function diffAgainstBaseline(baseline, current) {
	const regressions = [];
	const improvements = [];
	for (const [route, viewports] of Object.entries(current)) {
		for (const [viewport, now] of Object.entries(viewports)) {
			const was = baseline.routes[route]?.[viewport] ?? 0;
			if (now > was) regressions.push({ route, viewport, was, now });
			else if (now < was) improvements.push({ route, viewport, was, now });
		}
	}
	return { regressions, improvements };
}

/** Baseline with the measured routes/viewports replaced by `current`; zeros are dropped. */
export function mergeBaseline(baseline, current) {
	const routes = structuredClone(baseline.routes);
	for (const [route, viewports] of Object.entries(current)) {
		for (const [viewport, now] of Object.entries(viewports)) {
			if (now > 0) (routes[route] ||= {})[viewport] = now;
			else if (routes[route]) {
				delete routes[route][viewport];
				if (Object.keys(routes[route]).length === 0) delete routes[route];
			}
		}
	}
	const sorted = Object.fromEntries(Object.keys(routes).sort().map((k) => [k, routes[k]]));
	return { routes: sorted };
}

export function saveBaseline(file, baseline) {
	writeFileSync(file, JSON.stringify(baseline, null, '\t') + '\n');
}
