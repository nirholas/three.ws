// Enterprise access for teams: the Microsoft Entra tenant a team claims, the
// people (humans) who reach the team through that tenant, the per-team SCIM
// token, and the SCIM-backed storage of Users and Groups. Schema:
// api/_lib/migrations/20261111160232_enterprise_sso_scim.sql.
//
// Who may do what:
//   - Only the team owner claims a tenant, and only with a fresh sign-in by an
//     admin of that tenant (api/auth/microsoft, intent tenant_claim).
//   - A person signing in with Microsoft from a claimed tenant is offered the
//     team or added to it, as the owner configured (join_mode).
//   - The tenant's SCIM client (Entra provisioning) manages the people with
//     the team's bearer token. Deactivating a person ends their team access at
//     once and revokes every session they signed in to through that tenant.
//   - People read the team; every write on the team stays owner-only.
//
// Every change lands in team_enterprise_events (the settings feed) and the
// owner-side ones in audit_log too.

import { sql } from './db.js';
import { randomToken, sha256, constantTimeEquals } from './crypto.js';
import { logAudit } from './audit.js';
import {
	ScimError, userStateFromRow, applyUserPatch, applyGroupPatch,
} from './scim.js';

export const TOKEN_PREFIX = 'tws_scim_';
export const JOIN_MODES = Object.freeze(['offer', 'auto']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID.test(s);

export class EnterpriseError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

// ── events ───────────────────────────────────────────────────────────────────

export async function logEvent(teamId, { actor, actorUserId = null, action, personId = null, detail = {} }) {
	await sql`
		insert into team_enterprise_events (team_id, actor, actor_user_id, action, person_id, detail)
		values (${teamId}, ${actor}, ${actorUserId}, ${action}, ${personId}, ${JSON.stringify(detail)}::jsonb)
	`;
}

export async function listEvents(teamId, { limit = 25 } = {}) {
	return sql`
		select e.id, e.actor, e.action, e.person_id, e.detail, e.created_at,
		       p.display_name as person_name, p.user_name as person_user_name
		from team_enterprise_events e
		left join team_people p on p.id = e.person_id
		where e.team_id = ${teamId}
		order by e.created_at desc, e.id desc
		limit ${Math.min(Math.max(limit, 1), 100)}
	`;
}

// ── tenant claims ────────────────────────────────────────────────────────────

export async function getClaim(teamId) {
	const [row] = await sql`
		select team_id, tenant_id, tenant_name, join_mode, claimed_by_user_id, verified_by, verified_role, claimed_at, updated_at
		from team_tenant_claims where team_id = ${teamId} limit 1
	`;
	return row || null;
}

export async function getClaimByTenant(tenantId) {
	const [row] = await sql`
		select c.team_id, c.tenant_id, c.tenant_name, c.join_mode, t.name as team_name
		from team_tenant_claims c join teams t on t.id = c.team_id
		where c.tenant_id = ${String(tenantId).toLowerCase()} and t.archived_at is null
		limit 1
	`;
	return row || null;
}

/**
 * Record a proven claim. The caller already verified a fresh sign-in by a
 * directory admin of `tenantId` and that `userId` owns the team.
 */
export async function claimTenant({ teamId, userId, tenantId, tenantName = null, verifiedBy = null, verifiedRole = null, req = null }) {
	const tid = String(tenantId).toLowerCase();
	const other = await getClaimByTenant(tid);
	if (other && other.team_id !== teamId) {
		throw new EntraClaimConflict();
	}
	const current = await getClaim(teamId);
	if (current && current.tenant_id !== tid) {
		throw new EnterpriseError(409, 'already_claimed', 'this team already claimed a different Microsoft tenant; unclaim it first');
	}
	try {
		await sql`
			insert into team_tenant_claims (team_id, tenant_id, tenant_name, claimed_by_user_id, verified_by, verified_role)
			values (${teamId}, ${tid}, ${tenantName}, ${userId}, ${verifiedBy}, ${verifiedRole})
			on conflict (team_id) do update set
				tenant_name = excluded.tenant_name,
				claimed_by_user_id = excluded.claimed_by_user_id,
				verified_by = excluded.verified_by,
				verified_role = excluded.verified_role,
				updated_at = now()
		`;
	} catch (err) {
		// The tenant_id unique index: another team claimed it between the read
		// above and this write.
		if (err?.code === '23505') throw new EntraClaimConflict();
		throw err;
	}
	await logEvent(teamId, {
		actor: 'owner', actorUserId: userId, action: current ? 'tenant_reverified' : 'tenant_claimed',
		detail: { tenant_id: tid, tenant_name: tenantName, verified_by: verifiedBy, verified_role: verifiedRole },
	});
	logAudit({ userId, action: 'team:tenant_claim', resourceId: teamId, meta: { tenant_id: tid, verified_role: verifiedRole }, req });
	return getClaim(teamId);
}

export class EntraClaimConflict extends EnterpriseError {
	constructor() {
		super(409, 'tenant_claimed', 'that Microsoft tenant is already claimed by another team');
	}
}

export async function setJoinMode({ teamId, userId, mode, req = null }) {
	if (!JOIN_MODES.includes(mode)) throw new EnterpriseError(400, 'bad_join_mode', `join_mode must be one of ${JOIN_MODES.join(', ')}`);
	const rows = await sql`
		update team_tenant_claims set join_mode = ${mode}, updated_at = now()
		where team_id = ${teamId} returning team_id
	`;
	if (!rows.length) throw new EnterpriseError(409, 'tenant_claim_required', 'claim a Microsoft tenant first');
	await logEvent(teamId, { actor: 'owner', actorUserId: userId, action: 'join_mode_changed', detail: { join_mode: mode } });
	logAudit({ userId, action: 'team:join_mode', resourceId: teamId, meta: { join_mode: mode }, req });
	return getClaim(teamId);
}

/**
 * Release the tenant. The SCIM token goes with it (it is only meaningful for
 * that tenant). People keep their rows and their access: unclaiming stops new
 * joins and provisioning, it does not evict anyone. The owner removes people
 * one by one.
 */
export async function unclaimTenant({ teamId, userId, req = null }) {
	const claim = await getClaim(teamId);
	if (!claim) throw new EnterpriseError(404, 'not_claimed', 'this team has not claimed a Microsoft tenant');
	await sql`delete from team_scim_tokens where team_id = ${teamId}`;
	await sql`delete from team_tenant_claims where team_id = ${teamId}`;
	await logEvent(teamId, { actor: 'owner', actorUserId: userId, action: 'tenant_unclaimed', detail: { tenant_id: claim.tenant_id, tenant_name: claim.tenant_name } });
	logAudit({ userId, action: 'team:tenant_unclaim', resourceId: teamId, meta: { tenant_id: claim.tenant_id }, req });
	return { unclaimed: true, tenant_id: claim.tenant_id };
}

// ── people ───────────────────────────────────────────────────────────────────

const PERSON_COLUMNS = sql`
	id, team_id, user_id, role, status, source, entra_tenant_id, user_name, external_id, display_name,
	given_name, family_name, email, created_at, updated_at, deactivated_at, scim_deleted_at, last_provisioned_at
`;

/** True when `userId` is an active person of the team. */
export async function isActivePerson(teamId, userId) {
	if (!userId) return false;
	const [row] = await sql`
		select 1 as ok from team_people
		where team_id = ${teamId} and user_id = ${userId} and status = 'active'
		limit 1
	`;
	return Boolean(row);
}

/** Teams the user belongs to as a person (not as owner). */
export async function listMemberTeams(userId) {
	return sql`
		select t.id, t.name, t.description, t.network, t.status, t.created_at, p.source, p.created_at as joined_at
		from team_people p join teams t on t.id = p.team_id
		where p.user_id = ${userId} and p.status = 'active' and t.archived_at is null and t.owner_user_id <> ${userId}
		order by p.created_at desc
	`;
}

/**
 * Revoke the sessions a person signed in to through the team's tenant. A
 * deprovisioned directory account must not keep a live three.ws session that
 * came from it.
 */
export async function revokeTenantSessions({ userId, tenantId }) {
	if (!userId || !tenantId) return 0;
	const rows = await sql`
		update sessions set revoked_at = now()
		where user_id = ${userId} and entra_tenant_id = ${String(tenantId).toLowerCase()} and revoked_at is null
		returning id
	`;
	return rows.length;
}

async function tenantOf(teamId) {
	const [row] = await sql`select tenant_id from team_tenant_claims where team_id = ${teamId} limit 1`;
	return row?.tenant_id || null;
}

/** End a person's access: status, timestamp, and their tenant sessions. */
async function deactivatePersonRow(person, { tenantId }) {
	await sql`
		update team_people set status = 'deactivated', deactivated_at = now(), updated_at = now()
		where id = ${person.id}
	`;
	const revoked = await revokeTenantSessions({ userId: person.user_id, tenantId: tenantId || person.entra_tenant_id });
	return revoked;
}

/**
 * What happens to the team side when someone signs in with Microsoft. Called
 * by api/auth/microsoft after the session exists. Returns
 * { teamId, teamName, outcome } or null when the tenant is unclaimed, where
 * outcome is one of 'member', 'bound', 'joined', 'offer', 'blocked'.
 */
export async function onMicrosoftSignIn({ userId, claims }) {
	if (!claims?.tenant_id || claims.personal) return null;
	const claim = await getClaimByTenant(claims.tenant_id);
	if (!claim) return null;
	const teamId = claim.team_id;
	const base = { teamId, teamName: claim.team_name };

	const [own] = await sql`select owner_user_id from teams where id = ${teamId} limit 1`;
	if (own?.owner_user_id === userId) return { ...base, outcome: 'member' };

	const [existing] = await sql`select id, status from team_people where team_id = ${teamId} and user_id = ${userId} limit 1`;
	if (existing) return { ...base, outcome: existing.status === 'active' ? 'member' : existing.status === 'declined' ? 'offer' : 'blocked' };

	const keys = [...new Set([claims.username, claims.email].filter(Boolean).map((s) => s.toLowerCase()))];
	if (keys.length) {
		// A person the directory provisioned before their first sign-in.
		const [pending] = await sql`
			update team_people set user_id = ${userId}, entra_tenant_id = ${claim.tenant_id}, updated_at = now()
			where id = (
				select id from team_people
				where team_id = ${teamId} and user_id is null
				  and (lower(user_name) = any(${keys}::text[]) or lower(email) = any(${keys}::text[]))
				order by scim_deleted_at nulls first, created_at
				limit 1
			)
			returning id, status, scim_deleted_at
		`;
		if (pending) {
			await logEvent(teamId, { actor: 'member', actorUserId: userId, action: 'person_bound', personId: pending.id, detail: { via: 'microsoft_sign_in' } });
			return { ...base, outcome: pending.status === 'active' && !pending.scim_deleted_at ? 'bound' : 'blocked' };
		}
	}

	if (claim.join_mode !== 'auto') return { ...base, outcome: 'offer' };
	const person = await insertTenantPerson({ teamId, userId, tenantId: claim.tenant_id, claims, status: 'active' });
	if (!person) return { ...base, outcome: 'member' };
	await logEvent(teamId, { actor: 'member', actorUserId: userId, action: 'member_joined', personId: person.id, detail: { join_mode: 'auto' } });
	return { ...base, outcome: 'joined' };
}

async function insertTenantPerson({ teamId, userId, tenantId, claims, status }) {
	const [row] = await sql`
		insert into team_people (team_id, user_id, status, source, entra_tenant_id, user_name, display_name, email)
		values (${teamId}, ${userId}, ${status}, 'tenant_join', ${tenantId},
		        ${claims.username || claims.email || null}, ${claims.display_name || null}, ${claims.email || null})
		on conflict do nothing
		returning id
	`;
	return row || null;
}

/** The join offer a member from a claimed tenant sees on /teams/:id?join=1. */
export async function joinOffer({ teamId, userId }) {
	const [team] = await sql`select id, name, description, owner_user_id, archived_at from teams where id = ${teamId} limit 1`;
	if (!team || team.archived_at) throw new EnterpriseError(404, 'not_found', 'team not found');
	const claim = await getClaim(teamId);
	const identity = claim ? await tenantIdentity(userId, claim.tenant_id) : null;
	if (!claim || !identity) throw new EnterpriseError(404, 'not_found', 'team not found');
	const [person] = await sql`select status from team_people where team_id = ${teamId} and user_id = ${userId} limit 1`;
	return {
		team: { id: team.id, name: team.name, description: team.description },
		tenant_name: claim.tenant_name,
		join_mode: claim.join_mode,
		status: person?.status || null,
		account: { email: identity.email, display_name: identity.display_name },
	};
}

async function tenantIdentity(userId, tenantId) {
	const [row] = await sql`
		select subject, email, display_name from user_identities
		where user_id = ${userId} and provider = 'microsoft' and subject like ${`${String(tenantId).toLowerCase()}:%`}
		limit 1
	`;
	return row || null;
}

/** Accept or decline a join offer. */
export async function decideJoin({ teamId, userId, decision }) {
	if (!['join', 'decline'].includes(decision)) throw new EnterpriseError(400, 'bad_decision', 'decision must be join or decline');
	const claim = await getClaim(teamId);
	const identity = claim ? await tenantIdentity(userId, claim.tenant_id) : null;
	// Not from this team's tenant (or no claim): the offer does not exist.
	if (!claim || !identity) throw new EnterpriseError(404, 'not_found', 'team not found');
	const status = decision === 'join' ? 'active' : 'declined';
	const [existing] = await sql`select id, status from team_people where team_id = ${teamId} and user_id = ${userId} limit 1`;
	if (existing) {
		if (existing.status === 'deactivated') {
			throw new EnterpriseError(403, 'deactivated', 'your access to this team was removed by its owner or your organisation');
		}
		if (existing.status === status) return { status };
		await sql`update team_people set status = ${status}, updated_at = now() where id = ${existing.id}`;
		await logEvent(teamId, { actor: 'member', actorUserId: userId, action: decision === 'join' ? 'member_joined' : 'offer_declined', personId: existing.id });
		return { status };
	}
	const person = await insertTenantPerson({
		teamId, userId, tenantId: claim.tenant_id, status,
		claims: { username: identity.email, email: identity.email, display_name: identity.display_name },
	});
	if (!person) throw new EnterpriseError(409, 'conflict', 'someone in this team already uses that sign-in name; ask the owner');
	await logEvent(teamId, { actor: 'member', actorUserId: userId, action: decision === 'join' ? 'member_joined' : 'offer_declined', personId: person.id, detail: { join_mode: 'offer' } });
	return { status };
}

/** Owner removes or restores a person. */
export async function setPersonStatus({ teamId, personId, userId, status, req = null }) {
	if (!isUuid(personId)) throw new EnterpriseError(404, 'not_found', 'person not found');
	if (!['active', 'deactivated'].includes(status)) throw new EnterpriseError(400, 'bad_status', 'status must be active or deactivated');
	const [person] = await sql`select ${PERSON_COLUMNS} from team_people where id = ${personId} and team_id = ${teamId} limit 1`;
	if (!person) throw new EnterpriseError(404, 'not_found', 'person not found');
	if (person.status === status) return { id: personId, status };
	let revoked = 0;
	if (status === 'deactivated') {
		revoked = await deactivatePersonRow(person, { tenantId: await tenantOf(teamId) });
	} else {
		await sql`update team_people set status = 'active', deactivated_at = null, updated_at = now() where id = ${personId}`;
	}
	await logEvent(teamId, {
		actor: 'owner', actorUserId: userId, action: status === 'active' ? 'person_restored' : 'person_removed', personId,
		detail: status === 'active' ? {} : { sessions_revoked: revoked },
	});
	logAudit({ userId, action: status === 'active' ? 'team:person_restore' : 'team:person_remove', resourceId: teamId, meta: { person_id: personId }, req });
	return { id: personId, status, sessions_revoked: revoked };
}

// ── SCIM token ───────────────────────────────────────────────────────────────

/**
 * Generate (or rotate) the team's SCIM bearer. The plaintext is returned once;
 * only its hash is stored, so the previous token stops working immediately.
 */
export async function issueScimToken({ teamId, userId, req = null }) {
	const claim = await getClaim(teamId);
	if (!claim) throw new EnterpriseError(409, 'tenant_claim_required', 'claim your Microsoft tenant before generating a SCIM token');
	const token = `${TOKEN_PREFIX}${randomToken(32)}`;
	const hash = await sha256(token);
	const prefix = token.slice(0, TOKEN_PREFIX.length + 6);
	const [row] = await sql`
		insert into team_scim_tokens (team_id, token_hash, token_prefix, created_by_user_id)
		values (${teamId}, ${hash}, ${prefix}, ${userId})
		on conflict (team_id) do update set
			token_hash = excluded.token_hash,
			token_prefix = excluded.token_prefix,
			created_by_user_id = excluded.created_by_user_id,
			rotated_at = now(),
			last_used_at = null
		returning token_prefix, created_at, rotated_at
	`;
	const rotated = Boolean(row.rotated_at);
	await logEvent(teamId, { actor: 'owner', actorUserId: userId, action: rotated ? 'scim_token_rotated' : 'scim_token_generated', detail: { prefix } });
	logAudit({ userId, action: rotated ? 'team:scim_token_rotate' : 'team:scim_token_create', resourceId: teamId, meta: { prefix }, req });
	return { token, prefix, created_at: row.created_at, rotated_at: row.rotated_at };
}

export async function revokeScimToken({ teamId, userId, req = null }) {
	const rows = await sql`delete from team_scim_tokens where team_id = ${teamId} returning token_prefix`;
	if (!rows.length) throw new EnterpriseError(404, 'no_token', 'this team has no SCIM token');
	await logEvent(teamId, { actor: 'owner', actorUserId: userId, action: 'scim_token_revoked', detail: { prefix: rows[0].token_prefix } });
	logAudit({ userId, action: 'team:scim_token_revoke', resourceId: teamId, meta: { prefix: rows[0].token_prefix }, req });
	return { revoked: true };
}

/**
 * The team a SCIM bearer belongs to, or null. A token only works while its
 * team is live and still holds a tenant claim.
 */
export async function authenticateScimToken(token) {
	if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
	const hash = await sha256(token);
	const [row] = await sql`
		select k.team_id, k.token_hash, c.tenant_id
		from team_scim_tokens k
		join team_tenant_claims c on c.team_id = k.team_id
		join teams t on t.id = k.team_id and t.archived_at is null
		where k.token_hash = ${hash}
		limit 1
	`;
	if (!row || !constantTimeEquals(row.token_hash, hash)) return null;
	await sql`
		update team_scim_tokens set last_used_at = now()
		where team_id = ${row.team_id} and (last_used_at is null or last_used_at < now() - interval '30 seconds')
	`;
	return { teamId: row.team_id, tenantId: row.tenant_id };
}

// ── settings view ────────────────────────────────────────────────────────────

export async function enterpriseView(teamId) {
	const [claim, [token], people, events, [lastScim]] = await Promise.all([
		getClaim(teamId),
		sql`select token_prefix, created_at, rotated_at, last_used_at from team_scim_tokens where team_id = ${teamId} limit 1`,
		sql`
			select p.id, p.user_id, p.status, p.source, p.user_name, p.display_name, p.email, p.created_at,
			       p.deactivated_at, p.last_provisioned_at, (p.scim_deleted_at is not null) as scim_deleted
			from team_people p where p.team_id = ${teamId}
			order by (p.status = 'active') desc, p.created_at desc
			limit 200
		`,
		listEvents(teamId, { limit: 25 }),
		sql`select max(created_at) as at from team_enterprise_events where team_id = ${teamId} and actor = 'scim'`,
	]);
	const lastSync = [token?.last_used_at, lastScim?.at].filter(Boolean).map((d) => new Date(d).getTime());
	return {
		claim: claim && {
			tenant_id: claim.tenant_id,
			tenant_name: claim.tenant_name,
			join_mode: claim.join_mode,
			verified_by: claim.verified_by,
			verified_role: claim.verified_role,
			claimed_at: claim.claimed_at,
		},
		scim: {
			has_token: Boolean(token),
			token_prefix: token?.token_prefix || null,
			created_at: token?.created_at || null,
			rotated_at: token?.rotated_at || null,
			last_used_at: token?.last_used_at || null,
			last_sync_at: lastSync.length ? new Date(Math.max(...lastSync)).toISOString() : null,
		},
		people: people.map((p) => ({
			id: p.id,
			status: p.scim_deleted ? 'deleted' : p.status,
			source: p.source,
			bound: Boolean(p.user_id),
			user_name: p.user_name,
			display_name: p.display_name,
			email: p.email,
			created_at: p.created_at,
			deactivated_at: p.deactivated_at,
			last_provisioned_at: p.last_provisioned_at,
		})),
		counts: {
			active: people.filter((p) => p.status === 'active' && !p.scim_deleted).length,
			pending: people.filter((p) => p.status === 'active' && !p.user_id && !p.scim_deleted).length,
			deactivated: people.filter((p) => p.status !== 'active' || p.scim_deleted).length,
		},
		events,
	};
}

// ── SCIM Users ───────────────────────────────────────────────────────────────

async function scimPersonRow(teamId, id) {
	if (!isUuid(id)) return null;
	const [row] = await sql`
		select ${PERSON_COLUMNS} from team_people
		where id = ${id} and team_id = ${teamId} and scim_deleted_at is null
		limit 1
	`;
	return row || null;
}

/** The account to bind a provisioned person to: a Microsoft identity in the tenant. */
async function findTenantAccount(tenantId, state) {
	const keys = [...new Set([state.userName, state.email].filter(Boolean).map((s) => s.toLowerCase()))];
	if (!keys.length) return null;
	const [row] = await sql`
		select i.user_id from user_identities i join users u on u.id = i.user_id and u.deleted_at is null
		where i.provider = 'microsoft' and i.subject like ${`${tenantId}:%`} and lower(i.email) = any(${keys}::text[])
		limit 1
	`;
	return row?.user_id || null;
}

async function assertUserNameFree(teamId, userName, exceptId = null) {
	const [clash] = await sql`
		select id from team_people
		where team_id = ${teamId} and lower(user_name) = lower(${userName}) and (${exceptId}::uuid is null or id <> ${exceptId}::uuid)
		limit 1
	`;
	if (clash) throw new ScimError(409, `a user with userName ${userName} already exists`, 'uniqueness');
}

export async function scimCreateUser(ctx, state) {
	const [existing] = await sql`
		select ${PERSON_COLUMNS} from team_people
		where team_id = ${ctx.teamId} and lower(user_name) = lower(${state.userName})
		limit 1
	`;
	if (existing && !existing.scim_deleted_at) {
		throw new ScimError(409, `a user with userName ${state.userName} already exists`, 'uniqueness');
	}
	if (existing) {
		// A person the directory deleted and now provisions again.
		const row = await writeUserState(ctx, existing, state, { revive: true });
		await logEvent(ctx.teamId, { actor: 'scim', action: 'user_created', personId: row.id, detail: { user_name: state.userName, revived: true } });
		return row;
	}
	const userId = await findTenantAccount(ctx.tenantId, state);
	if (userId) {
		// The account already joined through the tenant: SCIM takes it over.
		const [joined] = await sql`select ${PERSON_COLUMNS} from team_people where team_id = ${ctx.teamId} and user_id = ${userId} limit 1`;
		if (joined) {
			const row = await writeUserState(ctx, joined, state, { revive: true });
			await logEvent(ctx.teamId, { actor: 'scim', action: 'user_created', personId: row.id, detail: { user_name: state.userName, adopted: true } });
			return row;
		}
	}
	let row;
	try {
		[row] = await sql`
			insert into team_people (team_id, user_id, status, source, entra_tenant_id, user_name, external_id, display_name,
			                         given_name, family_name, email, deactivated_at, last_provisioned_at)
			values (${ctx.teamId}, ${userId}, ${state.active ? 'active' : 'deactivated'}, 'scim', ${ctx.tenantId},
			        ${state.userName}, ${state.externalId}, ${state.displayName}, ${state.givenName}, ${state.familyName},
			        ${state.email}, ${state.active ? null : new Date()}, now())
			returning ${PERSON_COLUMNS}
		`;
	} catch (err) {
		if (err?.code === '23505') throw new ScimError(409, `a user with userName ${state.userName} already exists`, 'uniqueness');
		throw err;
	}
	await logEvent(ctx.teamId, { actor: 'scim', action: 'user_created', personId: row.id, detail: { user_name: state.userName, bound: Boolean(userId), active: state.active } });
	return row;
}

/**
 * Persist a full user state onto a row, handling the active transitions:
 * going inactive ends access and revokes tenant sessions; going active
 * restores it.
 */
async function writeUserState(ctx, row, state, { revive = false } = {}) {
	if (state.userName.toLowerCase() !== String(row.user_name || '').toLowerCase()) {
		await assertUserNameFree(ctx.teamId, state.userName, row.id);
	}
	const wasActive = row.status === 'active' && !row.scim_deleted_at;
	const userId = row.user_id || (await findTenantAccount(ctx.tenantId, state));
	const [updated] = await sql`
		update team_people set
			user_id = ${userId},
			user_name = ${state.userName},
			external_id = ${state.externalId},
			display_name = ${state.displayName},
			given_name = ${state.givenName},
			family_name = ${state.familyName},
			email = ${state.email},
			status = ${state.active ? 'active' : 'deactivated'},
			deactivated_at = ${state.active ? null : row.deactivated_at || new Date()},
			scim_deleted_at = ${revive ? null : row.scim_deleted_at},
			entra_tenant_id = coalesce(entra_tenant_id, ${ctx.tenantId}),
			last_provisioned_at = now(),
			updated_at = now()
		where id = ${row.id}
		returning ${PERSON_COLUMNS}
	`;
	if (wasActive && !state.active) {
		const revoked = await revokeTenantSessions({ userId: updated.user_id, tenantId: ctx.tenantId });
		await logEvent(ctx.teamId, { actor: 'scim', action: 'user_deactivated', personId: row.id, detail: { sessions_revoked: revoked } });
	} else if (!wasActive && state.active && !revive) {
		await logEvent(ctx.teamId, { actor: 'scim', action: 'user_reactivated', personId: row.id });
	}
	return updated;
}

export async function scimGetUser(ctx, id) {
	const row = await scimPersonRow(ctx.teamId, id);
	if (!row) throw new ScimError(404, `User ${id} not found`);
	return row;
}

/** `filters` from parseFilter(..., 'user'). Returns { rows, total }. */
export async function scimListUsers(ctx, filters, { startIndex, count }) {
	const f = {};
	for (const { field, value } of filters) {
		if (field in f && f[field] !== value) return { rows: [], total: 0 };
		f[field] = value;
	}
	if (f.id !== undefined && !isUuid(f.id)) return { rows: [], total: 0 };
	const p = {
		userName: f.userName ?? null,
		externalId: f.externalId ?? null,
		id: f.id ?? null,
		displayName: f.displayName ?? null,
		email: f.email ?? null,
		active: typeof f.active === 'boolean' ? f.active : null,
	};
	const where = sql`
		team_id = ${ctx.teamId} and scim_deleted_at is null
		and (${p.userName}::text is null or lower(user_name) = lower(${p.userName}::text))
		and (${p.externalId}::text is null or external_id = ${p.externalId}::text)
		and (${p.id}::uuid is null or id = ${p.id}::uuid)
		and (${p.displayName}::text is null or lower(display_name) = lower(${p.displayName}::text))
		and (${p.email}::text is null or lower(email) = lower(${p.email}::text))
		and (${p.active}::boolean is null or (status = 'active') = ${p.active}::boolean)
	`;
	const [[{ total }], rows] = await Promise.all([
		sql`select count(*)::int as total from team_people where ${where}`,
		count === 0 ? [] : sql`
			select ${PERSON_COLUMNS} from team_people where ${where}
			order by created_at, id
			offset ${startIndex - 1} limit ${count}
		`,
	]);
	return { rows, total };
}

export async function scimReplaceUser(ctx, id, state) {
	const row = await scimGetUser(ctx, id);
	const updated = await writeUserState(ctx, row, state);
	await logEvent(ctx.teamId, { actor: 'scim', action: 'user_updated', personId: row.id, detail: { via: 'put' } });
	return updated;
}

export async function scimPatchUser(ctx, id, operations) {
	const row = await scimGetUser(ctx, id);
	const before = userStateFromRow(row);
	const state = applyUserPatch(before, operations);
	const changed = Object.keys(state).filter((k) => state[k] !== before[k]);
	if (!changed.length) return row;
	const updated = await writeUserState(ctx, row, state);
	const nonActive = changed.filter((k) => k !== 'active');
	if (nonActive.length) await logEvent(ctx.teamId, { actor: 'scim', action: 'user_updated', personId: row.id, detail: { fields: nonActive } });
	return updated;
}

/** SCIM DELETE: deactivate, revoke, and hide from SCIM reads. */
export async function scimDeleteUser(ctx, id) {
	const row = await scimGetUser(ctx, id);
	await sql`
		update team_people set status = 'deactivated', deactivated_at = coalesce(deactivated_at, now()),
		       scim_deleted_at = now(), updated_at = now()
		where id = ${row.id}
	`;
	await sql`delete from team_scim_group_members where person_id = ${row.id}`;
	const revoked = await revokeTenantSessions({ userId: row.user_id, tenantId: ctx.tenantId });
	await logEvent(ctx.teamId, { actor: 'scim', action: 'user_deleted', personId: row.id, detail: { sessions_revoked: revoked } });
}

// ── SCIM Groups ──────────────────────────────────────────────────────────────

export async function scimGroupMembers(groupIds) {
	if (!groupIds.length) return new Map();
	const rows = await sql`
		select m.group_id, m.person_id, p.display_name, p.user_name
		from team_scim_group_members m join team_people p on p.id = m.person_id
		where m.group_id = any(${groupIds}::uuid[]) and p.scim_deleted_at is null
		order by m.added_at
	`;
	const map = new Map(groupIds.map((g) => [g, []]));
	for (const r of rows) map.get(r.group_id)?.push(r);
	return map;
}

async function groupRow(teamId, id) {
	if (!isUuid(id)) return null;
	const [row] = await sql`
		select id, team_id, display_name, external_id, created_at, updated_at
		from team_scim_groups where id = ${id} and team_id = ${teamId} limit 1
	`;
	return row || null;
}

export async function scimGetGroup(ctx, id) {
	const row = await groupRow(ctx.teamId, id);
	if (!row) throw new ScimError(404, `Group ${id} not found`);
	return row;
}

/** Keep only member ids that are SCIM-visible people of this team. */
async function validMembers(teamId, ids) {
	const uuids = [...new Set(ids.filter(isUuid).map((s) => s.toLowerCase()))];
	if (!uuids.length) return [];
	const rows = await sql`
		select id from team_people
		where team_id = ${teamId} and scim_deleted_at is null and id = any(${uuids}::uuid[])
	`;
	return rows.map((r) => r.id);
}

async function setGroupMembers(groupId, teamId, ids) {
	const keep = await validMembers(teamId, ids);
	await sql`delete from team_scim_group_members where group_id = ${groupId} and not (person_id = any(${keep}::uuid[]))`;
	if (keep.length) {
		await sql`
			insert into team_scim_group_members (group_id, person_id)
			select ${groupId}, unnest(${keep}::uuid[])
			on conflict do nothing
		`;
	}
	return { kept: keep.length, ignored: ids.length - keep.length };
}

export async function scimCreateGroup(ctx, state) {
	let row;
	try {
		[row] = await sql`
			insert into team_scim_groups (team_id, display_name, external_id)
			values (${ctx.teamId}, ${state.displayName}, ${state.externalId})
			returning id, team_id, display_name, external_id, created_at, updated_at
		`;
	} catch (err) {
		if (err?.code === '23505') throw new ScimError(409, `a group named ${state.displayName} already exists`, 'uniqueness');
		throw err;
	}
	const members = await setGroupMembers(row.id, ctx.teamId, state.members);
	await logEvent(ctx.teamId, { actor: 'scim', action: 'group_created', detail: { group: state.displayName, members: members.kept } });
	return row;
}

async function writeGroupState(ctx, row, state) {
	try {
		const [updated] = await sql`
			update team_scim_groups set display_name = ${state.displayName}, external_id = ${state.externalId}, updated_at = now()
			where id = ${row.id}
			returning id, team_id, display_name, external_id, created_at, updated_at
		`;
		const members = await setGroupMembers(row.id, ctx.teamId, state.members);
		return { updated, members };
	} catch (err) {
		if (err?.code === '23505') throw new ScimError(409, `a group named ${state.displayName} already exists`, 'uniqueness');
		throw err;
	}
}

export async function scimReplaceGroup(ctx, id, state) {
	const row = await scimGetGroup(ctx, id);
	const { updated, members } = await writeGroupState(ctx, row, state);
	await logEvent(ctx.teamId, { actor: 'scim', action: 'group_updated', detail: { group: updated.display_name, members: members.kept, via: 'put' } });
	return updated;
}

export async function scimPatchGroup(ctx, id, operations) {
	const row = await scimGetGroup(ctx, id);
	const current = (await scimGroupMembers([row.id])).get(row.id).map((m) => m.person_id);
	const state = applyGroupPatch({ displayName: row.display_name, externalId: row.external_id, members: current }, operations);
	const { updated, members } = await writeGroupState(ctx, row, state);
	await logEvent(ctx.teamId, { actor: 'scim', action: 'group_updated', detail: { group: updated.display_name, members: members.kept } });
	return updated;
}

export async function scimDeleteGroup(ctx, id) {
	const row = await scimGetGroup(ctx, id);
	await sql`delete from team_scim_groups where id = ${row.id}`;
	await logEvent(ctx.teamId, { actor: 'scim', action: 'group_deleted', detail: { group: row.display_name } });
}

export async function scimListGroups(ctx, filters, { startIndex, count }) {
	const f = {};
	for (const { field, value } of filters) {
		if (field in f && f[field] !== value) return { rows: [], total: 0 };
		f[field] = value;
	}
	if (f.id !== undefined && !isUuid(f.id)) return { rows: [], total: 0 };
	if (f.member !== undefined && !isUuid(f.member)) return { rows: [], total: 0 };
	const p = {
		displayName: f.displayName ?? null,
		externalId: f.externalId ?? null,
		id: f.id ?? null,
		member: f.member ?? null,
	};
	const where = sql`
		g.team_id = ${ctx.teamId}
		and (${p.displayName}::text is null or lower(g.display_name) = lower(${p.displayName}::text))
		and (${p.externalId}::text is null or g.external_id = ${p.externalId}::text)
		and (${p.id}::uuid is null or g.id = ${p.id}::uuid)
		and (${p.member}::uuid is null or exists (
			select 1 from team_scim_group_members m where m.group_id = g.id and m.person_id = ${p.member}::uuid
		))
	`;
	const [[{ total }], rows] = await Promise.all([
		sql`select count(*)::int as total from team_scim_groups g where ${where}`,
		count === 0 ? [] : sql`
			select g.id, g.team_id, g.display_name, g.external_id, g.created_at, g.updated_at
			from team_scim_groups g where ${where}
			order by g.created_at, g.id
			offset ${startIndex - 1} limit ${count}
		`,
	]);
	return { rows, total };
}
