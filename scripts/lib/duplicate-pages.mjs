// Finds duplicate `path` values anywhere in a parsed data/pages.json tree.
//
// data/pages.json has no uniqueness constraint on `path`. A copy refresh that
// appends a new entry instead of editing the existing one, or a plain
// double-add, ships two <loc> rows for the same URL in the live sitemap
// (api/sitemap/[type].js reads this file directly). See order 419,
// prompts/finish/_context/production-100-PROGRESS.md.

/**
 * @param {unknown} pages parsed data/pages.json
 * @param {string} [rawText] the same file's raw text, used to resolve line numbers
 * @returns {{ path: string, count: number, lines: number[] }[]}
 */
export function findDuplicatePaths(pages, rawText = '') {
	const pathOccurrences = new Map();
	(function collectPaths(node) {
		if (Array.isArray(node)) {
			node.forEach(collectPaths);
			return;
		}
		if (node && typeof node === 'object') {
			if (typeof node.path === 'string') {
				pathOccurrences.set(node.path, (pathOccurrences.get(node.path) || 0) + 1);
			}
			Object.values(node).forEach(collectPaths);
		}
	})(pages);

	const duplicates = [];
	for (const [p, count] of pathOccurrences) {
		if (count <= 1) continue;
		const lines = [];
		if (rawText) {
			const needle = new RegExp(`"path"\\s*:\\s*"${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
			rawText.split('\n').forEach((line, i) => {
				if (needle.test(line)) lines.push(i + 1);
			});
		}
		duplicates.push({ path: p, count, lines });
	}
	return duplicates;
}
