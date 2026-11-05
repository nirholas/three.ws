// Launch subjects: what a multichain launchpad coin is about.
//
// A subject is one of
//   agent      a 3D agent the creator owns
//   avatar     an avatar the creator owns, or any public avatar
//   animation  one curated animation played on an avatar (the coin is the
//              dance, not the character)
//   bundle     an agent with an avatar and an animation, all linked
// and it is independent of who signs: any subject can launch from one of the
// creator's agent wallets or from their own wallet. Each subject row is one
// launch, with a permanent showcase page at /l/:id that the coin's metadata
// links to. Table: launch_subjects (migration 20261105020000).

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sql } from './db.js';
import { thumbnailUrl } from './r2.js';
import { env } from './env.js';

export const SUBJECT_KINDS = Object.freeze(['agent', 'avatar', 'animation', 'bundle']);
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export class SubjectError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.name = 'SubjectError';
		this.code = code;
		this.status = status;
	}
}

/** A short, unambiguous id for /l/:id (10 chars, about 50 bits). */
export function newSubjectId(bytes = randomBytes(10)) {
	let out = '';
	for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
	return out;
}

let manifestCache = null;

/** The curated animation clips, from the manifest the viewer itself loads. */
export async function curatedAnimations() {
	if (manifestCache) return manifestCache;
	const raw = await readFile(path.resolve(process.cwd(), 'public/animations/manifest.json'), 'utf-8');
	const items = JSON.parse(raw);
	manifestCache = new Map(items.filter((a) => a && typeof a.name === 'string').map((a) => [a.name, { id: a.name, label: a.label || a.name, loop: a.loop === true, duration: a.duration ?? null, icon: a.icon || null }]));
	return manifestCache;
}

async function loadAvatar(avatarId, userId) {
	const [row] = await sql`
		SELECT id, owner_id, name, slug, visibility, thumbnail_key
		FROM avatars WHERE id = ${avatarId} AND deleted_at IS NULL LIMIT 1
	`;
	if (!row) throw new SubjectError('avatar_not_found', 'That avatar does not exist.', 404);
	const owned = row.owner_id === userId;
	if (!owned && row.visibility !== 'public') throw new SubjectError('avatar_private', 'That avatar is private. Launch off a public avatar or one of your own.', 403);
	return { ...row, owned };
}

async function loadOwnedAgentRow(agentId, userId) {
	const [row] = await sql`
		SELECT id, user_id, name, avatar_id FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL LIMIT 1
	`;
	if (!row) throw new SubjectError('agent_not_found', 'That agent does not exist.', 404);
	if (row.user_id !== userId) throw new SubjectError('agent_forbidden', 'A coin can only be linked to an agent you own.', 403);
	return row;
}

/**
 * Validate a subject request into the columns it stores. Pure checks on the
 * shape happen first so a bad request never touches the database.
 */
export async function resolveSubjectInput({ userId, kind, agentId = null, avatarId = null, animation = null }) {
	if (!SUBJECT_KINDS.includes(kind)) throw new SubjectError('invalid_kind', `kind must be one of ${SUBJECT_KINDS.join(', ')}.`);
	if ((kind === 'agent' || kind === 'bundle') && !agentId) throw new SubjectError('agent_required', 'Pick the agent this coin is linked to.');
	if ((kind === 'avatar' || kind === 'animation') && !avatarId) throw new SubjectError('avatar_required', 'Pick the avatar this coin is about.');
	if (kind === 'animation' && !animation) throw new SubjectError('animation_required', 'Pick the animation this coin is about.');

	const agent = agentId ? await loadOwnedAgentRow(agentId, userId) : null;
	const wantedAvatar = avatarId || agent?.avatar_id || null;
	const avatar = wantedAvatar ? await loadAvatar(wantedAvatar, userId) : null;
	let clip = null;
	if (animation) {
		clip = (await curatedAnimations()).get(String(animation));
		if (!clip) throw new SubjectError('animation_unknown', 'That animation is not in the three.ws animation library.');
		if (!avatar) throw new SubjectError('avatar_required', 'An animation plays on an avatar. Pick one.');
	}
	const title = titleFor({ kind, agent, avatar, clip });
	return {
		kind,
		agent_id: agent?.id || null,
		avatar_id: avatar?.id || null,
		animation: clip?.id || null,
		animation_label: clip?.label || null,
		title,
		agent,
		avatar,
		clip,
	};
}

export function titleFor({ kind, agent, avatar, clip }) {
	const who = avatar?.name || agent?.name || 'three.ws';
	if (kind === 'animation' && clip) return `${who}: ${clip.label}`.slice(0, 120);
	if (kind === 'bundle') return [agent?.name, clip?.label].filter(Boolean).join(': ').slice(0, 120) || who;
	if (kind === 'agent') return (agent?.name || who).slice(0, 120);
	return who.slice(0, 120);
}

export async function createSubject({ userId, input }) {
	const s = await resolveSubjectInput({ userId, kind: input.kind, agentId: input.agent_id || null, avatarId: input.avatar_id || null, animation: input.animation || null });
	const id = newSubjectId();
	const [row] = await sql`
		INSERT INTO launch_subjects (id, user_id, kind, agent_id, avatar_id, animation, animation_label, title)
		VALUES (${id}, ${userId}, ${s.kind}, ${s.agent_id}, ${s.avatar_id}, ${s.animation}, ${s.animation_label}, ${s.title})
		RETURNING *
	`;
	return row;
}

export async function getSubjectRow(id) {
	if (typeof id !== 'string' || !/^[a-z0-9]{6,16}$/.test(id)) return null;
	const [row] = await sql`SELECT * FROM launch_subjects WHERE id = ${id} LIMIT 1`;
	return row || null;
}

export async function getOwnedSubject(id, userId) {
	const row = await getSubjectRow(id);
	if (!row) throw new SubjectError('subject_not_found', 'That launch does not exist.', 404);
	if (row.user_id !== userId) throw new SubjectError('subject_forbidden', 'That launch belongs to another account.', 403);
	return row;
}

export function subjectUrl(id) {
	return `${(env.APP_ORIGIN || 'https://three.ws').replace(/\/+$/, '')}/l/${id}`;
}

/** The image a coin defaults to: the subject avatar's thumbnail. */
export async function subjectImage(row) {
	if (!row?.avatar_id) return null;
	const [av] = await sql`SELECT thumbnail_key, visibility FROM avatars WHERE id = ${row.avatar_id} AND deleted_at IS NULL LIMIT 1`;
	if (!av || (av.visibility !== 'public' && av.visibility !== 'unlisted')) return null;
	const url = thumbnailUrl(av.thumbnail_key);
	if (!url) return null;
	return url.startsWith('https://') ? url : `${(env.APP_ORIGIN || 'https://three.ws').replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Record the coin details and signer a launch is about to use. */
export async function stageSubject(id, { chain, venue, signer, signerAgentId = null, creatorAddress = null, name, symbol, imageUrl = null, description = null, prepared = null, status = 'prepared' }) {
	const [row] = await sql`
		UPDATE launch_subjects SET
			chain = ${chain}, venue = ${venue}, signer = ${signer}, signer_agent_id = ${signerAgentId},
			creator_address = ${creatorAddress}, name = ${name}, symbol = ${symbol}, image_url = ${imageUrl},
			description = ${description},
			prepared = ${prepared ? JSON.stringify(prepared) : '{}'}::jsonb,
			status = ${status}, updated_at = now()
		WHERE id = ${id} AND status IN ('draft', 'prepared', 'failed')
		RETURNING *
	`;
	if (!row) throw new SubjectError('subject_launched', 'This launch already went out. Start a new one for another coin.', 409);
	return row;
}

export async function markSubjectSubmitted(id, { txHash, launchRecordId = null }) {
	await sql`
		UPDATE launch_subjects SET tx_hash = ${txHash}, launch_record_id = COALESCE(${launchRecordId}, launch_record_id),
			status = 'submitted', updated_at = now()
		WHERE id = ${id} AND status <> 'live'
	`;
}

export async function markSubjectLive(id, { token, txHash, creatorAddress = null }) {
	const [row] = await sql`
		UPDATE launch_subjects SET token = ${token}, tx_hash = ${txHash},
			creator_address = COALESCE(${creatorAddress}, creator_address),
			status = 'live', launched_at = COALESCE(launched_at, now()), updated_at = now()
		WHERE id = ${id}
		RETURNING *
	`;
	return row || null;
}

export async function markSubjectFailed(id) {
	await sql`UPDATE launch_subjects SET status = 'failed', updated_at = now() WHERE id = ${id} AND status <> 'live'`;
}

/** The public view of a subject, with what /l/:id renders. */
export async function publicSubject(row) {
	if (!row) return null;
	const [agent] = row.agent_id ? await sql`SELECT id, name FROM agent_identities WHERE id = ${row.agent_id} AND deleted_at IS NULL LIMIT 1` : [null];
	const [avatar] = row.avatar_id ? await sql`SELECT id, name, slug, visibility FROM avatars WHERE id = ${row.avatar_id} AND deleted_at IS NULL LIMIT 1` : [null];
	const showAvatar = avatar && (avatar.visibility === 'public' || avatar.visibility === 'unlisted');
	return {
		id: row.id,
		url: subjectUrl(row.id),
		kind: row.kind,
		title: row.title,
		agent: agent ? { id: agent.id, name: agent.name, url: `/agents/${agent.id}` } : null,
		avatar: showAvatar ? { id: avatar.id, name: avatar.name } : null,
		animation: row.animation ? { id: row.animation, label: row.animation_label } : null,
		status: row.status,
		chain: row.chain,
		venue: row.venue,
		signer: row.signer,
		coin: row.name ? { name: row.name, symbol: row.symbol, image_url: row.image_url, description: row.description } : null,
		token: row.token,
		tx_hash: row.tx_hash,
		creator_address: row.creator_address,
		launch_record_id: row.launch_record_id,
		created_at: row.created_at,
		launched_at: row.launched_at,
	};
}

/** Point a subject at the launch record that is sending its coin. */
export async function linkSubjectRecord(id, launchRecordId) {
	await sql`UPDATE launch_subjects SET launch_record_id = ${launchRecordId}, updated_at = now() WHERE id = ${id} AND status <> 'live'`;
}

/** The caller's launches, newest first, for the launchpad's history list. */
export async function listOwnedSubjects(userId, { limit = 20 } = {}) {
	return sql`
		SELECT * FROM launch_subjects WHERE user_id = ${userId}
		ORDER BY created_at DESC LIMIT ${Math.min(Math.max(Number(limit) || 20, 1), 50)}
	`;
}
