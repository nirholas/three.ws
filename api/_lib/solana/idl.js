// Loader for vendored Pump program IDLs. Reading the JSON via fs (instead of
// `import ... assert { type: 'json' }`) keeps the helper compatible with both
// Vercel's bundler and Node's ESM loader without flag flips.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const IDL_DIR = resolve(HERE, '../../../contracts/idl/pump');

const cache = new Map();

function load(name) {
	if (cache.has(name)) return cache.get(name);
	const path = resolve(IDL_DIR, `${name}.json`);
	const idl = JSON.parse(readFileSync(path, 'utf8'));
	cache.set(name, idl);
	return idl;
}

export const loadPumpIdl = () => load('pump');
export const loadPumpAmmIdl = () => load('pump_amm');
export const loadPumpFeesIdl = () => load('pump_fees');

export function loadAllPumpIdls() {
	return {
		pump: loadPumpIdl(),
		pump_amm: loadPumpAmmIdl(),
		pump_fees: loadPumpFeesIdl(),
	};
}
