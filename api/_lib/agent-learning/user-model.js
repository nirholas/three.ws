// The user model: a structured, editable "about you" document per account
// (table user_model_entries).
//
// Agents add lines through memory_save(kind: 'user-model', section, content);
// the owner reads, edits and deletes every line on /settings/memory. The
// document is account-scoped on purpose: it describes a person, not an agent,
// so it is shared by all of that person's agents and never travels with an
// agent into a marketplace transfer or the community registry.

import { sql } from '../db.js';
import { isUuid } from '../validate.js';
import { LearningError, memoryOffError } from './errors.js';
import { memoryEnabled } from './settings.js';

/** Sections of the document, in display order, with the question each answers. */
export const USER_MODEL_SECTIONS = Object.freeze([
	{ id: 'identity', label: 'Who they are', hint: 'Name, role, what they work on.' },
	{ id: 'goals', label: 'Goals', hint: 'What they are trying to achieve.' },
	{ id: 'preferences', label: 'Preferences', hint: 'How they like things done.' },
	{ id: 'communication', label: 'Communication', hint: 'Tone, length and format they want.' },
	{ id: 'expertise', label: 'Expertise', hint: 'What they already know well, and what they do not.' },
	{ id: 'constraints', label: 'Constraints', hint: 'Limits: risk tolerance, budgets, things to never do.' },
	{ id: 'context', label: 'Current context', hint: 'Ongoing projects and situations worth knowing.' },
]);
export const SECTION_IDS = USER_MODEL_SECTIONS.map((s) => s.id);

export const MAX_ENTRY_CHARS = 600;
export const MAX_ENTRIES_PER_ACCOUNT = 200;

/** Dedup key: case, punctuation and spacing do not make a line new. */
export function contentKey(text) {
	return String(text || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.slice(0, 200);
}

function present(row) {
	return {
		id: row.id,
		section: row.section,
		content: row.content,
		source: row.source,
		source_agent_id: row.source_agent_id || null,
		source_run_id: row.source_run_id || null,
		confidence: row.confidence,
		use_count: row.use_count,
		last_used_at: row.last_used_at,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

function validate(section, content) {
	if (!SECTION_IDS.includes(section)) {
		throw new LearningError(400, 'validation_error', `section must be one of: ${SECTION_IDS.join(', ')}`);
	}
	const text = String(content || '').replace(/\s+/g, ' ').trim();
	if (!text) throw new LearningError(400, 'validation_error', 'content is required');
	if (text.length > MAX_ENTRY_CHARS) {
		throw new LearningError(400, 'validation_error', `a user-model line is at most ${MAX_ENTRY_CHARS} characters; split it`);
	}
	return text;
}

/** The whole document, grouped by section in display order. */
export async function getUserModel(userId) {
	const rows = await sql`
		SELECT id, section, content, source, source_agent_id, source_run_id, confidence,
		       use_count, last_used_at, created_at, updated_at
		FROM user_model_entries WHERE user_id = ${userId}
		ORDER BY created_at ASC, id ASC
	`;
	const bySection = new Map(SECTION_IDS.map((id) => [id, []]));
	for (const r of rows) bySection.get(r.section)?.push(present(r));
	return {
		sections: USER_MODEL_SECTIONS.map((s) => ({ ...s, entries: bySection.get(s.id) })),
		count: rows.length,
		max_entries: MAX_ENTRIES_PER_ACCOUNT,
	};
}

/**
 * Add a line, or reinforce the identical line when it already exists (the
 * confidence moves toward the new value and the line is marked as reaffirmed).
 * `source` is 'agent' for tool writes and 'owner' for the settings page.
 */
export async function addUserModelEntry(userId, { section, content, source = 'agent', agentId = null, runId = null, confidence = 0.7 }) {
	if (!(await memoryEnabled(userId))) throw memoryOffError();
	const text = validate(section, content);
	const key = contentKey(text);
	const conf = Math.min(1, Math.max(0, Number(confidence) || 0.7));

	const [existing] = await sql`
		SELECT id FROM user_model_entries WHERE user_id = ${userId} AND section = ${section} AND content_key = ${key}
	`;
	if (!existing) {
		const [{ n }] = await sql`SELECT count(*)::int AS n FROM user_model_entries WHERE user_id = ${userId}`;
		if (n >= MAX_ENTRIES_PER_ACCOUNT) {
			throw new LearningError(
				409,
				'limit_reached',
				`The user model holds at most ${MAX_ENTRIES_PER_ACCOUNT} lines. Remove stale ones at /settings/memory first.`,
			);
		}
	}
	const [row] = await sql`
		INSERT INTO user_model_entries
			(user_id, section, content, content_key, source, source_agent_id, source_run_id, confidence)
		VALUES
			(${userId}, ${section}, ${text}, ${key}, ${source}, ${isUuid(agentId) ? agentId : null},
			 ${isUuid(runId) ? runId : null}, ${conf})
		ON CONFLICT (user_id, section, content_key) DO UPDATE SET
			content = EXCLUDED.content,
			confidence = LEAST(1.0, (user_model_entries.confidence + EXCLUDED.confidence) / 2 + 0.05),
			updated_at = now()
		RETURNING id, section, content, source, source_agent_id, source_run_id, confidence,
		          use_count, last_used_at, created_at, updated_at, (xmax <> 0) AS reinforced
	`;
	return { entry: present(row), reinforced: Boolean(row.reinforced) };
}

/** Owner edit of one line: rewrite it or move it to another section. */
export async function updateUserModelEntry(userId, entryId, { section, content }) {
	if (!isUuid(entryId)) throw new LearningError(400, 'validation_error', 'entry id must be a uuid');
	const [current] = await sql`SELECT id, section, content FROM user_model_entries WHERE id = ${entryId} AND user_id = ${userId}`;
	if (!current) throw new LearningError(404, 'not_found', 'no such line in your user model');
	const nextSection = section ?? current.section;
	const text = validate(nextSection, content ?? current.content);
	const key = contentKey(text);
	const [clash] = await sql`
		SELECT id FROM user_model_entries
		WHERE user_id = ${userId} AND section = ${nextSection} AND content_key = ${key} AND id <> ${entryId}
	`;
	if (clash) throw new LearningError(409, 'duplicate', 'that line already exists in this section', { entry_id: clash.id });
	const [row] = await sql`
		UPDATE user_model_entries
		SET section = ${nextSection}, content = ${text}, content_key = ${key}, source = 'owner', updated_at = now()
		WHERE id = ${entryId} AND user_id = ${userId}
		RETURNING id, section, content, source, source_agent_id, source_run_id, confidence,
		          use_count, last_used_at, created_at, updated_at
	`;
	return present(row);
}

/** Remove one line. Irreversible. */
export async function deleteUserModelEntry(userId, entryId) {
	if (!isUuid(entryId)) throw new LearningError(400, 'validation_error', 'entry id must be a uuid');
	const [row] = await sql`
		DELETE FROM user_model_entries WHERE id = ${entryId} AND user_id = ${userId}
		RETURNING id, section, content
	`;
	if (!row) throw new LearningError(404, 'not_found', 'no such line in your user model');
	return row;
}

/** Remove the whole document. Irreversible. Returns how many lines went. */
export async function clearUserModel(userId) {
	const rows = await sql`DELETE FROM user_model_entries WHERE user_id = ${userId} RETURNING id`;
	return rows.length;
}

/**
 * The lines that reach a prompt: highest confidence and most recently
 * reaffirmed first, within a character budget, then regrouped by section so
 * the model reads a document, not a ranking. Marks the chosen lines as used.
 */
export async function userModelForPrompt(userId, { maxChars = 2400 } = {}) {
	const rows = await sql`
		SELECT id, section, content, confidence, updated_at
		FROM user_model_entries WHERE user_id = ${userId}
		ORDER BY confidence DESC, updated_at DESC
		LIMIT ${MAX_ENTRIES_PER_ACCOUNT}
	`;
	const chosen = [];
	let used = 0;
	for (const r of rows) {
		const cost = r.content.length + 4;
		if (used + cost > maxChars) continue;
		used += cost;
		chosen.push(r);
	}
	if (!chosen.length) return { lines: [], ids: [] };
	const ids = chosen.map((r) => r.id);
	sql`UPDATE user_model_entries SET use_count = use_count + 1, last_used_at = now() WHERE id = ANY(${ids}::uuid[])`.catch(() => {});
	const lines = [];
	for (const s of USER_MODEL_SECTIONS) {
		const inSection = chosen.filter((r) => r.section === s.id);
		if (!inSection.length) continue;
		lines.push(`${s.label}:`);
		for (const r of inSection) lines.push(`- ${r.content}`);
	}
	return { lines, ids };
}
