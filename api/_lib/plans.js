import { sql } from './db.js';

const PAID_PLANS = new Set(['pro', 'team', 'enterprise', 'admin']);

export async function getUserPlan(userId) {
	if (!userId) return 'free';
	const rows = await sql`select plan from users where id = ${userId} limit 1`;
	return rows[0]?.plan || 'free';
}

export function isPaidPlan(plan) {
	return PAID_PLANS.has(plan);
}

export async function userHasPaidPlan(userId) {
	return isPaidPlan(await getUserPlan(userId));
}
