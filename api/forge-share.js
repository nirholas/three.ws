/**
 * SSR share page for forge creations
 * ------------------------------------
 * GET /api/forge-share?id=<creation_id>
 *
 * Wired via vercel.json: /forge/share/:id → /api/forge-share?id=$1
 *
 * Bakes Open Graph + Twitter Card + Farcaster Frame meta into the <head>
 * so social crawlers get a real preview. Real browsers are JS-redirected
 * to /forge?share=<id> so they can view the creation in the full forge UI.
 *
 * Mirrors the pattern in api/app-og.js and api/discover-detail.js.
 */

import { sql } from './_lib/db.js';
import { cors, wrap } from './_lib/http.js';
import { env } from './_lib/env.js';
import { isUuid } from './_lib/validate.js';
import { scriptJson } from './_lib/safe-text.js';
import { creationJsonLd, renderPosterUrl, renderableGlb } from './_lib/creation-jsonld.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;

	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id');
	const origin = env.APP_ORIGIN || 'https://three.ws';

	if (!id || !isUuid(id)) {
		return redirect(res, `${origin}/forge`);
	}

	let row;
	try {
		// Private creations stay private: the same visibility rule as the
		// public read (getPublicCreation in api/_lib/forge-store.js).
		[row] = await sql`
			SELECT fc.id, fc.prompt, fc.preview_image_url, fc.status,
			       fc.glb_url, fc.web_glb_url, fc.web_size_bytes, fc.size_bytes,
			       fc.model_category, fc.created_at,
			       u.username AS creator_username, u.display_name AS creator_display_name
			FROM forge_creations fc
			LEFT JOIN users u ON u.id = fc.user_id AND u.deleted_at IS NULL
			WHERE fc.id = ${id}
			  AND (fc.visibility IS NULL OR fc.visibility IN ('public', 'unlisted'))
			LIMIT 1
		`;
	} catch {
		return redirect(res, `${origin}/forge`);
	}

	if (!row) return redirect(res, `${origin}/forge`);

	const title = row.prompt ? truncate(row.prompt, 80) : 'Forged creation';
	const desc = `3D model forged from text on three.ws: "${title}"`;
	const pageUrl = `${origin}/forge/share/${id}`;
	const forgeUrl = `${origin}/forge?share=${id}`;
	const finished = row.status === 'done' && Boolean(row.glb_url);
	const posterGlb = finished
		? renderableGlb([
				{ url: row.web_glb_url, sizeBytes: row.web_size_bytes },
				{ url: row.glb_url, sizeBytes: row.size_bytes },
			])
		: null;
	const poster = posterGlb ? renderPosterUrl(origin, posterGlb) : null;
	const ogImage = row.preview_image_url || poster || `${origin}/api/forge-og?id=${id}`;
	// Machine-readable description of the creation: the GLB, its render, the
	// creator when signed in, the date and the terms (api/_lib/creation-jsonld.js).
	const jsonLd = creationJsonLd({
		origin,
		pageUrl,
		name: title,
		description: desc,
		glbUrl: finished ? row.glb_url : null,
		glbSizeBytes: row.size_bytes,
		thumbnailUrl: poster || row.preview_image_url || null,
		image: ogImage,
		creator: row.creator_username
			? { username: row.creator_username, displayName: row.creator_display_name }
			: null,
		dateCreated: row.created_at,
		extra: { sameAs: `${origin}/m/${id}` },
	});
	// oEmbed discovery — /api/oembed resolves this exact shareUrl (extractForgeId
	// in api/agent-oembed.js) so Notion/Webflow/Discord auto-embed a live 3D
	// viewer when this URL is pasted, no manual snippet needed.
	const oembedJsonUrl = `${origin}/api/oembed?url=${encodeURIComponent(pageUrl)}&format=json`;

	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600');
	res.end(renderHtml({ id, title, desc, pageUrl, forgeUrl, ogImage, origin, oembedJsonUrl, jsonLd }));
});

function redirect(res, to) {
	res.statusCode = 302;
	res.setHeader('location', to);
	res.setHeader('cache-control', 'no-cache');
	res.end();
}

function renderHtml({ id, title, desc, pageUrl, forgeUrl, ogImage, origin, oembedJsonUrl, jsonLd }) {
	const t = esc(title);
	const d = esc(desc);
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta http-equiv="X-UA-Compatible" content="IE=edge">
	<title>${t} — three.ws Forge</title>
	<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
	<meta name="description" content="${d}">
	<meta name="theme-color" content="#0b0d10">

	<meta property="og:type" content="website">
	<meta property="og:site_name" content="three.ws">
	<meta property="og:title" content="${t} — three.ws Forge">
	<meta property="og:description" content="${d}">
	<meta property="og:url" content="${esc(pageUrl)}">
	<meta property="og:image" content="${esc(ogImage)}">
	<meta property="og:image:width" content="1200">
	<meta property="og:image:height" content="630">
	<meta property="og:image:alt" content="${t} forged on three.ws">

	<meta name="twitter:card" content="summary_large_image">
	<meta name="twitter:title" content="${t} — three.ws Forge">
	<meta name="twitter:description" content="${d}">
	<meta name="twitter:image" content="${esc(ogImage)}">
	<meta name="twitter:creator" content="@trythreews">

	<meta property="fc:frame" content="vNext">
	<meta property="fc:frame:image" content="${esc(ogImage)}">
	<meta property="fc:frame:image:aspect_ratio" content="1.91:1">
	<meta property="fc:frame:button:1" content="Forge your own →">
	<meta property="fc:frame:button:1:action" content="link">
	<meta property="fc:frame:button:1:target" content="${esc(forgeUrl)}">

	<link rel="canonical" href="${esc(pageUrl)}">
	<link rel="alternate" type="application/json+oembed" href="${esc(oembedJsonUrl)}" title="${t} oEmbed">
	<link rel="shortcut icon" href="/favicon.ico">
	<script type="application/ld+json">${scriptJson({ '@context': 'https://schema.org', '@graph': [jsonLd] })}</script>

	<style>
		html,body{margin:0;padding:0;background:#0b0d10;color:#e0e0e0;font-family:Inter,system-ui,sans-serif;height:100%}
		.shell{display:grid;place-items:center;min-height:100vh;text-align:center;padding:2rem;gap:1rem}
		.shell a{color:#e0e0e0;text-decoration:underline;text-underline-offset:3px}
		.spinner{width:28px;height:28px;border:2px solid rgba(255,255,255,0.1);border-top-color:rgba(255,255,255,0.6);border-radius:50%;animation:spin 0.9s linear infinite;margin:0 auto}
		@keyframes spin{to{transform:rotate(360deg)}}
		p{margin:0;color:rgba(255,255,255,0.5);font-size:14px}
	</style>
</head>
<body>
	<noscript>
		<div class="shell">
			<h1>${t}</h1>
			<p>${d}</p>
			<p><a href="${esc(forgeUrl)}">Open in Forge</a> · <a href="${esc(origin)}/forge">Browse Forge</a></p>
		</div>
	</noscript>
	<div class="shell" aria-live="polite">
		<div class="spinner" aria-hidden="true"></div>
		<p>Opening Forge…</p>
	</div>
	<script>(function(){window.location.replace(${JSON.stringify(forgeUrl)});})()</script>
</body>
</html>`;
}

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function truncate(s, n) {
	s = String(s || '');
	return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
