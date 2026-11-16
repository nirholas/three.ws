// Pure pieces of the embedding retrieval eval (scripts/nvidia-embed-eval.mjs):
// splitting Markdown docs into labelled sections, Matryoshka dimension
// reduction, exact cosine ranking and the IR metrics. No I/O, so the unit
// tests in tests/embed-eval-core.test.js exercise exactly what the eval runs.

/** GitHub-style heading slug: lowercase, drop punctuation, spaces to hyphens. */
export function slugify(heading) {
	return heading
		.toLowerCase()
		.replace(/`/g, '')
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/\s/g, '-');
}

/**
 * Split one Markdown file into sections at #, ## and ### headings (headings
 * inside fenced code blocks are ignored). Each section id is
 * `<path>#<slug>`, deduplicated the way GitHub does (`-1`, `-2`). Text before
 * the first heading belongs to no section and is dropped.
 */
export function splitSections(path, markdown) {
	const sections = [];
	const seen = new Map();
	let fenced = false;
	let current = null;
	let title = '';
	for (const line of markdown.split('\n')) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		const m = !fenced && line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
		if (m) {
			const heading = m[2].trim();
			if (m[1].length === 1 && !title) title = heading;
			const base = slugify(heading);
			const n = seen.get(base) || 0;
			seen.set(base, n + 1);
			current = { id: `${path}#${n ? `${base}-${n}` : base}`, heading, lines: [] };
			sections.push(current);
			continue;
		}
		if (current) current.lines.push(line);
	}
	return sections.map((s) => ({
		id: s.id,
		heading: s.heading,
		text: `${title && title !== s.heading ? `${title} > ` : ''}${s.heading}\n${s.lines.join('\n').trim()}`,
	}));
}

/**
 * Cut a section into passages of at most `maxChars`, breaking on blank lines
 * where possible. Every passage keeps the section's heading line so a passage
 * from the middle of a long section still says what it is about.
 */
export function chunkSection(section, maxChars) {
	if (section.text.length <= maxChars) return [section.text];
	const [head, ...rest] = section.text.split('\n');
	const budget = Math.max(200, maxChars - head.length - 1);
	const out = [];
	let buf = '';
	for (const para of rest.join('\n').split(/\n\s*\n/)) {
		const pieces = para.length > budget ? para.match(new RegExp(`[\\s\\S]{1,${budget}}`, 'g')) : [para];
		for (const piece of pieces) {
			if (buf && buf.length + piece.length + 2 > budget) {
				out.push(`${head}\n${buf}`);
				buf = '';
			}
			buf = buf ? `${buf}\n\n${piece}` : piece;
		}
	}
	if (buf.trim()) out.push(`${head}\n${buf}`);
	return out;
}

/**
 * Matryoshka reduction: keep the first `dim` components and renormalize.
 * Verified 2026-11-16 to equal NIM's own `dimensions` output for the
 * nemotron-3.5 embedders (cosine 1.000000 against the API at 1024).
 */
export function reduceDim(vec, dim) {
	const out = new Float32Array(dim);
	let n = 0;
	for (let i = 0; i < dim; i++) {
		out[i] = vec[i];
		n += vec[i] * vec[i];
	}
	n = Math.sqrt(n) || 1;
	for (let i = 0; i < dim; i++) out[i] /= n;
	return out;
}

/** Normalize to unit length (a copy), so a dot product is the cosine. */
export function normalize(vec) {
	return reduceDim(vec, vec.length);
}

/**
 * Rank documents for one query by cosine. `docs` are unit vectors, `docIds`
 * aligned with them (several passages may share an id; the best passage wins).
 * Returns the top `k` distinct ids, best first.
 */
export function rankIds(query, docs, docIds, k) {
	if (docs.length && docs[0].length !== query.length) {
		throw new Error(`dimension mismatch: query ${query.length} vs docs ${docs[0].length}`);
	}
	const best = new Map();
	for (let d = 0; d < docs.length; d++) {
		const v = docs[d];
		let s = 0;
		for (let i = 0; i < v.length; i++) s += v[i] * query[i];
		const id = docIds[d];
		const prev = best.get(id);
		if (prev === undefined || s > prev) best.set(id, s);
	}
	return [...best.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, k)
		.map(([id]) => id);
}

/** Share of the relevant ids found in the top k. `qrel` maps id to grade (> 0). */
export function recallAt(ranked, qrel, k) {
	const relevant = Object.keys(qrel).filter((id) => qrel[id] > 0);
	if (!relevant.length) return 0;
	const top = new Set(ranked.slice(0, k));
	return relevant.filter((id) => top.has(id)).length / relevant.length;
}

/** nDCG@k with graded gains (2^grade - 1), the BEIR / trec_eval convention. */
export function ndcgAt(ranked, qrel, k) {
	const gain = (g) => (g > 0 ? 2 ** g - 1 : 0);
	let dcg = 0;
	ranked.slice(0, k).forEach((id, i) => {
		dcg += gain(qrel[id] || 0) / Math.log2(i + 2);
	});
	const ideal = Object.values(qrel)
		.filter((g) => g > 0)
		.sort((a, b) => b - a)
		.slice(0, k);
	let idcg = 0;
	ideal.forEach((g, i) => {
		idcg += gain(g) / Math.log2(i + 2);
	});
	return idcg ? dcg / idcg : 0;
}

/** Percentile (0 to 100) of a numeric array, nearest-rank. */
export function percentile(values, p) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[idx];
}
