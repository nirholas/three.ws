// Account-level memory settings (table account_memory_settings).
//
// One row per account, written on first change. No row means the defaults, so
// every read degrades to "memory on" without a write. `enabled = false` is the
// global off switch: every write path (memory_save, user-model updates, skill
// drafts) checks it before touching the database, and every prompt path skips
// memory injection for the account.

import { z } from 'zod';
import { sql } from '../db.js';

export const MEMORY_DEFAULTS = Object.freeze({
	enabled: true,
	skill_drafts_enabled: true,
	nudge_every_turns: 6,
});

export const settingsPatchSchema = z
	.object({
		enabled: z.boolean().optional(),
		skill_drafts_enabled: z.boolean().optional(),
		nudge_every_turns: z.number().int().min(2).max(50).optional(),
	})
	.strict()
	.refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });

function present(row) {
	if (!row) return { ...MEMORY_DEFAULTS, updated_at: null };
	return {
		enabled: row.enabled,
		skill_drafts_enabled: row.skill_drafts_enabled,
		nudge_every_turns: row.nudge_every_turns,
		updated_at: row.updated_at,
	};
}

/** The account's settings, defaults when it has never changed any. */
export async function getMemorySettings(userId) {
	if (!userId) return { ...MEMORY_DEFAULTS, updated_at: null };
	const [row] = await sql`
		SELECT enabled, skill_drafts_enabled, nudge_every_turns, updated_at
		FROM account_memory_settings WHERE user_id = ${userId}
	`;
	return present(row);
}

/** True when the account allows memory reads and writes. */
export async function memoryEnabled(userId) {
	if (!userId) return false;
	return (await getMemorySettings(userId)).enabled;
}

/** Apply a patch already parsed by settingsPatchSchema. Returns the new settings. */
export async function updateMemorySettings(userId, patch) {
	const current = await getMemorySettings(userId);
	const next = { ...current, ...patch };
	const [row] = await sql`
		INSERT INTO account_memory_settings (user_id, enabled, skill_drafts_enabled, nudge_every_turns, updated_at)
		VALUES (${userId}, ${next.enabled}, ${next.skill_drafts_enabled}, ${next.nudge_every_turns}, now())
		ON CONFLICT (user_id) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			skill_drafts_enabled = EXCLUDED.skill_drafts_enabled,
			nudge_every_turns = EXCLUDED.nudge_every_turns,
			updated_at = now()
		RETURNING enabled, skill_drafts_enabled, nudge_every_turns, updated_at
	`;
	return present(row);
}
