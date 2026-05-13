import { sql } from './db.js';

const PAID_PLANS = new Set(['pro', 'team', 'enterprise']);

export function isPaidPlan(plan) {
	return PAID_PLANS.has(plan);
}

export async function userHasPaidPlan(userId) {
	if (!userId) return false;
	const rows = await sql`
		select plan, is_admin from users where id = ${userId} and deleted_at is null limit 1
	`;
	const u = rows[0];
	if (!u) return false;
	return u.is_admin === true || isPaidPlan(u.plan);
}
