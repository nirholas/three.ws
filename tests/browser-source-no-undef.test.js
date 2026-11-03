// Every identifier a browser module reads must resolve. A name that was
// dropped from an import, deleted in a refactor, or never wired is not a lint
// nit: it is a ReferenceError the moment that line runs, so the user action
// that reaches it throws. These modules each shipped such a gap.
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

const FILES = [
	'src/account.js',
	'src/agent-screen.js',
	'src/dashboard-next/pages/agents.js',
	'src/receipts.js',
	'src/walk.js',
];

describe('browser modules have no undefined identifiers', () => {
	const eslint = new ESLint({ cwd: process.cwd() });
	for (const file of FILES) {
		it(`${file} has no no-undef violations`, async () => {
			const [result] = await eslint.lintFiles([file]);
			const undef = result.messages
				.filter((m) => m.ruleId === 'no-undef')
				.map((m) => `${m.line}: ${m.message}`);
			expect(undef).toEqual([]);
		}, 60000);
	}
});
