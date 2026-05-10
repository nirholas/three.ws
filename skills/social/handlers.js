/**
 * Agent Social skill handlers.
 * Runs in a sandboxed Web Worker via ctx.fetch — never touches DOM or window.
 */

const BASE = '/api/social';

export async function social_platforms(args, ctx) {
	const url = args.id ? `${BASE}/platforms?id=${encodeURIComponent(args.id)}` : `${BASE}/platforms`;
	const resp = await ctx.fetch(url);
	return resp.json();
}

export async function social_post(args, ctx) {
	const resp = await ctx.fetch(`${BASE}/post`, {
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
			agent_id: args.agent_id,
		}),
	});
	return resp.json();
}

export async function social_list(args, ctx) {
	const params = new URLSearchParams();
	if (args.status) params.set('status', args.status);
	if (args.platform) params.set('platform', args.platform);
	if (args.agent_id) params.set('agent_id', args.agent_id);
	if (args.limit) params.set('limit', String(args.limit));
	if (args.offset) params.set('offset', String(args.offset));
	const resp = await ctx.fetch(`${BASE}/list?${params}`);
	return resp.json();
}

export async function social_get(args, ctx) {
	const resp = await ctx.fetch(`${BASE}/${encodeURIComponent(args.id)}`);
	return resp.json();
}

export async function social_cancel(args, ctx) {
	const resp = await ctx.fetch(`${BASE}/${encodeURIComponent(args.id)}`, { method: 'DELETE' });
	return resp.json();
}

export async function social_analytics(args, ctx) {
	const params = new URLSearchParams();
	if (args.post_id) params.set('post_id', args.post_id);
	if (args.post_url) params.set('post_url', args.post_url);
	if (args.mint) params.set('mint', args.mint);
	if (args.window_min) params.set('window_min', String(args.window_min));
	if (args.platform) params.set('platform', args.platform);
	if (args.agent_id) params.set('agent_id', args.agent_id);
	if (args.days) params.set('days', String(args.days));
	const resp = await ctx.fetch(`${BASE}/analytics?${params}`);
	return resp.json();
}

export async function social_upload(args, ctx) {
	// Inform the calling agent to do a direct multipart upload to /api/social/upload.
	// The sandbox cannot stream binary files, so we return the endpoint URL and
	// instructions for the agent to call it directly from outside the sandbox.
	return {
		upload_endpoint: `${BASE}/upload`,
		method: 'POST',
		content_type_header: 'multipart/form-data',
		field_name: 'file',
		note: 'POST your file as multipart/form-data with field name "file". The response includes the public URL to use in media_urls.',
	};
}
