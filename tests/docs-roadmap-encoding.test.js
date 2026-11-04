// ROADMAP.md is the root-level public statement of the phase plan, and README.md `## Roadmap`
// carries the same table. A past edit truncated the status glyphs to lone UTF-8 continuation
// bytes, which made the file invalid UTF-8 (grep treated it as binary) and let the two tables
// drift apart. These checks keep the file decodable and the two tables identical.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, ROOT));

// The phase rows are the table lines that start with a bold phase number, e.g. `| **2** |`.
function phaseRows(markdown) {
	return markdown
		.split('\n')
		.filter((line) => /^\|\s*\*\*\d+\*\*\s*\|/.test(line))
		.map((line) =>
			line
				.split('|')
				.slice(1, -1)
				.map((cell) => cell.trim().replace(/\s+/g, ' '))
				.join(' | '),
		);
}

function readmeRoadmapSection(readme) {
	const start = readme.indexOf('\n## Roadmap\n');
	expect(start, 'README.md has a `## Roadmap` section').toBeGreaterThan(-1);
	const end = readme.indexOf('\n### Phase 0', start);
	expect(end, 'README.md `## Roadmap` is followed by `### Phase 0`').toBeGreaterThan(start);
	return readme.slice(start, end);
}

describe('ROADMAP.md', () => {
	it('is valid UTF-8', () => {
		const bytes = read('ROADMAP.md');
		expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
	});

	it('has the same phase table as the README roadmap', () => {
		const roadmap = new TextDecoder('utf-8').decode(read('ROADMAP.md'));
		const readme = new TextDecoder('utf-8').decode(read('README.md'));
		const fromRoadmap = phaseRows(roadmap);
		const fromReadme = phaseRows(readmeRoadmapSection(readme));
		expect(fromRoadmap.length).toBeGreaterThanOrEqual(6);
		expect(fromRoadmap).toEqual(fromReadme);
	});

	it('uses no em-dash or en-dash in the phase table', () => {
		const roadmap = new TextDecoder('utf-8').decode(read('ROADMAP.md'));
		for (const row of phaseRows(roadmap)) expect(row).not.toMatch(/[\u2013\u2014]/);
	});
});
