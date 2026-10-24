// Patches 8004-solana after install so it resolves under @noble/curves 2.x.
//
// The SDK's signing helper imports `@noble/curves/ed25519` (extensionless), a
// subpath that only @noble/curves 1.x exports. This repo hoists @noble/curves
// 2.x (shared by the Solana kit tree), whose export map only lists
// `./ed25519.js`, so importing the SDK throws ERR_PACKAGE_PATH_NOT_EXPORTED at
// load time. Both majors export the same `ed25519` binding from that file, so
// pointing the specifier at the `.js` subpath is behavior-neutral.
//
// Idempotent (the rewritten specifier no longer matches) and wired into the
// postinstall chain so it survives `npm ci`.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const file = join(repo, 'node_modules/8004-solana/dist/utils/signing.js');

if (!existsSync(file)) {
	console.log('[fix-8004-solana-esm] package not installed, skipping');
	process.exit(0);
}

const src = readFileSync(file, 'utf8');
const out = src.replace(/(['"])@noble\/curves\/ed25519\1/g, "'@noble/curves/ed25519.js'");
if (out === src) {
	console.log('[fix-8004-solana-esm] already patched');
} else {
	writeFileSync(file, out);
	console.log('[fix-8004-solana-esm] pointed @noble/curves/ed25519 at the .js subpath');
}
