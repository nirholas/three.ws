// An in-process Postgres (PGlite) carrying the real tables the agent-learning
// layer reads and writes: the base tables from api/_lib/schema.sql plus the
// migrations that add memory kinds, the user model and learned skills. Only the
// sql tag is swapped for PGlite, so every query in api/_lib/agent-learning runs
// as written against the production schema.

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIG = new URL('../../api/_lib/migrations/', import.meta.url);
const SCHEMA = readFileSync(new URL('../../api/_lib/schema.sql', import.meta.url), 'utf8');

function createTable(name) {
	const m = new RegExp(`create table if not exists ${name}\\s*\\(.*?\\n\\);`, 'is').exec(SCHEMA);
	if (!m) throw new Error(`schema.sql has no table ${name}`);
	return m[0].replace(/\bcitext\b/gi, 'text');
}

const BASE_TABLES = ['users', 'agent_identities', 'agent_memories', 'agent_messages', 'agent_runs', 'agent_run_steps'];
const MIGRATIONS = [
	'20260619120000_memory_studio.sql',
	'20260922153000_agent_custom_skills.sql',
	'20260922190000_agent_memory_learning.sql',
];

/** Build a fresh database with the learning schema. */
export async function createLearningDb() {
	const pg = new PGlite();
	for (const t of BASE_TABLES) await pg.exec(createTable(t));
	for (const f of MIGRATIONS) await pg.exec(readFileSync(new URL(f, MIG), 'utf8'));
	return pg;
}

/**
 * A `sql` tagged template over a PGlite instance with the same fragment
 * composition as api/_lib/db.js: an interpolated sql`...` is spliced inline and
 * its placeholders renumbered.
 */
export function sqlOver(getPg) {
	const FRAG = Symbol('fragment');
	function build(strings, values) {
		let text = '';
		const params = [];
		strings.forEach((part, i) => {
			text += part;
			if (i >= values.length) return;
			const v = values[i];
			if (v && v[FRAG]) {
				const inner = build(v.strings, v.values);
				const offset = params.length;
				text += inner.text.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
				params.push(...inner.params);
			} else {
				params.push(v);
				text += `$${params.length}`;
			}
		});
		return { text, params };
	}
	return function sql(strings, ...values) {
		const frag = { [FRAG]: true, strings, values };
		let promise;
		const run = () => {
			promise ||= (async () => {
				const { text, params } = build(strings, values);
				return (await getPg().query(text, params)).rows;
			})();
			return promise;
		};
		frag.then = (a, b) => run().then(a, b);
		frag.catch = (b) => run().catch(b);
		frag.finally = (f) => run().finally(f);
		return frag;
	};
}

/** Empty every learning table so one database serves a whole test file. */
export async function resetLearningDb(pg) {
	await pg.exec('truncate users cascade');
}

let seq = 0;
/** Insert a user and one agent they own; returns their ids. */
export async function seedAccount(pg, label = `u${++seq}`) {
	const u = (await pg.query(`insert into users (email, display_name) values ($1, $2) returning id`, [`${label}@example.test`, label])).rows[0];
	const a = (await pg.query(`insert into agent_identities (user_id, name) values ($1, $2) returning id`, [u.id, `${label}-agent`])).rows[0];
	return { userId: u.id, agentId: a.id };
}
