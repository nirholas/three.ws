/**
 * Build script for @three-ws/sdk
 *
 * Uses esbuild (available in the root node_modules) to produce:
 *   dist/index.js    — CommonJS bundle
 *   dist/index.mjs   — ESM bundle
 *
 * Then copies type declarations into dist/.
 *
 * Run: node build.mjs (from sdk/ directory)
 */

import { build } from '../node_modules/esbuild/lib/main.js';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const entryPoint = join(__dirname, 'src/index.js');
const outDir = join(__dirname, 'dist');

mkdirSync(outDir, { recursive: true });

const shared = {
	entryPoints: [entryPoint],
	bundle: true,
	// Mark all peer deps and ethers as external — consumers install them.
	external: ['ethers', '@solana/web3.js'],
	sourcemap: false,
	logLevel: 'info',
};

// ESM build
await build({
	...shared,
	format: 'esm',
	outfile: join(outDir, 'index.mjs'),
});

// CJS build
await build({
	...shared,
	format: 'cjs',
	outfile: join(outDir, 'index.js'),
});

// Copy type declarations
copyFileSync(join(__dirname, 'src/index.d.ts'), join(outDir, 'index.d.ts'));

// permissions sub-entry
mkdirSync(join(outDir, 'permissions'), { recursive: true });
copyFileSync(join(__dirname, 'src/permissions.d.ts'), join(outDir, 'permissions.d.ts'));

// permissions/advanced sub-entry
copyFileSync(join(__dirname, 'src/permissions/advanced.d.ts'), join(outDir, 'permissions/advanced.d.ts'));

// Copy styles
copyFileSync(join(__dirname, 'src/styles.css'), join(outDir, 'styles.css'));

console.log('Build complete — dist/');
