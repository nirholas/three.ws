#!/usr/bin/env node
// Inventory every error code a Forge endpoint can put in a response body.
//
//   node scripts/forge-error-codes.mjs          # one line per code: statuses, files
//   node scripts/forge-error-codes.mjs --json   # machine-readable
//   node scripts/forge-error-codes.mjs --missing  # only codes with no copy in src/forge-errors.js
//
// Why a script and not a hand-kept list: the server emits codes from dozens of
// handlers, and the page used to recognize a handful and file the rest under a
// generic line. tests/forge-error-copy.test.js imports extractForgeErrorCodes()
// from here and fails when any extracted code has no entry in the page's copy
// map (src/forge-errors.js), so a new server code cannot ship without copy.
//
// What it reads (static text, no imports, nothing executed):
//   - the Forge endpoint handlers: api/forge.js, api/forge-*.js, api/forge/*.js,
//     api/forged.js, api/forge-off/*.js
//   - the Forge helpers those handlers return through: api/_lib/forge-*.js,
//     api/_lib/require-three.js
//   - the shared envelope codes every handler can answer with (wrap(), method(),
//     rateLimited(), requireCreator()). Those helpers emit through variables, so
//     they are listed in SHARED_CODES below and each one is checked to still
//     appear in its source file: a renamed helper code fails loudly here instead
//     of silently dropping out of the inventory.
//
// Patterns recognized:
//   error: 'code'                         a response body literal
//   error(res, 400, 'code'                the http.js error() helper
//   respondError/serverError(res, 5xx, 'code'
//   code: 'code'                          a thrown error whose code the handler
//                                         echoes as `error: err.code`, or that
//                                         wrap() returns for an `expose`d error
//
// api/forge/webhook/ answers a provider, not a person, and is not scanned.
// api/gpt-forge.js serves the ChatGPT surfaces with their own copy layer.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..');

export const SHARED_CODES = [
	{ code: 'internal_error', status: 500, file: 'api/_lib/http.js' },
	{ code: 'service_unavailable', status: 503, file: 'api/_lib/http.js' },
	{ code: 'not_configured', status: 503, file: 'api/_lib/http.js' },
	{ code: 'bad_request', status: 400, file: 'api/_lib/http.js' },
	{ code: 'validation_error', status: 400, file: 'api/_lib/http.js' },
	{ code: 'method_not_allowed', status: 405, file: 'api/_lib/http.js' },
	{ code: 'rate_limited', status: 429, file: 'api/_lib/http.js' },
	{ code: 'sign_in_required', status: 401, file: 'api/_lib/creator-account.js' },
];

function listJs(dir) {
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	return names.filter((n) => n.endsWith('.js')).map((n) => join(dir, n)).filter((p) => statSync(p).isFile());
}

export function forgeSourceFiles(root = DEFAULT_ROOT) {
	const api = join(root, 'api');
	const lib = join(api, '_lib');
	const files = [
		join(api, 'forge.js'),
		join(api, 'forged.js'),
		...listJs(api).filter((p) => /[\\/]forge-[^\\/]+\.js$/.test(p)),
		...listJs(join(api, 'forge')),
		...listJs(join(api, 'forge-off')),
		...listJs(lib).filter((p) => /[\\/]forge-[^\\/]+\.js$/.test(p)),
		join(lib, 'require-three.js'),
	];
	return [...new Set(files)].sort();
}

const CODE = '([a-z][a-z0-9_]*)';
const PATTERNS = [
	{ kind: 'body', re: new RegExp(`\\berror:\\s*'${CODE}'`, 'g') },
	{ kind: 'helper', re: new RegExp(`\\b(?:error|respondError|serverError)\\(\\s*res\\s*,\\s*(\\d{3})\\s*,\\s*'${CODE}'`, 'g') },
	{ kind: 'thrown', re: new RegExp(`\\bcode:\\s*'${CODE}'`, 'g') },
	// payErr('msg', 402, 'payment_invalid') and any other (…, status, 'code') call.
	{ kind: 'pair', re: new RegExp(`,\\s*(\\d{3})\\s*,\\s*'${CODE}'\\s*[,)]`, 'g') },
];

// Status of a body literal: the json(res, NNN, { ... }) that encloses it.
function enclosingStatus(src, idx) {
	const window = src.slice(Math.max(0, idx - 800), idx);
	const calls = [...window.matchAll(/\bjson\(\s*res\s*,\s*([^,]+),/g)];
	const last = calls.at(-1);
	if (!last) return null;
	// The object that json() call opened must still be open at the match.
	if (/\}\s*\)\s*;/.test(window.slice(last.index))) return null;
	const status = last[1].trim();
	return /^\d{3}$/.test(status) ? Number(status) : null;
}

// Status of a thrown code: a `status: NNN` in the same object literal.
function siblingStatus(src, idx) {
	const open = src.lastIndexOf('{', idx);
	const close = src.indexOf('}', idx);
	if (open === -1 || close === -1) return null;
	const m = /\bstatus:\s*(\d{3})/.exec(src.slice(open, close));
	return m ? Number(m[1]) : null;
}

/**
 * Every error code a Forge endpoint can put in a response body.
 * @returns {Map<string, { code: string, statuses: number[], files: string[] }>}
 */
export function extractForgeErrorCodes(root = DEFAULT_ROOT) {
	const out = new Map();
	const add = (code, status, file) => {
		let row = out.get(code);
		if (!row) out.set(code, (row = { code, statuses: new Set(), files: new Set() }));
		if (status != null) row.statuses.add(status);
		row.files.add(file);
	};
	for (const path of forgeSourceFiles(root)) {
		let src;
		try {
			src = readFileSync(path, 'utf8');
		} catch {
			continue;
		}
		const file = relative(root, path);
		for (const { kind, re } of PATTERNS) {
			re.lastIndex = 0;
			for (const m of src.matchAll(re)) {
				if (kind === 'helper' || kind === 'pair') add(m[2], Number(m[1]), file);
				else if (kind === 'body') add(m[1], enclosingStatus(src, m.index), file);
				else add(m[1], siblingStatus(src, m.index), file);
			}
		}
	}
	for (const { code, status, file } of SHARED_CODES) {
		const src = readFileSync(join(root, file), 'utf8');
		if (!src.includes(`'${code}'`)) {
			throw new Error(`SHARED_CODES is stale: '${code}' no longer appears in ${file}. Update scripts/forge-error-codes.mjs.`);
		}
		add(code, status, file);
	}
	const result = new Map();
	for (const code of [...out.keys()].sort()) {
		const row = out.get(code);
		result.set(code, { code, statuses: [...row.statuses].sort(), files: [...row.files].sort() });
	}
	return result;
}

async function main() {
	const args = new Set(process.argv.slice(2));
	const codes = extractForgeErrorCodes();
	let rows = [...codes.values()];
	if (args.has('--missing')) {
		const { FORGE_ERROR_COPY } = await import('../src/forge-errors.js');
		rows = rows.filter((r) => !Object.hasOwn(FORGE_ERROR_COPY, r.code));
	}
	if (args.has('--json')) {
		process.stdout.write(JSON.stringify({ count: rows.length, codes: rows }, null, 2) + '\n');
		return;
	}
	for (const r of rows) {
		const st = r.statuses.length ? r.statuses.join('/') : 'n/a';
		console.log(`${r.code.padEnd(30)} ${st.padEnd(12)} ${r.files.join(', ')}`);
	}
	console.log(`\n${rows.length} code${rows.length === 1 ? '' : 's'}${args.has('--missing') ? ' without copy' : ''}.`);
	if (args.has('--missing') && rows.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch((err) => {
		console.error(err?.stack || err);
		process.exit(1);
	});
}
