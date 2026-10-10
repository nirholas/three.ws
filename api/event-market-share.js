/**
 * GET /api/event-market-share?m=<slug>[&pick=<outcome id>]
 * Wired via vercel.json: /event-markets/<slug> -> this handler.
 *
 * The market page is a client-rendered shell, so its meta cannot vary per market.
 * This is the crawlable front door: per-market Open Graph and Twitter meta pointing
 * at /api/event-market-og (live odds), a real summary for readers without
 * JavaScript, then a hand-off to the SPA at /event-markets/view?m=<slug>.
 * Modeled on api/arena-share.js.
 */

import { cors, wrap } from './_lib/http.js';
import { env } from './_lib/env.js';
import { getMarket } from './_lib/event-markets/index.js';
import { esc, rankedEntrants, pctLabel, shareDescription, timeLine } from './_lib/event-market-card.js';

const CACHE = 'public, max-age=30, s-maxage=60, stale-while-revalidate=600';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
	const ref = (url.searchParams.get('m') || '').trim().slice(0, 100);
	const pickId = (url.searchParams.get('pick') || '').trim().slice(0, 40) || null;
	const origin = env.APP_ORIGIN || 'https://three.ws';
	const view = ref ? await getMarket(ref).catch(() => null) : null;
	if (!view) {
		res.statusCode = 302;
		res.setHeader('location', `${origin}/event-markets`);
		res.setHeader('cache-control', 'no-cache');
		return res.end('');
	}
	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', CACHE);
	res.end(renderHtml(view, { origin, pickId }));
});

function renderHtml(view, { origin, pickId }) {
	const live = `${origin}/event-markets/view?m=${encodeURIComponent(view.slug)}${pickId ? `&pick=${encodeURIComponent(pickId)}` : ''}`;
	const canonical = `${origin}/event-markets/${encodeURIComponent(view.slug)}`;
	const image = `${origin}/api/event-market-og?m=${encodeURIComponent(view.slug)}${pickId ? `&pick=${encodeURIComponent(pickId)}` : ''}`;
	const description = shareDescription(view, { pickId });
	const title = `${view.title} · Event Markets · three.ws`;
	const rows = rankedEntrants(view).slice(0, 5).map((o) => `<li><span class="nm">${esc(o.label)}</span><span class="pc">${esc(pctLabel(o.percent))}</span></li>`).join('\n\t\t');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="three.ws">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(view.title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(view.title)} current odds">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@trythreews">
<meta name="twitter:title" content="${esc(view.title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="#0a0a0a">
<link rel="icon" href="/favicon.ico" sizes="any">
<style>
:root{color-scheme:dark}
body{margin:0;background:#08080b;color:#e5e7eb;font:16px/1.5 Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem 1rem}
main{max-width:660px;width:100%}
.kick{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;margin:0 0 .5rem}
h1{font-size:clamp(1.5rem,5vw,2.2rem);line-height:1.1;margin:0 0 .6rem;color:#f9fafb;overflow-wrap:anywhere}
p.d{color:#9ca3af;margin:0 0 1.4rem}
img.card{width:100%;height:auto;border-radius:12px;border:1px solid #1f2937;margin-bottom:1.4rem}
ul{list-style:none;padding:0;margin:0 0 1.4rem;display:flex;flex-direction:column;gap:.4rem}
li{display:flex;align-items:center;gap:.8rem;padding:.6rem .8rem;border:1px solid #1f2937;border-radius:10px;background:#0e1015}
.nm{font-weight:600;color:#f9fafb;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc{font-variant-numeric:tabular-nums;font-weight:700}
a.go{display:inline-block;background:#e5e7eb;color:#08080b;font-weight:600;text-decoration:none;padding:.7rem 1.1rem;border-radius:10px}
a.go:hover{background:#fff}
</style>
</head>
<body>
<main>
	<p class="kick">three.ws &middot; Event Markets &middot; ${esc(timeLine(view))}</p>
	<h1>${esc(view.title)}</h1>
	<p class="d">${esc(description)}</p>
	<img class="card" src="${esc(image)}" alt="${esc(view.title)} current odds" width="1200" height="630">
	<ul>
		${rows}
	</ul>
	<a class="go" href="${esc(live)}">Open the market</a>
</main>
<script>location.replace(${JSON.stringify(live)});</script>
</body>
</html>`;
}
