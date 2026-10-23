// Keyless X (Twitter) reader: public profiles and user timelines through the
// guest-token GraphQL surface x.com's own web client uses for logged-out
// visitors. No API key, no account, read-only.
//
// Adapted from XActions (Apache-2.0, see NOTICE in this directory). It is the
// second rung behind the paid X API v2 (src/kol/x-profile.js) and the feeder for
// the oracle social endpoint (api/cron/oracle-social-ingest.js).
//
// Failure model: every error is an XGuestError with a `reason` (rate_limited,
// stale_query_id, not_found, guest_token, upstream) so callers can fail soft to
// the previous rung and log why. A 429 opens a cooldown that short-circuits
// later calls until the window x.com reported has passed.

import { XGuestError, NotFoundError, RateLimitError } from './errors.js';
import { parseUserData } from './parse-user.js';
import { parseTimelineInstructions, userTimelineInstructions } from './parse-tweet.js';

export { XGuestError, NotFoundError, RateLimitError, parseUserData };

const WEB_BEARER =
	'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const GRAPHQL_BASE = 'https://x.com/i/api/graphql';
const ACTIVATE_URL = 'https://api.x.com/1.1/guest/activate.json';
const UPSTREAM_ENDPOINTS_URL =
	'https://raw.githubusercontent.com/nirholas/XActions/main/src/scrapers/twitter/http/x-endpoints.generated.js';

const GUEST_TTL_MS = 2.5 * 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Known-good query IDs. Replaced at runtime by the live upstream constants when
// x.com rotates one (see refreshQueryId).
const QUERY_IDS = {
	UserByScreenName: 'Gb-d6r0vxPOADdG62OEBpQ',
	UserTweets: 'SXVCYB8XHSS25nzIljNtZA',
};

const USER_FEATURES = {
	hidden_profile_subscriptions_enabled: true,
	responsive_web_graphql_exclude_directive_enabled: true,
	verified_phone_label_enabled: false,
	subscriptions_verification_info_is_identity_verified_enabled: true,
	subscriptions_verification_info_verified_since_enabled: true,
	highlights_tweets_tab_ui_enabled: true,
	responsive_web_twitter_article_notes_tab_enabled: true,
	creator_subscriptions_tweet_preview_api_enabled: true,
	responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
	responsive_web_graphql_timeline_navigation_enabled: true,
};

const TIMELINE_FEATURES = {
	rweb_video_screen_enabled: false,
	responsive_web_graphql_timeline_navigation_enabled: true,
	responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
	creator_subscriptions_tweet_preview_api_enabled: true,
	longform_notetweets_consumption_enabled: true,
	longform_notetweets_rich_text_read_enabled: true,
	longform_notetweets_inline_media_enabled: true,
	freedom_of_speech_not_reach_fetch_enabled: true,
	standardized_nudges_misinfo: true,
	tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
	view_counts_everywhere_api_enabled: true,
	responsive_web_edit_tweet_api_enabled: true,
	graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
	responsive_web_enhance_cards_enabled: false,
	communities_web_enable_tweet_community_results_fetch: true,
	c9s_tweet_anatomy_moderator_badge_enabled: true,
	articles_preview_enabled: true,
	responsive_web_twitter_article_tweet_consumption_enabled: true,
	tweet_awards_web_tipping_enabled: false,
	creator_subscriptions_quote_tweet_preview_enabled: false,
	rweb_tipjar_consumption_enabled: true,
	responsive_web_grok_analyze_button_fetch_trends_enabled: false,
};

const state = {
	guest: null, // { value, createdAt }
	activating: null,
	cooldownUntil: 0,
	queryIds: { ...QUERY_IDS },
	refreshing: null,
};

/** Clear cached guest token, cooldown and discovered query IDs (tests, ops). */
export function resetGuestState() {
	state.guest = null;
	state.activating = null;
	state.cooldownUntil = 0;
	state.queryIds = { ...QUERY_IDS };
	state.refreshing = null;
}

function withTimeout(init) {
	return { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
}

async function activateGuestToken(fetchImpl) {
	const res = await fetchImpl(
		ACTIVATE_URL,
		withTimeout({
			method: 'POST',
			headers: { authorization: `Bearer ${WEB_BEARER}`, 'user-agent': USER_AGENT },
		}),
	);
	if (res.status === 429) {
		throw new RateLimitError('guest activation rate limited', { status: 429, endpoint: ACTIVATE_URL });
	}
	if (!res.ok) {
		throw new XGuestError(`guest activation failed: HTTP ${res.status}`, {
			status: res.status,
			endpoint: ACTIVATE_URL,
			reason: 'guest_token',
		});
	}
	const body = await res.json().catch(() => null);
	if (!body?.guest_token) {
		throw new XGuestError('guest activation returned no token', { endpoint: ACTIVATE_URL, reason: 'guest_token' });
	}
	return { value: String(body.guest_token), createdAt: Date.now() };
}

async function guestToken(fetchImpl, { force = false } = {}) {
	if (!force && state.guest && Date.now() - state.guest.createdAt < GUEST_TTL_MS) return state.guest.value;
	if (!state.activating) {
		state.activating = activateGuestToken(fetchImpl)
			.then((token) => {
				state.guest = token;
				return token;
			})
			.finally(() => {
				state.activating = null;
			});
	}
	return (await state.activating).value;
}

/**
 * Re-read the operation's query ID from the XActions repo's current constants.
 * Returns the new ID, or null when upstream is unreachable or does not list it.
 */
async function refreshQueryId(operation, fetchImpl) {
	if (!state.refreshing) {
		state.refreshing = (async () => {
			const res = await fetchImpl(UPSTREAM_ENDPOINTS_URL, withTimeout({ headers: { 'user-agent': USER_AGENT } }));
			if (!res.ok) return null;
			const src = await res.text();
			for (const op of Object.keys(QUERY_IDS)) {
				const m = src.match(new RegExp(`"${op}":\\s*Object\\.freeze\\(\\{\\s*queryId:\\s*"([\\w-]+)"`));
				if (m) state.queryIds[op] = m[1];
			}
			return true;
		})()
			.catch(() => null)
			.finally(() => {
				state.refreshing = null;
			});
	}
	await state.refreshing;
	return state.queryIds[operation] || null;
}

function isStaleQueryIdFailure(status, body) {
	if (status === 404) return true;
	if (status !== 400) return false;
	const text = JSON.stringify(body || {}).toLowerCase();
	return text.includes('persistedquery') || text.includes('query id') || text.includes('queryid');
}

async function graphql(operation, variables, features, fetchImpl, { retried = false, tokenRetried = false } = {}) {
	if (Date.now() < state.cooldownUntil) {
		throw new RateLimitError('x guest reader cooling down after a rate limit', {
			resetAt: state.cooldownUntil,
			endpoint: operation,
		});
	}
	const queryId = state.queryIds[operation];
	const url = `${GRAPHQL_BASE}/${queryId}/${operation}?variables=${encodeURIComponent(
		JSON.stringify(variables),
	)}&features=${encodeURIComponent(JSON.stringify(features))}`;
	const token = await guestToken(fetchImpl);
	const res = await fetchImpl(
		url,
		withTimeout({
			headers: {
				authorization: `Bearer ${WEB_BEARER}`,
				'x-guest-token': token,
				'user-agent': USER_AGENT,
				'content-type': 'application/json',
				'x-twitter-active-user': 'yes',
				'x-twitter-client-language': 'en',
			},
		}),
	);

	if (res.status === 429) {
		const reset = Number(res.headers?.get?.('x-rate-limit-reset')) * 1000;
		state.cooldownUntil = Number.isFinite(reset) && reset > Date.now() ? reset : Date.now() + DEFAULT_COOLDOWN_MS;
		state.guest = null;
		throw new RateLimitError('x guest reader rate limited', {
			status: 429,
			resetAt: state.cooldownUntil,
			endpoint: operation,
		});
	}

	const body = await res.json().catch(() => null);

	if (res.status === 403 && !tokenRetried) {
		state.guest = null;
		return graphql(operation, variables, features, fetchImpl, { retried, tokenRetried: true });
	}
	if (isStaleQueryIdFailure(res.status, body)) {
		if (retried) {
			throw new XGuestError(`query id for ${operation} is stale and upstream has no fresh one`, {
				status: res.status,
				endpoint: operation,
				reason: 'stale_query_id',
			});
		}
		const fresh = await refreshQueryId(operation, fetchImpl);
		if (!fresh || fresh === queryId) {
			throw new XGuestError(`query id for ${operation} is stale and upstream has no fresh one`, {
				status: res.status,
				endpoint: operation,
				reason: 'stale_query_id',
			});
		}
		return graphql(operation, variables, features, fetchImpl, { retried: true, tokenRetried });
	}
	if (!res.ok) {
		throw new XGuestError(`x guest ${operation} failed: HTTP ${res.status}`, {
			status: res.status,
			endpoint: operation,
			reason: 'upstream',
		});
	}
	if (!body || typeof body !== 'object') {
		throw new XGuestError(`x guest ${operation} returned a non-JSON body`, { endpoint: operation, reason: 'upstream' });
	}
	return body;
}

function cleanHandle(handle) {
	const clean = String(handle || '').replace(/^@/, '');
	if (!HANDLE_RE.test(clean)) throw new NotFoundError(`invalid X handle: ${clean || '(empty)'}`);
	return clean;
}

/**
 * Public profile for a handle (followers, joined date, avatar, bio, ...).
 * @returns {Promise<object>} XActions profile object, see parse-user.js
 */
export async function fetchGuestProfile(handle, { fetchImpl = fetch } = {}) {
	const clean = cleanHandle(handle);
	const body = await graphql(
		'UserByScreenName',
		{ screen_name: clean, withSafetyModeUserFields: true },
		USER_FEATURES,
		fetchImpl,
	);
	const result = body?.data?.user?.result;
	if (!result) throw new NotFoundError(`@${clean} not found`);
	return parseUserData(result);
}

/**
 * Latest original tweets for a handle, newest first (pinned tweet included when
 * x.com sends it). One page, up to `limit` tweets.
 * @returns {Promise<{ profile: object, tweets: object[] }>}
 */
export async function fetchGuestTimeline(handle, { limit = 20, fetchImpl = fetch } = {}) {
	const clean = cleanHandle(handle);
	const profile = await fetchGuestProfile(clean, { fetchImpl });
	const body = await graphql(
		'UserTweets',
		{
			userId: profile.id,
			count: Math.max(1, Math.min(Number(limit) || 20, 40)),
			includePromotedContent: false,
			withQuickPromoteEligibilityTweetFields: true,
			withVoice: true,
			withV2Timeline: true,
		},
		TIMELINE_FEATURES,
		fetchImpl,
	);
	const { tweets } = parseTimelineInstructions(userTimelineInstructions(body?.data));
	return { profile, tweets: tweets.slice(0, limit) };
}
