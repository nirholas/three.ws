// The Crawl worker's link choice (workers/agent-crawler/frontier.js): pure, so
// the rules that decide where an agent walks are pinned here.
import { describe, expect, it } from 'vitest';
import {
	Frontier, MAX_PAGES_PER_DOMAIN, canonical, gistOf, isCrawlable, relevance, scoreLink, stem, thoughtFor, tokenize, topicTerms,
} from '../workers/agent-crawler/frontier.js';

const ctx = (over = {}) => ({ terms: topicTerms('solana validator economics'), fromHost: 'example.com', domainCounts: new Map(), visited: new Set(), ...over });

describe('terms', () => {
	it('stems plurals and gerunds and drops stopwords', () => {
		expect(stem('validators')).toBe('validator');
		expect(stem('staking')).toBe('stak');
		expect(stem('class')).toBe('class');
		expect(tokenize('The validators are staking')).toEqual(['validator', 'stak']);
		expect(topicTerms('Solana validator economics and the validators')).toEqual(['solana', 'validator', 'economic']);
	});
});

describe('isCrawlable / canonical', () => {
	it('refuses account walls, share intents, binaries and non-web links', () => {
		for (const u of [
			'https://e.com/login', 'https://e.com/account/settings', 'https://e.com/cart?x=1', 'https://twitter.com/intent/tweet?u=1',
			'https://e.com/paper.pdf', 'https://e.com/a.zip', 'mailto:a@b.c', 'javascript:void(0)', 'https://www.facebook.com/page',
		]) expect(isCrawlable(u), u).toBe(false);
		expect(isCrawlable('https://e.com/blog/validator-economics')).toBe(true);
	});

	it('canonicalizes like the API so a revisit is caught', () => {
		expect(canonical('https://e.com/a/?utm_source=x&b=1#c')).toBe('https://e.com/a?b=1');
		expect(canonical('ftp://e.com')).toBeNull();
	});
});

describe('scoreLink', () => {
	it('prefers an on-topic descriptive anchor over boilerplate and noise', () => {
		const good = scoreLink({ href: 'https://example.com/blog/validator-rewards', text: 'How Solana validator rewards work', visible: true }, ctx());
		const meh = scoreLink({ href: 'https://example.com/about-us', text: 'About our team', visible: true }, ctx());
		expect(good).toBeGreaterThan(meh);
		expect(scoreLink({ href: 'https://example.com/privacy', text: 'Privacy policy' }, ctx())).toBe(-Infinity);
	});

	it('never revisits and stops at the per-domain cap', () => {
		const href = 'https://example.com/validators';
		expect(scoreLink({ href, text: 'validators' }, ctx({ visited: new Set([canonical(href)]) }))).toBe(-Infinity);
		const full = new Map([['other.org', MAX_PAGES_PER_DOMAIN]]);
		expect(scoreLink({ href: 'https://other.org/validators', text: 'validators' }, ctx({ domainCounts: full }))).toBe(-Infinity);
	});

	it('rewards a relevant new site to widen the corpus', () => {
		const fresh = scoreLink({ href: 'https://new.org/x', text: 'validator economics explained' }, ctx());
		const worn = scoreLink({ href: 'https://new.org/x', text: 'validator economics explained' }, ctx({ domainCounts: new Map([['new.org', 12]]) }));
		expect(fresh).toBeGreaterThan(worn);
	});
});

describe('relevance', () => {
	it('separates a page about the topic from a passing mention', () => {
		const terms = topicTerms('solana validator economics');
		const about = relevance(terms, 'Solana validator economics', 'Validators on Solana earn inflation rewards. Validator economics depend on stake. '.repeat(20));
		const passing = relevance(terms, 'Gardening tips', `${'Tomatoes need sun and water. '.repeat(60)} Someone mentioned Solana once.`);
		expect(about).toBeGreaterThan(0.6);
		expect(passing).toBeLessThan(0.2);
		expect(relevance([], 'x', 'y')).toBe(0);
	});
});

describe('Frontier', () => {
	it('pops best first, dedupes by canonical URL, keeps the higher score, and respects the cap', () => {
		const f = new Frontier(3);
		f.add('https://a.com/1', 1);
		f.add('https://a.com/2', 5);
		f.add('https://a.com/2#frag', 2); // same page, lower score: ignored
		f.add('https://a.com/3', 3);
		f.add('https://a.com/4', 4); // evicts the lowest (score 1)
		expect(f.size).toBe(3);
		expect(f.pop().url).toBe('https://a.com/2');
		expect(f.pop((i) => i.url !== 'https://a.com/4').url).toBe('https://a.com/3');
		expect(f.pop().url).toBe('https://a.com/4');
		expect(f.pop()).toBeNull();
	});

	it('decays old hopes', () => {
		const f = new Frontier();
		f.add('https://a.com/1', 10);
		f.decay(0.5);
		expect(f.items.get('https://a.com/1').score).toBe(5);
	});
});

describe('gistOf', () => {
	it('picks real sentences, prefers on-topic ones, and keeps reading order', () => {
		const text = 'Menu Home About\nValidators secure the Solana network by voting on blocks every slot. '
			+ 'The weather in the city was mild and pleasant for most of the week. '
			+ 'Validator economics come down to inflation rewards, fees and commission rates.';
		const g = gistOf(text, topicTerms('solana validator economics'), 480);
		expect(g.startsWith('Validators secure the Solana network')).toBe(true);
		expect(g).toContain('Validator economics come down');
		expect(gistOf('short. bits.', [], 480)).toBe('');
	});
});

describe('thoughtFor', () => {
	it('narrates what the agent is really doing', () => {
		expect(thoughtFor('reading', { title: 'Rewards', domain: 'e.com', topic: 'validators', relevance: 0.5 })).toMatch(/squarely about validators/);
		expect(thoughtFor('walking', { text: 'Next page', host: 'b.org', offsite: true })).toBe('Walking to "Next page", off to b.org.');
		expect(thoughtFor('blocked', { host: 'e.com', reason: 'answered 403' })).toBe('e.com answered 403. Finding another way.');
	});
});
