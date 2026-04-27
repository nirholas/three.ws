/**
 * oEmbed endpoint for agent URLs
 * ------------------------------
 * GET /api/oembed?url=<agent-url>[&format=json|xml]
 *
 * Implements https://oembed.com with type=rich. The html payload is a
 * sandboxed iframe pointing at /agent/:id/embed so consumers (Notion,
 * Discord, etc.) can render the agent inline.
 */

import { sql } from './_lib/db.js';
import { env } from './_lib/env.js';
import { cors, wrap, error } from './_lib/http.js';
import { resolveOnChainAgent, SERVER_CHAIN_META } from './_lib/onchain.js';

const WIDTH = 420;
const HEIGHT = 520;
const THUMB_WIDTH = 1200;
const THUMB_HEIGHT = 630;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;

	const url = new URL(req.url, 'http://x');
	const target = url.searchParams.get('url');
	const format = (url.searchParams.get('format') || 'json').toLowerCase();

	if (!target) return error(res, 400, 'invalid_request', 'url parameter required');

	const onchain = extractOnChain(target);
	if (onchain) return sendOnChain(res, format, onchain);

	const agentId = extractAgentId(target);
	if (!agentId) return error(res, 404, 'not_found', 'url is not a recognised agent url');

	const [agent] = await sql`
		SELECT id, name, description, avatar_id
		FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
		LIMIT 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	const origin = env.APP_ORIGIN;
	const embedUrl = `${origin}/agent/${agent.id}/embed`;
	const agentUrl = `${origin}/agent/${agent.id}`;
	const thumbUrl = `${origin}/api/agent/${agent.id}/og`;
	const title = agent.name || 'Agent';

	const iframe = `<iframe src="${escapeAttr(embedUrl)}" width="${WIDTH}" height="${HEIGHT}" style="border:0;border-radius:12px" allow="autoplay; xr-spatial-tracking" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`;

	const payload = {
		type: 'rich',
		version: '1.0',
		provider_name: 'three.ws',
		provider_url: origin,
		title,
		author_name: title,
		author_url: agentUrl,
		html: iframe,
		width: WIDTH,
		height: HEIGHT,
		thumbnail_url: thumbUrl,
		thumbnail_width: THUMB_WIDTH,
		thumbnail_height: THUMB_HEIGHT,
	};

	res.setHeader('cache-control', 'public, max-age=900');

	if (format === 'xml') {
		res.statusCode = 200;
		res.setHeader('content-type', 'text/xml; charset=utf-8');
		res.end(toXml(payload));
		return;
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'application/json+oembed; charset=utf-8');
	res.end(JSON.stringify(payload));
});

function extractAgentId(target) {
	let parsed;
	try {
		parsed = new URL(target);
	} catch {
		return null;
	}

	const originStr = `${parsed.protocol}//${parsed.host}`;
	const okOrigin =
		originStr === env.APP_ORIGIN || /^https?:\/\/localhost(:\d+)?$/.test(originStr);
	if (!okOrigin) return null;

	const match = parsed.pathname.match(/^\/agent\/([A-Za-z0-9_-]+)\/?$/);
	return match ? match[1] : null;
}

function extractOnChain(target) {
	let parsed;
	try {
		parsed = new URL(target);
	} catch {
		return null;
	}

	const originStr = `${parsed.protocol}//${parsed.host}`;
	const okOrigin =
		originStr === env.APP_ORIGIN || /^https?:\/\/localhost(:\d+)?$/.test(originStr);
	if (!okOrigin) return null;

	const match = parsed.pathname.match(/^\/a\/(\d+)\/(\d+)\/?$/);
	if (!match) return null;
	const chainId = Number(match[1]);
	const agentId = match[2];
	if (!SERVER_CHAIN_META[chainId]) return null;
	return { chainId, agentId };
}

async function sendOnChain(res, format, { chainId, agentId }) {
	const agent = await resolveOnChainAgent({ chainId, agentId });
	if (agent.error && agent.error.startsWith('chain_read')) {
		return error(res, 404, 'not_found', `agent #${agentId} not found on chain ${chainId}`);
	}

	const origin = env.APP_ORIGIN;
	const pageUrl = `${origin}/a/${chainId}/${agentId}`;
	const embedUrl = `${origin}/a/${chainId}/${agentId}/embed`;
	const thumbUrl = `${origin}/api/a-og?chain=${chainId}&id=${encodeURIComponent(agentId)}`;
	const title = agent.name || `Agent #${agentId}`;

	const iframe = `<iframe src="${escapeAttr(embedUrl)}" width="${WIDTH}" height="${HEIGHT}" style="border:0;border-radius:12px" allow="autoplay; xr-spatial-tracking" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`;

	const payload = {
		type: 'rich',
		version: '1.0',
		provider_name: 'three.ws',
		provider_url: origin,
		title,
		author_name: title,
		author_url: pageUrl,
		html: iframe,
		width: WIDTH,
		height: HEIGHT,
		thumbnail_url: thumbUrl,
		thumbnail_width: THUMB_WIDTH,
		thumbnail_height: THUMB_HEIGHT,
	};

	res.setHeader('cache-control', 'public, max-age=900');

	if (format === 'xml') {
		res.statusCode = 200;
		res.setHeader('content-type', 'text/xml; charset=utf-8');
		res.end(toXml(payload));
		return;
	}
	res.statusCode = 200;
	res.setHeader('content-type', 'application/json+oembed; charset=utf-8');
	res.end(JSON.stringify(payload));
}

function toXml(payload) {
	const lines = Object.entries(payload).map(([k, v]) => `  <${k}>${escapeXml(String(v))}</${k}>`);
	return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<oembed>\n${lines.join('\n')}\n</oembed>`;
}

function escapeXml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function escapeAttr(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
