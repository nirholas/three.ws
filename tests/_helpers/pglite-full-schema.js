// An in-process Postgres (PGlite) carrying the production schema: api/_lib/schema.sql
// followed by every migration in filename order, each applied one statement at a
// time. schema.sql alone is not self-contained (later migrations create tables it
// references), and a few migrations need extensions PGlite does not ship, so a
// statement that cannot apply here is skipped and the rest still land. The result
// is the real table, constraint and foreign-key catalog for any test that must
// reason about the schema as a whole (for example which tables point at users).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const API_LIB = new URL('../../api/_lib/', import.meta.url);

/**
 * Split a SQL script into statements on top-level semicolons. Respects
 * single-quoted strings, dollar-quoted bodies, and -- / block comments.
 * @param {string} text
 * @returns {string[]}
 */
export function splitStatements(text) {
	const out = [];
	let cur = '';
	let i = 0;
	let dollar = null;
	while (i < text.length) {
		const ch = text[i];
		const two = text.slice(i, i + 2);
		if (dollar) {
			if (text.startsWith(dollar, i)) {
				cur += dollar;
				i += dollar.length;
				dollar = null;
			} else cur += text[i++];
			continue;
		}
		if (two === '--') {
			const nl = text.indexOf('\n', i);
			const end = nl === -1 ? text.length : nl;
			cur += text.slice(i, end);
			i = end;
		} else if (two === '/*') {
			const close = text.indexOf('*/', i + 2);
			const end = close === -1 ? text.length : close + 2;
			cur += text.slice(i, end);
			i = end;
		} else if (ch === "'") {
			let j = i + 1;
			while (j < text.length) {
				if (text[j] === "'" && text[j + 1] === "'") j += 2;
				else if (text[j] === "'") break;
				else j++;
			}
			cur += text.slice(i, j + 1);
			i = j + 1;
		} else if (ch === '$') {
			const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i, i + 64));
			if (m) {
				dollar = m[0];
				cur += dollar;
				i += dollar.length;
			} else cur += text[i++];
		} else if (ch === ';') {
			if (cur.trim()) out.push(cur.trim());
			cur = '';
			i++;
		} else cur += text[i++];
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

const EXTENSIONS = { citext, pgcrypto };

/**
 * Build the schema database. Building takes about two minutes, so the finished
 * data directory is cached on disk keyed by a hash of schema.sql and every
 * migration; any edit to either rebuilds it. Resolves to { pg, skipped, cached }.
 */
export async function createFullSchemaDb() {
	const scripts = [['schema.sql', readFileSync(new URL('schema.sql', API_LIB), 'utf8')]];
	const dir = new URL('migrations/', API_LIB);
	for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
		scripts.push([f, readFileSync(new URL(f, dir), 'utf8')]);
	}
	const hash = createHash('sha256');
	for (const [name, text] of scripts) hash.update(name).update(text);
	const cacheDir = join(tmpdir(), 'three-ws-pglite-schema');
	const cacheFile = join(cacheDir, `${hash.digest('hex').slice(0, 24)}.tar`);

	if (existsSync(cacheFile)) {
		try {
			const loadDataDir = new Blob([readFileSync(cacheFile)]);
			const pg = new PGlite({ loadDataDir, extensions: EXTENSIONS });
			await pg.waitReady;
			return { pg, skipped: [], cached: true };
		} catch {
			// A corrupt or half-written cache falls through to a rebuild.
		}
	}

	const pg = new PGlite({ extensions: EXTENSIONS });
	const skipped = [];
	for (const [name, text] of scripts) {
		for (const stmt of splitStatements(text)) {
			const bare = stmt.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
			if (/^(begin|commit|start transaction)$/i.test(bare)) continue;
			try {
				await pg.exec(stmt);
			} catch (err) {
				skipped.push({ file: name, error: err.message });
				await pg.exec('rollback').catch(() => {});
			}
		}
	}
	try {
		mkdirSync(cacheDir, { recursive: true });
		const dump = await pg.dumpDataDir('none');
		const tmp = `${cacheFile}.${process.pid}`;
		writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
		const { renameSync } = await import('node:fs');
		renameSync(tmp, cacheFile);
	} catch {
		// Caching is an optimisation; a read-only tmpdir only costs the rebuild.
	}
	return { pg, skipped, cached: false };
}
