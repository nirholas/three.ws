// Self-service for customers billed through Microsoft Marketplace: what they
// bought, what it is costing them this billing period, and who holds the seats.
//
// Read by /dashboard/billing ("Billed through Microsoft") through
//   GET  /api/microsoft-marketplace/subscriptions
//   POST /api/microsoft-marketplace/seats   { op, subscription_id, user_id | team_id }
// both dispatched from api/microsoft-marketplace/[action].js.
//
// Who sees a subscription:
//   owner        the account that activated it (microsoft_saas_subscriptions.user_id)
//   team_admin   the owner of the team the subscription is linked to
//   seat_holder  anyone holding one of its seats (sees the plan, not the people)
//
// Seats (per-user plans, where Microsoft sends a quantity):
//   - recomputeUserPlan grants the plan only to seat holders who are still the
//     owner, the linked team's owner or an active member of that team;
//   - a manager (owner or team admin) assigns and unassigns seats, never more
//     than Microsoft's quantity, to the owner and the linked team's people;
//   - when the quantity drops below the seats in use (ChangeQuantity down), the
//     most recently assigned lose their seats first and each is told in-app;
//   - a flat-rate plan (quantity null) has no seats and grants its owner.
//
// Usage meters read microsoft_saas_usage_events, the rows the metering cron
// (api/cron/microsoft-metering.js) reports to Microsoft, so what this page shows
// is what Microsoft bills.

import { readFileSync } from 'node:fs';
import { sql } from './db.js';
import { getSessionUser } from './auth.js';
import { requireCsrf } from './csrf.js';
import { cors, method, error, json, readJson, rateLimited } from './http.js';
import { limits, clientIp } from './rate-limit.js';
import { insertNotification } from './notify.js';
import { logAudit } from './audit.js';
import {
	DIMENSIONS, entitles, planForMicrosoftPlan, publisherConfig, getSubscription, upsertSubscription,
	recomputeUserPlan, isSeatBased,
} from './microsoft-marketplace.js';

const CONFIG = JSON.parse(readFileSync(new URL('../../data/microsoft-marketplace.json', import.meta.url), 'utf8'));
const PLANS = JSON.parse(readFileSync(new URL('../../data/plans.json', import.meta.url), 'utf8'));

/** A stored row older than this is re-read from the Fulfillment API before it is shown. */
export const REFRESH_AFTER_MS = 10 * 60_000;
/** How long the page waits for Microsoft before it shows the stored row instead. */
export const REFRESH_TIMEOUT_MS = 5_000;

/**
 * Where a Microsoft customer manages the purchase itself. Microsoft's SaaS
 * lifecycle guide (learn.microsoft.com/marketplace/saas-subscription-lifecycle-management)
 * names both: the Microsoft 365 admin center subscriptions list and, for
 * purchases made in Azure, the Azure portal's SaaS resource list.
 */
export const MANAGE_LINKS = Object.freeze([
	Object.freeze({
		id: 'm365_admin_center',
		label: 'Microsoft 365 admin center',
		url: 'https://admin.microsoft.com/Adminportal/Home?#/subscriptions',
		hint: 'Change seats, turn recurring billing on or off, see invoices under Bills & payments, or cancel.',
	}),
	Object.freeze({
		id: 'azure_portal',
		label: 'Azure portal',
		url: 'https://portal.azure.com/#home',
		hint: 'For purchases made in Azure: search "SaaS", open the subscription, then change plan or cancel.',
	}),
]);

export class BillingError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

// ── Pure rules ──────────────────────────────────────────────────────────────

/** The three.ws display name of a Partner Center plan id ("Pro"), or the raw id when unknown. */
export function planDisplayName(planId) {
	const plan = planForMicrosoftPlan(planId);
	const entry = plan ? PLANS.plans.find((p) => p.id === plan) : null;
	return entry?.name || planId || 'Unknown plan';
}

/** Included quantity of one metered dimension in one billing period of a plan, or null. */
export function includedFor(planId, dimensionId) {
	const n = CONFIG.included?.[planId]?.[dimensionId];
	return Number.isFinite(n) ? n : null;
}

const STATUS_INFO = Object.freeze({
	PendingFulfillmentStart: {
		label: 'Waiting for activation',
		tone: 'warn',
		explanation: 'Microsoft has the purchase but it is not active yet, and nothing is billed until it is. Finish setup from the "Configure account" button on Microsoft Marketplace.',
	},
	Subscribed: {
		label: 'Active',
		tone: 'ok',
		explanation: 'Billed by Microsoft. Every feature of the plan is on.',
	},
	Suspended: {
		label: 'Suspended',
		tone: 'bad',
		explanation: 'Microsoft suspended this subscription, usually because a payment did not go through. Paid features are paused. Your account, agents, avatars and everything on the free plan keep working, and the plan comes back on its own once Microsoft reinstates the subscription.',
	},
	Unsubscribed: {
		label: 'Cancelled',
		tone: 'muted',
		explanation: 'This subscription has ended and Microsoft cannot reactivate it. Your account and everything you made stay, on the free plan limits unless another plan applies. To return, buy the offer again on Microsoft Marketplace.',
	},
});

/** Plain-language status for a Microsoft saasSubscriptionStatus. */
export function statusInfo(saasStatus) {
	return STATUS_INFO[saasStatus] || { label: 'Unknown', tone: 'muted', explanation: `Microsoft reported the status "${saasStatus}".` };
}

/** "buyer@contoso.com" as "b***r@contoso.com". The domain stays: it names the organization. */
export function maskEmail(email) {
	if (typeof email !== 'string' || !email.includes('@')) return null;
	const at = email.lastIndexOf('@');
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	if (!local) return `***@${domain}`;
	const masked = local.length <= 2 ? `${local[0]}***` : `${local[0]}***${local[local.length - 1]}`;
	return `${masked}@${domain}`;
}

function addMonthsUtc(date, months) {
	const y = date.getUTCFullYear();
	const m = date.getUTCMonth() + months;
	const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
	return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay),
		date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

function validDate(v) {
	if (v == null) return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The billing period that contains `now`. Microsoft bills metered usage
 * monthly from the subscription's term start, so periods are one-month windows
 * anchored on term_start (a 31st clamps to the month's last day) and the last
 * one ends at term_end. Before the term starts the first period is returned;
 * after it ends, the last. With no term (not activated yet) the calendar month
 * in UTC is used. Pure.
 */
export function billingPeriod({ termStart, termEnd, now = new Date() }) {
	const t = new Date(now);
	const start = validDate(termStart);
	if (!start) {
		return {
			start: new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)),
			end: new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)),
			anchored: false,
		};
	}
	const end = validDate(termEnd);
	let ref = t;
	if (ref < start) ref = start;
	if (end && end > start && ref >= end) ref = new Date(end.getTime() - 1);
	let k = (ref.getUTCFullYear() - start.getUTCFullYear()) * 12 + (ref.getUTCMonth() - start.getUTCMonth());
	if (addMonthsUtc(start, k) > ref) k -= 1;
	let periodStart = addMonthsUtc(start, k);
	let periodEnd = addMonthsUtc(start, k + 1);
	if (periodEnd <= ref) {
		periodStart = periodEnd;
		periodEnd = addMonthsUtc(start, k + 2);
	}
	if (end && end > periodStart && periodEnd > end) periodEnd = end;
	return { start: periodStart, end: periodEnd, anchored: true };
}

/**
 * Fold usage-event rows ({ dimension, status, quantity }, one per status or one
 * per event) into one meter per declared dimension. accepted and pending are
 * what Microsoft bills or is about to; rejected and expired never reach an
 * invoice and are shown so a customer can see nothing was lost silently. Pure.
 */
export function aggregateUsage(rows, planId) {
	const byDim = new Map(DIMENSIONS.map((d) => [d.id, { accepted: 0, pending: 0, rejected: 0, expired: 0 }]));
	for (const r of rows || []) {
		const bucket = byDim.get(r.dimension);
		if (!bucket || !Object.hasOwn(bucket, r.status)) continue;
		const q = Number(r.quantity);
		if (Number.isFinite(q) && q > 0) bucket[r.status] += q;
	}
	return DIMENSIONS.map((d) => {
		const b = byDim.get(d.id);
		const billable = b.accepted + b.pending;
		const included = includedFor(planId, d.id);
		return {
			id: d.id,
			display_name: d.display_name,
			unit: d.unit,
			...b,
			billable,
			included,
			percent: included ? Math.min(100, Math.round((billable / included) * 1000) / 10) : null,
			over_included: included != null && billable > included,
		};
	});
}

/**
 * Which seats a quantity drop takes back: the most recently assigned first,
 * ties broken by user id so the outcome never depends on row order. Returns the
 * seats to revoke, newest first. Pure.
 */
export function seatsToRevoke(seats, quantity) {
	const q = Number(quantity);
	if (!Number.isInteger(q) || q < 0) return [];
	const excess = seats.length - q;
	if (excess <= 0) return [];
	return [...seats]
		.sort((a, b) => {
			const dt = new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime();
			if (dt) return dt;
			return String(b.user_id).localeCompare(String(a.user_id));
		})
		.slice(0, excess);
}

// ── Reads ───────────────────────────────────────────────────────────────────

// Seat holders who may still hold a seat on `s`: the owner, the linked team's
// owner, or an active member of the linked team.
const ELIGIBLE_SEAT = (s, seat) => sql`(
	${seat}.user_id = ${s}.user_id
	or exists (select 1 from teams et where et.id = ${s}.team_id and et.archived_at is null and et.owner_user_id = ${seat}.user_id)
	or exists (select 1 from team_people ep where ep.team_id = ${s}.team_id and ep.user_id = ${seat}.user_id
	           and ep.status = 'active' and ep.scim_deleted_at is null)
)`;

async function visibleRows(userId) {
	return sql`
		select s.*, t.name as team_name, t.owner_user_id as team_owner_id,
		       (seat.user_id is not null) as you_hold_seat
		from microsoft_saas_subscriptions s
		left join teams t on t.id = s.team_id and t.archived_at is null
		left join microsoft_saas_seats seat on seat.subscription_id = s.id and seat.user_id = ${userId}
		where s.user_id = ${userId} or t.owner_user_id = ${userId} or seat.user_id is not null
		order by s.created_at desc
		limit 50
	`;
}

function roleFor(row, userId) {
	if (row.user_id === userId) return 'owner';
	if (row.team_owner_id === userId) return 'team_admin';
	return 'seat_holder';
}

function isStale(row, now = Date.now()) {
	if (row.saas_status === 'Unsubscribed') return false; // final; nothing left to change
	const seen = validDate(row.refreshed_at) || validDate(row.updated_at);
	return !seen || now - seen.getTime() > REFRESH_AFTER_MS;
}

function withTimeout(promise, ms) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Microsoft did not answer within ${ms / 1000} seconds`)), ms); }),
	]).finally(() => clearTimeout(timer));
}

/**
 * Re-read one stored row from the Fulfillment API. Any failure (not
 * configured, timeout, Microsoft down) leaves the stored row in place and says
 * so; the page never blocks on Microsoft.
 */
async function refreshRow(row) {
	if (!publisherConfig()) return { row, freshness: { source: 'stored', refreshed_at: row.refreshed_at || row.updated_at, error: null } };
	try {
		const sub = await withTimeout(getSubscription(row.id), REFRESH_TIMEOUT_MS);
		const fresh = await upsertSubscription(sub);
		const [{ refreshed_at } = {}] = await sql`update microsoft_saas_subscriptions set refreshed_at = now() where id = ${row.id} returning refreshed_at`;
		const changed = fresh.saas_status !== row.saas_status || fresh.plan_id !== row.plan_id || fresh.quantity !== row.quantity;
		// A webhook Microsoft never delivered still lands here: reconcile seats and plans.
		if (changed) await reconcileSeats(row.id);
		return { row: { ...row, ...fresh, refreshed_at }, freshness: { source: 'microsoft', refreshed_at, error: null } };
	} catch (err) {
		return { row, freshness: { source: 'stored', refreshed_at: row.refreshed_at || row.updated_at, error: String(err?.message || err).slice(0, 200) } };
	}
}

async function usageFor(row, period) {
	return sql`
		select dimension, status, sum(quantity) as quantity
		from microsoft_saas_usage_events
		where subscription_id = ${row.id}
		  and effective_start_time >= ${period.start} and effective_start_time < ${period.end}
		group by dimension, status
	`;
}

async function seatsFor(row, viewerId, canManage) {
	const holders = await sql`
		select seat.user_id, seat.assigned_at, u.display_name, u.email
		from microsoft_saas_seats seat
		join users u on u.id = seat.user_id
		where seat.subscription_id = ${row.id}
		order by seat.assigned_at asc, seat.user_id asc
	`;
	const out = { purchased: row.quantity, used: holders.length, holders: [], candidates: [] };
	if (!canManage) return out;
	out.holders = holders.map((h) => ({
		user_id: h.user_id,
		name: h.display_name || h.email || 'Unnamed member',
		email: h.email,
		assigned_at: h.assigned_at,
		is_you: h.user_id === viewerId,
		is_owner: h.user_id === row.user_id,
	}));
	const held = new Set(holders.map((h) => h.user_id));
	const people = await sql`
		select u.id as user_id, u.display_name, u.email,
		       (other.subscription_id is not null) as seat_elsewhere
		from users u
		left join microsoft_saas_seats other on other.user_id = u.id and other.subscription_id <> ${row.id}
		where u.deleted_at is null and (
			u.id = ${row.user_id}
			or u.id in (select owner_user_id from teams where id = ${row.team_id} and archived_at is null)
			or u.id in (select user_id from team_people where team_id = ${row.team_id} and status = 'active'
			            and scim_deleted_at is null and user_id is not null)
		)
		order by coalesce(u.display_name, u.email) asc
		limit 500
	`;
	out.candidates = people
		.filter((p) => !held.has(p.user_id))
		.map((p) => ({
			user_id: p.user_id,
			name: p.display_name || p.email || 'Unnamed member',
			email: p.email,
			is_you: p.user_id === viewerId,
			seat_elsewhere: Boolean(p.seat_elsewhere),
		}));
	return out;
}

function shape(row, viewerId, { usage, seats, period, freshness }) {
	const role = roleFor(row, viewerId);
	const status = statusInfo(row.saas_status);
	const plan = planForMicrosoftPlan(row.plan_id);
	const seatBased = isSeatBased(row);
	const fullContact = role === 'owner';
	return {
		id: row.id,
		name: row.name,
		offer_id: row.offer_id,
		plan_id: row.plan_id,
		plan,
		plan_name: planDisplayName(row.plan_id),
		status: row.saas_status,
		status_label: status.label,
		status_tone: status.tone,
		status_explanation: status.explanation,
		entitled: entitles(row.saas_status) && Boolean(plan),
		term_start: row.term_start,
		term_end: row.term_end,
		auto_renew: row.auto_renew,
		renews_at: row.auto_renew && row.saas_status === 'Subscribed' ? row.term_end : null,
		is_test: row.is_test,
		activated_at: row.activated_at,
		role,
		you_hold_seat: Boolean(row.you_hold_seat),
		can_manage_seats: seatBased && role !== 'seat_holder',
		can_link_team: role === 'owner' && seatBased,
		team: row.team_id && row.team_name ? { id: row.team_id, name: row.team_name } : null,
		purchaser_email: fullContact ? row.purchaser_email : maskEmail(row.purchaser_email),
		beneficiary_email: fullContact ? row.beneficiary_email : maskEmail(row.beneficiary_email),
		seat_based: seatBased,
		quantity: row.quantity,
		seats: seatBased ? seats : null,
		period: { start: period.start.toISOString(), end: period.end.toISOString() },
		usage,
		freshness,
	};
}

/** Every Microsoft subscription the user may see, refreshed when stale, with usage and seats. */
export async function listBillingSubscriptions(userId, { now = new Date() } = {}) {
	const rows = await visibleRows(userId);
	const refreshed = await Promise.all(rows.map((r) => (isStale(r, now.getTime())
		? refreshRow(r)
		: { row: r, freshness: { source: 'microsoft', refreshed_at: r.refreshed_at || r.updated_at, error: null } })));
	const subscriptions = await Promise.all(refreshed.map(async ({ row, freshness }) => {
		const period = billingPeriod({ termStart: row.term_start, termEnd: row.term_end, now });
		const role = roleFor(row, userId);
		const [usageRows, seats] = await Promise.all([
			usageFor(row, period),
			isSeatBased(row) ? seatsFor(row, userId, role !== 'seat_holder') : null,
		]);
		return shape(row, userId, { usage: aggregateUsage(usageRows, row.plan_id), seats, period, freshness });
	}));
	const teams = await sql`
		select id, name from teams where owner_user_id = ${userId} and archived_at is null order by name asc limit 100
	`;
	const [{ plan } = {}] = await sql`select plan from users where id = ${userId} limit 1`;
	return { plan: plan || 'free', subscriptions, teams, manage_links: MANAGE_LINKS };
}

// ── Seat writes ─────────────────────────────────────────────────────────────

async function loadForManager(subscriptionId, viewerId) {
	const [row] = await sql`
		select s.*, t.owner_user_id as team_owner_id
		from microsoft_saas_subscriptions s
		left join teams t on t.id = s.team_id and t.archived_at is null
		where s.id = ${subscriptionId}
		limit 1
	`;
	if (!row || (row.user_id !== viewerId && row.team_owner_id !== viewerId)) {
		throw new BillingError('not_found', 'no Microsoft subscription you manage has that id', 404);
	}
	if (!isSeatBased(row)) throw new BillingError('flat_rate', 'this plan is billed at a flat rate and has no seats to assign', 409);
	return row;
}

function notifySeat(userId, action, row, summary) {
	return insertNotification(userId, 'microsoft_seat', {
		action,
		subscription_id: row.id,
		plan_name: planDisplayName(row.plan_id),
		title: action === 'assigned' ? `You have a ${planDisplayName(row.plan_id)} seat` : `Your ${planDisplayName(row.plan_id)} seat was removed`,
		summary,
		link: '/dashboard/billing#bl-microsoft',
	}).catch(() => null);
}

/** Give `targetUserId` a seat. The insert itself enforces the quantity, so two admins racing cannot over-assign. */
export async function assignSeat(viewerId, subscriptionId, targetUserId) {
	const row = await loadForManager(subscriptionId, viewerId);
	const [eligible] = await sql`
		select 1 as ok from (select ${targetUserId}::uuid as user_id) seat, microsoft_saas_subscriptions s
		where s.id = ${row.id} and ${ELIGIBLE_SEAT(sql`s`, sql`seat`)}
	`;
	if (!eligible) throw new BillingError('not_eligible', 'seats go to the subscription owner and active members of its linked team', 409);
	let inserted;
	try {
		[inserted] = await sql`
			insert into microsoft_saas_seats (subscription_id, user_id, assigned_by)
			select ${row.id}, ${targetUserId}, ${viewerId}
			where (select count(*) from microsoft_saas_seats where subscription_id = ${row.id}) < ${row.quantity}
			on conflict (subscription_id, user_id) do nothing
			returning user_id
		`;
	} catch (err) {
		if (/microsoft_saas_seats_one_per_user|duplicate key/i.test(String(err?.message))) {
			throw new BillingError('seat_elsewhere', 'this person already holds a seat on another Microsoft subscription; remove that one first', 409);
		}
		throw err;
	}
	if (!inserted) {
		const [{ held } = {}] = await sql`select count(*)::int as held from microsoft_saas_seats where subscription_id = ${row.id} and user_id = ${targetUserId}`;
		if (held) return { changed: false, plan: await recomputeUserPlan(targetUserId) };
		throw new BillingError('no_seats_left', `all ${row.quantity} seats are in use; add seats in Microsoft or remove someone first`, 409);
	}
	const plan = await recomputeUserPlan(targetUserId);
	if (targetUserId !== viewerId) {
		await notifySeat(targetUserId, 'assigned', row, `You now have the ${planDisplayName(row.plan_id)} plan, billed through Microsoft.`);
	}
	return { changed: true, plan };
}

/** Take a seat back. A manager may free any seat; anyone may give up their own. */
export async function unassignSeat(viewerId, subscriptionId, targetUserId) {
	const [row] = await sql`
		select s.*, t.owner_user_id as team_owner_id
		from microsoft_saas_subscriptions s
		left join teams t on t.id = s.team_id and t.archived_at is null
		where s.id = ${subscriptionId}
		limit 1
	`;
	const manager = row && (row.user_id === viewerId || row.team_owner_id === viewerId);
	if (!row || (!manager && targetUserId !== viewerId)) throw new BillingError('not_found', 'no Microsoft subscription you manage has that id', 404);
	const removed = await sql`delete from microsoft_saas_seats where subscription_id = ${row.id} and user_id = ${targetUserId} returning user_id`;
	const plan = await recomputeUserPlan(targetUserId);
	if (removed.length && targetUserId !== viewerId) {
		await notifySeat(targetUserId, 'removed', row, 'An admin of your team freed this seat. Your account and everything you made stay; paid features are off unless another plan applies.');
	}
	return { changed: removed.length > 0, plan };
}

/** Let the people of a team the owner runs hold this subscription's seats. */
export async function linkTeam(viewerId, subscriptionId, teamId) {
	const row = await loadForManager(subscriptionId, viewerId);
	if (row.user_id !== viewerId) throw new BillingError('owner_only', 'only the account that activated the subscription can link it to a team', 403);
	const [team] = await sql`select id, name from teams where id = ${teamId} and owner_user_id = ${viewerId} and archived_at is null limit 1`;
	if (!team) throw new BillingError('team_not_found', 'link a team you own', 404);
	await sql`update microsoft_saas_subscriptions set team_id = ${team.id}, updated_at = now() where id = ${row.id}`;
	// Seats held through the previous team no longer qualify.
	const revoked = await reconcileSeats(row.id);
	return { team, revoked };
}

export async function unlinkTeam(viewerId, subscriptionId) {
	const row = await loadForManager(subscriptionId, viewerId);
	if (row.user_id !== viewerId) throw new BillingError('owner_only', 'only the account that activated the subscription can unlink its team', 403);
	await sql`update microsoft_saas_subscriptions set team_id = null, updated_at = now() where id = ${row.id}`;
	const revoked = await reconcileSeats(row.id);
	return { revoked };
}

/**
 * Bring a subscription's seats back in line with its plan, quantity and team:
 * a flat-rate plan holds no seats, a seat whose holder left the team is freed,
 * and seats beyond the quantity go most-recent-first. Every person who loses a
 * seat is notified and has their plan recomputed. Returns their user ids.
 */
export async function reconcileSeats(subscriptionId) {
	const [row] = await sql`select * from microsoft_saas_subscriptions where id = ${subscriptionId} limit 1`;
	if (!row) return [];
	const revoked = [];
	if (!isSeatBased(row)) {
		const gone = await sql`delete from microsoft_saas_seats where subscription_id = ${row.id} returning user_id`;
		for (const g of gone) revoked.push({ user_id: g.user_id, reason: 'plan' });
	} else {
		const ineligible = await sql`
			delete from microsoft_saas_seats seat
			using microsoft_saas_subscriptions s
			where s.id = ${row.id} and seat.subscription_id = s.id and not ${ELIGIBLE_SEAT(sql`s`, sql`seat`)}
			returning seat.user_id
		`;
		for (const g of ineligible) revoked.push({ user_id: g.user_id, reason: 'team' });
		const seats = await sql`select user_id, assigned_at from microsoft_saas_seats where subscription_id = ${row.id}`;
		const over = seatsToRevoke(seats, row.quantity);
		if (over.length) {
			const ids = over.map((s) => s.user_id);
			await sql`delete from microsoft_saas_seats where subscription_id = ${row.id} and user_id = any(${ids}::uuid[])`;
			for (const id of ids) revoked.push({ user_id: id, reason: 'quantity' });
		}
	}
	const affected = new Set([row.user_id, ...revoked.map((r) => r.user_id)].filter(Boolean));
	await Promise.all([...affected].map((id) => recomputeUserPlan(id)));
	const why = {
		quantity: `Your organization reduced the seats on its ${planDisplayName(row.plan_id)} subscription in Microsoft, and the most recently assigned seats were freed first. Ask your team admin for a seat if one opens up.`,
		team: 'You are no longer a member of the team this Microsoft subscription is shared with.',
		plan: 'The Microsoft subscription moved to a plan without seats.',
	};
	await Promise.all(revoked.map((r) => notifySeat(r.user_id, 'removed', row, why[r.reason])));
	if (revoked.length) {
		logAudit({ userId: row.user_id, action: 'microsoft_marketplace:seats_reconciled', resourceId: row.id, meta: { quantity: row.quantity, revoked: revoked.map((r) => r.user_id) } });
	}
	return revoked.map((r) => r.user_id);
}

/** A per-user subscription starts with its owner holding the first seat. */
export async function ensureOwnerSeat(subscriptionId) {
	const [row] = await sql`select * from microsoft_saas_subscriptions where id = ${subscriptionId} limit 1`;
	if (!row || !row.user_id || !isSeatBased(row)) return false;
	const [inserted] = await sql`
		insert into microsoft_saas_seats (subscription_id, user_id, assigned_by)
		select ${row.id}, ${row.user_id}, ${row.user_id}
		where (select count(*) from microsoft_saas_seats where subscription_id = ${row.id}) < ${row.quantity}
		on conflict do nothing
		returning user_id
	`;
	return Boolean(inserted);
}

/** A person left a team: free any seat they held through it. */
export async function releaseTeamSeat(teamId, userId) {
	if (!teamId || !userId) return [];
	const subs = await sql`
		select seat.subscription_id from microsoft_saas_seats seat
		join microsoft_saas_subscriptions s on s.id = seat.subscription_id
		where seat.user_id = ${userId} and s.team_id = ${teamId}
	`;
	const revoked = [];
	for (const s of subs) revoked.push(...await reconcileSeats(s.subscription_id));
	return revoked;
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/** GET /api/microsoft-marketplace/subscriptions */
export async function handleBillingSubscriptions(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to see your Microsoft subscriptions');
	res.setHeader('cache-control', 'private, no-store');
	return json(res, 200, await listBillingSubscriptions(user.id));
}

const SEAT_OPS = {
	assign: (uid, b) => assignSeat(uid, b.subscription_id, b.user_id),
	unassign: (uid, b) => unassignSeat(uid, b.subscription_id, b.user_id),
	link_team: (uid, b) => linkTeam(uid, b.subscription_id, b.team_id),
	unlink_team: (uid, b) => unlinkTeam(uid, b.subscription_id),
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/microsoft-marketplace/seats { op, subscription_id, user_id | team_id } */
export async function handleSeats(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to manage seats');
	if (!(await requireCsrf(req, res, user.id))) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const body = (await readJson(req)) || {};
	const op = SEAT_OPS[body.op];
	if (!op) return error(res, 400, 'validation_error', 'op must be assign, unassign, link_team or unlink_team');
	if (typeof body.subscription_id !== 'string' || !body.subscription_id || body.subscription_id.length > 100) {
		return error(res, 400, 'validation_error', 'subscription_id is required');
	}
	if ((body.op === 'assign' || body.op === 'unassign') && !UUID_RE.test(String(body.user_id || ''))) {
		return error(res, 400, 'validation_error', 'user_id must be a user id');
	}
	if (body.op === 'link_team' && !UUID_RE.test(String(body.team_id || ''))) {
		return error(res, 400, 'validation_error', 'team_id must be a team id');
	}
	try {
		const result = await op(user.id, body);
		logAudit({ userId: user.id, action: `microsoft_marketplace:seat_${body.op}`, resourceId: body.subscription_id, meta: { target: body.user_id || body.team_id || null }, req });
		return json(res, 200, { ok: true, ...result });
	} catch (err) {
		if (err instanceof BillingError) return error(res, err.status, err.code, err.message);
		throw err;
	}
}
