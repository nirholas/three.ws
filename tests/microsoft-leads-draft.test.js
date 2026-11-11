// Drafted replies for Microsoft Marketplace leads (api/_lib/microsoft-leads.js).
// Regression cover for two defects seen against the live free LLM lanes on
// 2026-11-11: a lane answering 200 with a few tokens of mixed-script noise
// ("周当Create type.!.Е") was accepted or failed the lead outright instead of
// failing over, and a failed "Draft again" flipped a lead that already had a
// good draft back to failed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const llmComplete = vi.fn();
const providerChain = vi.fn();
vi.mock('../api/_lib/llm.js', () => ({ llmComplete: (...a) => llmComplete(...a), providerChain: (...a) => providerChain(...a) }));

const queries = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		const text = strings.join('?');
		queries.push({ text, values });
		return Promise.resolve([{ id: 'lead-1', text, values }]);
	},
}));

const { draftLooksUsable, draftReply } = await import('../api/_lib/microsoft-leads.js');

const GOOD = `Subject: Your three.ws Marketplace enquiry

Hi Avery,

Thank you for reaching out about three.ws on Microsoft Marketplace. three.ws gives your team 3D AI agents and a creation pipeline your people can use from Microsoft Teams and the browser.

Could you share what you would like to build first? I am happy to set up a short call this week.

The three.ws team`;

const ROW = {
	id: 'lead-1',
	action: 'PLT',
	source: 'AzureMarketplace',
	offer_id: 'three-ws',
	offer_title: 'three.ws',
	first_name: 'Avery',
	company: 'Contoso',
	draft_body: null,
};

const chain = [
	{ name: 'kilo', model: 'free-a', url: 'https://kilo.example/v1' },
	{ name: 'kilo:super', model: 'free-a2', url: 'https://kilo.example/v1' },
	{ name: 'ovh', model: 'free-b', url: 'https://ovh.example/v1' },
	{ name: 'vertex', model: 'gemini', url: 'https://vertex.example/v1' },
];

beforeEach(() => {
	queries.length = 0;
	llmComplete.mockReset();
	providerChain.mockReset();
	providerChain.mockReturnValue(chain);
});

describe('draftLooksUsable', () => {
	it('accepts a real reply', async () => {
		const { parseDraft } = await import('../api/_lib/microsoft-leads.js');
		expect(draftLooksUsable(parseDraft(GOOD))).toBe(true);
	});
	it.each([
		['mixed-script noise', '周当Create type.!.Е"'],
		['dash noise', '-P guerreCómo乱\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014-Re'],
		['too short', 'Subject: Hi\n\nThanks, we will be in touch. The three.ws team'],
		['no subject line', GOOD.replace(/^Subject: .*\n\n/, '')],
		['mostly non-Latin', `Subject: 你好\n\n${'你好，感谢您的关注。'.repeat(30)} three.ws`],
	])('rejects %s', async (_label, text) => {
		const { parseDraft } = await import('../api/_lib/microsoft-leads.js');
		expect(draftLooksUsable(parseDraft(text))).toBe(false);
	});
});

describe('draftReply', () => {
	it('fails over past a lane that returns noise, skipping its sibling lanes, and records the lane that answered', async () => {
		llmComplete
			.mockResolvedValueOnce({ text: '周当Create type.!.Е"', provider: 'kilo', model: 'free-a' })
			.mockResolvedValueOnce({ text: GOOD, provider: 'ovh', model: 'free-b' });
		await draftReply(ROW, { timeoutMs: 20_000 });
		expect(llmComplete).toHaveBeenCalledTimes(2);
		expect(llmComplete.mock.calls[0][0].chain).toBeUndefined();
		expect(llmComplete.mock.calls[1][0].chain.map((p) => p.name)).toEqual(['ovh']);
		const update = queries.at(-1);
		expect(update.text).toContain("draft_status = 'ready'");
		expect(update.values).toContain('ovh');
	});

	it('marks the draft failed when every attempt is unusable and there is no earlier draft', async () => {
		llmComplete.mockResolvedValue({ text: 'noise', provider: 'kilo', model: 'free-a' });
		await draftReply(ROW, { timeoutMs: 20_000 });
		const update = queries.at(-1);
		expect(update.text).toMatch(/case when draft_body is not null then 'ready' else 'failed' end/);
		expect(update.values.join(' ')).toMatch(/unusable/);
	});

	it('keeps an earlier good draft ready when a redraft fails', async () => {
		llmComplete.mockRejectedValue(new Error('every lane timed out'));
		await draftReply({ ...ROW, draft_body: 'an earlier reply' }, { timeoutMs: 20_000 });
		const update = queries.at(-1);
		expect(update.text).toMatch(/case when draft_body is not null then 'ready' else 'failed' end/);
		expect(update.text).not.toContain('draft_body = ');
	});
});
