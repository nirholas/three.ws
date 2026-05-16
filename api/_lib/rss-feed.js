// Build an RSS 2.0 feed for HackerNoon's "Auto Import" ingester (also valid
// for any standard reader). Two sources:
//   - curated: data/rss/items.json (default — hand-edited, full editorial control)
//   - archive: data/archives/*.json (scraped X posts — fallback / mirror mode)

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'data');
const ARCHIVES_DIR = path.join(DATA_ROOT, 'archives');
const CURATED_FILE = path.join(DATA_ROOT, 'rss', 'items.json');
const MIN_LENGTH = 140;
const MAX_ITEMS = 50;

const ACCOUNTS = {
	trythreews: { handle: '@trythreews', display: 'three.ws', url: 'https://x.com/trythreews' },
	nichxbt: { handle: '@nichxbt', display: 'Nicholas (three.ws)', url: 'https://x.com/nichxbt' },
};

export async function loadCuratedItems() {
	const raw = await readFile(CURATED_FILE, 'utf8');
	const data = JSON.parse(raw);
	const entries = Array.isArray(data?.items) ? data.items : [];
	const items = [];
	for (const e of entries) {
		if (!e || typeof e !== 'object') continue;
		if (!e.id || !e.title || !e.date || !e.body_html) continue;
		const ts = new Date(e.date);
		if (Number.isNaN(ts.getTime())) continue;
		items.push({
			id: String(e.id),
			title: String(e.title),
			link: typeof e.link === 'string' && e.link ? e.link : 'https://three.ws',
			author: typeof e.author === 'string' && e.author ? e.author : 'three.ws',
			summary: typeof e.summary === 'string' ? e.summary : deriveSummary(e.body_html),
			bodyHtml: String(e.body_html),
			tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string') : [],
			timestamp: ts,
		});
	}
	items.sort((a, b) => b.timestamp - a.timestamp);
	return items.slice(0, MAX_ITEMS);
}

function deriveSummary(html) {
	const text = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 280 ? text.slice(0, 277) + '…' : text;
}

export async function loadAnnouncementItems({ source = 'all' } = {}) {
	const files = (await readdir(ARCHIVES_DIR)).filter((f) => f.endsWith('.json') && f.includes('tweets'));
	const items = [];
	for (const file of files) {
		const archive = JSON.parse(await readFile(path.join(ARCHIVES_DIR, file), 'utf8'));
		const account = archive.profile;
		if (source !== 'all' && source !== account) continue;
		for (const t of archive.tweets || []) {
			if (t?.type?.isRetweet || t?.type?.isReply) continue;
			const text = cleanText(t.text || '');
			if (text.length < MIN_LENGTH) continue;
			const ts = new Date(t.timestamp);
			if (Number.isNaN(ts.getTime())) continue;
			items.push({
				id: t.id,
				account,
				url: t.url,
				text,
				timestamp: ts,
				hasImage: !!t?.media?.hasImage,
				hasVideo: !!t?.media?.hasVideo,
			});
		}
	}
	items.sort((a, b) => b.timestamp - a.timestamp);
	const seen = new Set();
	const deduped = [];
	for (const it of items) {
		if (seen.has(it.id)) continue;
		seen.add(it.id);
		deduped.push(it);
		if (deduped.length >= MAX_ITEMS) break;
	}
	return deduped;
}

// The scraper emits bare "http://" tokens (sometimes on their own line) as
// placeholders for t.co-shortened URLs; the displayed URL text follows.
// Strip these so the prose reads cleanly.
function cleanText(s) {
	return s
		.replace(/\r\n/g, '\n')
		.replace(/^\s*https?:\/\/\s*\n?/u, '')
		.replace(/\bhttps?:\/\/\s*\n\s*/g, '')
		.replace(/\n[ \t]*https?:\/\/[ \t]*\n/g, '\n')
		.replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
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
	return escapeXml(s);
}

function rfc822(date) {
	return date.toUTCString();
}

function deriveTitle(text) {
	const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) || text;
	const firstSentence = firstLine.split(/(?<=[.!?])\s+/)[0] || firstLine;
	const candidate = firstSentence.length > 90 ? firstLine : firstSentence;
	if (candidate.length <= 90) return candidate;
	const cut = candidate.slice(0, 87);
	const lastSpace = cut.lastIndexOf(' ');
	return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '…';
}

// Linkify URLs and @handles in a single pass that swaps URLs out for
// placeholders so the handle pass can't accidentally match @-segments inside
// the URLs we just wrapped (e.g. https://x.com/Handle).
function linkify(html) {
	const urls = [];
	let buf = html.replace(/\bhttps?:\/\/[^\s<]+/g, (url) => {
		const trimmed = url.replace(/[.,!?)]+$/, '');
		const tail = url.slice(trimmed.length);
		urls.push({ trimmed, tail });
		return ` URL${urls.length - 1} `;
	});
	buf = buf.replace(/(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{1,15})/g, (_m, pre, handle) =>
		`${pre}<a href="https://x.com/${handle}" rel="noopener">@${handle}</a>`,
	);
	return buf.replace(/ URL(\d+) /g, (_m, i) => {
		const { trimmed, tail } = urls[Number(i)];
		return `<a href="${trimmed}" rel="noopener">${trimmed}</a>${tail}`;
	});
}

function renderBodyHtml(item) {
	const account = ACCOUNTS[item.account] || { handle: '@' + item.account, display: item.account, url: `https://x.com/${item.account}` };
	const paragraphs = item.text
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => '<p>' + linkify(escapeXml(p)).replace(/\n/g, '<br>') + '</p>')
		.join('\n');
	const footer =
		`<p><em>Originally posted by <a href="${account.url}" rel="noopener">${escapeXml(account.handle)}</a> on ` +
		`<a href="${item.url}" rel="noopener">${escapeXml(item.timestamp.toISOString().slice(0, 10))}</a>. ` +
		`Follow more updates at <a href="https://three.ws" rel="noopener">three.ws</a>.</em></p>`;
	return paragraphs + '\n' + footer;
}

function renderDescription(item) {
	const oneLine = item.text.replace(/\s+/g, ' ').trim();
	return oneLine.length > 280 ? oneLine.slice(0, 277) + '…' : oneLine;
}

export function buildRssXml({ items, selfUrl, source = 'curated' }) {
	const account = ACCOUNTS[source];
	const channelTitle = account
		? `three.ws — ${account.display} updates`
		: 'three.ws — News & Announcements';
	const channelDescription = account
		? `Latest announcements from ${account.handle}, the team behind three.ws.`
		: 'Product launches, integrations, and announcements from three.ws — 3D AI agent avatars on-chain.';
	const lastBuildDate = items[0]?.timestamp || new Date();
	const itemsXml = items.map((item) => renderItemXml(item)).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
\txmlns:content="http://purl.org/rss/1.0/modules/content/"
\txmlns:dc="http://purl.org/dc/elements/1.1/"
\txmlns:atom="http://www.w3.org/2005/Atom">
\t<channel>
\t\t<title>${escapeXml(channelTitle)}</title>
\t\t<link>https://three.ws</link>
\t\t<atom:link href="${escapeAttr(selfUrl)}" rel="self" type="application/rss+xml"/>
\t\t<description>${escapeXml(channelDescription)}</description>
\t\t<language>en-us</language>
\t\t<lastBuildDate>${rfc822(lastBuildDate)}</lastBuildDate>
\t\t<generator>three.ws RSS feed</generator>
${itemsXml}
\t</channel>
</rss>
`;
}

function renderItemXml(item) {
	if (item.bodyHtml) {
		const tagsXml = (item.tags || [])
			.map((t) => `\n\t\t\t<category>${escapeXml(t)}</category>`)
			.join('');
		return `\t\t<item>
\t\t\t<title>${escapeXml(item.title)}</title>
\t\t\t<link>${escapeXml(item.link)}</link>
\t\t\t<guid isPermaLink="false">three-ws:${escapeXml(item.id)}</guid>
\t\t\t<pubDate>${rfc822(item.timestamp)}</pubDate>
\t\t\t<dc:creator>${escapeXml(item.author)}</dc:creator>${tagsXml}
\t\t\t<description>${escapeXml(item.summary)}</description>
\t\t\t<content:encoded><![CDATA[${item.bodyHtml}]]></content:encoded>
\t\t</item>`;
	}
	const account = ACCOUNTS[item.account] || { handle: '@' + item.account };
	const title = deriveTitle(item.text);
	return `\t\t<item>
\t\t\t<title>${escapeXml(title)}</title>
\t\t\t<link>${escapeXml(item.url)}</link>
\t\t\t<guid isPermaLink="false">three-ws:${escapeXml(item.id)}</guid>
\t\t\t<pubDate>${rfc822(item.timestamp)}</pubDate>
\t\t\t<dc:creator>${escapeXml(account.handle)}</dc:creator>
\t\t\t<description>${escapeXml(renderDescription(item))}</description>
\t\t\t<content:encoded><![CDATA[${renderBodyHtml(item)}]]></content:encoded>
\t\t</item>`;
}
