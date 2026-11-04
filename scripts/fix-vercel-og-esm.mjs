// Patches @vercel/og after install.
//
// 1.0.x bundles satori >=0.33.5 (fixes GHSA for satori <0.33.5), but its Node
// ESM entry `dist/index.node.js` inlines harfbuzzjs's Emscripten loader, which
// calls esbuild's `__require("fs")` shim and reads `__dirname`. Neither exists
// in a real ES module, so importing the entry throws ("Dynamic require of
// \"fs\" is not supported", then "__dirname is not defined").
//
// Prepend module-scoped `require`, `__filename` and `__dirname` built from
// `import.meta.url`.
//
// The published dist also omits `hb.wasm`, which that loader reads from next to
// the entry. Copy it from the harfbuzzjs version satori pins (installed as
// satori's dependency). Idempotent; survives `npm ci` via postinstall.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(repo, 'node_modules/@vercel/og/dist/index.node.js');
const MARKER = '/* three.ws: fix-vercel-og-esm */';
const PATCH = [
	MARKER,
	'import { createRequire as __threewsCreateRequire } from "node:module";',
	'import { fileURLToPath as __threewsFileURLToPath } from "node:url";',
	'import { dirname as __threewsDirname } from "node:path";',
	'const require = __threewsCreateRequire(import.meta.url);',
	'const __filename = __threewsFileURLToPath(import.meta.url);',
	'const __dirname = __threewsDirname(__filename);',
	'',
].join('\n');

if (!existsSync(entry)) {
	console.log('[fix-vercel-og-esm] package not installed, skipping');
	process.exit(0);
}

const src = readFileSync(entry, 'utf8');
if (src.startsWith(MARKER)) {
	console.log('[fix-vercel-og-esm] already patched');
} else if (/^(?:var|let|const)\s+(?:require|__filename|__dirname)\b/m.test(src)) {
	console.log('[fix-vercel-og-esm] entry already defines a CJS global, skipping');
} else {
	writeFileSync(entry, PATCH + src);
	console.log('[fix-vercel-og-esm] injected createRequire into dist/index.node.js');
}

const wasmTarget = join(dirname(entry), 'hb.wasm');
if (existsSync(wasmTarget)) {
	console.log('[fix-vercel-og-esm] hb.wasm present');
} else {
	const fromOg = createRequire(join(repo, 'node_modules/@vercel/og/package.json'));
	const fromSatori = createRequire(fromOg.resolve('satori/package.json'));
	const wasmSource = join(dirname(fromSatori.resolve('harfbuzzjs/package.json')), 'hb.wasm');
	copyFileSync(wasmSource, wasmTarget);
	console.log('[fix-vercel-og-esm] copied harfbuzzjs hb.wasm into dist/');
}
