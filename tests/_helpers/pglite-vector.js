// pgvector stand-in for PGlite, which ships without the extension.
//
// `vector` becomes a domain over text (pgvector's text form, "[0.1,0.2]", is
// also a JSON array) and `<=>` is cosine distance computed in SQL, so the
// agent-knowledge queries run unchanged: `1 - (embedding <=> $1::vector)` and
// `ORDER BY embedding <=> $1::vector` mean the same thing they do on Postgres
// with pgvector. Then the knowledge migrations that the full-schema builder
// skipped (they need the extension) are applied on top.
//
// Used by tests/knowledge-pdf-jobs.test.js and scripts/knowledge-pdf-live-check.mjs.

import { readFileSync } from 'node:fs';
import { splitStatements } from './pglite-full-schema.js';

const KNOWLEDGE_MIGRATIONS = [
	'20261111161519_agent_knowledge.sql',
	'20261116182500_agent_knowledge_pdf_jobs.sql',
	'20261116193000_embedding_migration_shadow.sql',
];

export async function addVectorSupport(pg) {
	await pg.exec(`
		DO $$ BEGIN CREATE DOMAIN vector AS text; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
		CREATE OR REPLACE FUNCTION test_cosine_distance(a text, b text) RETURNS float8 LANGUAGE sql IMMUTABLE AS $f$
			SELECT 1 - sum(x.v::float8 * y.v::float8) / (sqrt(sum(x.v::float8 ^ 2)) * sqrt(sum(y.v::float8 ^ 2)))
			FROM jsonb_array_elements_text(a::jsonb) WITH ORDINALITY x(v, i)
			JOIN jsonb_array_elements_text(b::jsonb) WITH ORDINALITY y(v, i) USING (i)
		$f$;
		DO $$ BEGIN CREATE OPERATOR <=> (LEFTARG = text, RIGHTARG = text, FUNCTION = test_cosine_distance);
		EXCEPTION WHEN duplicate_function THEN NULL; END $$;
	`);
	for (const file of KNOWLEDGE_MIGRATIONS) {
		const text = readFileSync(new URL(`../../api/_lib/migrations/${file}`, import.meta.url), 'utf8');
		for (const stmt of splitStatements(text)) {
			if (/CREATE EXTENSION/i.test(stmt)) continue;
			await pg.exec(stmt).catch((err) => {
				// The shadow-column migration also touches tables PGlite's schema
				// build may not have created; only those statements may fail.
				if (!/does not exist/.test(err.message) || !/widget_knowledge_chunks|agent_memories/.test(stmt)) throw err;
			});
		}
	}
}
