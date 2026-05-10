/**
 * Avatar OG image endpoint
 * ------------------------
 * GET /api/avatar/:id/og
 *
 * Strategy: prefer a real PNG (avatar's R2-hosted thumbnail) when one exists,
 * fall back to a rich SVG card otherwise. Slack/X/Discord all accept
 * image/svg+xml for OG images, so the fallback never reaches a renderer.
 *
 * Demo avatars (avatar_demo_*) are seeded fixtures and have no thumbnails —
 * they always get the SVG card, which still includes the avatar name,
 * description, attribution, and a 3D-themed gradient backdrop.
 */

import { getAvatar } from './_lib/avatars.js';
import { DEMO_AVATARS } from './_lib/demo-avatars.js';
import { cors, wrap } from './_lib/http.js';

const CACHE_CARD_OK = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const CACHE_CARD_404 = 'public, max-age=60';
const CACHE_REDIR = 'public, max-age=3600';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;

	const url = new URL(req.url, 'http://x');
	const avatarId = url.searchParams.get('id') || extractIdFromPath(url.pathname);

	if (!avatarId) {
		return sendCardSvg(res, 404, CACHE_CARD_404, {
			name: 'Avatar not found',
			description: '',
		});
	}

	// Demo fixtures live in DEMO_AVATARS, not the DB.
	if (avatarId.startsWith('avatar_demo_')) {
		const demo = DEMO_AVATARS.find((a) => a.avatarId === avatarId);
		if (!demo) {
			return sendCardSvg(res, 404, CACHE_CARD_404, {
				name: 'Avatar not found',
				description: '',
			});
		}
		return sendCardSvg(res, 200, CACHE_CARD_OK, {
			name: demo.name,
			description: demo.description,
			attribution: demo.attribution?.displayName,
			tags: demo.tags || [],
		});
	}

	const avatar = await getAvatar({ id: avatarId });
	if (!avatar) {
		return sendCardSvg(res, 404, CACHE_CARD_404, {
			name: 'Avatar not found',
			description: '',
		});
	}

	if (avatar.thumbnail_url) {
		res.statusCode = 302;
		res.setHeader('location', avatar.thumbnail_url);
		res.setHeader('cache-control', CACHE_REDIR);
		res.end();
		return;
	}

	return sendCardSvg(res, 200, CACHE_CARD_OK, {
		name: avatar.name || 'Avatar',
		description: avatar.description || 'A 3D avatar on three.ws',
		tags: avatar.tags || [],
	});
});

// Vercel routes /api/avatar/:id/og → here. Read the id from the URL path
// when the rewrite leaves it as a path segment instead of a query param.
function extractIdFromPath(pathname) {
	const m = pathname.match(/\/api\/avatar(?:s)?\/([^/]+)\/og$/);
	return m ? m[1] : null;
}

function sendCardSvg(res, status, cacheControl, payload) {
	res.statusCode = status;
	res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
	res.setHeader('cache-control', cacheControl);
	res.end(renderCardSvg(payload));
}

function renderCardSvg({ name, description, attribution, tags = [] }) {
	const safeName = escapeXml(truncate(name, 60));
	const safeDesc = escapeXml(truncate(description, 160));
	const safeAttr = attribution ? escapeXml(truncate(attribution, 40)) : '';
	const tagPills = tags.slice(0, 4).map((t, i) => {
		const x = 80 + i * 120;
		const w = Math.min(110, 24 + escapeXml(t).length * 11);
		return `
			<rect x="${x}" y="450" width="${w}" height="36" rx="18" fill="rgba(125,211,252,0.12)" stroke="rgba(125,211,252,0.3)" stroke-width="1.2"/>
			<text x="${x + w / 2}" y="475" text-anchor="middle" fill="#7dd3fc" font-family="Inter, sans-serif" font-size="16" font-weight="600">${escapeXml(t).slice(0, 14)}</text>`;
	}).join('');
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${safeName}">
	<defs>
		<radialGradient id="bg-cyan" cx="85%" cy="20%" r="60%">
			<stop offset="0%" stop-color="rgba(125,211,252,0.18)"/>
			<stop offset="100%" stop-color="rgba(125,211,252,0)"/>
		</radialGradient>
		<radialGradient id="bg-purple" cx="15%" cy="80%" r="55%">
			<stop offset="0%" stop-color="rgba(167,139,250,0.14)"/>
			<stop offset="100%" stop-color="rgba(167,139,250,0)"/>
		</radialGradient>
		<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0%" stop-color="#7dd3fc"/>
			<stop offset="100%" stop-color="#a78bfa"/>
		</linearGradient>
	</defs>
	<rect width="1200" height="630" fill="#0a0a0a"/>
	<rect width="1200" height="630" fill="url(#bg-cyan)"/>
	<rect width="1200" height="630" fill="url(#bg-purple)"/>
	<rect x="0" y="0" width="6" height="630" fill="url(#accent)"/>
	<text x="80" y="120" fill="#7dd3fc" font-family="Inter, sans-serif" font-size="14" font-weight="600" letter-spacing="3">COMMUNITY · 3D AVATAR</text>
	<text x="80" y="270" fill="#fafafa" font-family="'Space Grotesk', Inter, sans-serif" font-size="92" font-weight="700" letter-spacing="-2">${safeName}</text>
	<text x="80" y="340" fill="rgba(250,250,250,0.65)" font-family="Inter, sans-serif" font-size="26" font-weight="400">${safeDesc}</text>
	${tagPills}
	${safeAttr ? `<text x="80" y="555" fill="rgba(250,250,250,0.4)" font-family="Inter, sans-serif" font-size="18" font-weight="400">by ${safeAttr}</text>` : ''}
	<text x="1120" y="585" text-anchor="end" fill="rgba(250,250,250,0.35)" font-family="Inter, sans-serif" font-size="20" font-weight="500" letter-spacing="3">three.ws</text>
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
