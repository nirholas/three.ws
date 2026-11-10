#!/usr/bin/env node
/**
 * Dead-code report with knip (config: knip.json).
 *
 *   npm run audit:dead-code
 *
 * Report mode: always writes reports/dead-code.json (gitignored) and prints a
 * count summary, exits 0 when knip ran, 2 when it could not run. Knip is run as
 * a pinned `npx` tool so it never touches the shared root node_modules. Findings
 * are candidates, not verdicts: route strings, import() templates, cron
 * handlers and worker entry points are invisible to it. Verify each with grep
 * before deleting (see docs/ops/dead-code.md).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const KNIP_VERSION = '6.45.0';

/** Count findings by category from knip's JSON reporter output. */
export function summarizeKnip(report) {
	const counts = { files: 0, dependencies: 0, devDependencies: 0, exports: 0 };
	for (const issue of report?.issues || []) {
		for (const key of Object.keys(counts)) counts[key] += (issue[key] || []).length;
	}
	return counts;
}

function main() {
	const run = spawnSync('npx', ['--yes', `knip@${KNIP_VERSION}`, '--reporter', 'json', '--no-exit-code'], {
		cwd: ROOT,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
	});
	if (run.error || !run.stdout) {
		console.error(`dead-code: knip did not run: ${run.error?.message || String(run.stderr).slice(-500)}`);
		process.exit(2);
	}
	let report;
	try {
		report = JSON.parse(run.stdout);
	} catch (err) {
		console.error(`dead-code: knip output was not JSON: ${err.message}`);
		process.exit(2);
	}
	mkdirSync(join(ROOT, 'reports'), { recursive: true });
	writeFileSync(join(ROOT, 'reports', 'dead-code.json'), JSON.stringify(report, null, 2));
	const c = summarizeKnip(report);
	console.log(`dead-code: ${c.files} unused files, ${c.exports} unused exports, ${c.dependencies} unused dependencies, ${c.devDependencies} unused devDependencies. Full report: reports/dead-code.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
