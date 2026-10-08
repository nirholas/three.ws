// A real Postgres for the worker tests: PGlite (the in-process Postgres the repo
// already tests SQL semantics with, tests/_helpers/pglite-sql.js) carrying the
// gateway tables exactly as production got them, built by running the two
// shipped migration files verbatim. The tables those migrations reference but do
// not own (users, agent_identities, notification_events, agent_messages) are
// created first with only the columns the gateway touches.

import { readFileSync } from 'node:fs';
import { createPgliteSql } from '../../../tests/_helpers/pglite-sql.js';

const MIGRATIONS = new URL('../../../api/_lib/migrations/', import.meta.url);
const GATEWAY_MIGRATIONS = ['20260922180000_chat_gateways.sql', '20260922190000_more_chat_gateways.sql'];

const PREREQUISITES = `
	CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
	CREATE TABLE agent_identities (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id uuid REFERENCES users(id),
		name text,
		meta jsonb NOT NULL DEFAULT '{}'::jsonb,
		deleted_at timestamptz
	);
	CREATE TABLE notification_events (id bigserial PRIMARY KEY, channel text NOT NULL);
	CREATE TABLE agent_messages (id bigserial PRIMARY KEY);
`;

export async function createGatewayDb() {
	const db = createPgliteSql();
	await db.exec(PREREQUISITES);
	for (const file of GATEWAY_MIGRATIONS) await db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
	return db;
}

/** A user, one agent, and a live link pairing `chatId` on `platform` to them. */
export async function seedPairedChat(db, { platform = 'telegram', chatId, platformUserId }) {
	const [user] = await db.query('INSERT INTO users DEFAULT VALUES RETURNING id');
	const [agent] = await db.query("INSERT INTO agent_identities (user_id, name) VALUES ($1, 'Test Agent') RETURNING id", [user.id]);
	const [link] = await db.query(
		`INSERT INTO gateway_links (platform, platform_user_id, chat_id, chat_type, user_id, default_agent_id, last_seen_at)
		 VALUES ($1, $2, $3, 'private', $4, $5, now()) RETURNING *`,
		[platform, String(platformUserId), String(chatId), user.id, agent.id],
	);
	return { user, agent, link };
}
