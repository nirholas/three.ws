// Writes stringResources/en-US/resources.resjson from the English table in
// src/strings.ts, so the visual's code and its Power BI string resources can
// never disagree. Node loads the TypeScript file with its built-in type
// stripping. Run with --check to fail instead of writing when they differ.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { STRINGS } = await import(join(root, 'src', 'strings.ts'));
const out = join(root, 'stringResources', 'en-US', 'resources.resjson');
const next = `${JSON.stringify(STRINGS, null, 4)}\n`;

let current = null;
try {
	current = readFileSync(out, 'utf8');
} catch {
	current = null;
}

if (process.argv.includes('--check')) {
	if (current !== next) {
		console.error(`[build-strings] ${out} is out of date. Run npm run strings.`);
		process.exit(1);
	}
	console.log(`[build-strings] ${Object.keys(STRINGS).length} strings in sync.`);
} else if (current !== next) {
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, next);
	console.log(`[build-strings] wrote ${Object.keys(STRINGS).length} strings to ${out}`);
} else {
	console.log(`[build-strings] ${Object.keys(STRINGS).length} strings already in sync.`);
}
