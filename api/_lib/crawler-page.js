/**
 * Server-rendered entity pages for crawlers.
 * -----------------------------------------
 * /avatars/:id and /agents/:id are single-page-app routes: the HTML a browser
 * receives is an empty shell and the entity is fetched client-side. vercel.json
 * routes known bot User-Agents to an SSR handler instead so a shared link
 * unfurls, and so a search engine has something to index.
 *
 * The first version of that SSR page carried only <meta> tags: the visible body
 * was a spinner, the words lived inside <noscript>, and the last line was
 * `location.replace(<this same URL>)`. That combination is invisible to a
 * search engine in the worst possible way:
 *
 *   - A rendering crawler (Googlebot, bingbot, Applebot) runs the script. The
 *     replace() targets the URL it is already on and the UA still matches the
 *     bot branch, so the response is byte-identical and the navigation repeats:
 *     a self-reload loop, and a URL the crawler may bucket as a redirect.
 *   - Rendering also drops <noscript>, so the only real text on the page is
 *     removed before indexing. Every entity URL then renders as the same
 *     spinner over the same "Loading…" line, i.e. one duplicate cluster tens of
 *     thousands of pages wide with no unique content to tell them apart.
 *
 * So the renderers here put the entity's real content in the body, and the
 * self-redirect is emitted only for crawlers that never index (link unfurlers
 * like Embedly or Iframely, where bouncing a human who arrives with a scraper
 * UA is still the friendly outcome). Search engines get content and no script.
 *
 * Content parity is what keeps this out of cloaking territory: a crawler sees
 * the same name, description, tags, owner, and imagery the interactive page
 * shows, minus the WebGL viewport it cannot run.
 */

// Crawlers that index (and, for the big three, render JS before indexing).
// These must never be handed a self-redirect or a content-free body.
const SEARCH_CRAWLERS =
	/(Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google|Google-Extended|bingbot|BingPreview|Applebot|DuckDuckBot|DuckAssistBot|YandexBot|Baiduspider|PetalBot|SeznamBot|Amazonbot|Bytespider|CCBot|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|Claude-User|PerplexityBot|Perplexity-User|MistralAI-User|cohere-ai|YouBot)/i;

/**
 * True when this User-Agent belongs to a crawler that builds a search or
 * answer index, as opposed to a scraper that only wants unfurl metadata.
 *
 * @param {string|undefined|null} ua
 * @returns {boolean}
 */
export function isSearchCrawler(ua) {
	return SEARCH_CRAWLERS.test(String(ua || ''));
}

/** HTML-escape a value for use in text or a double-quoted attribute. */
export function esc(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

// One stylesheet for every crawler page. Inline because the page must be
// self-contained: it is served from an /api route and a crawler that fetches
// no subresources should still get a page that reads correctly.
const STYLES = `
	:root{color-scheme:dark}
	*,*::before,*::after{box-sizing:border-box}
	html,body{margin:0;padding:0;background:#06070a;color:#e7e9ee;
		font:16px/1.6 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
		-webkit-font-smoothing:antialiased}
	a{color:#9fd0ff;text-decoration:none}
	a:hover,a:focus-visible{text-decoration:underline;text-underline-offset:3px}
	a:focus-visible{outline:2px solid #9fd0ff;outline-offset:3px;border-radius:4px}
	main{max-width:56rem;margin:0 auto;padding:3rem 1.25rem 4rem}
	nav[aria-label="Breadcrumb"]{font-size:.8125rem;color:#8b93a7;margin-bottom:1.5rem}
	nav[aria-label="Breadcrumb"] ol{list-style:none;display:flex;flex-wrap:wrap;gap:.5rem;margin:0;padding:0}
	nav[aria-label="Breadcrumb"] li+li::before{content:"/";margin-right:.5rem;color:#4a5164}
	h1{font-size:clamp(1.75rem,4vw,2.5rem);line-height:1.15;margin:0 0 .75rem;letter-spacing:-.02em}
	.lede{font-size:1.0625rem;color:#b6bccb;margin:0 0 2rem;max-width:44rem}
	.card{display:block;width:100%;max-width:40rem;height:auto;aspect-ratio:1200/630;
		border:1px solid #1d2230;border-radius:14px;background:#0b0d13;margin:0 0 2rem}
	dl{display:grid;grid-template-columns:minmax(6rem,10rem) 1fr;gap:.5rem 1.5rem;margin:0 0 2rem;
		font-size:.9375rem}
	dt{color:#8b93a7}
	dd{margin:0;color:#e7e9ee}
	ul.tags{list-style:none;display:flex;flex-wrap:wrap;gap:.5rem;margin:0;padding:0}
	ul.tags a{display:inline-block;padding:.15rem .6rem;border:1px solid #232838;border-radius:999px;
		font-size:.8125rem;color:#b6bccb}
	.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin:0 0 2.5rem}
	.actions a{display:inline-block;padding:.6rem 1.1rem;border-radius:10px;border:1px solid #232838;
		background:#0e1119;color:#e7e9ee;font-size:.9375rem}
	.actions a.primary{background:#e7e9ee;color:#06070a;border-color:#e7e9ee;font-weight:600}
	footer{border-top:1px solid #171b26;padding-top:1.5rem;font-size:.875rem;color:#8b93a7}
	footer ul{list-style:none;display:flex;flex-wrap:wrap;gap:1rem;margin:.5rem 0 0;padding:0}
	@media(max-width:36rem){dl{grid-template-columns:1fr;gap:.15rem}dt{margin-top:.75rem}}
`;

/** Breadcrumb markup plus the matching schema.org ListItem entries. */
function breadcrumb(trail, origin) {
	const items = trail
		.map((c, i) => {
			const label = esc(c.name);
			const inner = i === trail.length - 1 ? `<span aria-current="page">${label}</span>` : `<a href="${esc(c.path)}">${label}</a>`;
			return `<li>${inner}</li>`;
		})
		.join('');
	const ld = trail.map((c, i) => ({
		'@type': 'ListItem',
		position: i + 1,
		name: c.name,
		item: `${origin}${c.path}`,
	}));
	return { html: `<nav aria-label="Breadcrumb"><ol>${items}</ol></nav>`, ld };
}

/**
 * Render a crawler-facing entity page: real content in the body, self-canonical
 * in the head, structured data, and no self-redirect for an indexing crawler.
 *
 * @param {object} o
 * @param {string} o.title           entity name, unescaped
 * @param {string} o.desc            one-paragraph summary, unescaped
 * @param {string} o.pageUrl         absolute canonical URL
 * @param {string} o.ogImage         absolute URL of the 1200x630 card
 * @param {string} o.origin          site origin
 * @param {string} o.ogType          Open Graph object type
 * @param {string} o.frameButton     Farcaster frame button label
 * @param {{name:string,path:string}[]} o.trail       breadcrumb, root first
 * @param {{term:string,detail:string}[]} [o.facts]   definition rows, unescaped
 * @param {{label:string,href:string}[]} [o.tags]     tag chips
 * @param {{label:string,href:string,primary?:boolean}[]} [o.actions] links out
 * @param {{label:string,href:string}[]} [o.related]  footer links
 * @param {object} [o.jsonLd]        entity node merged into the @graph
 * @param {boolean} [o.redirect]     emit the bounce-to-SPA script
 * @param {boolean} [o.noindex]      ask crawlers not to index this entity
 * @returns {string} complete HTML document
 */
export function renderCrawlerPage({
	title,
	desc,
	pageUrl,
	ogImage,
	origin,
	ogType = 'website',
	frameButton = 'Open on three.ws',
	trail = [],
	facts = [],
	tags = [],
	actions = [],
	related = [],
	jsonLd = null,
	redirect = false,
	noindex = false,
}) {
	const t = esc(title);
	const d = esc(desc);
	const crumbs = breadcrumb(trail, origin);
	const path = new URL(pageUrl).pathname;

	const graph = [];
	if (jsonLd) graph.push(jsonLd);
	graph.push({ '@type': 'BreadcrumbList', itemListElement: crumbs.ld });

	const factsHtml = facts.length
		? `<dl>${facts.map((f) => `<dt>${esc(f.term)}</dt><dd>${f.detail}</dd>`).join('')}</dl>`
		: '';
	const tagsHtml = tags.length
		? `<ul class="tags">${tags.map((g) => `<li><a href="${esc(g.href)}">${esc(g.label)}</a></li>`).join('')}</ul>`
		: '';
	const actionsHtml = actions.length
		? `<div class="actions">${actions
				.map((a) => `<a href="${esc(a.href)}"${a.primary ? ' class="primary"' : ''}>${esc(a.label)}</a>`)
				.join('')}</div>`
		: '';
	const relatedHtml = related.length
		? `<ul>${related.map((r) => `<li><a href="${esc(r.href)}">${esc(r.label)}</a></li>`).join('')}</ul>`
		: '';

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>${t} · three.ws</title>
	<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
	<meta name="description" content="${d}">
	<meta name="theme-color" content="#06070a">
	<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1'}">

	<meta property="og:type" content="${esc(ogType)}">
	<meta property="og:site_name" content="three.ws">
	<meta property="og:title" content="${t} · three.ws">
	<meta property="og:description" content="${d}">
	<meta property="og:url" content="${esc(pageUrl)}">
	<meta property="og:image" content="${esc(ogImage)}">
	<meta property="og:image:width" content="1200">
	<meta property="og:image:height" content="630">
	<meta property="og:image:alt" content="${t} on three.ws">

	<meta name="twitter:card" content="summary_large_image">
	<meta name="twitter:title" content="${t} · three.ws">
	<meta name="twitter:description" content="${d}">
	<meta name="twitter:image" content="${esc(ogImage)}">
	<meta name="twitter:creator" content="@trythreews">

	<meta property="fc:frame" content="vNext">
	<meta property="fc:frame:image" content="${esc(ogImage)}">
	<meta property="fc:frame:image:aspect_ratio" content="1.91:1">
	<meta property="fc:frame:button:1" content="${esc(frameButton)}">
	<meta property="fc:frame:button:1:action" content="link">
	<meta property="fc:frame:button:1:target" content="${esc(pageUrl)}">

	${noindex ? '' : `<link rel="canonical" href="${esc(pageUrl)}">`}
	<link rel="shortcut icon" href="/favicon.ico">
	<style>${STYLES}</style>
	<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>
</head>
<body>
	<main>
		${crumbs.html}
		<h1>${t}</h1>
		<p class="lede">${d}</p>
		<img class="card" src="${esc(ogImage)}" width="1200" height="630" alt="${t} on three.ws" loading="eager">
		${actionsHtml}
		${factsHtml}
		${tagsHtml}
		<footer>
			<p>${t} lives on three.ws, the agent layer for the open web: build a 3D avatar, give it an identity, and embed it anywhere.</p>
			${relatedHtml}
		</footer>
	</main>
${redirect ? `	<script>(function(){window.location.replace(${JSON.stringify(path)});})()</script>\n` : ''}</body>
</html>`;
}

/**
 * Render the page a crawler gets for an id that names nothing public: gone,
 * private, or never existed. Served with a 404 so the URL leaves the index
 * instead of being logged as a redirect to an unrelated listing.
 *
 * @param {object} o
 * @param {string} o.heading    unescaped
 * @param {string} o.message    unescaped
 * @param {string} o.origin
 * @param {{label:string,href:string}[]} o.actions
 * @param {string} [o.redirect] path to bounce a non-indexing scraper to
 * @returns {string} complete HTML document
 */
export function renderCrawlerNotFound({ heading, message, origin, actions = [], redirect = '' }) {
	const h = esc(heading);
	const m = esc(message);
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>${h} · three.ws</title>
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta name="description" content="${m}">
	<meta name="robots" content="noindex, follow">
	<meta name="theme-color" content="#06070a">
	<meta property="og:type" content="website">
	<meta property="og:site_name" content="three.ws">
	<meta property="og:title" content="${h} · three.ws">
	<meta property="og:description" content="${m}">
	<meta property="og:image" content="${esc(origin)}/og-image.png">
	<meta name="twitter:card" content="summary_large_image">
	<link rel="shortcut icon" href="/favicon.ico">
	<style>${STYLES}</style>
</head>
<body>
	<main>
		<h1>${h}</h1>
		<p class="lede">${m}</p>
		<div class="actions">${actions
			.map((a, i) => `<a href="${esc(a.href)}"${i === 0 ? ' class="primary"' : ''}>${esc(a.label)}</a>`)
			.join('')}</div>
	</main>
${redirect ? `	<script>(function(){window.location.replace(${JSON.stringify(redirect)});})()</script>\n` : ''}</body>
</html>`;
}
