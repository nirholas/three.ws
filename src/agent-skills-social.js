/**
 * Social media skill registration for the agent runtime.
 *
 * Registers tools for posting to X (Twitter), Farcaster, and Reddit,
 * with scheduling, analytics, and media upload support.
 */

export function registerSocialSkills(agentSkills) {
	// ── Platforms discovery ────────────────────────────────────────────────
	agentSkills.register({
		name: 'social-platforms',
		description: 'List supported social platforms and their credential requirements.',
		instruction: 'Return supported social platforms, credential requirements, and limits.',
		animationHint: 'think',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Optional: get details for one platform (x, farcaster, reddit)' },
			},
			required: [],
		},
		handler: async (args) => {
			const url = args.id
				? `/api/social/platforms?id=${encodeURIComponent(args.id)}`
				: '/api/social/platforms';
			const resp = await fetch(url);
			const data = await resp.json();
			if (!resp.ok) return { success: false, output: data.error_description || 'Failed to fetch platforms' };
			return { success: true, data, output: JSON.stringify(data, null, 2) };
		},
	});

	// ── Post now or schedule ───────────────────────────────────────────────
	agentSkills.register({
		name: 'social-post',
		description: 'Post to X (Twitter), Farcaster, or Reddit. Supports immediate posting and future scheduling.',
		instruction: 'Post content to a social media platform. Call social-platforms first to see credential requirements.',
		animationHint: 'speak',
		voicePattern: 'Posting to {{platform}}...',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				platform: { type: 'string', enum: ['x', 'farcaster', 'reddit'], description: 'Target platform' },
				content: { type: 'string', description: 'Post text' },
				credentials: {
					type: 'object',
					description:
						'Platform credentials. X: {consumer_key, consumer_secret, access_token, access_secret}. Farcaster: {neynar_key, signer_uuid}. Reddit: {access_token}.',
				},
				media_urls: {
					type: 'array',
					items: { type: 'string' },
					description: 'Optional image/video URLs to attach',
				},
				reply_to: { type: 'string', description: 'Optional: post ID to reply to' },
				schedule_at: {
					type: 'string',
					description: 'Optional ISO timestamp to schedule (e.g. 2026-05-11T09:00:00Z)',
				},
				settings: {
					type: 'object',
					description:
						'Platform-specific settings. Reddit: {subreddit, title, kind}. Farcaster: {channel_id, parent_url}.',
				},
			},
			required: ['platform', 'content', 'credentials'],
		},
		handler: async (args) => {
			const resp = await fetch('/api/social/post', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					platform: args.platform,
					content: args.content,
					credentials: args.credentials,
					media_urls: args.media_urls || [],
					reply_to: args.reply_to,
					schedule_at: args.schedule_at,
					settings: args.settings || {},
				}),
			});
			const data = await resp.json();
			if (!resp.ok) {
				return { success: false, output: data.error_description || 'Post failed', data };
			}
			const action = data.status === 'scheduled' ? 'Scheduled' : 'Posted';
			const detail = data.url ? ` — ${data.url}` : data.schedule_at ? ` for ${data.schedule_at}` : '';
			return {
				success: true,
				data,
				output: `${action} to ${args.platform}${detail}`,
			};
		},
	});

	// ── List posts ─────────────────────────────────────────────────────────
	agentSkills.register({
		name: 'social-list',
		description: 'List scheduled, published, and failed social posts.',
		instruction: 'Return a list of social posts. Filter by status or platform.',
		animationHint: 'think',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				status: { type: 'string', enum: ['scheduled', 'published', 'failed', 'pending'] },
				platform: { type: 'string', enum: ['x', 'farcaster', 'reddit'] },
				limit: { type: 'integer', default: 20 },
				offset: { type: 'integer', default: 0 },
			},
			required: [],
		},
		handler: async (args) => {
			const params = new URLSearchParams();
			if (args.status) params.set('status', args.status);
			if (args.platform) params.set('platform', args.platform);
			if (args.limit) params.set('limit', String(args.limit));
			if (args.offset) params.set('offset', String(args.offset));
			const resp = await fetch(`/api/social/list?${params}`);
			const data = await resp.json();
			if (!resp.ok) return { success: false, output: data.error_description || 'Failed to list posts' };
			return { success: true, data, output: `Found ${data.total} posts` };
		},
	});

	// ── Cancel scheduled post ──────────────────────────────────────────────
	agentSkills.register({
		name: 'social-cancel',
		description: 'Cancel a scheduled social post before it is published.',
		instruction: 'Cancel a scheduled post by ID.',
		animationHint: 'think',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Post ID to cancel' },
			},
			required: ['id'],
		},
		handler: async (args) => {
			const resp = await fetch(`/api/social/${encodeURIComponent(args.id)}`, { method: 'DELETE' });
			const data = await resp.json();
			if (!resp.ok) return { success: false, output: data.error_description || 'Cancel failed' };
			return { success: true, data, output: `Post ${args.id} cancelled` };
		},
	});

	// ── Analytics + price correlation ──────────────────────────────────────
	agentSkills.register({
		name: 'social-analytics',
		description:
			'Get post analytics. Pass post_url + mint to correlate a tweet with Pump.fun token price movement.',
		instruction:
			'Return analytics for a post or aggregate stats. Correlate X posts with on-chain token prices.',
		animationHint: 'think',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				post_id: { type: 'string', description: 'Post DB ID for engagement analytics' },
				post_url: { type: 'string', description: 'X post URL for price correlation' },
				mint: { type: 'string', description: 'Pump.fun token mint for price correlation' },
				window_min: { type: 'integer', default: 30 },
				platform: { type: 'string' },
				days: { type: 'integer', default: 7 },
			},
			required: [],
		},
		handler: async (args) => {
			const params = new URLSearchParams();
			if (args.post_id) params.set('post_id', args.post_id);
			if (args.post_url) params.set('post_url', args.post_url);
			if (args.mint) params.set('mint', args.mint);
			if (args.window_min) params.set('window_min', String(args.window_min));
			if (args.platform) params.set('platform', args.platform);
			if (args.days) params.set('days', String(args.days));
			const resp = await fetch(`/api/social/analytics?${params}`);
			const data = await resp.json();
			if (!resp.ok) return { success: false, output: data.error_description || 'Analytics failed' };
			return {
				success: true,
				data,
				output: data.summary || JSON.stringify(data, null, 2),
			};
		},
	});
}
