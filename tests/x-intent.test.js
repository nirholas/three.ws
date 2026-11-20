import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
	xIntentUrl,
	xWeightedLength,
	xTextBudget,
	fitXText,
	X_MAX_WEIGHT,
	X_URL_WEIGHT,
} from '../src/shared/share-targets.js';

const read = (href) => {
	const u = new URL(href);
	return { base: u.origin + u.pathname, text: u.searchParams.get('text'), url: u.searchParams.get('url'), via: u.searchParams.get('via') };
};

describe('xWeightedLength (twitter-text v3 weighting)', () => {
	it('counts Latin text one per character', () => {
		expect(xWeightedLength('hello world')).toBe(11);
		expect(xWeightedLength('')).toBe(0);
	});
	it('counts CJK characters two each', () => {
		expect(xWeightedLength('日本語')).toBe(6);
		expect(xWeightedLength('한국')).toBe(4);
		expect(xWeightedLength('a中b')).toBe(4);
	});
	it('counts each emoji as two, including ZWJ, skin tone and flag sequences', () => {
		expect(xWeightedLength('🚀')).toBe(2);
		expect(xWeightedLength('👩‍💻')).toBe(2);
		expect(xWeightedLength('👍🏽')).toBe(2);
		expect(xWeightedLength('🇯🇵')).toBe(2);
		expect(xWeightedLength('go 🚀🚀')).toBe(7);
	});
	it('counts every URL as 23 regardless of its real length', () => {
		expect(xWeightedLength('https://three.ws/m/0001e5f4-adff-464d-859e-95867eae2f2c?utm_source=x')).toBe(X_URL_WEIGHT);
		expect(xWeightedLength('see http://a.co')).toBe(4 + X_URL_WEIGHT);
		expect(xWeightedLength('visit three.ws/forge now')).toBe(6 + X_URL_WEIGHT + 4);
	});
	it('does not treat an @handle or an email-like token as a URL', () => {
		expect(xWeightedLength('@grok')).toBe(5);
	});
	it('NFC-normalizes before counting', () => {
		expect(xWeightedLength('é')).toBe(1);
	});
	it('counts punctuation in the light ranges as one and the ellipsis as two', () => {
		expect(xWeightedLength('‘quote’')).toBe(7);
		expect(xWeightedLength('…')).toBe(2);
	});
});

describe('xTextBudget', () => {
	it('is the full 280 without a url or via', () => {
		expect(xTextBudget({})).toBe(X_MAX_WEIGHT);
	});
	it('reserves 23 plus a space for an attached url', () => {
		expect(xTextBudget({ url: 'https://three.ws/x' })).toBe(X_MAX_WEIGHT - X_URL_WEIGHT - 1);
	});
	it('reserves the " via @handle" suffix', () => {
		expect(xTextBudget({ url: 'https://three.ws/x', via: 'trythreews' })).toBe(X_MAX_WEIGHT - X_URL_WEIGHT - 1 - ' via @trythreews'.length);
	});
});

describe('fitXText', () => {
	it('returns short text unchanged', () => {
		expect(fitXText('short', 100)).toBe('short');
	});
	it('truncates long text with an ellipsis inside the budget', () => {
		const out = fitXText('word '.repeat(100).trim(), 50);
		expect(xWeightedLength(out)).toBeLessThanOrEqual(50);
		expect(out.endsWith('…')).toBe(true);
	});
	it('never splits an emoji sequence and weighs CJK and the ellipsis at two', () => {
		const out = fitXText('👩‍💻'.repeat(40), 21);
		expect(xWeightedLength(out)).toBeLessThanOrEqual(21);
		expect(out).toBe('👩‍💻'.repeat(9) + '…');
		const cjk = fitXText('日'.repeat(200), 11);
		expect(cjk).toBe('日'.repeat(4) + '…');
	});
	it('drops a URL in the text whole rather than cutting through it', () => {
		const out = fitXText('read https://three.ws/a/very/long/path please', 20);
		expect(out).not.toMatch(/https:\/\/three\.ws\/a\/very\/lo[^n]/);
		expect(out.includes('https://')).toBe(false);
		expect(xWeightedLength(out)).toBeLessThanOrEqual(20);
	});
});

describe('xIntentUrl', () => {
	it('builds the X compose intent with text, url and via', () => {
		const r = read(xIntentUrl({ text: 'A robot & more', url: 'https://three.ws/m/abc?x=1&y=2', via: 'trythreews' }));
		expect(r.base).toBe('https://x.com/intent/post');
		expect(r.text).toBe('A robot & more');
		expect(r.url).toBe('https://three.ws/m/abc?x=1&y=2');
		expect(r.via).toBe('trythreews');
	});
	it('omits empty params', () => {
		const u = new URL(xIntentUrl({ text: 'hi' }));
		expect([...u.searchParams.keys()]).toEqual(['text']);
	});
	it('encodes spaces as %20, not +', () => {
		expect(xIntentUrl({ text: 'a b' })).toContain('text=a%20b');
	});
	it('truncates the text, never the url, so the post fits 280', () => {
		const url = 'https://three.ws/forge/share/0001e5f4-adff-464d-859e-95867eae2f2c?utm_source=x&utm_medium=share&utm_campaign=grok-share';
		const r = read(xIntentUrl({ text: 'x'.repeat(400), url, via: 'trythreews' }));
		expect(r.url).toBe(url);
		expect(r.text.endsWith('…')).toBe(true);
		expect(xWeightedLength(r.text) + 1 + X_URL_WEIGHT + ' via @trythreews'.length).toBeLessThanOrEqual(X_MAX_WEIGHT);
	});
	it('fits a CJK post on the weighted, not the raw, length', () => {
		const r = read(xIntentUrl({ text: '日'.repeat(200), url: 'https://three.ws/a' }));
		expect(xWeightedLength(r.text)).toBeLessThanOrEqual(X_MAX_WEIGHT - X_URL_WEIGHT - 1);
		expect(r.text.length).toBeLessThan(130);
	});
	it('keeps a text that already fits byte for byte', () => {
		const text = 'Forged a brass clockwork owl on three.ws\n';
		expect(read(xIntentUrl({ text, url: 'https://three.ws/a' })).text).toBe(text);
	});
	it('strips a leading @ from via', () => {
		expect(read(xIntentUrl({ text: 't', via: '@trythreews' })).via).toBe('trythreews');
	});
});

// Every X intent the app builds goes through xIntentUrl, so the weighted length
// rule and the url-never-truncated rule hold everywhere. A hand-built
// x.com/intent or twitter.com/intent string anywhere in shipped app code
// fails here. The exceptions cannot import a Vite-bundled module: raw
// publicDir copies served byte for byte, and code built and deployed outside
// this app (apps/hq has its own TypeScript build, infra/lambda its own deploy).
describe('no hand-built X intent outside share-targets.js', () => {
	const ROOTS = ['src', 'pages', 'api', 'server', 'scripts', 'public'];
	const BUILDER = 'src/shared/share-targets.js';
	const RAW_COPIES = new Set([
		'public/forever.js',
		'public/changelog/entry/index.html',
	]);
	const INTENT_RE = /(?:x|twitter)\.com\/intent\//;

	it('finds every intent built through xIntentUrl', () => {
		const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', ...ROOTS], {
			cwd: new URL('..', import.meta.url),
			encoding: 'utf8',
		})
			.split('\n')
			.filter((f) => /\.(m?js|html)$/.test(f) && f !== BUILDER && !RAW_COPIES.has(f) && !f.includes('/vendor/') && !/\.min\.js$/.test(f));
		const offenders = [];
		for (const f of files) {
			let text;
			try {
				text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
			} catch {
				continue;
			}
			text.split('\n').forEach((line, i) => {
				if (INTENT_RE.test(line)) offenders.push(`${f}:${i + 1}`);
			});
		}
		expect(offenders).toEqual([]);
	});
});
