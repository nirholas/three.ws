// @ts-check
// Permanent purge of deleted accounts, 30 days after the owner deleted them.
//
// The privacy policy (public/legal/privacy.html, section 5) promises: "Deleted
// accounts are soft-deleted for 30 days (for recovery), then permanently
// purged." DELETE /api/auth/me does the soft half (api/auth/[action].js,
// handleDeleteAccount). This module does the permanent half, and
// api/cron/purge-deleted-accounts.js runs it daily.
//
// How a purge works, per account
// -------------------------------
//   1. Guard. Any row that would block the delete through a foreign key nobody
//      has classified (below) fails this account with a coded error. The purge
//      never guesses about data it has not been told how to treat.
//   2. Object storage. Every R2 object the account owns (avatar bodies and
//      thumbnails, animation and mocap clips, profile images, version GLBs) is
//      deleted BEFORE any row, because the rows are the only record of which keys
//      to delete. A key still referenced by another account's row is skipped.
//   3. Rows, in one transaction: anonymize retained records, delete the
//      account's own records that a plain foreign key would otherwise block,
//      delete the account's records that carry no foreign key at all, then delete
//      the users row, which cascades through everything declared ON DELETE
//      CASCADE and nulls everything declared ON DELETE SET NULL.
//   4. Receipt. One account_purge_log row: SHA-256 of the user id, the
//      soft-delete time and per-table counts. No email, wallet or username.
//
// A failure at any step leaves the account soft-deleted and purgeable, records
// the error code in account_purge_failures, and the next tick retries it after
// the accounts that have never been attempted.
//
// Classification of everything that refers to a user (live catalog, 2026-11-04)
// ---------------------------------------------------------------------------
// cascade (dies with the users row): 232 foreign keys declared ON DELETE CASCADE,
//   reaching 336 tables in all. Among them: sessions, user_wallets,
//   user_identities, api_keys, oauth tokens, avatars, agent_identities, widgets,
//   animation_clips, mocap_clips, subscriptions, credit_ledger, push and APNs
//   devices, notifications, follows, direct messages, home membership.
// set null (anonymized by the database): 63 foreign keys declared ON DELETE SET
//   NULL. Among them: audit_log, forge_creations, usage_events, print_orders,
//   token_payments, fee_bridge_payouts, marketplace_skills.author_id.
// blocking (plain NO ACTION or RESTRICT foreign key, on users or on a table in
//   the cascade tree): each has an explicit decision in EDGE_POLICY. "delete"
//   for the account's own records, "nullify" for records that outlive it
//   (financial, two-party, or another person's row that merely points at it).
//   Migration 20261104180000_account_purge.sql drops NOT NULL on the retained
//   columns that had it; every foreign key is kept.
// no foreign key: OWNED_WITHOUT_FK lists the user-id columns the platform writes
//   without a constraint, each with the same delete or nullify decision.
//   EMAIL_KEYED lists records keyed by the account's email address.
// retain (left exactly as written): RETAINED_TABLES. legal_signatures (the
//   policy keeps legal acceptance records after deletion), the purge receipts,
//   the security decision log within its own retention window, and the x402 and
//   on-chain settlement logs, which are keyed by a public wallet address that
//   paid an open endpoint, carry no account link, and are pruned on their own
//   windows by api/cron/db-retention.js.
//
// On every row the purge anonymizes, any address, wallet, payer, recipient or
// email column that holds one of this account's own identifiers is cleared too
// (null, or a random "purged-" token where the column is NOT NULL), so a
// retained financial row keeps its amount and transaction signature but no
// longer names the person.

import { createHash } from 'node:crypto';
import { sql } from './db.js';
import { deleteObject, keyFromPublicUrl, objectStorageConfigured } from './r2.js';

export const PURGE_AFTER_DAYS = 30;

/**
 * Decisions for every blocking foreign key, keyed `child_table.column`.
 * @type {Record<string, 'delete' | 'nullify'>}
 */
export const EDGE_POLICY = {
	// Direct references to users.
	'users.referred_by_id': 'nullify',
	'skill_purchases.recipient_user_id': 'nullify',
	'skill_purchases.referrer_user_id': 'nullify',
	'agent_strategies.owner_id': 'delete',
	'agent_strategy_equips.owner_id': 'delete',
	'strategy_kill_switch.owner_id': 'delete',
	'avatar_versions.created_by': 'nullify',
	'agent_withdrawals.user_id': 'nullify',
	'payouts.creator_id': 'nullify',
	'genome_breedings.bred_by': 'delete',
	'genome_breedings.consent_owner': 'nullify',
	'scene_gates.user_id': 'delete',
	'skill_payment_earnings.creator_id': 'nullify',
	'payment_session_executions.user_id': 'nullify',
	'agent_transfers.buyer_user_id': 'nullify',
	'agent_transfers.seller_user_id': 'nullify',
	'agent_listings.seller_user_id': 'delete',
	'agent_listing_bids.bidder_user_id': 'delete',
	'human_tasks.poster_user_id': 'nullify',
	'human_task_quotes.user_id': 'delete',
	'human_task_claims.worker_user_id': 'nullify',
	'human_task_disputes.opened_by_user_id': 'nullify',
	'human_task_disputes.resolved_by': 'nullify',
	'human_task_reviews.reviewer_user_id': 'nullify',
	'human_task_reviews.subject_user_id': 'nullify',
	'event_market_overrides.admin_id': 'nullify',
	// References into the cascade tree (the account's avatars, agents, plans,
	// payment sessions, top-ups and bundles) from rows that outlive it.
	'avatars.parent_avatar_id': 'nullify',
	'agent_revenue_events.agent_id': 'nullify',
	'agent_revenue_events.intent_id': 'nullify',
	'agent_payments.payee_agent_id': 'nullify',
	'agent_payments.payer_agent_id': 'nullify',
	'agent_withdrawals.agent_id': 'nullify',
	'vault_backers.backer_agent_id': 'nullify',
	'agent_listings.agent_id': 'delete',
	'agent_listing_bids.funding_agent_id': 'nullify',
	'agent_listing_bids.listing_id': 'delete',
	'agent_transfers.agent_id': 'nullify',
	'agent_transfers.listing_id': 'nullify',
	'agent_transfers.bid_id': 'nullify',
	'human_tasks.poster_agent_id': 'nullify',
	'human_task_quotes.agent_id': 'delete',
	'human_task_reviews.subject_agent_id': 'nullify',
	'oauth_refresh_tokens.replaced_by': 'nullify',
	'creator_subscriptions.plan_id': 'delete',
	'subscription_payments.subscription_id': 'nullify',
	'payment_session_executions.session_id': 'nullify',
	'inference_keys.topup_id': 'nullify',
	'bundle_purchases.bundle_id': 'nullify',
};

/**
 * User-id columns written without a foreign key. `delete` for the account's own
 * records, `nullify` for records that outlive it.
 * @type {Array<{ table: string, column: string, action: 'delete' | 'nullify' }>}
 */
export const OWNED_WITHOUT_FK = [
	...[
		['agent_activations', 'user_id'],
		['agent_anomaly_events', 'user_id'],
		['agent_labor_policies', 'user_id'],
		['agent_launcher_configs', 'user_id'],
		['agent_market_maker_configs', 'user_id'],
		['agent_market_previews', 'user_id'],
		['agent_wallet_capabilities', 'user_id'],
		['agent_wallet_intents', 'user_id'],
		['agent_signers', 'user_id'],
		['agent_sniper_positions', 'user_id'],
		['agent_strategy_positions', 'owner_id'],
		['agent_recovery_requests', 'prev_owner_id'],
		['agent_recovery_requests', 'new_owner_id'],
		['agent_launched_coins', 'user_id'],
		['agent_personas', 'owner_id'],
		['agent_skills', 'user_id'],
		['agora_citizens', 'user_id'],
		['agora_idempotency', 'user_id'],
		['agora_vouches', 'voucher_user_id'],
		['anatomy_designs', 'user_id'],
		['auth_reauth', 'user_id'],
		['avatar_regen_jobs', 'user_id'],
		['bounties', 'user_id'],
		['bounty_submissions', 'user_id'],
		['bounty_submission_likes', 'user_id'],
		['cad_designs', 'user_id'],
		['copy_executions', 'copier_user_id'],
		['creator_payout_wallets', 'user_id'],
		['destination_stepup_codes', 'user_id'],
		['destination_stepup_grants', 'user_id'],
		['destination_whitelist_entries', 'user_id'],
		['destination_whitelist_settings', 'user_id'],
		['fixed_supply_launches', 'user_id'],
		['forge_seed_jobs', 'user_id'],
		['home_action_log', 'user_id'],
		['irl_interactions', 'viewer_user_id'],
		['irl_pins', 'user_id'],
		['oracle_agent_watch', 'user_id'],
		['oracle_watch_actions', 'user_id'],
		['pending_external_txs', 'user_id'],
		['pins', 'user_id'],
		['premium_quotes', 'user_id'],
		['stages', 'owner_user_id'],
		['world_docs', 'owner_id'],
	].map(([table, column]) => ({ table, column, action: /** @type {const} */ ('delete') })),
	...[
		['agent_bids', 'worker_user_id'],
		['agent_bounties', 'poster_user_id'],
		['agent_card_events', 'actor_user_id'],
		['agent_card_withdrawals', 'user_id'],
		['agent_custody_events', 'user_id'],
		['agent_hires', 'hirer_user_id'],
		['agent_hires', 'provider_user_id'],
		['agent_jobs', 'worker_user_id'],
		['agent_marketplace_history', 'actor_user_id'],
		['agent_mirror_fills', 'owner_user_id'],
		['agent_revenue_events', 'owner_user_id'],
		['agent_vaults', 'owner_user_id'],
		['creator_payout_distributions', 'user_id'],
		['growth_program_payouts', 'user_id'],
		['human_task_events', 'actor_user_id'],
		['irl_drop_claims', 'claimant_user_id'],
		['irl_drops', 'creator_user_id'],
		['irl_presence_proofs', 'completer_user_id'],
		['irl_world_lines', 'creator_user_id'],
		['launch_sponsorships', 'user_id'],
		['orders', 'user_id'],
		['premium_passes', 'user_id'],
		['show_tips', 'tipper_user_id'],
		['vault_backers', 'user_id'],
		['vault_events', 'user_id'],
	].map(([table, column]) => ({ table, column, action: /** @type {const} */ ('nullify') })),
];

/**
 * Rows that still move someone's money. If the purge would delete or unlink one
 * (an open bid on the account's listing still holds a bidder's escrow, a refund
 * is still owed, a sale is still settling), the account waits with
 * in_flight:<table> and a later tick purges it once the marketplace escrow
 * sweep has settled the row. Deleting it first would erase the only record of
 * what is owed.
 */
export const IN_FLIGHT = [
	{
		table: 'agent_listing_bids',
		columns: ['status', 'refund_status'],
		when: `"status" in ('awaiting_funds', 'open') or "refund_status" in ('pending', 'failed')`,
	},
	{ table: 'agent_transfers', columns: ['status'], when: `"status" <> 'completed'` },
];

/** Records keyed by the account's email address rather than its id. */
export const EMAIL_KEYED = [{ table: 'home_invites', column: 'email' }];

/** Tables the purge deliberately leaves exactly as written. */
export const RETAINED_TABLES = [
	'legal_signatures',
	'account_purge_log',
	'firewall_decisions',
	'x402_receipts',
	'x402_audit_log',
	'x402_self_facilitator_log',
	'x402_prepaid_accounts',
	'x402_prepaid_entries',
	'x402_pending_settlements',
	'x402_data_desk',
	'x402_demo_feed',
	'x402_pump_launches',
	'x402_ring_ledger',
	'club_tips',
	'inference_jobs',
	'royalty_ledger',
	'builder_code_attribution',
	'bsc_consumed_tx',
	'canary_notification_log',
	'spend_session_health_log',
	'forge_autonomous_props',
	'agent_commerce_invoice_payments',
	'wallet_reputation',
	'smart_wallet_reputation',
	'pump_coin_wallets',
	'pump_coin_intel',
	'pumpfun_graduations',
	'erc8004_agents_index',
	'solana_agents_index',
	'three_holder_snapshot',
	'custody_attestation_leaves',
];

// R2 objects an account owns. KEY sources store bucket keys; URL sources store
// public URLs that map back to a key when they point into our bucket.
const KEY_SOURCES = [
	{ table: 'avatars', owner: 'owner_id', columns: ['storage_key', 'thumbnail_key', 'baked_storage_key', 'usdz_key', 'halfbody_key'] },
	{ table: 'animation_clips', owner: 'owner_id', columns: ['storage_key', 'thumbnail_key', 'artifact_key'] },
	{ table: 'mocap_clips', owner: 'owner_id', columns: ['storage_key', 'thumbnail_key'] },
];
const URL_SOURCES = [
	{ table: 'users', owner: 'id', columns: ['avatar_url', 'banner_url'] },
	{ table: 'agent_identities', owner: 'user_id', columns: ['avatar_url', 'profile_image_url'] },
	{ table: 'avatar_versions', via: { column: 'avatar_id', table: 'avatars', owner: 'owner_id' }, columns: ['glb_url'] },
];

// Text columns that can hold a person's wallet or email on a retained row.
const IDENTIFIER_COLUMN = /(address|wallet|payer|recipient|email)/;
const NOT_IDENTIFIER_COLUMN = /(^ip_|_ip$|ip_address|escrow|pool|platform_fee|treasury|charity|split_address|mint)/;

const STORAGE_CONCURRENCY = 8;

/** SHA-256 hex of a user id: the only handle a purge receipt keeps. */
export function userRef(userId) {
	return createHash('sha256').update(String(userId)).digest('hex');
}

function qi(name) {
	return `"${String(name).replace(/"/g, '""')}"`;
}

class PurgeError extends Error {
	/** @param {string} code */
	constructor(code) {
		super(code);
		this.code = code;
	}
}

// ── Catalog ──────────────────────────────────────────────────────────────────

async function loadCatalog() {
	const [fks, cols] = await Promise.all([
		sql(
			`select
				(select relname from pg_class where oid = c.conrelid) as child,
				(select relname from pg_class where oid = c.confrelid) as parent,
				c.confdeltype as rule,
				array(select a.attname::text from unnest(c.conkey) with ordinality k(n, o)
					join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as cols,
				array(select a.attname::text from unnest(c.confkey) with ordinality k(n, o)
					join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o) as pcols
			from pg_constraint c
			where c.contype = 'f' and c.connamespace = (select oid from pg_namespace where nspname = current_schema())`,
			[],
		),
		sql(
			`select table_name, column_name, data_type, is_nullable
			from information_schema.columns where table_schema = current_schema()`,
			[],
		),
	]);
	/** @type {Map<string, Map<string, { type: string, nullable: boolean }>>} */
	const columns = new Map();
	for (const c of cols) {
		if (!columns.has(c.table_name)) columns.set(c.table_name, new Map());
		columns.get(c.table_name).set(c.column_name, { type: c.data_type, nullable: c.is_nullable === 'YES' });
	}
	return { fks, columns };
}

// ── Plan ─────────────────────────────────────────────────────────────────────
// Built once per run from the live catalog. Every statement takes $1 = user id;
// statements that clear identifiers also take $2 = the account's identifiers.
//
// The walk only records which edges reach each table. WHERE clauses are rendered
// after the walk, so a table reached by several paths (an agent listing found
// through the seller and again through the seller's agent) carries every path,
// and deletes run children first by the longest path from users, so a row is
// never deleted while something still selects or references it.
function buildPlan({ fks, columns }) {
	const col = (table, name) => columns.get(table)?.get(name);
	const byParent = new Map();
	for (const fk of fks) {
		if (!byParent.has(fk.parent)) byParent.set(fk.parent, []);
		byParent.get(fk.parent).push(fk);
	}

	// table -> { roots: direct predicates on $1, edges: FKs from rows being removed }
	const nodes = new Map();
	const queue = [];
	const deleteTables = new Set();
	const guardEdges = [];
	const nullifyEdges = [];
	const nullifies = [];

	const node = (table) => {
		if (!nodes.has(table)) {
			nodes.set(table, { roots: [], edges: [] });
			queue.push(table);
		}
		return nodes.get(table);
	};
	node('users').roots.push('"id" = $1::uuid');

	for (const entry of OWNED_WITHOUT_FK) {
		const info = col(entry.table, entry.column);
		if (!info) continue;
		const pred = `${qi(entry.column)} = ${info.type === 'uuid' ? '$1::uuid' : '$1::uuid::text'}`;
		if (entry.action === 'delete') {
			node(entry.table).roots.push(pred);
			deleteTables.add(entry.table);
		} else {
			nullifies.push({ label: entry.table, table: entry.table, columns: [entry.column], pred, nullable: info.nullable });
		}
	}

	while (queue.length) {
		const parent = queue.shift();
		for (const fk of byParent.get(parent) || []) {
			if (fk.rule === 'n' || fk.rule === 'd') continue;
			const key = `${fk.child}.${fk.cols.join(',')}`;
			if (fk.rule === 'c') {
				node(fk.child).edges.push(fk);
				continue;
			}
			const nullable = fk.cols.every((c) => col(fk.child, c)?.nullable);
			const policy = EDGE_POLICY[key];
			if (policy === 'delete') {
				node(fk.child).edges.push(fk);
				deleteTables.add(fk.child);
			} else if (policy === 'nullify' && !nullable) {
				guardEdges.push({ code: `fk_not_nullable:${key}`, fk });
			} else if (policy === 'nullify' || nullable) {
				// An unclassified edge on a nullable column gets what ON DELETE SET
				// NULL would have done: the other row survives, unlinked.
				nullifyEdges.push(fk);
			} else {
				guardEdges.push({ code: `unclassified_fk:${key}`, fk });
			}
		}
	}

	// The rows of `table` the purge removes. A self-reference or cycle is not
	// followed back into a table already on the path: Postgres cascades those
	// rows itself, and the walk has no other way to reach them.
	const memo = new Map();
	const whereOf = (table, path = new Set()) => {
		if (memo.has(table)) return memo.get(table);
		const n = nodes.get(table);
		const next = new Set(path).add(table);
		let cut = false;
		const parts = [...n.roots];
		for (const fk of n.edges) {
			if (next.has(fk.parent)) {
				cut = true;
				continue;
			}
			parts.push(edgePred(fk, next));
		}
		const where = parts.length ? parts.map((p) => `(${p})`).join(' or ') : 'false';
		if (!cut) memo.set(table, where);
		return where;
	};
	const edgePred = (fk, path = new Set()) =>
		`(${fk.cols.map(qi).join(', ')}) in (select ${fk.pcols.map(qi).join(', ')} from ${qi(fk.parent)} where ${whereOf(fk.parent, path)})`;

	// Longest path from users, so every table is deleted after all of its
	// children in the walk.
	const depthMemo = new Map();
	const depthOf = (table, path = new Set()) => {
		if (depthMemo.has(table)) return depthMemo.get(table);
		const n = nodes.get(table);
		const next = new Set(path).add(table);
		let cut = false;
		let depth = n.roots.length && table !== 'users' ? 1 : 0;
		for (const fk of n.edges) {
			if (next.has(fk.parent)) {
				cut = true;
				continue;
			}
			depth = Math.max(depth, depthOf(fk.parent, next) + 1);
		}
		if (!cut) depthMemo.set(table, depth);
		return depth;
	};

	for (const fk of nullifyEdges) {
		nullifies.push({ label: fk.child, table: fk.child, columns: fk.cols, pred: edgePred(fk), nullable: true });
	}
	const guards = guardEdges.map(({ code, fk }) => ({ code, table: fk.child, pred: edgePred(fk) }));
	for (const f of IN_FLIGHT) {
		if (!f.columns.every((c) => col(f.table, c))) continue;
		const touched = nullifies.filter((n) => n.table === f.table).map((n) => n.pred);
		if (nodes.has(f.table)) touched.push(whereOf(f.table));
		if (!touched.length) continue;
		guards.push({ code: `in_flight:${f.table}`, table: f.table, pred: `(${touched.map((p) => `(${p})`).join(' or ')}) and (${f.when})` });
	}
	const deletes = [...deleteTables]
		.map((table) => ({ label: table, table, pred: whereOf(table), depth: depthOf(table) }))
		.sort((a, b) => b.depth - a.depth || a.table.localeCompare(b.table));

	const identifierColumns = (table, skip) => {
		const out = [];
		for (const [name, info] of columns.get(table) || []) {
			if (skip.includes(name) || info.type !== 'text') continue;
			if (IDENTIFIER_COLUMN.test(name) && !NOT_IDENTIFIER_COLUMN.test(name)) out.push({ name, nullable: info.nullable });
		}
		return out;
	};

	const statements = [];
	for (const n of nullifies) {
		if (!n.nullable) {
			guards.push({ code: `not_nullable:${n.table}.${n.columns.join(',')}`, table: n.table, pred: n.pred });
			continue;
		}
		const sets = n.columns.map((c) => `${qi(c)} = null`);
		const scrubbed = identifierColumns(n.table, n.columns);
		for (const ic of scrubbed) {
			const replacement = ic.nullable ? 'null' : `'purged-' || md5(random()::text)`;
			sets.push(`${qi(ic.name)} = case when lower(${qi(ic.name)}) = any($2::text[]) then ${replacement} else ${qi(ic.name)} end`);
		}
		statements.push({
			label: `anonymized:${n.label}`,
			text: `with x as (update ${qi(n.table)} set ${sets.join(', ')} where ${n.pred} returning 1) select count(*)::int as n from x`,
			// Postgres rejects a bind that supplies a parameter the text never uses.
			identifiers: scrubbed.length > 0,
		});
	}
	for (const d of deletes) {
		statements.push({
			label: `deleted:${d.label}`,
			text: `with x as (delete from ${qi(d.table)} where ${d.pred} returning 1) select count(*)::int as n from x`,
		});
	}
	for (const e of EMAIL_KEYED) {
		if (!col(e.table, e.column)) continue;
		statements.push({
			label: `deleted:${e.table}`,
			text: `with x as (delete from ${qi(e.table)} where lower(${qi(e.column)}) = any($2::text[]) and $1::uuid is not null returning 1) select count(*)::int as n from x`,
			identifiers: true,
		});
	}
	if (col('audit_log', 'meta')) {
		// The deletion's own audit row names the released handle; the row stays
		// (security log), the handle goes.
		statements.push({
			label: 'anonymized:audit_log',
			text: `with x as (update audit_log set meta = meta - 'released_username' where user_id = $1::uuid and meta ? 'released_username' returning 1) select count(*)::int as n from x`,
		});
	}

	const guardSql = guards.length
		? `select array_remove(array[${guards
				.map((g) => `case when exists (select 1 from ${qi(g.table)} where ${g.pred}) then '${g.code.replace(/'/g, "''")}' end`)
				.join(', ')}], null) as codes`
		: null;

	return { statements, guardSql, guardCodes: guards.map((g) => g.code) };
}

// ── Object storage ───────────────────────────────────────────────────────────

async function collectStorageKeys(userId, columns) {
	const has = (t, c) => columns.get(t)?.has(c);
	const parts = [];
	for (const s of KEY_SOURCES) {
		const cols = s.columns.filter((c) => has(s.table, c));
		if (!cols.length || !has(s.table, s.owner)) continue;
		parts.push(`select v from ${qi(s.table)}, unnest(array[${cols.map(qi).join(', ')}]::text[]) v where ${qi(s.owner)} = $1::uuid and v is not null`);
	}
	const urlParts = [];
	for (const s of URL_SOURCES) {
		const cols = s.columns.filter((c) => has(s.table, c));
		if (!cols.length) continue;
		const where = s.via
			? `${qi(s.via.column)} in (select id from ${qi(s.via.table)} where ${qi(s.via.owner)} = $1::uuid)`
			: `${qi(s.owner)} = $1::uuid`;
		urlParts.push(`select v from ${qi(s.table)}, unnest(array[${cols.map(qi).join(', ')}]::text[]) v where ${where} and v is not null`);
	}
	const keys = new Set();
	if (parts.length) {
		for (const r of await sql(`select distinct v from (${parts.join(' union all ')}) s`, [userId])) keys.add(r.v);
	}
	if (urlParts.length) {
		for (const r of await sql(`select distinct v from (${urlParts.join(' union all ')}) s`, [userId])) {
			const key = keyFromPublicUrl(r.v);
			if (key) keys.add(key);
		}
	}
	if (!keys.size) return [];

	// Never delete bytes another account still points at.
	const shared = [];
	for (const s of KEY_SOURCES) {
		const cols = s.columns.filter((c) => has(s.table, c));
		if (!cols.length || !has(s.table, s.owner)) continue;
		shared.push(`select v from ${qi(s.table)}, unnest(array[${cols.map(qi).join(', ')}]::text[]) v where ${qi(s.owner)} <> $1::uuid and v = any($2::text[])`);
	}
	if (shared.length) {
		for (const r of await sql(`select distinct v from (${shared.join(' union all ')}) s`, [userId, [...keys]])) keys.delete(r.v);
	}
	return [...keys];
}

async function deleteStorageObjects(keys) {
	let next = 0;
	let failed = false;
	const worker = async () => {
		while (next < keys.length) {
			const key = keys[next++];
			try {
				await deleteObject(key);
			} catch {
				failed = true;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(STORAGE_CONCURRENCY, keys.length) }, worker));
	if (failed) throw new PurgeError('storage_delete_failed');
}

// ── Purge ────────────────────────────────────────────────────────────────────

async function identifiersFor(user, columns) {
	const ids = new Set([user.email, user.wallet_address].filter(Boolean).map((v) => String(v).toLowerCase()));
	if (columns.get('user_wallets')?.has('address')) {
		for (const r of await sql`select lower(address) as a from user_wallets where user_id = ${user.id}`) ids.add(r.a);
	}
	return [...ids];
}

async function purgeOne(user, plan, columns, olderThanDays) {
	if (plan.guardSql) {
		const [row] = await sql(plan.guardSql, [user.id]);
		if (row?.codes?.length) throw new PurgeError(row.codes[0]);
	}

	const identifiers = await identifiersFor(user, columns);
	let r2Objects = 0;
	if (objectStorageConfigured()) {
		const keys = await collectStorageKeys(user.id, columns);
		await deleteStorageObjects(keys);
		r2Objects = keys.length;
	}

	const queries = [
		// Abort the whole transaction unless the account is still past its window
		// (restored or already purged since the batch was selected): dividing by
		// a zero count raises 22012, which errorCode() reports as not_eligible.
		sql(
			`select 1 / count(*)::int as ok
			from users where id = $1::uuid and deleted_at is not null and deleted_at < now() - make_interval(days => $2::int)`,
			[user.id, olderThanDays],
		),
		...plan.statements.map((s) => sql(s.text, s.identifiers ? [user.id, identifiers] : [user.id])),
		sql(`with x as (delete from users where id = $1::uuid returning 1) select count(*)::int as n from x`, [user.id]),
	];
	const results = await sql.transaction(queries);

	/** @type {Record<string, number>} */
	const counts = {};
	plan.statements.forEach((s, i) => {
		const n = Number(results[i + 1]?.[0]?.n || 0);
		if (n) counts[s.label] = (counts[s.label] || 0) + n;
	});
	counts['deleted:users'] = Number(results[results.length - 1]?.[0]?.n || 0);

	const ref = userRef(user.id);
	await sql`
		insert into account_purge_log (user_hash, soft_deleted_at, counts, r2_objects)
		values (${ref}, ${user.deleted_at}, ${JSON.stringify(counts)}::jsonb, ${r2Objects})
		on conflict (user_hash) do nothing
	`;
	return { ref, counts, r2Objects };
}

function errorCode(err) {
	if (err instanceof PurgeError) return err.code;
	const message = String(err?.message || '');
	if (err?.code === '22012' || message.includes('division by zero')) return 'not_eligible';
	if (err?.code === '23503') return `fk_violation:${err.constraint || err.table || 'unknown'}`;
	if (err?.code) return `db_error:${err.code}`;
	return 'purge_failed';
}

/**
 * Permanently purge accounts soft-deleted more than `olderThanDays` ago.
 * Bounded (`limit` accounts, `budgetMs` wall time), idempotent, and isolated per
 * account: one failure is recorded and retried next run, never fatal to the
 * batch. The result carries no email, wallet, username or raw user id.
 */
export async function purgeDeletedAccounts({ olderThanDays = PURGE_AFTER_DAYS, limit = 25, budgetMs = 240_000 } = {}) {
	const started = Date.now();
	const days = Math.max(PURGE_AFTER_DAYS, Math.floor(Number(olderThanDays) || PURGE_AFTER_DAYS));
	const batch = await sql(
		`select u.id, u.deleted_at, u.email, u.wallet_address
		from users u
		left join account_purge_failures f on f.user_id = u.id
		where u.deleted_at is not null and u.deleted_at < now() - make_interval(days => $1::int)
		order by f.last_attempt_at asc nulls first, u.deleted_at asc
		limit $2::int`,
		[days, Math.max(1, Math.min(500, Math.floor(Number(limit) || 25)))],
	);
	const result = { scanned: batch.length, purged: 0, r2_objects: 0, failed: [], receipts: [], deferred: 0 };
	if (!batch.length) return result;

	const catalog = await loadCatalog();
	const plan = buildPlan(catalog);

	for (const user of batch) {
		if (Date.now() - started > budgetMs) {
			result.deferred += 1;
			continue;
		}
		try {
			const done = await purgeOne(user, plan, catalog.columns, days);
			result.purged += 1;
			result.r2_objects += done.r2Objects;
			result.receipts.push({ ref: done.ref.slice(0, 12), counts: done.counts, r2_objects: done.r2Objects });
		} catch (err) {
			const code = errorCode(err).slice(0, 200);
			result.failed.push({ ref: userRef(user.id).slice(0, 12), code });
			try {
				await sql`
					insert into account_purge_failures (user_id, last_error)
					values (${user.id}, ${code})
					on conflict (user_id) do update
						set attempts = account_purge_failures.attempts + 1,
							last_error = excluded.last_error,
							last_attempt_at = now()
				`;
			} catch {
				// The failure is already in this run's result; the retry queue
				// row is best effort and the account is retried either way.
			}
		}
	}
	return result;
}

/** Read-only: how many deleted accounts are past the window, and how many are still inside it. */
export async function countPurgeable({ olderThanDays = PURGE_AFTER_DAYS } = {}) {
	const days = Math.max(PURGE_AFTER_DAYS, Math.floor(Number(olderThanDays) || PURGE_AFTER_DAYS));
	const [row] = await sql(
		`select
			count(*) filter (where deleted_at < now() - make_interval(days => $1::int))::int as purgeable,
			count(*) filter (where deleted_at >= now() - make_interval(days => $1::int))::int as pending
		from users where deleted_at is not null`,
		[days],
	);
	return { purgeable: row?.purgeable || 0, pending: row?.pending || 0 };
}

/**
 * Read-only dry run of the next purge: builds the plan from the live catalog
 * and runs only its guard SELECT for each account past the window, so a
 * blocking foreign key nobody has classified shows up before a live run hits
 * it. Deletes nothing, writes nothing, touches no object storage.
 *
 * `ready` counts accounts no guard refuses. A ready account can still fail a
 * live run on object storage or a row that changes between now and then.
 */
export async function previewPurge({ olderThanDays = PURGE_AFTER_DAYS, limit = 500 } = {}) {
	const days = Math.max(PURGE_AFTER_DAYS, Math.floor(Number(olderThanDays) || PURGE_AFTER_DAYS));
	const { purgeable, pending } = await countPurgeable({ olderThanDays: days });
	const catalog = await loadCatalog();
	const plan = buildPlan(catalog);
	const batch = await sql(
		`select id from users
		where deleted_at is not null and deleted_at < now() - make_interval(days => $1::int)
		order by deleted_at asc
		limit $2::int`,
		[days, Math.max(1, Math.min(5000, Math.floor(Number(limit) || 500)))],
	);
	const blocked = [];
	for (const user of batch) {
		if (!plan.guardSql) break;
		const [row] = await sql(plan.guardSql, [user.id]);
		if (row?.codes?.length) blocked.push({ ref: userRef(user.id).slice(0, 12), code: row.codes[0] });
	}
	return {
		purgeable,
		pending,
		checked: batch.length,
		ready: batch.length - blocked.length,
		blocked,
		plan: {
			statements: plan.statements.length,
			guards: plan.guardCodes,
			sql_bytes: plan.statements.reduce((n, st) => n + st.text.length, 0) + (plan.guardSql?.length || 0),
		},
	};
}
