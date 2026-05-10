/**
 * GET /api/social/platforms
 *
 * Discovery endpoint. Returns all supported platforms, their required
 * credentials, optional settings, and limits. No auth required.
 *
 * Designed for AI agents to call first to understand what to pass to
 * /api/social/post.
 */

import { cors, json, method, wrap } from '../_lib/http.js';

const PLATFORMS = [
	{
		id: 'x',
		name: 'X (Twitter)',
		url: 'https://x.com',
		content_limit: 280,
		supports_media: true,
		supports_threads: true,
		supports_scheduling: true,
		credentials: {
			required: ['consumer_key', 'consumer_secret', 'access_token', 'access_secret'],
			description:
				'OAuth 1.0a credentials from https://developer.twitter.com. consumer_key + consumer_secret are app credentials; access_token + access_secret are user credentials.',
		},
		settings: {},
		media_types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4'],
		media_limit: 4,
		x402: {
			amount_usdc: '0.001',
			description: 'Pay 0.001 USDC per tweet via x402 to use platform posting account',
		},
	},
	{
		id: 'farcaster',
		name: 'Farcaster / Warpcast',
		url: 'https://warpcast.com',
		content_limit: 1024,
		supports_media: true,
		supports_threads: false,
		supports_scheduling: true,
		credentials: {
			required: ['neynar_key', 'signer_uuid'],
			description:
				'Neynar API key from https://neynar.com and a signer UUID registered with your Farcaster FID. Neynar free tier supports posting.',
		},
		settings: {
			channel_id: { type: 'string', description: 'Farcaster channel to post in (e.g. "dev")' },
			parent_url: { type: 'string', description: 'Parent URL for channel casts' },
		},
		media_types: ['image/jpeg', 'image/png', 'image/gif', 'video/mp4'],
		media_limit: 2,
		x402: {
			amount_usdc: '0.0005',
			description: 'Pay 0.0005 USDC per cast via x402',
		},
	},
	{
		id: 'reddit',
		name: 'Reddit',
		url: 'https://reddit.com',
		content_limit: 40000,
		supports_media: false,
		supports_threads: false,
		supports_scheduling: true,
		credentials: {
			required: ['access_token'],
			optional: ['user_agent'],
			description:
				'Reddit OAuth 2.0 user access token with submit scope. Obtain via https://www.reddit.com/prefs/apps.',
		},
		settings: {
			subreddit: { type: 'string', required: true, description: 'Subreddit name (without r/)' },
			title: { type: 'string', required: true, description: 'Post title (required for Reddit)' },
			kind: {
				type: 'string',
				enum: ['self', 'link'],
				default: 'self',
				description: 'self = text post, link = URL post',
			},
		},
		media_types: [],
		media_limit: 0,
		x402: {
			amount_usdc: '0.0002',
			description: 'Pay 0.0002 USDC per post via x402',
		},
	},
];

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const id = req.query?.id;
	if (id) {
		const platform = PLATFORMS.find((p) => p.id === id);
		if (!platform) {
			const { error } = await import('../_lib/http.js');
			return error(res, 404, 'not_found', `unknown platform: ${id}`);
		}
		return json(res, 200, platform);
	}

	return json(res, 200, {
		platforms: PLATFORMS,
		total: PLATFORMS.length,
	});
});
