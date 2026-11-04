import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const langLine = (src) => src.split('\n').find((l) => l.includes('README.zh-CN.md'));
const links = (line) => [...line.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
const headings = (src, mark) =>
	src.split('\n').filter((l) => !l.startsWith('    ') && new RegExp(`^${mark} `).test(l)).length;
const fences = (src) => (src.match(/^```/gm) || []).length;

const readme = read('README.md');
const targets = links(langLine(readme)).filter((l) => l.startsWith('docs/readme/'));

describe('README translations', () => {
	it('links es, pt-BR, hi and ru from the README language line', () => {
		for (const f of ['es', 'pt-BR', 'hi', 'ru']) {
			expect(targets).toContain(`docs/readme/README.${f}.md`);
		}
	});

	it('every linked file exists and mirrors the shared translated structure', () => {
		const base = read('docs/readme/README.ja.md');
		for (const rel of targets) {
			expect(existsSync(path.join(root, rel)), rel).toBe(true);
			const src = read(rel);
			expect(headings(src, '#'), `${rel} H1`).toBe(headings(base, '#'));
			expect(headings(src, '##'), `${rel} H2`).toBe(headings(base, '##'));
			expect(fences(src), `${rel} fences`).toBe(fences(base));
			expect(src, `${rel} links back to English`).toContain('(../../README.md)');
		}
	});

	it('every translation carries the same language line as the README, relative to its folder', () => {
		const expected = links(langLine(readme)).map((l) => path.basename(l));
		for (const rel of targets) {
			const own = links(langLine(read(rel)))
				.filter((l) => l !== '../../README.md')
				.map((l) => path.basename(l));
			expect(own, rel).toEqual(expected);
		}
	});

	it('keeps product names, URLs and commands untouched', () => {
		for (const rel of targets) {
			const src = read(rel);
			for (const needle of [
				'https://three.ws/forge',
				'https://three.ws/api/mcp-studio',
				'/plugin install three-ws-3d@three-ws',
				'npm run dev',
				'$THREE',
			]) {
				expect(src, `${rel} ${needle}`).toContain(needle);
			}
		}
	});
});
