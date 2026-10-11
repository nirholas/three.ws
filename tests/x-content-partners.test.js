import { describe, expect, it } from 'vitest';
import { articleBlocks, articleClaims, articleFacts, articleItemFor, articleSeriesFindings, assembleArticle, buildArticleBrief, draftArticle, nextArticleDay, parseArticle, partnerArticles, pickArticlePartner, buildBrief, claimsFor, draftFindings, draftSpotlight, itemFor, nextDay, parseDraft, partnerProblems, pickNext, seriesFindings, spotlights } from '../api/_lib/x-content/partners.js';
import { validateItem } from '../api/_lib/x-content/queue.js';

const scenario = { format: 'square', steps: [{ goto: 'https://three.ws/openai', caption: 'Eleven keyless 3D tools' }, { expect: 'Connect' }, { hold: 3000 }] };
const page = (contains) => [{ type: 'page', url: 'https://three.ws/openai', contains }];

const openai = {
	id: 'openai',
	name: 'OpenAI',
	order: 1,
	designation: 'OpenAI Select Partner',
	designationEvidence: page('OpenAI Select Partner'),
	page: 'https://three.ws/openai',
	handle: 'OpenAI',
	mark: null,
	forbidden: ['endorsed by OpenAI', 'official OpenAI'],
	guidance: 'three.ws is an OpenAI Select Partner. Never imply endorsement.',
	docs: ['docs/partners.md'],
	features: [
		{
			id: 'studio',
			title: 'Free 3D tools inside ChatGPT',
			surface: 'https://three.ws/openai',
			covers: ['/openai'],
			lane: 'community',
			summary: 'A connector that brings 3D tools into ChatGPT.',
			docs: [],
			scenario,
			facts: [
				{ says: 'eleven keyless 3D tools', evidence: page('eleven keyless 3D tools') },
				{ says: 'runs inside ChatGPT', evidence: page('runs inside ChatGPT') },
				{ says: 'no sign-up', evidence: page('no sign-up') },
				{ says: 'answers in 2 seconds', evidence: page('answers in 2 seconds') },
			],
		},
		{ id: 'ar', title: 'AR in ChatGPT', surface: 'https://three.ws/openai/ar', lane: 'developer', summary: 'AR.', scenario, facts: [] },
	],
};
const nvidia = { ...openai, id: 'nvidia', name: 'NVIDIA', order: 6, designation: 'NVIDIA Inception member', page: 'https://three.ws/nvidia', features: [{ ...openai.features[0], id: 'gpu' }] };

const GOOD = {
	post: 'OpenAI models sit behind eleven keyless 3D tools we built for ChatGPT: three.ws/openai\n\nDescribe a model, and it appears in the chat with no sign-up.',
	thread: [
		'The connector runs inside ChatGPT. Ask for a chair, a robot or a whole room, and the tools build it, render it, and hand back a GLB you can download.',
		'We are an OpenAI Select Partner, and grateful to OpenAI for the platform that lets a conversation become a working 3D studio: three.ws/openai',
		'Agents get the same tools over MCP, so an assistant can model, preview and export without a person opening a page.',
	],
	headline: 'Describe it.\nChatGPT builds it in 3D.',
	body: 'Keyless 3D tools that run inside ChatGPT, with no sign-up.',
	prompt: '',
	why: 'Leads on the tools.',
};

describe('partner registry', () => {
	it('accepts a complete partner and names every missing piece of an incomplete one', () => {
		expect(partnerProblems({ ...openai, features: [openai.features[0]] })).toEqual([]);
		const problems = partnerProblems({ id: 'x', features: [{ id: 'y', lane: 'nope', facts: [] }] });
		expect(problems.join('\n')).toMatch(/designation is required/);
		expect(problems.join('\n')).toMatch(/a scenario is required/);
		expect(problems.join('\n')).toMatch(/lane must be one of/);
	});
});

describe('rotation', () => {
	it('features the least recently seen partner in page order, then its least recent feature, rotating heads and patterns', () => {
		const first = pickNext([nvidia, openai], []);
		expect(first.partner.id).toBe('openai');
		expect(first.feature.id).toBe('studio');
		const history = [{ partner: 'openai', feature: 'studio', head: first.head, pattern: first.pattern, day: '2026-10-12' }];
		const second = pickNext([openai, nvidia], history);
		expect(second.partner.id).toBe('nvidia');
		expect(second.head).not.toBe(first.head);
		expect(second.pattern).not.toBe(first.pattern);
		const third = pickNext([openai, nvidia], [...history, { partner: 'nvidia', feature: 'gpu', head: second.head, pattern: second.pattern, day: '2026-10-13' }]);
		expect(third.partner.id).toBe('openai');
		expect(third.feature.id).toBe('ar');
	});

	it('only leads on a number when the feature has one', () => {
		const plain = { ...openai, features: [{ ...openai.features[0], facts: openai.features[0].facts.filter((fact) => !/\d/.test(fact.says)) }] };
		const used = ['mechanism', 'walkthrough', 'clip'].map((pattern, index) => ({ partner: 'x', feature: 'y', head: 'reel', pattern, day: `2026-10-0${index + 1}` }));
		expect(pickNext([plain], used).pattern).not.toBe('number');
		expect(pickNext([openai], used).pattern).toBe('number');
	});

	it('gives each spotlight its own day, after every day already held', () => {
		const items = [
			{ id: 'a', series: 'partners', spotlight: { partner: 'openai', feature: 'studio' }, notBefore: '2026-10-12T00:00:00.000Z', status: 'approved' },
			{ id: 'b', series: 'partners', spotlight: { partner: 'nvidia', feature: 'gpu' }, notBefore: '2026-10-13T00:00:00.000Z', status: 'draft' },
			{ id: 'c', tier: 1, notBefore: '2026-10-14T00:00:00.000Z' },
		];
		const history = spotlights(items);
		expect(history.map((row) => row.partner)).toEqual(['openai', 'nvidia']);
		expect(nextDay(history, Date.parse('2026-10-12T09:00:00Z'))).toBe('2026-10-14');
	});
});

describe('series lint', () => {
	it('passes a thread that states the designation, quotes the facts and tags no one', () => {
		expect(seriesFindings(openai, openai.features[0], GOOD, { partners: [openai, nvidia] })).toEqual([]);
		expect(draftFindings({ partner: openai, feature: openai.features[0], head: 'card', draft: GOOD, partners: [openai, nvidia] })).toEqual([]);
	});

	it('refuses a paraphrased designation, an overstatement, a tag, and a partner the feature does not involve', () => {
		const bad = {
			...GOOD,
			thread: [GOOD.thread[0], 'Proud to be an official OpenAI partner, thanks @OpenAI: three.ws/openai', 'It also runs on NVIDIA GPUs.'],
		};
		const findings = seriesFindings(openai, openai.features[0], bad, { partners: [openai, nvidia] }).join('\n');
		expect(findings).toMatch(/"OpenAI Select Partner", word for word/);
		expect(findings).toMatch(/"official OpenAI" overstates/);
		expect(findings).toMatch(/@openai: the spotlight tags no one/i);
		expect(findings).toMatch(/NVIDIA is another partner/);
	});

	it('refuses a fact set in quotation marks, and copy about where the media sits', () => {
		const draft = { ...GOOD, thread: [...GOOD.thread, 'In its own words, "runs inside ChatGPT". The full reel rides on this reply.'] };
		const findings = seriesFindings(openai, openai.features[0], draft, { partners: [openai] }).join('\n');
		expect(findings).toMatch(/"runs inside ChatGPT" is set in quotation marks/);
		expect(findings).toMatch(/where the media sits/);
	});

	it('holds every number to a fact the registry can prove', () => {
		const draft = { ...GOOD, thread: [...GOOD.thread, 'It answers in 2 seconds and served 40,000 models last month.'] };
		const findings = draftFindings({ partner: openai, feature: openai.features[0], head: 'reel', draft, partners: [openai] }).join('\n');
		expect(findings).toMatch(/"40,000" is an unverified number/);
		expect(findings).not.toMatch(/"2 seconds"/);
	});
});

describe('the item', () => {
	it('builds its claims from the registry and the run, never from the model', () => {
		const texts = [GOOD.post, ...GOOD.thread, 'The run counted 214 avatars.'];
		const claims = claimsFor(openai, openai.features[0], texts, { facts: { avatars: '214' } });
		expect(claims.map((claim) => claim.says)).toEqual(['OpenAI Select Partner', 'eleven keyless 3D tools', 'runs inside ChatGPT', 'no sign-up', '214']);
		expect(claims[0].evidence).toBe(openai.designationEvidence);
		expect(claims[4].evidence).toEqual([{ type: 'proof', fact: 'avatars', equals: '214' }]);
	});

	it('becomes a tier 1 partners-series draft the queue accepts, with the reel moved behind a card', () => {
		const item = itemFor({ partner: openai, feature: openai.features[0], head: 'card', pattern: 'mechanism', day: '2026-10-12', draft: GOOD });
		expect(item).toMatchObject({ id: 'partner-openai-studio-20261012', tier: 1, series: 'partners', spotlight: { partner: 'openai', feature: 'studio', head: 'card' }, notBefore: '2026-10-12T00:00:00.000Z', mentions: {} });
		expect(item.head).toEqual({ as: 'card', headline: GOOD.headline, body: GOOD.body });
		item.posts[0].media = [{ path: 'public/x-media/stand-in.png', alt: 'A frame of three.ws/openai with the eleven tools listed beside a ChatGPT window' }];
		const problems = validateItem(item, process.cwd(), { quality: { maximumLength: 1000 } }).filter((problem) => !/^head:|stand-in/.test(problem));
		expect(problems).toEqual([]);
	});
});

describe('drafting', () => {
	it('feeds the findings back and returns the draft that passes', async () => {
		const replies = [JSON.stringify({ ...GOOD, thread: GOOD.thread.slice(0, 1) }), JSON.stringify(GOOD)];
		const requests = [];
		const call = async (request, { parse }) => {
			requests.push(request);
			return { value: parse(replies.shift()), model: 'stand-in' };
		};
		const brief = buildBrief({ partner: openai, feature: openai.features[0], head: 'card', pattern: 'mechanism', day: '2026-10-12', otherPartners: [nvidia] });
		const result = await draftSpotlight(brief, { partner: openai, feature: openai.features[0], partners: [openai, nvidia] }, { call });
		expect(result.ok).toBe(true);
		expect(result.attempts).toHaveLength(2);
		expect(requests[1].parts[0].text).toMatch(/the thread has 1 replies/);
		expect(requests[0].system).toMatch(/No @mentions anywhere/);
	});

	it('refuses a reply with no JSON in it', () => {
		expect(() => parseDraft('no')).toThrow(/no JSON/);
	});
});

describe('the weekly Article', () => {
	const proven = { ...openai.features[0], facts: [...openai.features[0].facts, { says: 'the run counted the tools', evidence: [{ type: 'proof', fact: 'tools', min: 10 }] }] };
	const runs = [
		{ feature: proven, proof: { facts: { tools: '15' }, video: { durationSec: 12.4 } }, live: { url: 'https://three.ws/api/tools', json: true, body: '{\n  "tools": 15\n}' } },
		{ feature: { ...proven, id: 'ar', title: 'AR in ChatGPT' }, proof: { facts: { hits: '9' }, video: { durationSec: 8 } }, live: null },
	];
	const figures = [1, 2, 3, 4].map((n) => ({ path: `public/x-media/a/f${n}.jpg`, alt: `Frame ${n}` }));

	it('is due a week after the last one, goes to the partner whose Article is oldest, and never counts a spotlight', () => {
		const items = [
			{ id: 'a', kind: 'article', spotlight: { partner: 'openai', article: true }, notBefore: '2026-10-05T00:00:00Z', status: 'posted' },
			{ id: 'b', kind: 'post', series: 'partners', spotlight: { partner: 'nvidia', feature: 'gpu' }, notBefore: '2026-10-09T00:00:00Z', status: 'approved' },
		];
		const rows = partnerArticles(items);
		expect(rows.map((row) => row.id)).toEqual(['a']);
		expect(nextArticleDay(rows, Date.parse('2026-10-08T10:00:00Z'))).toBe('2026-10-12');
		expect(nextArticleDay(rows, Date.parse('2026-10-20T10:00:00Z'))).toBe('2026-10-20');
		expect(nextArticleDay([], Date.parse('2026-10-08T10:00:00Z'))).toBe('2026-10-08');
		expect(pickArticlePartner([openai, nvidia], rows).id).toBe('nvidia');
	});

	it('only lets the lead run speak for facts a run proved', () => {
		expect(articleFacts(proven, { lead: true }).map((fact) => fact.says)).toContain('the run counted the tools');
		expect(articleFacts(proven).map((fact) => fact.says)).not.toContain('the run counted the tools');
	});

	it('builds its code and tables from the registry and the runs', () => {
		const blocks = articleBlocks(openai, runs);
		expect(Object.keys(blocks).sort()).toEqual(['facts-ar', 'facts-studio', 'request-studio', 'runs', 'scenario-ar', 'scenario-studio']);
		expect(blocks.runs).toMatch(/\| Free 3D tools inside ChatGPT \| three\.ws\/openai \| 12\.4 s \| tools = 15 \|/);
		expect(blocks['facts-studio']).toMatch(/\| eleven keyless 3D tools \| three\.ws\/openai shows "eleven keyless 3D tools" \|/);
		expect(blocks['facts-studio']).toMatch(/the run read tools = 15/);
		expect(blocks['facts-ar']).not.toMatch(/the run counted/);
		expect(blocks['request-studio']).toContain("curl -s 'https://three.ws/api/tools'");
		const roster = articleBlocks(openai, runs, [openai, nvidia]).partners;
		expect(roster.split('\n')).toHaveLength(4);
		expect(roster).toContain(`| NVIDIA | ${nvidia.designation} |`);
		const logged = articleBlocks(openai, [{ ...runs[0], proof: { ...runs[0].proof, steps: [{ index: 1, kind: 'goto', target: 'https://three.ws/openai', detail: 'loaded | ok', ok: true, ms: 812 }, { index: 2, kind: 'hold', target: '2500', ok: true, ms: 2500 }] } }]);
		expect(logged['log-studio']).toBe('| Step | Did | On | Result | ms |\n|---|---|---|---|---|\n| 1 | goto | three.ws/openai | passed: loaded \\| ok | 812 |');
		const brief = buildArticleBrief({ partner: openai, runs, figures, blocks, partnersSection: ['OpenAI: Select'], tryIt: [openai.page] });
		expect(brief.features[1].measured).toEqual({});
		expect(brief.blocks.runs).toMatch(/^table:/);
	});

	it('places every block once and the figures by number, and names what is missing', () => {
		const blocks = { runs: '| a |\n|---|', 'facts-x': '| b |\n|---|' };
		const markdown = 'Intro.\n\n{{block:runs}}\n\n{{figure:1}}\n{{figure:2}}\n\n{{block:runs}}\n\n{{block:nope}}\n\nInline {{figure:3}} here.';
		const { body, findings } = assembleArticle(markdown, blocks, figures);
		expect(body).toContain('![Frame 1](/x-media/a/f1.jpg)');
		expect(body.match(/\| a \|/g)).toHaveLength(1);
		expect(findings.join('\n')).toMatch(/block:facts-x\}\} is missing/);
		expect(findings.join('\n')).toMatch(/block:runs\}\} is placed 2 times/);
		expect(findings.join('\n')).toMatch(/block:nope\}\} is not in brief\.blocks/);
		expect(findings.join('\n')).toMatch(/2 figures are placed; place at least 4/);
		expect(findings.join('\n')).toMatch(/not on a line of its own/);
	});

	it('reads the TITLE / POST / body shape and refuses anything else', () => {
		const words = Array.from({ length: 220 }, () => 'word').join(' ');
		expect(parseArticle(`TITLE: A title\nPOST: The post\n---\n${words}`)).toEqual({ title: 'A title', post: 'The post', markdown: words });
		expect(parseArticle(`TITLE: Three.ws and IBM\nPOST: Three.ws met\n---\nThree.ws ran it. ${words}`)).toMatchObject({ title: 'three.ws and IBM', post: 'three.ws met', markdown: expect.stringMatching(/^three\.ws ran it/) });
		expect(() => parseArticle('{"post":"x"}')).toThrow(/TITLE \/ POST/);
	});

	it('holds the prose to the series rules and builds claims for the whole Article', () => {
		const draft = { title: 'How three.ws built for ChatGPT', post: 'A post.', markdown: 'We are an official OpenAI partner, thanks @OpenAI.' };
		const findings = articleSeriesFindings(openai, draft).join('\n');
		expect(findings).toMatch(/"OpenAI Select Partner", word for word/);
		expect(findings).toMatch(/"official OpenAI" overstates/);
		expect(findings).toMatch(/tags no one/);
		expect(findings).toMatch(/title must name OpenAI/);
		expect(findings).toMatch(/link the partner page three\.ws\/openai/);
		const texts = ['We are an OpenAI Select Partner. It runs inside ChatGPT, the run counted the tools, 15 of them, with no sign-up. The other run counted the tools too.'];
		const claims = articleClaims(openai, runs, texts);
		expect(claims.map((claim) => claim.says)).toEqual(['OpenAI Select Partner', 'runs inside ChatGPT', 'no sign-up', 'the run counted the tools', '15']);
	});

	it('becomes an Article item quoted by one post that carries the lead reel', () => {
		const draft = { title: 'T', post: 'P', markdown: 'M' };
		const item = articleItemFor({ partner: openai, runs, day: '2026-10-18', draft, body: 'B', cover: { path: 'public/x-media/a/cover.png', alt: 'c' }, media: { path: 'public/x-media/a/reel.mp4' } });
		expect(item).toMatchObject({ id: 'partner-openai-article-20261018', kind: 'article', tier: 1, spotlight: { partner: 'openai', article: true, features: ['studio', 'ar'] }, article: { title: 'T', body: 'data/x-content/articles/partner-openai-article-20261018.md' }, scenario: proven.scenario });
		expect(item.series).toBeUndefined();
		expect(item.posts[0].media[0].path).toBe('public/x-media/a/reel.mp4');
	});

	it('feeds the gate back until a draft passes', async () => {
		const words = Array.from({ length: 220 }, () => 'word').join(' ');
		const replies = [`TITLE: one\nPOST: p\n---\n${words}`, `TITLE: two\nPOST: p\n---\n${words}`];
		const requests = [];
		const result = await draftArticle({ partner: { guidance: 'g' } }, {
			call: async (request, { parse }) => {
				requests.push(request);
				return { value: parse(replies.shift()), model: 'stand-in' };
			},
			check: (draft) => (draft.title === 'one' ? ['article title is 3 characters'] : []),
		});
		expect(result.ok).toBe(true);
		expect(result.attempts).toHaveLength(2);
		expect(requests[1].parts[0].text).toMatch(/article title is 3 characters/);
		expect(requests[0].system).toMatch(/The partners behind/);
	});
});
