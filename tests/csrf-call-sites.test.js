// Every requireCsrf call site, checked as source.
//
// `requireCsrf(req, res, userId)` is async and takes the caller's user id: the
// token row is bound to a user, so a call that omits the id matches no row and
// a call that omits `await` never blocks. Both mistakes are silent. Written the
// wrong way, as `if (!requireCsrf(req, res)) return;`, the guard returns a
// Promise, which is truthy, so the handler runs on regardless of the answer,
// and the rejection lands separately as a 403 the user reads as a broken
// feature. That shipped on the floorplan's own write endpoints, where it both
// stopped every browser save and left the check enforcing nothing.
//
// The unit tests cannot see this, because a suite that mocks CSRF is a suite
// that mocks exactly the argument that was missing. So this reads the source.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api');

/** Every .js file under api/, recursively. */
function apiFiles(dir = API_DIR, found = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) apiFiles(full, found);
		else if (entry.name.endsWith('.js')) found.push(full);
	}
	return found;
}

/**
 * The arguments of one `requireCsrf(...)` call, split at top-level commas so a
 * nested call like `requireCsrf(req, res, session(req).id)` counts as three.
 */
function argsOf(source, openParen) {
	let depth = 0;
	const args = [];
	let current = '';
	for (let i = openParen; i < source.length; i += 1) {
		const ch = source[i];
		if (ch === '(') {
			depth += 1;
			if (depth === 1) continue;
		}
		if (ch === ')') {
			depth -= 1;
			if (depth === 0) {
				if (current.trim()) args.push(current.trim());
				return args;
			}
		}
		if (ch === ',' && depth === 1) {
			args.push(current.trim());
			current = '';
			continue;
		}
		current += ch;
	}
	return args;
}

function callSites() {
	const sites = [];
	for (const file of apiFiles()) {
		const source = fs.readFileSync(file, 'utf8');
		const rel = path.relative(path.join(API_DIR, '..'), file);
		for (let i = source.indexOf('requireCsrf('); i !== -1; i = source.indexOf('requireCsrf(', i + 1)) {
			// Skip the import line and the definition in _lib/csrf.js itself.
			const lineStart = source.lastIndexOf('\n', i) + 1;
			const line = source.slice(lineStart, source.indexOf('\n', i));
			if (line.includes('import ') || line.includes('export ')) continue;
			// Prose, not a call. Several handlers explain the guard in a comment
			// above it, and a comment cannot fail to await anything.
			const trimmed = line.trim();
			if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
			sites.push({
				file: rel,
				line: source.slice(0, i).split('\n').length,
				text: line.trim(),
				args: argsOf(source, source.indexOf('(', i)),
				awaited: /await\s+requireCsrf\($/.test(source.slice(0, i + 'requireCsrf('.length)),
			});
		}
	}
	return sites;
}

describe('every requireCsrf call site', () => {
	const sites = callSites();

	it('finds the call sites at all, so a passing suite means something', () => {
		expect(sites.length).toBeGreaterThan(10);
	});

	it('passes the caller user id, because the token row is bound to a user', () => {
		const short = sites.filter((site) => site.args.length < 3);
		expect(
			short.map((s) => `${s.file}:${s.line}  ${s.text}`),
			'requireCsrf(req, res) matches no token row: pass the caller user id as the third argument',
		).toEqual([]);
	});

	it('is awaited, because an unawaited guard is a truthy promise that blocks nothing', () => {
		const bare = sites.filter((site) => !site.awaited);
		expect(
			bare.map((s) => `${s.file}:${s.line}  ${s.text}`),
			'requireCsrf is async: without await the handler runs on regardless of the answer',
		).toEqual([]);
	});
});
