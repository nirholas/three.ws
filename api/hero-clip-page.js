// GET /api/hero-clip-page?id=<xai request id>
//
// Wired via vercel.json: /hero-clip/:id → /api/hero-clip-page?id=$1
//
// The public page for a finished hero clip (docs/hero-clips.md): the clip
// plays inline, the Open Graph and X card tags carry the first-frame render as
// the preview image and the MP4 as og:video, and the page links back to the 3D
// model it was made from. Everything on it comes from the stored object and its
// metadata, written once by api/_lib/xai-video.js storeVideo, so the page needs
// no database and keeps working long after xAI's own URL has expired.

import { cors, wrap } from './_lib/http.js';
import { env } from './_lib/env.js';
import { headObject, cdnUrl } from './_lib/r2.js';
import { clipKey } from './_lib/xai-video.js';
import { heroClipPreset, clipPagePath, subjectHint } from './_lib/hero-clip.js';
import { xIntentUrl } from '../src/shared/share-targets.js';

const ID_RE = /^[A-Za-z0-9-]{8,80}$/;
const SOURCE_PAGE_RE = /^\/(?:m|avatars)\/[A-Za-z0-9_-]{1,80}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,HEAD,OPTIONS' })) return;
	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id') || '';
	const origin = env.APP_ORIGIN || 'https://three.ws';

	if (!ID_RE.test(id)) return notFound(res, origin);
	const key = clipKey(id);
	const head = await headObject(key);
	if (!head) return notFound(res, origin);

	const clip = clipFromHead({ id, head, origin, videoUrl: cdnUrl(key) });
	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	// A stored clip never changes, so the page can sit at the edge for a day.
	res.setHeader('cache-control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
	res.end(renderClipPage(clip));
});

function decode(value) {
	try {
		return decodeURIComponent(String(value ?? ''));
	} catch {
		return '';
	}
}

/** The page model for a stored clip, from its object metadata. */
export function clipFromHead({ id, head, origin, videoUrl }) {
	const meta = head?.Metadata || {};
	const title = subjectHint(decode(meta.title)) || 'A 3D model';
	const preset = heroClipPreset(meta.preset);
	const sourcePage = SOURCE_PAGE_RE.test(meta.source_page || '') ? meta.source_page : null;
	const poster = typeof meta.poster === 'string' && meta.poster.startsWith(`${origin}/api/render/glb?`) ? meta.poster : null;
	const duration = Number(meta.duration);
	return {
		id,
		title,
		presetLabel: preset?.label || 'Hero clip',
		videoUrl,
		poster,
		sourceUrl: sourcePage ? `${origin}${sourcePage}` : null,
		pageUrl: `${origin}${clipPagePath(id)}`,
		duration: Number.isFinite(duration) && duration > 0 ? duration : null,
		bytes: Number(head?.ContentLength) || null,
		createdAt: head?.LastModified ? new Date(head.LastModified).toISOString() : null,
		origin,
	};
}

function esc(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

const STYLE = `
	:root{--bg:#0b0d10;--panel:#14171c;--line:rgba(255,255,255,.1);--text:#e8eaed;--muted:rgba(232,234,237,.62);--accent:#7aa7ff}
	*{box-sizing:border-box}
	html,body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,sans-serif}
	main{max-width:960px;margin:0 auto;padding:clamp(16px,4vw,40px) 16px 48px;display:grid;gap:20px}
	.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0}
	h1{font-size:clamp(22px,3.4vw,32px);line-height:1.2;margin:4px 0 0}
	.frame{background:#000;border:1px solid var(--line);border-radius:14px;overflow:hidden;aspect-ratio:16/9}
	video{display:block;width:100%;height:100%;object-fit:contain;background:#000}
	.meta{color:var(--muted);font-size:14px;margin:0}
	.actions{display:flex;flex-wrap:wrap;gap:10px}
	.btn{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 16px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text);font:inherit;font-size:14px;font-weight:500;text-decoration:none;cursor:pointer;transition:background .15s ease,border-color .15s ease,transform .1s ease}
	.btn:hover{background:#1c2027;border-color:rgba(255,255,255,.22)}
	.btn:active{transform:translateY(1px)}
	.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
	.btn--primary{background:var(--accent);border-color:var(--accent);color:#0b0d10}
	.btn--primary:hover{background:#9bbcff;border-color:#9bbcff}
	.empty{min-height:70vh;display:grid;place-content:center;text-align:center;gap:14px}
	.empty p{color:var(--muted);margin:0;max-width:44ch}
`;

/** The HTML for a stored clip. */
export function renderClipPage(c) {
	const title = `${c.title}: ${c.presetLabel}`;
	const desc = `A ${c.duration ? `${c.duration} second ` : ''}hero clip made from real renders of this 3D model on three.ws.`;
	const shareHref = xIntentUrl({ text: `${c.title}, a hero clip made from a 3D model on three.ws`, url: c.pageUrl });
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>${esc(title)} | three.ws</title>
	<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
	<meta name="description" content="${esc(desc)}">
	<meta name="theme-color" content="#0b0d10">
	<meta property="og:type" content="video.other">
	<meta property="og:site_name" content="three.ws">
	<meta property="og:title" content="${esc(title)}">
	<meta property="og:description" content="${esc(desc)}">
	<meta property="og:url" content="${esc(c.pageUrl)}">
${c.poster ? `	<meta property="og:image" content="${esc(c.poster)}">\n	<meta property="og:image:width" content="1280">\n	<meta property="og:image:height" content="720">\n` : ''}	<meta property="og:video" content="${esc(c.videoUrl)}">
	<meta property="og:video:secure_url" content="${esc(c.videoUrl)}">
	<meta property="og:video:type" content="video/mp4">
	<meta property="og:video:width" content="1280">
	<meta property="og:video:height" content="720">
	<meta name="twitter:card" content="summary_large_image">
	<meta name="twitter:site" content="@trythreews">
	<meta name="twitter:title" content="${esc(title)}">
	<meta name="twitter:description" content="${esc(desc)}">
${c.poster ? `	<meta name="twitter:image" content="${esc(c.poster)}">\n` : ''}	<link rel="canonical" href="${esc(c.pageUrl)}">
	<link rel="shortcut icon" href="/favicon.ico">
	<style>${STYLE}</style>
</head>
<body>
	<main>
		<header>
			<p class="eyebrow">${esc(c.presetLabel)}</p>
			<h1>${esc(c.title)}</h1>
		</header>
		<div class="frame">
			<video src="${esc(c.videoUrl)}"${c.poster ? ` poster="${esc(c.poster)}"` : ''} controls autoplay muted loop playsinline preload="metadata" aria-label="${esc(title)}"></video>
		</div>
		<p class="meta">Made with Grok Imagine Video from real renders of the 3D model${c.duration ? `. ${c.duration} seconds` : ''}${c.createdAt ? `, ${esc(c.createdAt.slice(0, 10))}` : ''}.</p>
		<div class="actions">
${c.sourceUrl ? `			<a class="btn btn--primary" href="${esc(c.sourceUrl)}">Open the 3D model</a>\n` : ''}			<a class="btn" href="${esc(c.videoUrl)}" download="hero-clip-${esc(c.id)}.mp4">Download MP4</a>
			<a class="btn" href="${esc(shareHref)}" target="_blank" rel="noopener">Share to X</a>
			<a class="btn" href="${esc(c.origin)}/forge">Make your own 3D model</a>
		</div>
	</main>
</body>
</html>`;
}

function notFound(res, origin) {
	res.statusCode = 404;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	// Short: a clip still being made gets its page within a minute or two.
	res.setHeader('cache-control', 'public, max-age=30, s-maxage=60');
	res.end(`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>Hero clip not found | three.ws</title>
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta name="robots" content="noindex">
	<style>${STYLE}</style>
</head>
<body>
	<main class="empty">
		<h1>This hero clip is not here</h1>
		<p>It may still be rendering (most clips finish in under two minutes), or the link is incomplete. Clips are made from the Make a hero clip button on any 3D model page.</p>
		<div class="actions" style="justify-content:center">
			<a class="btn btn--primary" href="${esc(origin)}/forge">Make a 3D model</a>
			<a class="btn" href="${esc(origin)}/">three.ws home</a>
		</div>
	</main>
</body>
</html>`);
}
