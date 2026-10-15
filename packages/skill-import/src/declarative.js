// README-only repos -> a declarative skill: SKILL.md + manifest.json, no
// tools.json and no handlers.js. See specs/SKILL_SPEC.md "Declarative-only skills".

function slugify(text) {
	return (
		String(text || 'imported-skill')
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 64) || 'imported-skill'
	);
}

/** First non-empty, non-heading, non-badge paragraph of a README. */
function firstParagraph(readmeText) {
	const lines = String(readmeText || '').split('\n');
	const buf = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			if (buf.length) break;
			continue;
		}
		if (trimmed.startsWith('#')) continue;
		if (/^\[!\[/.test(trimmed) || /^\[!\[.*\]\(.*\)\]\(.*\)$/.test(trimmed)) continue;
		buf.push(trimmed.replace(/^>\s*/, ''));
	}
	return buf.join(' ').slice(0, 500);
}

/**
 * @param {{repoName: string, readmeText: string, sourceUrl: string}} input
 * @returns {{manifest: object, skillMd: string}}
 */
export function generateDeclarativeBundle({ repoName, readmeText, sourceUrl }) {
	const name = slugify(repoName);
	const description = firstParagraph(readmeText) || `Imported from ${sourceUrl}`;

	const manifest = {
		spec: 'skill/0.1',
		name,
		version: '0.1.0',
		description,
		author: 'imported',
		license: 'unknown',
		tags: ['imported', 'declarative'],
		requires: {
			rig: ['any'],
			runtime: '>=0.1.0',
			tools: [],
			secrets: [],
		},
		dependencies: {},
		provides: {
			tools: [],
			triggers: ['imported', name],
		},
		source: { type: 'github-readme', url: sourceUrl },
	};

	const skillMd = `---
name: ${name}
description: ${description.replace(/\n/g, ' ')}
triggers:
    - imported
cost: low
---

# ${repoName}

${description}

This skill has no tools: the source repository ships only documentation
(no OpenAPI spec was found), so this bundle carries instructions for the LLM
to reference rather than executable handlers. Full README:

${readmeText || '_No README content was available._'}

## Source

Imported from ${sourceUrl} by @three-ws/skill-import.
`;

	return { manifest, skillMd };
}
