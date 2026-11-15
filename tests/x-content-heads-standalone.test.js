import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HEAD_KINDS, STANDALONE_HEADS, codeHash, codeSourceProblems, headProblems, headSpecProblems, reelPostIndex } from '../api/_lib/x-content/formats.js';
import { codeSize, highlightLine } from '../scripts/lib/x-card.mjs';

const root = () => {
	const dir = mkdtempSync(join(tmpdir(), 'x-heads-'));
	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(join(dir, 'src/embed.html'), '<body>\n\t<script type="module" src="https://three.ws/agent-3d.js"></script>\n\t<agent-3d body="https://three.ws/a.glb"></agent-3d>\n</body>\n');
	mkdirSync(join(dir, 'public/x-media/tip'), { recursive: true });
	writeFileSync(join(dir, 'public/x-media/tip/code.png'), 'png');
	writeFileSync(join(dir, 'public/x-media/tip/shot.png'), 'png');
	return dir;
};

const codeHead = { as: 'code', headline: 'An avatar on any page', source: 'src/embed.html', code: ['<agent-3d body="https://three.ws/a.glb"></agent-3d>'] };
const shotHead = { as: 'shot', headline: 'Forge from a sentence', url: 'https://three.ws/forge' };
const item = (head, extra = {}) => ({ id: 'tip', kind: 'post', posts: [{ text: 'Drop one tag on a page and the avatar renders. three.ws/embed' }], head, ...extra });

describe('heads that need no reel', () => {
	it('are head kinds the queue accepts', () => {
		expect(HEAD_KINDS).toEqual(expect.arrayContaining(['code', 'shot']));
		expect(STANDALONE_HEADS).toEqual(['code', 'shot']);
	});

	it('pass without a scenario or a reply to carry a reel', () => {
		expect(headSpecProblems(item(codeHead))).toEqual([]);
		expect(headSpecProblems(item(shotHead))).toEqual([]);
		expect(reelPostIndex(item(codeHead))).toBeNull();
	});

	it('still move the reel to a reply when the item is filmed', () => {
		const filmed = item(codeHead, { scenario: { steps: [] } });
		expect(reelPostIndex(filmed)).toBe(1);
		expect(headSpecProblems(filmed).join('\n')).toMatch(/needs a reply there/);
	});

	it('keep the reel-built heads tied to a scenario', () => {
		expect(headSpecProblems(item({ as: 'card', headline: 'x' })).join('\n')).toMatch(/carries no scenario/);
	});
});

describe('code head', () => {
	it.each([
		[{ ...codeHead, code: [] }, /needs code/],
		[{ ...codeHead, code: Array(13).fill('x') }, /13 lines/],
		[{ ...codeHead, code: ['x'.repeat(80)] }, /80 characters/],
		[{ ...codeHead, source: '' }, /names its source/],
		[{ ...codeHead, headline: '' }, /needs a headline/],
	])('rejects %j', (head, rule) => {
		expect(headSpecProblems(item(head)).join('\n')).toMatch(rule);
	});

	it('only shows lines that are in the source file, indentation aside', () => {
		const dir = root();
		expect(codeSourceProblems(codeHead, dir)).toEqual([]);
		expect(codeSourceProblems({ ...codeHead, code: ['<agent-3d body="https://evil.example/a.glb"></agent-3d>'] }, dir).join('\n')).toMatch(/is not in src\/embed.html/);
		expect(codeSourceProblems({ ...codeHead, source: '../etc/passwd' }, dir).join('\n')).toMatch(/not a file in the repo/);
	});

	it('refuses a card built for an older snippet', () => {
		const dir = root();
		const built = { path: 'public/x-media/tip/code.png', derived: { as: 'code', code: codeHash(codeHead) } };
		expect(headProblems({ ...item(codeHead), posts: [{ text: 'Drop one tag on a page and the avatar renders.', media: [built] }] }, dir)).toEqual([]);
		const edited = { ...codeHead, headline: 'A new headline' };
		expect(headProblems({ ...item(edited), posts: [{ text: 'x', media: [built] }] }, dir).join('\n')).toMatch(/older snippet/);
	});
});

describe('shot head', () => {
	it.each([
		[{ ...shotHead, url: 'not a url' }, /needs url/],
		[{ ...shotHead, url: 'https://example.com/forge' }, /not a three.ws page/],
		[{ ...shotHead, url: 'http://three.ws/forge' }, /not a three.ws page/],
		[{ ...shotHead, url: 'https://three.ws.evil.com/' }, /not a three.ws page/],
		[{ ...shotHead, frame: 'panel' }, /browser or phone/],
	])('rejects %j', (head, rule) => {
		expect(headSpecProblems(item(head)).join('\n')).toMatch(rule);
	});

	it('accepts subdomains of three.ws', () => {
		expect(headSpecProblems(item({ ...shotHead, url: 'https://docs.three.ws/start' }))).toEqual([]);
	});

	it('expires on the proof clock and follows the url', () => {
		const dir = root();
		const media = (capturedAt, url = shotHead.url) => ({ ...item(shotHead), posts: [{ text: 'x', media: [{ path: 'public/x-media/tip/shot.png', derived: { as: 'shot', url, capturedAt } }] }] });
		expect(headProblems(media(new Date().toISOString()), dir)).toEqual([]);
		expect(headProblems(media(new Date(Date.now() - 20 * 86_400_000).toISOString()), dir).join('\n')).toMatch(/captured 20 days ago/);
		expect(headProblems(media(new Date().toISOString(), 'https://three.ws/old'), dir).join('\n')).toMatch(/but head.url is/);
	});

	it('asks for a build when nothing is on the head post', () => {
		expect(headProblems(item(shotHead), root()).join('\n')).toMatch(/does not carry a shot built for it/);
	});
});

describe('code highlighting', () => {
	it('classes each token and escapes the markup inside it', () => {
		const html = highlightLine('<agent-3d body="a<b">');
		expect(html).toContain('<span class="t">&lt;agent-3d</span>');
		expect(html).toContain('<span class="a">body</span>');
		expect(html).toContain('<span class="s">&quot;a&lt;b&quot;</span>');
		expect(html).not.toMatch(/<agent-3d/);
	});

	it('reads JS and shell without mistaking a URL or an arrow for something else', () => {
		expect(highlightLine('const x = await f() // note')).toMatch(/class="k">const[\s\S]*class="a">f[\s\S]*class="c">\/\/ note/);
		expect(highlightLine('curl https://three.ws/api')).not.toContain('class="c"');
		expect(highlightLine('(a) => a')).not.toContain('class="t"');
		expect(highlightLine('npx three-ws create # scaffold')).toContain('<span class="c"># scaffold</span>');
	});

	it('sizes type to the snippet: large for two lines, smaller for twelve long ones', () => {
		expect(codeSize(['short', 'lines'])).toBe(30);
		expect(codeSize(Array(12).fill('x'.repeat(72)))).toBeLessThan(30);
		expect(codeSize(Array(12).fill('x'.repeat(72)))).toBeGreaterThanOrEqual(18);
	});
});
