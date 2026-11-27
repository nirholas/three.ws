/**
 * Forge creation OG image
 * -----------------------
 * GET /api/forge-og?id=<creation_id>
 *
 * Happy path: 302 to the creation's preview_image_url (the flux-generated
 * reference image) so social crawlers cache a real thumbnail. Fallback: a
 * server-rendered SVG card in the same style as api/agent-og.js so every
 * forge share link gets a real og:image.
 *
 * No client-key auth: if a creator has the ID they've chosen to share it.
 * UUIDs are unguessable by construction. A private model (which is what a
 * content-safety block forces) answers the generic card, the same visibility
 * rule as the share page (api/forge-share.js) and the public read.
 */

import { sql } from './_lib/db.js';
import { cors, wrap } from './_lib/http.js';
import { isUuid } from './_lib/validate.js';

const CACHE_CARD = 'public, max-age=3600, s-maxage=86400';
const CACHE_REDIR = 'public, max-age=3600';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;

	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id');

	if (!id || !isUuid(id)) return sendFallback(res);

	let row;
	try {
		[row] = await sql`
			SELECT id, prompt, preview_image_url
			FROM forge_creations
			WHERE id = ${id}
			  AND (visibility IS NULL OR visibility IN ('public', 'unlisted'))
			LIMIT 1
		`;
	} catch {
		return sendFallback(res);
	}

	if (!row) return sendFallback(res);

	if (row.preview_image_url) {
		res.statusCode = 302;
		res.setHeader('location', row.preview_image_url);
		res.setHeader('cache-control', CACHE_REDIR);
		res.end();
		return;
	}

	sendCardSvg(res, 200, CACHE_CARD, {
		prompt: row.prompt || 'Forged creation',
	});
});

function sendFallback(res) {
	sendCardSvg(res, 404, 'public, max-age=60', { prompt: 'Forged with three.ws' });
}

function sendCardSvg(res, status, cacheControl, { prompt }) {
	res.statusCode = status;
	res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
	res.setHeader('cache-control', cacheControl);
	res.end(renderCardSvg({ prompt }));
}

function renderCardSvg({ prompt }) {
	const safePrompt = escapeXml(truncate(prompt, 80));
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${safePrompt}">
	<rect width="1200" height="630" fill="#0b0d10"/>
	<text x="80" y="140" fill="#e5e5e5" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="52" font-weight="300">◳</text>
	<text x="80" y="300" fill="#e5e5e5" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="68" font-weight="300" letter-spacing="-2">${safePrompt}</text>
	<text x="80" y="380" fill="rgba(229,229,229,0.45)" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="24" font-weight="400">Forged with text → 3D on three.ws</text>
	<text x="80" y="570" fill="rgba(229,229,229,0.3)" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="20" font-weight="400" letter-spacing="4">three.ws / forge</text>
</svg>`;
}

function truncate(s, n) {
	s = String(s || '');
	return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function escapeXml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

