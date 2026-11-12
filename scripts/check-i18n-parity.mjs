#!/usr/bin/env node
// check-i18n-parity.mjs - fail when a shipped locale is falling out of the picker.
//
// From 2026-10-12 to 2026-11-12 the production language switcher offered only
// English: new pages added English keys every day, the 84 translated catalogs
// fell further behind, and writeManifest() quietly held each one back. No check
// fired, because lint was already red with tens of thousands of problems and
// nothing looked at completeness on its own. This one does, in a few seconds:
//
//   • every locale in .i18nrc.json outputLocales has a readable catalog;
//   • each is at or above manifestThreshold (the same number the manifest uses),
//     so a failure here means "this language is about to vanish from the picker";
//   • public/locales/manifest.json lists exactly what the catalogs justify.
//
// Fix a failure with `npm run i18n:translate` (fills only the missing keys, then
// rewrites the manifest). A stale manifest alone is fixed by
// `node scripts/i18n-translate.mjs --dry-run`, which rewrites it without
// translating anything. No network, no API key.
//
// Usage: npm run check:i18n [-- --threshold=0.99] [-- --json]
import { resolve } from 'node:path';
import { ROOT, loadConfig, readJSON, parityReport } from './lib/i18n-shared.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const cfg = loadConfig();
const source = readJSON(resolve(ROOT, cfg.entry));
if (!source) {
	console.error(`check:i18n: source catalog ${cfg.entry} not found. Run \`npm run i18n:extract\`.`);
	process.exit(1);
}
const threshold = Number(arg('threshold') ?? cfg.manifestThreshold ?? 1);
const committedManifest = readJSON(resolve(ROOT, cfg.output, 'manifest.json'), null);
const report = parityReport({
	cfg,
	source,
	readCatalog: (code) => readJSON(resolve(ROOT, cfg.output, `${code}.json`), null),
	threshold,
	committedManifest,
});

if (process.argv.includes('--json')) {
	console.log(JSON.stringify({ threshold, ...report }, null, 2));
	process.exit(report.failures.length ? 1 : 0);
}

const behind = report.rows.filter((r) => r.behind > 0).sort((a, b) => b.behind - a.behind);
const listed = committedManifest?.locales?.length ?? 0;
console.log(
	`check:i18n: ${report.total} source keys, ${report.rows.length}/${cfg.outputLocales.length} catalogs, ` +
		`manifest lists ${listed}, threshold ${(threshold * 100).toFixed(2)}%`,
);
if (behind.length) {
	console.log(
		`  behind (still listed while above threshold): ${behind
			.slice(0, 12)
			.map((r) => `${r.code} ${r.behind}`)
			.join(', ')}${behind.length > 12 ? `, +${behind.length - 12} more` : ''}`,
	);
}
if (report.failures.length) {
	for (const f of report.failures) console.error(`✗ ${f}`);
	console.error(
		`\ncheck:i18n failed: ${report.failures.length} problem(s). Run \`npm run i18n:translate\` ` +
			'(fills only the missing keys and rewrites the manifest), then rerun this check.',
	);
	process.exit(1);
}
console.log('✓ every configured locale is within the picker threshold and the manifest is current.');
