// threews-agent MCP: account status, dashboard links and per-agent X posting.
//
// Tool policy (docs/prompts/03):
//   read   get_account_status      plan, limits, what is left, agents, wallet, approvals waiting
//          get_dashboard_urls      canonical pages on this deployment, so nobody guesses a link
//          list_scheduled_posts    an agent's X posts waiting for review or a send time
//   write  connect_twitter         the link the owner opens to connect an X account (nothing connects here)
//          configure_twitter_posting  an agent's posting policy (kinds, caps, review-first)
//          post_to_x              request a post through the agent's policy
//
// post_to_x never bypasses the policy: it calls requestAgentPost(), the one
// place posting_paused, kind_not_allowed, tone, daily cap and review-before-post
// are enforced. With review on, the post is queued and nothing is published.

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import { XPostError } from '../_lib/x-post.js';
import { buildAccountStatus, dashboardUrls, DASHBOARD_PAGE_NAMES } from '../_lib/account-status.js';
import {
	POST_KIND_IDS,
	requestAgentPost,
	saveAgentPolicy,
	getAgentXState,
	listScheduledPosts,
} from '../_lib/x-agent-policy.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE_IDEMPOTENT = { ...WRITE, idempotentHint: true, openWorldHint: false };

const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent. three://agents lists yours.' };

function result(text, structuredContent, isError = false) {
	return { content: [{ type: 'text', text }], structuredContent, ...(isError ? { isError: true } : {}) };
}
const refusal = (text, reason, extra = {}) => result(text, { ok: false, reason, ...extra }, true);

const absolute = (path) => (path && path.startsWith('/') ? `${env.APP_ORIGIN.replace(/\/+$/, '')}${path}` : path);

async function rateLimit(auth) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

async function guard(auth, scope, fn) {
	await rateLimit(auth);
	if (!auth.userId) return refusal('Sign in to three.ws to use this tool.', 'auth_required', { signed_in: false });
	if (scope && !hasScope(auth.scope, scope)) {
		return refusal(`This action needs the ${scope} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scope });
	}
	try {
		return await fn();
	} catch (err) {
		if (err instanceof XPostError || err?.code === 'not_found' || err?.code === 'forbidden' || err?.status === 403 || err?.status === 404 || err?.status === 400) {
			const extra = { ...(err.extra || {}) };
			if (extra.connect_url) extra.connect_url = absolute(extra.connect_url);
			if (extra.settings_url) extra.settings_url = absolute(extra.settings_url);
			if (extra.review_url) extra.review_url = absolute(extra.review_url);
			return refusal(err.message, err.code || 'refused', extra);
		}
		throw err;
	}
}

const money = (n) => (n == null ? '?' : String(n));

function statusText(s) {
	const lines = [
		`Plan: ${s.plan.account} account, ${s.plan.api.name} API plan (resets ${s.plan.api.period_end?.slice(0, 10)}).`,
		`API calls: ${s.remaining.api_calls} of ${s.limits.api_calls_per_period} left this period (burst ${s.limits.burst_per_minute}/min, ${s.limits.concurrent} concurrent).`,
		`Free chat: ${s.remaining.free_chat_messages} of ${s.limits.free_chat_per_day} left today.`,
		`Agents: ${s.agents.count}.`,
	];
	if (s.wallet) {
		lines.push(
			s.wallet.provisioned
				? `Wallet ${s.wallet.address}: ${money(s.wallet.balances.sol)} SOL, ${money(s.wallet.balances.usdc)} USDC, autonomous spend ${s.wallet.spend_enabled ? 'on' : 'off'}.`
				: 'No agent wallet is provisioned yet.',
		);
	}
	lines.push(s.approvals.pending ? `${s.approvals.pending} approval${s.approvals.pending === 1 ? '' : 's'} waiting: ${s.approvals.url}` : 'Nothing is waiting for approval.');
	return lines.join('\n');
}

export const accountToolDefs = [
	{
		name: 'get_account_status',
		title: 'Account status',
		group: 'account',
		tier: 'read',
		annotations: READ,
		description: 'Show the signed-in account at a glance: its plan, API and free-chat limits and how much is left, how many agents it has, the agent wallet summary (when the token has wallet:read), and how many approvals are waiting. Use this when the user asks what plan they are on, what their limits are, what they have left, or what needs their attention.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		handler: (args, auth) => guard(auth, 'profile', async () => {
			const includeWallet = hasScope(auth.scope, 'wallet:read') || hasScope(auth.scope, 'wallet:write');
			const status = await buildAccountStatus(auth.userId, { includeWallet });
			return result(statusText(status), { ok: true, status });
		}),
	},
	{
		name: 'get_dashboard_urls',
		title: 'Dashboard links',
		group: 'account',
		tier: 'read',
		annotations: READ,
		description: `Return the canonical three.ws page URLs (dashboard, billing, wallet, runs, approvals, connections, API keys and more) so you can link the user to the right place instead of guessing. Pass page to get one. Pages: ${DASHBOARD_PAGE_NAMES.join(', ')}. Use this whenever you need to send the user to a three.ws page.`,
		inputSchema: {
			type: 'object',
			properties: { page: { type: 'string', enum: DASHBOARD_PAGE_NAMES, description: 'Return only this page.' } },
			additionalProperties: false,
		},
		handler: async (args, auth) => {
			await rateLimit(auth);
			if (args.page != null && !DASHBOARD_PAGE_NAMES.includes(args.page)) {
				return refusal(`Unknown page. Choose one of: ${DASHBOARD_PAGE_NAMES.join(', ')}.`, 'unknown_page', { pages: DASHBOARD_PAGE_NAMES });
			}
			const urls = dashboardUrls(args.page || null);
			return result(Object.entries(urls).map(([k, u]) => `${k}: ${u}`).join('\n'), { ok: true, urls });
		},
	},
	{
		name: 'connect_twitter',
		title: 'Connect an X account to an agent',
		group: 'integrations',
		tier: 'write',
		annotations: WRITE_IDEMPOTENT,
		description: 'Get the link the owner opens to connect an X (Twitter) account to an agent, and whether one is already connected. Nothing is connected by this call: the owner signs in to X on the link. Use this when the user wants an agent to post from its own X account.',
		inputSchema: { type: 'object', properties: { agent_id: agentIdProp }, required: ['agent_id'], additionalProperties: false },
		handler: (args, auth) => guard(auth, 'agents:write', async () => {
			const state = await getAgentXState({ userId: auth.userId, agentId: args.agent_id });
			const connectUrl = absolute(state.connect_url);
			const connected = Boolean(state.connection?.connected);
			const text = !state.configured
				? 'X sign-in is not configured on this server yet, so an account cannot be connected.'
				: connected
					? `An X account is already connected to this agent. To switch accounts, open ${connectUrl}`
					: `Not connected yet. The owner opens this link to connect an X account: ${connectUrl}`;
			return result(text, { ok: true, configured: state.configured, connection: state.connection, connect_url: connectUrl, policy: state.policy });
		}),
	},
	{
		name: 'configure_twitter_posting',
		title: "Set an agent's X posting policy",
		group: 'integrations',
		tier: 'write',
		annotations: WRITE_IDEMPOTENT,
		description: 'Set what an agent may post to X and how: turn posting on or off, which kinds of post are allowed, the daily cap and minimum gap, whether the owner approves each post first, and tone rules. Only the fields you pass change. Keep review_before_post on unless the owner has asked for hands-off posting. Use this to change what an agent may post to X before it posts.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				enabled: { type: 'boolean', description: 'Posting on or paused.' },
				allowed_kinds: { type: 'array', items: { type: 'string', enum: POST_KIND_IDS }, description: 'Kinds of post the agent may make.' },
				review_before_post: { type: 'boolean', description: 'Queue every post for the owner to approve.' },
				max_posts_per_day: { type: 'integer', minimum: 1, maximum: 100 },
				min_interval_min: { type: 'integer', minimum: 0, maximum: 1440, description: 'Minutes between posts.' },
				tone_guidance: { type: 'string', maxLength: 1000 },
				banned_terms: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 100 },
				max_hashtags: { type: 'integer', minimum: 0, maximum: 10 },
				allow_links: { type: 'boolean' },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => guard(auth, 'agents:write', async () => {
			const { agent_id: agentId, ...patch } = args;
			const policy = await saveAgentPolicy({ userId: auth.userId, agentId, patch });
			const text = `Posting is ${policy.enabled ? 'on' : 'paused'}, ${policy.review_before_post ? 'each post waits for the owner' : 'posts go out without review'}, up to ${policy.max_posts_per_day} a day.`;
			return result(text, { ok: true, policy });
		}),
	},
	{
		name: 'post_to_x',
		title: 'Post to X as an agent',
		group: 'integrations',
		tier: 'write',
		annotations: WRITE,
		description: 'Request a post to X for an agent. The agent\'s policy decides what happens: with review-before-post on (the default) the post is queued for the owner and NOTHING is published; otherwise it is scheduled or published, within the daily cap and tone rules. A refused post comes back with the reason. Use list_scheduled_posts to see the queue. For a reply, kind is "replies" and reply_to_tweet_id is required. Use this when the user wants an agent to post, thread or reply on X.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				kind: { type: 'string', enum: POST_KIND_IDS },
				text: { type: 'string', maxLength: 280, description: 'The post, up to 280 characters. Use thread_parts for a thread.' },
				thread_parts: { type: 'array', items: { type: 'string', maxLength: 280 }, maxItems: 25, description: 'A thread, one entry per post.' },
				reply_to_tweet_id: { type: 'string', pattern: '^[0-9]{1,25}$', description: 'Only for kind "replies".' },
				scheduled_at: { type: 'string', format: 'date-time', description: 'Send no earlier than this time.' },
			},
			required: ['agent_id', 'kind'],
			additionalProperties: false,
		},
		handler: (args, auth) => guard(auth, 'agents:write', async () => {
			const out = await requestAgentPost({
				userId: auth.userId,
				agentId: args.agent_id,
				kind: args.kind,
				text: args.text ?? null,
				threadParts: args.thread_parts ?? null,
				replyTo: args.reply_to_tweet_id ?? null,
				scheduledAt: args.scheduled_at ?? null,
				source: 'mcp',
			});
			const posted = out.status === 'published';
			const text = posted
				? 'Posted to X.'
				: out.status === 'scheduled'
					? `Scheduled for ${out.scheduled_at}. Nothing is posted yet.`
					: `${out.message || 'Queued for the owner\'s approval. Nothing was posted.'}${out.review_url ? ` Review: ${absolute(out.review_url)}` : ''}`;
			const clean = { ...out };
			if (clean.review_url) clean.review_url = absolute(clean.review_url);
			if (clean.connect_url) clean.connect_url = absolute(clean.connect_url);
			return result(text, { ok: true, posted, ...clean });
		}),
	},
	{
		name: 'list_scheduled_posts',
		title: "List an agent's queued X posts",
		group: 'integrations',
		tier: 'read',
		annotations: READ,
		description: 'List X posts waiting for the owner to approve and posts scheduled to go out (plus the last week\'s sent or failed ones). Omit agent_id to list across all of the account\'s agents. Use this to check what is queued or already sent on X.',
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, limit: { type: 'integer', minimum: 1, maximum: 100 } },
			additionalProperties: false,
		},
		handler: (args, auth) => guard(auth, 'agents:read', async () => {
			const out = await listScheduledPosts({ userId: auth.userId, agentId: args.agent_id || null, limit: args.limit });
			const text = `${out.pending_review.length} waiting for review, ${out.scheduled.length} scheduled or recent.`;
			return result(text, { ok: true, pending_review: out.pending_review, scheduled: out.scheduled });
		}),
	},
];
