// Per-agent X posting: which account an agent posts through, what it may post,
// how often, and whether a human approves each post first.
//
// Every automated or tool-driven post for an agent goes through
// requestAgentPost(). That is the one place the policy is enforced, so a run,
// an MCP tool call and the settings page's composer can never disagree about
// what is allowed:
//
//   1. the policy is on and the post's kind is allowed,
//   2. the content passes the tone rules (banned terms, hashtags, links),
//   3. the daily cap has room,
//   4. then the post is queued for review (review_before_post), scheduled
//      (a future time, or the next slot the minimum interval allows), or
//      published now through publishTweet (which still applies the account's
//      X tier quota, dedup window and scope check).
//
// Owner approval of a queued post (api/x/reviews.js) is a human decision and
// is not held to the agent's cadence caps; it still goes through publishTweet.

import { sql } from './db.js';
import { env } from './env.js';
import { isUuid } from './validate.js';
import { MAX_TWEET_LEN, XPostError, publishTweet, resolveXConnection } from './x-post.js';
import { X_POST_REQUIRED_SCOPES, missingScopes } from './x-scopes.js';

/** What an agent may post about. Order is the order the settings page lists them. */
export const POST_KINDS = Object.freeze([
	{ id: 'launches', label: 'Launches', summary: 'Coins the agent launches on three.ws.' },
	{ id: 'trades', label: 'Trades', summary: 'Buys and sells the agent makes from its wallet.' },
	{ id: 'runs', label: 'Runs', summary: 'Results of the agent\'s runs and automations.' },
	{ id: 'replies', label: 'Replies', summary: 'Replies to posts on X, threaded under the original.' },
	{ id: 'updates', label: 'Updates', summary: 'General posts in the agent\'s voice.' },
]);
export const POST_KIND_IDS = Object.freeze(POST_KINDS.map((k) => k.id));

/** The policy an agent has before its owner configures one: nothing may post. */
export const DEFAULT_POLICY = Object.freeze({
	enabled: true,
	allowed_kinds: Object.freeze([]),
	review_before_post: true,
	max_posts_per_day: 4,
	min_interval_min: 60,
	tone_guidance: '',
	banned_terms: Object.freeze([]),
	max_hashtags: 1,
	allow_links: true,
});

const LIMITS = Object.freeze({
	max_posts_per_day: [0, 50],
	min_interval_min: [0, 1440],
	max_hashtags: [0, 10],
	tone_guidance: 1000,
	banned_terms: 50,
	banned_term_len: 60,
});

// Ceiling on the review queue per agent: a run that loops must not be able to
// bury the owner under drafts.
const MAX_PENDING_REVIEWS_PER_AGENT = 50;
const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const TWEET_ID_RE = /^\d{1,25}$/;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const LINK_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/i;

function invalid(message, extra) {
	return new XPostError('validation_error', message, 400, extra);
}

function intInRange(value, [min, max], name) {
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max) throw invalid(`${name} must be an integer from ${min} to ${max}`);
	return n;
}

/**
 * Validate a partial policy update. Returns only the fields present, normalized.
 * Throws XPostError('validation_error') on the first bad field.
 */
export function normalizePolicyPatch(patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('policy must be an object');
	const out = {};
	if ('enabled' in patch) {
		if (typeof patch.enabled !== 'boolean') throw invalid('enabled must be a boolean');
		out.enabled = patch.enabled;
	}
	if ('review_before_post' in patch) {
		if (typeof patch.review_before_post !== 'boolean') throw invalid('review_before_post must be a boolean');
		out.review_before_post = patch.review_before_post;
	}
	if ('allow_links' in patch) {
		if (typeof patch.allow_links !== 'boolean') throw invalid('allow_links must be a boolean');
		out.allow_links = patch.allow_links;
	}
	if ('allowed_kinds' in patch) {
		if (!Array.isArray(patch.allowed_kinds)) throw invalid('allowed_kinds must be an array');
		const unknown = patch.allowed_kinds.filter((k) => !POST_KIND_IDS.includes(k));
		if (unknown.length) throw invalid(`unknown kind: ${unknown.join(', ')}. Use: ${POST_KIND_IDS.join(', ')}`);
		out.allowed_kinds = POST_KIND_IDS.filter((k) => patch.allowed_kinds.includes(k));
	}
	for (const key of ['max_posts_per_day', 'min_interval_min', 'max_hashtags']) {
		if (key in patch) out[key] = intInRange(patch[key], LIMITS[key], key);
	}
	if ('tone_guidance' in patch) {
		if (typeof patch.tone_guidance !== 'string') throw invalid('tone_guidance must be a string');
		const t = patch.tone_guidance.trim();
		if (t.length > LIMITS.tone_guidance) throw invalid(`tone_guidance is limited to ${LIMITS.tone_guidance} characters`);
		out.tone_guidance = t;
	}
	if ('banned_terms' in patch) {
		if (!Array.isArray(patch.banned_terms) || patch.banned_terms.some((t) => typeof t !== 'string')) {
			throw invalid('banned_terms must be an array of strings');
		}
		const terms = [...new Set(patch.banned_terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
		if (terms.length > LIMITS.banned_terms) throw invalid(`at most ${LIMITS.banned_terms} banned terms`);
		if (terms.some((t) => t.length > LIMITS.banned_term_len)) {
			throw invalid(`each banned term is limited to ${LIMITS.banned_term_len} characters`);
		}
		out.banned_terms = terms;
	}
	return out;
}

/**
 * Check post text against the tone rules. Returns a list of violations, empty
 * when the post may go out. `parts` is one string per tweet.
 */
export function checkPostContent(policy, parts) {
	const violations = [];
	if (!parts.length || parts.every((p) => !p.trim())) violations.push({ rule: 'empty', message: 'the post has no text' });
	parts.forEach((p, i) => {
		if (p.length > MAX_TWEET_LEN) {
			violations.push({ rule: 'length', message: `part ${i + 1} is ${p.length} characters; the limit is ${MAX_TWEET_LEN}` });
		}
	});
	const all = parts.join('\n');
	const lower = all.toLowerCase();
	for (const term of policy.banned_terms || []) {
		if (term && lower.includes(term)) violations.push({ rule: 'banned_term', message: `contains the banned term "${term}"` });
	}
	const hashtags = (all.match(HASHTAG_RE) || []).length;
	if (hashtags > policy.max_hashtags) {
		violations.push({ rule: 'hashtags', message: `${hashtags} hashtags; the policy allows ${policy.max_hashtags}` });
	}
	if (!policy.allow_links && LINK_RE.test(all)) {
		violations.push({ rule: 'links', message: 'contains a link; the policy does not allow links' });
	}
	return violations;
}

/** Split request text into tweet parts. */
export function toParts({ text = null, threadParts = null }) {
	if (Array.isArray(threadParts) && threadParts.length) {
		return threadParts.map((s) => String(s ?? '').trim()).filter(Boolean);
	}
	const t = String(text ?? '').trim();
	return t ? [t] : [];
}

function rowToPolicy(row) {
	if (!row) return { ...DEFAULT_POLICY, allowed_kinds: [], banned_terms: [], configured: false, updated_at: null };
	return {
		enabled: row.enabled,
		allowed_kinds: row.allowed_kinds || [],
		review_before_post: row.review_before_post,
		max_posts_per_day: row.max_posts_per_day,
		min_interval_min: row.min_interval_min,
		tone_guidance: row.tone_guidance || '',
		banned_terms: row.banned_terms || [],
		max_hashtags: row.max_hashtags,
		allow_links: row.allow_links,
		configured: true,
		updated_at: row.updated_at,
	};
}

/** The agent, if the user owns it. Throws not_found otherwise. */
export async function loadOwnedAgent(userId, agentId) {
	if (!isUuid(agentId)) throw invalid('agent_id must be a uuid');
	const [agent] = await sql`
		select id, name from agent_identities
		where id = ${agentId} and user_id = ${userId} and deleted_at is null
		limit 1
	`;
	if (!agent) throw new XPostError('not_found', 'agent not found', 404);
	return agent;
}

export async function getAgentPolicy(agentId) {
	const [row] = await sql`select * from agent_x_policies where agent_id = ${agentId} limit 1`;
	return rowToPolicy(row);
}

/** Apply a partial update over the current policy (or the defaults) and store it. */
export async function saveAgentPolicy({ userId, agentId, patch }) {
	await loadOwnedAgent(userId, agentId);
	const changes = normalizePolicyPatch(patch);
	const next = { ...(await getAgentPolicy(agentId)), ...changes };
	const [row] = await sql`
		insert into agent_x_policies
			(agent_id, user_id, enabled, allowed_kinds, review_before_post, max_posts_per_day,
			 min_interval_min, tone_guidance, banned_terms, max_hashtags, allow_links)
		values
			(${agentId}, ${userId}, ${next.enabled}, ${next.allowed_kinds}, ${next.review_before_post},
			 ${next.max_posts_per_day}, ${next.min_interval_min}, ${next.tone_guidance}, ${next.banned_terms},
			 ${next.max_hashtags}, ${next.allow_links})
		on conflict (agent_id) do update set
			user_id = excluded.user_id,
			enabled = excluded.enabled,
			allowed_kinds = excluded.allowed_kinds,
			review_before_post = excluded.review_before_post,
			max_posts_per_day = excluded.max_posts_per_day,
			min_interval_min = excluded.min_interval_min,
			tone_guidance = excluded.tone_guidance,
			banned_terms = excluded.banned_terms,
			max_hashtags = excluded.max_hashtags,
			allow_links = excluded.allow_links,
			updated_at = now()
		returning *
	`;
	return rowToPolicy(row);
}

/**
 * Posts that count against the agent's daily cap: published in the last 24h
 * (thread heads only) plus scheduled ones due in the next 24h.
 */
async function cadenceState(agentId, policy) {
	const [c] = await sql`
		select
			(select count(*)::int from x_posts
			 where agent_id = ${agentId} and created_at > now() - interval '24 hours'
			   and not exists (select 1 from x_posts p2
			                   where p2.agent_id = ${agentId} and p2.tweet_id = x_posts.reply_to_tweet_id)) as published_24h,
			(select count(*)::int from x_scheduled_posts
			 where agent_id = ${agentId} and posted_at is null and error is null
			   and scheduled_at < now() + interval '24 hours') as scheduled_24h,
			(select max(created_at) from x_posts where agent_id = ${agentId}) as last_posted_at,
			(select max(scheduled_at) from x_scheduled_posts
			 where agent_id = ${agentId} and posted_at is null and error is null) as last_scheduled_at
	`;
	const used = c.published_24h + c.scheduled_24h;
	const anchors = [c.last_posted_at, c.last_scheduled_at].filter(Boolean).map((d) => new Date(d).getTime());
	const lastSlot = anchors.length ? Math.max(...anchors) : 0;
	const nextAllowedMs = lastSlot ? lastSlot + policy.min_interval_min * 60_000 : 0;
	return {
		used_24h: used,
		cap: policy.max_posts_per_day,
		remaining_24h: Math.max(0, policy.max_posts_per_day - used),
		last_posted_at: c.last_posted_at,
		next_allowed_at: nextAllowedMs > Date.now() ? new Date(nextAllowedMs).toISOString() : null,
	};
}

function connectionSummary(conn) {
	if (!conn) return null;
	return {
		account: conn.source,
		username: conn.username,
		can_post: missingScopes(conn.scopes, X_POST_REQUIRED_SCOPES).length === 0,
		connected_at: conn.connected_at,
		last_posted_at: conn.last_posted_at,
	};
}

export function connectUrl(agentId, { target = 'agent' } = {}) {
	const q = new URLSearchParams({ scope: 'full', return_to: '/settings/connections' });
	if (agentId) q.set('agent_id', agentId);
	if (target === 'agent') q.set('target', 'agent');
	return `/api/auth/x/connect?${q.toString()}`;
}

/** Everything the settings page and get tools need for one agent. */
export async function getAgentXState({ userId, agentId }) {
	const agent = await loadOwnedAgent(userId, agentId);
	const [policy, conn, [{ pending }]] = await Promise.all([
		getAgentPolicy(agentId),
		resolveXConnection({ userId, agentId }),
		sql`select count(*)::int as pending from x_pending_reviews where agent_id = ${agentId} and user_id = ${userId} and status = 'pending'`,
	]);
	return {
		agent: { id: agent.id, name: agent.name },
		configured: Boolean(env.X_OAUTH_CLIENT_ID && env.X_OAUTH_CLIENT_SECRET),
		connection: connectionSummary(conn),
		connect_url: connectUrl(agentId),
		policy,
		cadence: await cadenceState(agentId, policy),
		pending_reviews: pending,
		kinds: POST_KINDS,
	};
}

/** Every agent the user owns, with its posting state, for the connections page. */
export async function listAgentXStates(userId) {
	const agents = await sql`
		select a.id, a.name,
		       p.agent_id is not null as policy_configured, p.enabled, p.allowed_kinds, p.review_before_post,
		       c.username as agent_username, c.disconnected_at is null and c.agent_id is not null as has_own_account,
		       (select count(*)::int from x_pending_reviews r
		        where r.agent_id = a.id::text and r.user_id = ${userId} and r.status = 'pending') as pending_reviews
		from agent_identities a
		left join agent_x_policies p on p.agent_id = a.id
		left join agent_x_connections c on c.agent_id = a.id and c.disconnected_at is null
		where a.user_id = ${userId} and a.deleted_at is null
		order by a.created_at desc
		limit 200
	`;
	return agents.map((a) => ({
		id: a.id,
		name: a.name,
		account: a.has_own_account ? { account: 'agent', username: a.agent_username } : null,
		policy_configured: a.policy_configured,
		enabled: a.policy_configured ? a.enabled : DEFAULT_POLICY.enabled,
		allowed_kinds: a.allowed_kinds || [],
		review_before_post: a.policy_configured ? a.review_before_post : DEFAULT_POLICY.review_before_post,
		pending_reviews: a.pending_reviews,
	}));
}

/** Disconnect the agent's own X account; it falls back to the owner's account. */
export async function disconnectAgentX({ userId, agentId }) {
	await loadOwnedAgent(userId, agentId);
	const rows = await sql`
		update agent_x_connections set disconnected_at = now(), updated_at = now()
		where agent_id = ${agentId} and user_id = ${userId} and disconnected_at is null
		returning agent_id
	`;
	return { disconnected: rows.length > 0 };
}

function parseSchedule(scheduledAt) {
	if (scheduledAt == null || scheduledAt === '') return null;
	const when = new Date(scheduledAt);
	if (Number.isNaN(when.getTime())) throw invalid('scheduled_at must be an ISO timestamp');
	if (when.getTime() < Date.now() - 60_000) throw invalid('scheduled_at must be in the future');
	if (when.getTime() > Date.now() + MAX_SCHEDULE_AHEAD_MS) throw invalid('scheduled_at must be within a year');
	return when.getTime() <= Date.now() ? null : when;
}

/**
 * Ask for an agent to post. Applies the agent's policy and answers with what
 * happened: `pending_review`, `scheduled` or `published`. Refusals throw
 * XPostError with a code the caller can act on (posting_paused,
 * kind_not_allowed, tone_violation, daily_cap_reached, review_queue_full,
 * not_connected, plus everything publishTweet can refuse).
 *
 * @param {object} o
 * @param {string} o.userId
 * @param {string} o.agentId
 * @param {string} o.kind            one of POST_KIND_IDS
 * @param {string} [o.text]
 * @param {string[]} [o.threadParts]
 * @param {string} [o.replyTo]       tweet id; required for kind 'replies'
 * @param {string} [o.scheduledAt]   ISO time; the post goes out then
 * @param {string} o.source          what produced the post: 'mcp', 'run', 'settings', 'api'
 * @param {string} [o.sourceRef]     id of the run / launch / trade behind it
 */
export async function requestAgentPost({ userId, agentId, kind, text = null, threadParts = null, replyTo = null, scheduledAt = null, source, sourceRef = null }) {
	await loadOwnedAgent(userId, agentId);
	if (!POST_KIND_IDS.includes(kind)) throw invalid(`kind must be one of: ${POST_KIND_IDS.join(', ')}`);
	if (kind === 'replies') {
		if (!replyTo || !TWEET_ID_RE.test(String(replyTo))) throw invalid('a reply needs reply_to_tweet_id');
	} else if (replyTo) {
		throw invalid('reply_to_tweet_id is only valid for kind "replies"');
	}

	const policy = await getAgentPolicy(agentId);
	const settings = `/settings/connections?agent=${agentId}#x`;
	if (!policy.enabled) {
		throw new XPostError('posting_paused', 'posting is paused for this agent', 403, { settings_url: settings });
	}
	if (!policy.allowed_kinds.includes(kind)) {
		throw new XPostError('kind_not_allowed', `this agent's policy does not allow "${kind}" posts`, 403, {
			allowed_kinds: policy.allowed_kinds,
			settings_url: settings,
			hint: policy.configured ? undefined : 'no posting policy is set yet; configure one with configure_twitter_posting',
		});
	}

	const parts = toParts({ text, threadParts });
	const violations = checkPostContent(policy, parts);
	if (violations.length) {
		throw new XPostError('tone_violation', violations.map((v) => v.message).join('; '), 422, {
			violations,
			tone_guidance: policy.tone_guidance || undefined,
		});
	}

	const when = parseSchedule(scheduledAt);
	const conn = await resolveXConnection({ userId, agentId });
	const threadJson = parts.length > 1 ? JSON.stringify(parts) : null;

	if (policy.review_before_post) {
		const [{ pending }] = await sql`
			select count(*)::int as pending from x_pending_reviews
			where agent_id = ${agentId} and user_id = ${userId} and status = 'pending'
		`;
		if (pending >= MAX_PENDING_REVIEWS_PER_AGENT) {
			throw new XPostError('review_queue_full', `${pending} posts are already waiting for approval`, 409, { review_url: settings });
		}
		const [row] = await sql`
			insert into x_pending_reviews
				(user_id, agent_id, text, thread_parts, kind, source, source_ref, scheduled_for, reply_to_tweet_id)
			values (${userId}, ${agentId}, ${parts[0]}, ${threadJson}::jsonb, ${kind}, ${source}, ${sourceRef},
			        ${when ? when.toISOString() : null}, ${replyTo})
			returning id, created_at
		`;
		return {
			status: 'pending_review',
			review_id: row.id,
			kind,
			scheduled_for: when ? when.toISOString() : null,
			needs_connection: !conn,
			connect_url: conn ? undefined : connectUrl(agentId),
			review_url: settings,
			message: conn
				? 'Queued for the owner\'s approval. Nothing was posted.'
				: 'Queued for the owner\'s approval. Connect an X account before approving it.',
		};
	}

	if (!conn) {
		throw new XPostError('not_connected', 'no X account is connected for this agent or its owner', 400, {
			connect_url: connectUrl(agentId),
		});
	}

	const cadence = await cadenceState(agentId, policy);
	if (cadence.remaining_24h <= 0) {
		throw new XPostError('daily_cap_reached', `the policy allows ${policy.max_posts_per_day} posts a day`, 429, { cadence });
	}

	const nextSlot = cadence.next_allowed_at ? new Date(cadence.next_allowed_at) : null;
	const goesOutAt = when && nextSlot ? (when > nextSlot ? when : nextSlot) : when || nextSlot;
	if (goesOutAt) {
		const [row] = await sql`
			insert into x_scheduled_posts (user_id, agent_id, text, thread_parts, reply_to_tweet_id, scheduled_at, kind)
			values (${userId}, ${agentId}, ${parts[0]}, ${threadJson}::jsonb, ${replyTo}, ${goesOutAt.toISOString()}, ${kind})
			returning id, scheduled_at
		`;
		return {
			status: 'scheduled',
			scheduled_post_id: row.id,
			scheduled_at: row.scheduled_at,
			kind,
			reason: when && goesOutAt === when ? 'requested_time' : 'min_interval',
		};
	}

	const result = await publishTweet({
		userId,
		agentId,
		kind,
		text: parts.length > 1 ? null : parts[0],
		threadParts: parts.length > 1 ? parts : null,
		replyTo,
	});
	return { status: 'published', kind, ...result };
}

/** Pending approvals and scheduled posts, optionally for one agent. */
export async function listScheduledPosts({ userId, agentId = null, limit = 50 }) {
	if (agentId) await loadOwnedAgent(userId, agentId);
	const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
	const [reviews, scheduled] = await Promise.all([
		agentId
			? sql`select id, agent_id, text, thread_parts, kind, source, source_ref, scheduled_for, reply_to_tweet_id, created_at
			      from x_pending_reviews where user_id = ${userId} and agent_id = ${agentId} and status = 'pending'
			      order by created_at desc limit ${lim}`
			: sql`select id, agent_id, text, thread_parts, kind, source, source_ref, scheduled_for, reply_to_tweet_id, created_at
			      from x_pending_reviews where user_id = ${userId} and status = 'pending'
			      order by created_at desc limit ${lim}`,
		agentId
			? sql`select id, agent_id, text, thread_parts, kind, scheduled_at, posted_at, tweet_id, error
			      from x_scheduled_posts where user_id = ${userId} and agent_id = ${agentId}
			        and (posted_at is null or posted_at > now() - interval '7 days')
			      order by scheduled_at desc limit ${lim}`
			: sql`select id, agent_id, text, thread_parts, kind, scheduled_at, posted_at, tweet_id, error
			      from x_scheduled_posts where user_id = ${userId}
			        and (posted_at is null or posted_at > now() - interval '7 days')
			      order by scheduled_at desc limit ${lim}`,
	]);
	const state = (p) => (p.posted_at ? 'posted' : p.error ? 'failed' : 'scheduled');
	return {
		pending_review: reviews,
		scheduled: scheduled.map((p) => ({ ...p, state: state(p) })),
	};
}
