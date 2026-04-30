/**
 * Fire-and-forget in-app notification insert.
 * Failures are logged, never thrown — callers must not await this for correctness.
 *
 * @param {string} userId
 * @param {'payment_received'|'withdrawal_completed'|'withdrawal_failed'} type
 * @param {object} payload
 */
import { sql } from './db.js';

export function insertNotification(userId, type, payload) {
	sql`
		insert into user_notifications (user_id, type, payload)
		values (${userId}, ${type}, ${JSON.stringify(payload)}::jsonb)
	`.catch((err) => console.error('[notify] insert failed:', err.message));
}
