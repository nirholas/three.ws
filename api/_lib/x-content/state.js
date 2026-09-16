// Publish ledger for the content queue, stored in app_settings so the Cloud
// Scheduler cron and a local `npm run x:content -- run` share one record and
// can never double-post.
//
// Shape:
//   { published: [{ id, kind, lane, pattern, publishedAt, text, postIds, articleId?, url }],
//     inflight:  { [id]: { media: { [path]: { id, at } }, postIds: [], articleDraftId?, articlePostId? } } }
//
// `inflight` is written after every API call that creates something on X, so a
// crash mid-thread resumes where it stopped instead of reposting.

export const STATE_KEY = 'x_content';
const LOCK_KEY = 'x_content_lock';
// Video processing can take minutes; the lock outlives the slowest publish.
const LOCK_TTL_S = 900;

const emptyState = () => ({ published: [], inflight: {} });

export function dbStore() {
	const db = () => import('../db.js').then((module) => module.sql);
	return {
		label: 'database',
		async load() {
			const sql = await db();
			const [row] = await sql`SELECT value FROM app_settings WHERE key = ${STATE_KEY}`;
			return { ...emptyState(), ...(row?.value || {}) };
		},
		async save(state) {
			const sql = await db();
			await sql`
				INSERT INTO app_settings (key, value) VALUES (${STATE_KEY}, ${JSON.stringify(state)}::jsonb)
				ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
			`;
		},
		async acquireLock() {
			const sql = await db();
			const rows = await sql`
				INSERT INTO app_settings (key, value)
				VALUES (${LOCK_KEY}, jsonb_build_object('until', extract(epoch from now()) + ${LOCK_TTL_S}))
				ON CONFLICT (key) DO UPDATE
					SET value = excluded.value, updated_at = now()
					WHERE (app_settings.value->>'until')::numeric < extract(epoch from now())
				RETURNING key
			`;
			return rows.length > 0;
		},
		async releaseLock() {
			const sql = await db();
			await sql`UPDATE app_settings SET value = '{"until":0}'::jsonb, updated_at = now() WHERE key = ${LOCK_KEY}`;
		},
	};
}

// For previews on a machine without DATABASE_URL: starts empty, keeps nothing.
export function memoryStore(initial = emptyState()) {
	let state = structuredClone(initial);
	return {
		label: 'memory (no DATABASE_URL, so published history is not considered)',
		async load() {
			return structuredClone(state);
		},
		async save(next) {
			state = structuredClone(next);
		},
		async acquireLock() {
			return true;
		},
		async releaseLock() {},
	};
}
