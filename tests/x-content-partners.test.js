import { describe, expect, it } from 'vitest';
import { buildBrief, claimsFor, draftFindings, draftSpotlight, itemFor, nextDay, parseDraft, partnerProblems, pickNext, seriesFindings, spotlights } from '../api/_lib/x-content/partners.js';
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
