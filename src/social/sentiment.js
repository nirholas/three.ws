import lexiconData from './lexicon.json' with { type: 'json' };

const POS_TERMS = lexiconData.positive.map((t) => t.toLowerCase());
const NEG_TERMS = lexiconData.negative.map((t) => t.toLowerCase());

function countMatches(text, terms) {
	const lower = text.toLowerCase();
	let count = 0;
	for (const term of terms) {
		let idx = 0;
		while ((idx = lower.indexOf(term, idx)) !== -1) {
			count++;
			idx += term.length;
		}
	}
	return count;
}

/**
 * Score sentiment for a batch of social posts using a deterministic lexicon.
 * @param {Array<{id?: string, ts?: string|number, text: string, author?: string}>} posts
 * @returns {{
 *   score: number,
 *   posPct: number,
 *   negPct: number,
 *   neuPct: number,
 *   count: number,
 *   examples: { pos: string[], neg: string[] }
 * }}
 */
export function scoreSentiment(posts) {
	if (!Array.isArray(posts) || posts.length === 0) {
		return { score: 0, posPct: 0, negPct: 0, neuPct: 100, count: 0, examples: { pos: [], neg: [] } };
	}

	let posCount = 0;
	let negCount = 0;
	let neuCount = 0;
	const posExamples = [];
	const negExamples = [];

	for (const post of posts) {
		const text = String(post.text || '');
		const p = countMatches(text, POS_TERMS);
		const n = countMatches(text, NEG_TERMS);

		if (p > n) {
			posCount++;
			if (posExamples.length < 3) posExamples.push(text);
		} else if (n > p) {
			negCount++;
			if (negExamples.length < 3) negExamples.push(text);
		} else {
			neuCount++;
		}
	}

	const total = posts.length;
	const score = total > 0 ? (posCount - negCount) / total : 0;
	const posPct = (posCount / total) * 100;
	const negPct = (negCount / total) * 100;
	const neuPct = (neuCount / total) * 100;

	return {
		score: Math.round(score * 1000) / 1000,
		posPct: Math.round(posPct * 10) / 10,
		negPct: Math.round(negPct * 10) / 10,
		neuPct: Math.round(neuPct * 10) / 10,
		count: total,
		examples: { pos: posExamples, neg: negExamples },
	};
}
