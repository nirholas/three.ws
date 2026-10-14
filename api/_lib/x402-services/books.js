// Entirely keyless and entirely live:
//   - Editions and availability from the OpenLibrary Search API.
//   - Public-domain full text from Project Gutenberg, cleaned and chaptered.
//   - Gutenberg availability from Gutendex, with a fallback to gutenberg.org's
//     own search when Gutendex is unreachable.
// No fixture mode: every response is fetched live.

const THREE_WS_UA = 'three.ws/1.0 (+https://three.ws; support@three.ws)';
const OPENLIBRARY_BASE = 'https://openlibrary.org';
const GUTENDEX_BASE = 'https://gutendex.com';
const GUTENBERG_BASE = 'https://www.gutenberg.org';
const TIMEOUT_MS = 30_000;

async function get(url, accept = 'application/json') {
	return fetch(url, {
		headers: { 'user-agent': THREE_WS_UA, accept },
		signal: AbortSignal.timeout(TIMEOUT_MS),
		redirect: 'follow',
	});
}

function normalizeTitle(t) {
	return t
		.toLowerCase()
		.replace(/[^a-z0-9 ]+/g, ' ')
		.replace(/\b(the|a|an|or|and|of)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function gutendexSearch(query) {
	try {
		const res = await get(`${GUTENDEX_BASE}/books?search=${encodeURIComponent(query)}`);
		if (!res.ok) return null;
		const body = await res.json();
		return body.results ?? [];
	} catch {
		return null;
	}
}

async function gutenbergSiteSearch(query) {
	try {
		const res = await get(`${GUTENBERG_BASE}/ebooks/search/?query=${encodeURIComponent(query)}`, 'text/html');
		if (!res.ok) return null;
		const html = await res.text();
		const out = [];
		const re = /href="\/ebooks\/(\d+)"[\s\S]{0,600}?<span class="title">([^<]*)<\/span>/g;
		let m;
		while ((m = re.exec(html)) !== null && out.length < 25) {
			out.push({ id: Number(m[1]), title: m[2].trim() });
		}
		return out;
	} catch {
		return null;
	}
}

async function gutenbergIndex(query) {
	const build = (entries) => {
		const index = new Map();
		for (const e of entries) {
			const key = normalizeTitle(e.title);
			if (!index.has(key)) index.set(key, e.id);
		}
		return index;
	};

	const viaGutendex = await gutendexSearch(query);
	if (viaGutendex) {
		return {
			index: build(viaGutendex.filter((b) => b.id != null && typeof b.title === 'string').map((b) => ({ id: b.id, title: b.title }))),
		};
	}
	const viaSite = await gutenbergSiteSearch(query);
	if (viaSite) {
		return { index: build(viaSite), note: 'Gutendex unreachable; availability resolved via gutenberg.org search.' };
	}
	return { index: new Map(), note: 'Gutenberg availability could not be determined (both Gutendex and gutenberg.org were unreachable).' };
}

function matchGutenberg(title, index) {
	const norm = normalizeTitle(title);
	if (index.has(norm)) return index.get(norm) ?? null;
	for (const [key, id] of index) {
		if (key.startsWith(norm) || norm.startsWith(key)) return id;
	}
	return null;
}

export async function searchBooks(q, author, limit) {
	const params = new URLSearchParams({
		q,
		limit: String(limit),
		fields: 'key,title,author_name,first_publish_year,edition_count,language,subject,cover_i,ebook_access,ia',
	});
	if (author) params.set('author', author);

	const res = await get(`${OPENLIBRARY_BASE}/search.json?${params.toString()}`);
	if (!res.ok) {
		const err = new Error(`OpenLibrary search failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
		err.status = 502;
		err.code = 'upstream_error';
		throw err;
	}
	const body = await res.json();
	const docs = body.docs ?? [];

	const { index, note } = await gutenbergIndex(author ? `${q} ${author}` : q);

	const editions = docs.map((d) => {
		const title = d.title ?? '(untitled)';
		const gutenbergId = matchGutenberg(title, index);
		return {
			key: d.key ?? '',
			title,
			authors: d.author_name ?? [],
			firstPublishYear: d.first_publish_year ?? null,
			editionCount: d.edition_count ?? 0,
			languages: d.language ?? [],
			subjects: (d.subject ?? []).slice(0, 8),
			coverUrl: d.cover_i != null ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
			ebookAccess: d.ebook_access ?? null,
			internetArchiveIds: (d.ia ?? []).slice(0, 5),
			openLibraryUrl: d.key ? `${OPENLIBRARY_BASE}${d.key}` : OPENLIBRARY_BASE,
			gutenberg:
				gutenbergId != null
					? { available: true, gutenbergId, readPath: `/read/${gutenbergId}` }
					: { available: false, gutenbergId: null, readPath: null, ...(note ? { note } : {}) },
		};
	});

	return {
		source: 'openlibrary+gutenberg',
		query: { q, author, limit },
		totalFound: body.numFound ?? editions.length,
		count: editions.length,
		editions,
		retrievedAt: new Date().toISOString(),
	};
}

async function gutenbergMetadata(id) {
	try {
		const res = await get(`${GUTENDEX_BASE}/books/${id}`);
		if (res.ok) {
			const b = await res.json();
			if (b.id != null) {
				return {
					title: b.title ?? `Project Gutenberg eBook ${id}`,
					authors: (b.authors ?? []).map((a) => a.name ?? '').filter(Boolean),
					languages: b.languages ?? [],
					subjects: (b.subjects ?? []).slice(0, 10),
				};
			}
		}
	} catch {
		// fall through to the RDF
	}

	try {
		const res = await get(`${GUTENBERG_BASE}/cache/epub/${id}/pg${id}.rdf`, 'application/rdf+xml');
		if (!res.ok) return null;
		const xml = await res.text();
		const one = (re) => re.exec(xml)?.[1]?.trim() ?? null;
		const all = (re) => [...xml.matchAll(re)].map((m) => m[1].trim());
		const title = one(/<dcterms:title>([\s\S]*?)<\/dcterms:title>/);
		if (!title) return null;
		return {
			title,
			authors: all(/<pgterms:name>([\s\S]*?)<\/pgterms:name>/g),
			languages: all(/<rdf:value[^>]*>([a-z]{2,3})<\/rdf:value>/g).slice(0, 2),
			subjects: all(/<rdf:value>([^<]{3,})<\/rdf:value>/g)
				.filter((v) => !/^[a-z]{2,3}$/.test(v))
				.slice(0, 10),
		};
	} catch {
		return null;
	}
}

function textUrls(id) {
	return [`${GUTENBERG_BASE}/cache/epub/${id}/pg${id}.txt`, `${GUTENBERG_BASE}/files/${id}/${id}-0.txt`, `${GUTENBERG_BASE}/ebooks/${id}.txt.utf-8`];
}

const START_MARKER = /^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*$/im;
const END_MARKER = /^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*$/im;

function stripBoilerplate(raw) {
	let text = raw.replace(/\r\n/g, '\n');
	const start = START_MARKER.exec(text);
	if (start) text = text.slice(start.index + start[0].length);
	const end = END_MARKER.exec(text);
	if (end) text = text.slice(0, end.index);
	return text.replace(/^\s*\n+/, '').replace(/\n{4,}/g, '\n\n\n');
}

const HEADING = /^\s{0,8}((?:chapter|letter|part|book|canto|act|scene|volume)\s+[a-z0-9ivxlcdm]+\.?)\s*$/i;

function toMarkdown(lines) {
	const paragraphs = [];
	let current = [];
	for (const line of lines) {
		if (line.trim().length === 0) {
			if (current.length > 0) {
				paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim());
				current = [];
			}
		} else {
			current.push(line.trim());
		}
	}
	if (current.length > 0) paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim());
	return paragraphs.filter((p) => p.length > 0).join('\n\n');
}

function countWords(s) {
	const m = s.match(/\S+/g);
	return m ? m.length : 0;
}

function chapterize(text) {
	const lines = text.split('\n');
	const marks = [];
	for (let i = 0; i < lines.length; i++) {
		const m = HEADING.exec(lines[i]);
		const prevBlank = i === 0 || lines[i - 1].trim() === '';
		const nextBlank = i + 1 >= lines.length || lines[i + 1].trim() === '';
		if (m && prevBlank && nextBlank) {
			marks.push({ line: i, title: m[1].replace(/\.$/, '').trim() });
		}
	}

	if (marks.length === 0) {
		const markdown = toMarkdown(lines);
		return { frontMatter: null, chapters: [{ index: 1, title: 'Full text', markdown, wordCount: countWords(markdown) }] };
	}

	const frontLines = lines.slice(0, marks[0].line);
	const frontMarkdown = toMarkdown(frontLines);

	const chapters = marks.map((mark, i) => {
		const from = mark.line + 1;
		const to = i + 1 < marks.length ? marks[i + 1].line : lines.length;
		const markdown = toMarkdown(lines.slice(from, to));
		return { index: i + 1, title: mark.title, markdown, wordCount: countWords(markdown) };
	});

	return { frontMatter: frontMarkdown.length > 0 ? frontMarkdown : null, chapters };
}

export async function readBook(gutenbergId) {
	let raw = null;
	let usedUrl = '';
	for (const url of textUrls(gutenbergId)) {
		try {
			const res = await get(url, 'text/plain');
			if (res.ok) {
				const body = await res.text();
				if (body.length > 2000 && !body.trimStart().startsWith('<')) {
					raw = body;
					usedUrl = url;
					break;
				}
			}
		} catch {
			// try the next candidate URL
		}
	}
	if (raw == null) return null;

	const meta = await gutenbergMetadata(gutenbergId);
	const cleaned = stripBoilerplate(raw);
	const { frontMatter, chapters } = chapterize(cleaned);
	const wordCount = chapters.reduce((n, c) => n + c.wordCount, 0) + countWords(frontMatter ?? '');

	return {
		source: 'gutenberg',
		gutenbergId,
		title: meta?.title ?? `Project Gutenberg eBook ${gutenbergId}`,
		authors: meta?.authors ?? [],
		languages: meta?.languages ?? [],
		subjects: meta?.subjects ?? [],
		textUrl: usedUrl,
		gutenbergUrl: `${GUTENBERG_BASE}/ebooks/${gutenbergId}`,
		rights: 'Public domain in the USA. Project Gutenberg licence applies to the source file; the cleaned text is derived from it.',
		chapterCount: chapters.length,
		wordCount,
		frontMatter,
		chapters,
		retrievedAt: new Date().toISOString(),
	};
}
