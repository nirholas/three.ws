// Patches @pump-fun/pump-sdk and @pump-fun/pump-swap-sdk after install.
//
// Both packages ship `dist/esm/index.js` containing ES `import` statements,
// but neither the package root nor the `dist/esm/` directory declares
// `"type": "module"`. Node.js loads those files as CommonJS and throws
// "Cannot use import statement outside a module" at first dynamic import.
//
// We drop a `{"type":"module"}` package.json into each `dist/esm/` folder so
// Node treats the bundle as ESM. Idempotent; survives `npm ci` via postinstall.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = dirname(root);

const targets = [
	'node_modules/@pump-fun/pump-sdk/dist/esm',
	'node_modules/@pump-fun/pump-swap-sdk/dist/esm',
];

let patched = 0;
let skipped = 0;
for (const rel of targets) {
	const dir = join(repo, rel);
	if (!existsSync(dir)) {
		skipped++;
		continue;
	}
	const pkgPath = join(dir, 'package.json');
	const desired = { type: 'module' };
	if (existsSync(pkgPath)) {
		const current = JSON.parse(readFileSync(pkgPath, 'utf8'));
		if (current.type === 'module') {
			skipped++;
			continue;
		}
	}
	writeFileSync(pkgPath, JSON.stringify(desired, null, 2) + '\n');
	patched++;
}

console.log(`[fix-pump-sdk-esm] patched ${patched}, skipped ${skipped}`);
