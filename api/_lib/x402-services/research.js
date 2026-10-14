// Live, keyless scholarly search and citation data from three sources:
//   - arXiv (Atom XML)
//   - Crossref (JSON)
//   - Semantic Scholar (JSON)
// Each upstream call has a timeout and degrades gracefully: a failing or
// rate-limited source is reported in the `sources` block instead of
// failing the whole request.

const THREE_WS_UA = 'three.ws/1.0 (+https://three.ws; support@three.ws)';
const TIMEOUT_MS = 12_000;

async function getJson(url, headers = {}) {
	const res = await fetch(url, {
		headers: { 'user-agent': THREE_WS_UA, accept: 'application/json', ...headers },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
	return res.json();
}

async function getText(url, headers = {}) {
	const res = await fetch(url, {
		headers: { 'user-agent': THREE_WS_UA, ...headers },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
	return res.text();
}

function decodeXml(s) {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

function xmlTag(block, tag) {
	const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
	return m ? decodeXml(m[1]) : null;
}

function normTitle(t) {
	return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function searchArxiv(q, limit) {
	const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=${limit}&sortBy=relevance`;
	const xml = await getText(url);
	const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
	return entries.map((e) => {
		const idUrl = xmlTag(e, 'id') ?? '';
		const arxivId = idUrl.replace(/^.*\/abs\//, '').replace(/v\d+$/, '') || null;
		const published = xmlTag(e, 'published');
		const authors = (e.match(/<author>[\s\S]*?<\/author>/g) ?? [])
			.map((a) => xmlTag(a, 'name'))
			.filter(Boolean);
		return {
			title: xmlTag(e, 'title') ?? '(untitled)',
			authors,
			year: published ? Number(published.slice(0, 4)) : null,
			venue: 'arXiv',
			doi: xmlTag(e, 'arxiv:doi'),
			arxivId,
			url: idUrl || null,
			abstract: xmlTag(e, 'summary'),
			citationCount: null,
			source: 'arxiv',
		};
	});
}

async function searchCrossref(q, limit) {
	const url = `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${limit}&select=DOI,title,author,issued,container-title,is-referenced-by-count,URL,abstract`;
	const data = await getJson(url);
	return (data.message?.items ?? []).map((it) => {
		const issued = it.issued?.['date-parts']?.[0]?.[0];
		return {
			title: Array.isArray(it.title) ? it.title[0] ?? '(untitled)' : '(untitled)',
			authors: (it.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(' ')),
			year: typeof issued === 'number' ? issued : null,
			venue: Array.isArray(it['container-title']) ? it['container-title'][0] ?? null : null,
			doi: it.DOI ?? null,
			arxivId: null,
			url: it.URL ?? (it.DOI ? `https://doi.org/${it.DOI}` : null),
			abstract: typeof it.abstract === 'string' ? decodeXml(it.abstract.replace(/<[^>]+>/g, ' ')) : null,
			citationCount: it['is-referenced-by-count'] ?? null,
			source: 'crossref',
		};
	});
}

const S2_FIELDS = 'title,year,venue,authors,externalIds,citationCount,abstract,url';

async function searchS2(q, limit) {
	const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${limit}&fields=${S2_FIELDS}`;
	const data = await getJson(url);
	return (data.data ?? []).map((p) => ({
		title: p.title ?? '(untitled)',
		authors: (p.authors ?? []).map((a) => a.name).filter(Boolean),
		year: p.year ?? null,
		venue: p.venue || null,
		doi: p.externalIds?.DOI ?? null,
		arxivId: p.externalIds?.ArXiv ?? null,
		url: p.url ?? null,
		abstract: p.abstract ?? null,
		citationCount: p.citationCount ?? null,
		source: 'semantic-scholar',
	}));
}

export async function search(q, limit) {
	const per = Math.min(Math.max(limit, 1), 25);
	const jobs = [
		['arxiv', searchArxiv(q, per)],
		['crossref', searchCrossref(q, per)],
		['semanticScholar', searchS2(q, per)],
	];
	const sources = {};
	const collected = [];
	const settled = await Promise.allSettled(jobs.map(([, p]) => p));
	settled.forEach((r, i) => {
		const name = jobs[i][0];
		if (r.status === 'fulfilled') {
			sources[name] = 'ok';
			collected.push(...r.value);
		} else {
			const msg = String(r.reason?.message ?? r.reason);
			sources[name] = /429/.test(msg) ? 'rate-limited' : `error: ${msg}`;
		}
	});
	if (Object.values(sources).every((s) => s !== 'ok')) {
		const err = new Error(`All upstream sources failed: ${JSON.stringify(sources)}. Try again shortly.`);
		err.status = 502;
		err.code = 'all_sources_failed';
		throw err;
	}

	const byKey = new Map();
	for (const p of collected) {
		const key = p.doi?.toLowerCase() ?? `t:${normTitle(p.title)}`;
		const prev = byKey.get(key);
		if (!prev) {
			byKey.set(key, { ...p });
		} else {
			prev.citationCount = prev.citationCount ?? p.citationCount;
			prev.abstract = prev.abstract ?? p.abstract;
			prev.doi = prev.doi ?? p.doi;
			prev.arxivId = prev.arxivId ?? p.arxivId;
			prev.venue = prev.venue ?? p.venue;
		}
	}
	const papers = [...byKey.values()]
		.sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0) || (b.year ?? 0) - (a.year ?? 0))
		.slice(0, per);

	return { query: q, count: papers.length, papers, sources, retrievedAt: new Date().toISOString() };
}

function s2IdFor(id) {
	if (/^10\.\d{4,9}\//.test(id)) return `DOI:${id}`;
	if (/^arxiv:/i.test(id)) return `ARXIV:${id.slice(6)}`;
	if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(id)) return `ARXIV:${id.replace(/v\d+$/, '')}`;
	return id;
}

export async function paperDetail(id) {
	const fields =
		'title,abstract,year,venue,publicationDate,authors,externalIds,citationCount,' +
		'referenceCount,influentialCitationCount,fieldsOfStudy,tldr,openAccessPdf,' +
		'citations.title,citations.year,citations.externalIds,citations.citationCount,' +
		'references.title,references.year,references.externalIds,references.citationCount';

	try {
		const p = await getJson(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(s2IdFor(id))}?fields=${fields}`);
		const slim = (arr) =>
			(arr ?? []).slice(0, 25).map((c) => ({
				title: c.title ?? null,
				year: c.year ?? null,
				doi: c.externalIds?.DOI ?? null,
				arxivId: c.externalIds?.ArXiv ?? null,
				citationCount: c.citationCount ?? null,
			}));
		return {
			id,
			resolvedAs: s2IdFor(id),
			title: p.title ?? null,
			abstract: p.abstract ?? p.tldr?.text ?? null,
			tldr: p.tldr?.text ?? null,
			year: p.year ?? null,
			venue: p.venue || null,
			publicationDate: p.publicationDate ?? null,
			authors: (p.authors ?? []).map((a) => a.name).filter(Boolean),
			externalIds: p.externalIds ?? {},
			fieldsOfStudy: p.fieldsOfStudy ?? [],
			openAccessPdf: p.openAccessPdf?.url ?? null,
			citationGraph: {
				citationCount: p.citationCount ?? null,
				referenceCount: p.referenceCount ?? null,
				influentialCitationCount: p.influentialCitationCount ?? null,
				topCitations: slim(p.citations),
				references: slim(p.references),
			},
			source: 'semantic-scholar',
			retrievedAt: new Date().toISOString(),
		};
	} catch (err) {
		if (/^10\.\d{4,9}\//.test(id)) {
			const data = await getJson(`https://api.crossref.org/works/${encodeURIComponent(id)}`);
			const m = data.message ?? {};
			return {
				id,
				resolvedAs: `DOI:${id}`,
				title: Array.isArray(m.title) ? m.title[0] ?? null : null,
				abstract: typeof m.abstract === 'string' ? decodeXml(m.abstract.replace(/<[^>]+>/g, ' ')) : null,
				year: m.issued?.['date-parts']?.[0]?.[0] ?? null,
				venue: Array.isArray(m['container-title']) ? m['container-title'][0] ?? null : null,
				authors: (m.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(' ')),
				externalIds: { DOI: id },
				citationGraph: {
					citationCount: m['is-referenced-by-count'] ?? null,
					referenceCount: m['reference-count'] ?? null,
					note: 'Citation lists unavailable (Semantic Scholar unreachable); counts from Crossref.',
				},
				source: 'crossref',
				partial: true,
				upstreamError: String(err.message),
				retrievedAt: new Date().toISOString(),
			};
		}
		throw err;
	}
}

function apaAuthors(authors) {
	const fmt = (a) => {
		const initials = (a.given ?? '')
			.split(/[\s-]+/)
			.filter(Boolean)
			.map((n) => `${n[0].toUpperCase()}.`)
			.join(' ');
		return initials ? `${a.family}, ${initials}` : a.family ?? '';
	};
	const names = authors.map(fmt).filter(Boolean);
	if (names.length === 0) return '';
	if (names.length === 1) return names[0];
	if (names.length <= 20) return `${names.slice(0, -1).join(', ')}, & ${names.at(-1)}`;
	return `${names.slice(0, 19).join(', ')}, ... ${names.at(-1)}`;
}

function apaEntry(m, doi) {
	const year = m.issued?.['date-parts']?.[0]?.[0] ?? 'n.d.';
	const title = Array.isArray(m.title) ? m.title[0] ?? '' : '';
	const journal = Array.isArray(m['container-title']) ? m['container-title'][0] ?? '' : '';
	const vol = m.volume ? `${m.volume}` : '';
	const issue = m.issue ? `(${m.issue})` : '';
	const pages = m.page ? `, ${m.page}` : '';
	const authors = apaAuthors(m.author ?? []);
	const journalPart = journal ? ` ${journal}${vol || issue ? `, ${vol}${issue}` : ''}${pages}.` : '';
	return `${authors ? `${authors} ` : ''}(${year}). ${title}.${journalPart} https://doi.org/${doi}`;
}

export async function bibliography(dois, format) {
	const unique = [...new Set(dois.map((d) => String(d).trim()).filter(Boolean))].slice(0, 25);
	const entries = await Promise.all(
		unique.map(async (doi) => {
			try {
				const entry = { doi, status: 'ok' };
				if (format !== 'apa') {
					entry.bibtex = (await getText(`https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`)).trim();
				}
				if (format !== 'bibtex') {
					const data = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
					entry.apa = apaEntry(data.message ?? {}, doi);
				}
				return entry;
			} catch (err) {
				return { doi, status: 'error', error: String(err.message) };
			}
		}),
	);
	return { format, count: entries.length, entries, retrievedAt: new Date().toISOString() };
}
