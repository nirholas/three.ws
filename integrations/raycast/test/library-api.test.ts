import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForgeClient, ForgeError, needsApiKey } from '../src/forge-api';

// Recorded from production by test/record-library-fixtures.mjs.
interface Exchange {
	path: string;
	status: number;
	body: Record<string, unknown>;
}
function load(name: string): Exchange[] {
	return (
		JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as {
			exchanges: Exchange[];
		}
	).exchanges;
}
const search = load('catalog-search.json');
const items = load('catalog-item.json');
const mine = load('my-models.json');

function replay(exchanges: Exchange[]) {
	const calls: Array<{ url: string; headers: Record<string, string> }> = [];
	let index = 0;
	const fetchImpl = (async (url: string, init?: RequestInit) => {
		calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
		const next = exchanges[Math.min(index, exchanges.length - 1)];
		index += 1;
		return new Response(JSON.stringify(next.body), { status: next.status });
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

const KEY = 'sk_live_test_only';

describe('catalog search against recorded production responses', () => {
	it('reads a page, its totals and the next offset, and never sends the API key', async () => {
		const { fetchImpl, calls } = replay([search[0]]);
		const client = new ForgeClient({ clientHandle: 't', apiKey: KEY, fetchImpl });
		const page = await client.searchCatalog({ query: ' wooden chair ', limit: 3 });
		expect(calls[0].url).toBe('https://three.ws/api/catalog?limit=3&q=wooden+chair');
		expect(calls[0].headers.authorization).toBeUndefined();
		expect(page.items).toHaveLength(3);
		expect(page.items[0].id).toBe((search[0].body.items as Array<{ id: string }>)[0].id);
		expect(page.items[0].url).toMatch(/\.glb$/);
		expect(page.matched).toBe(search[0].body.matched);
		expect(page.total).toBeGreaterThan(page.matched);
		expect(page.nextOffset).toBe(3);
		expect(page.relaxed).toBe(false);
	});

	it('passes the offset and kind, and reports the last page with a null offset', async () => {
		const { fetchImpl, calls } = replay([search[1]]);
		const client = new ForgeClient({ clientHandle: 't', fetchImpl });
		await client.searchCatalog({ query: 'wooden chair', kind: 'object', offset: 3, limit: 3 });
		expect(calls[0].url).toBe(
			'https://three.ws/api/catalog?limit=3&q=wooden+chair&kind=object&offset=3',
		);

		const { fetchImpl: emptyFetch } = replay([search[2]]);
		const empty = await new ForgeClient({
			clientHandle: 't',
			fetchImpl: emptyFetch,
		}).searchCatalog({
			query: 'zzqxv flurb',
		});
		expect(empty.items).toEqual([]);
		expect(empty.matched).toBe(0);
		expect(empty.nextOffset).toBeNull();
	});

	it('leaves q out of an empty search so the whole catalog browses', async () => {
		const { fetchImpl, calls } = replay([search[0]]);
		await new ForgeClient({ clientHandle: 't', fetchImpl }).searchCatalog({ query: '   ' });
		expect(calls[0].url).toBe('https://three.ws/api/catalog?limit=30');
	});

	it("reads an object's links and snippets with the kind's default framework first", async () => {
		const { fetchImpl, calls } = replay([items[0]]);
		const detail = await new ForgeClient({
			clientHandle: 't',
			apiKey: KEY,
			fetchImpl,
		}).catalogItem(String((items[0].body.item as { id: string }).id));
		expect(calls[0].url).toMatch(/^https:\/\/three\.ws\/api\/catalog\?id=object%3A/);
		expect(calls[0].headers.authorization).toBeUndefined();
		expect(detail.links.preview).toMatch(/^https:\/\/three\.ws\//);
		expect(detail.frameworks[0]).toBe((items[0].body.frameworks as string[])[0]);
		expect(detail.snippets[detail.frameworks[0]].code.length).toBeGreaterThan(20);
	});

	it('reads an animation clip, which has no thumbnail and a clip JSON url', async () => {
		const { fetchImpl } = replay([items[1]]);
		const detail = await new ForgeClient({ clientHandle: 't', fetchImpl }).catalogItem(
			'animation:x',
		);
		expect(detail.item.kind).toBe('animation');
		expect(detail.item.thumb).toBeNull();
		expect(detail.item.url).toMatch(/\.json$/);
		expect(detail.frameworks.every((f) => detail.snippets[f])).toBe(true);
	});
});

describe('My Models against recorded production responses', () => {
	it("lists the key owner's models with the bearer and pages with nextBefore", async () => {
		const { fetchImpl, calls } = replay([mine[0], mine[1]]);
		const client = new ForgeClient({ clientHandle: 't', apiKey: KEY, fetchImpl });
		const first = await client.listMyModels({ limit: 2 });
		expect(calls[0].url).toBe('https://three.ws/api/forge/mine?limit=2');
		expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
		expect(first.models).toHaveLength(2);
		expect(first.models[0].modelUrl).toMatch(/^https:\/\/three\.ws\/m\//);
		expect(first.nextBefore).toBe(mine[0].body.nextBefore);

		const second = await client.listMyModels({ limit: 2, before: first.nextBefore });
		expect(calls[1].url).toBe(
			`https://three.ws/api/forge/mine?limit=2&before=${encodeURIComponent(String(first.nextBefore))}`,
		);
		expect(second.models[0].id).not.toBe(first.models[0].id);
	});

	it('refuses without a key before touching the network', async () => {
		const { fetchImpl, calls } = replay([mine[0]]);
		const error = await new ForgeClient({ clientHandle: 't', fetchImpl })
			.listMyModels()
			.catch((e) => e);
		expect(error).toBeInstanceOf(ForgeError);
		expect(needsApiKey(error)).toBe(true);
		expect(calls).toHaveLength(0);
	});

	it("turns the recorded 401 into a key error that carries the server's sentence", async () => {
		const { fetchImpl } = replay([mine[mine.length - 1]]);
		const error = await new ForgeClient({
			clientHandle: 't',
			apiKey: 'sk_live_revoked',
			fetchImpl,
		})
			.listMyModels()
			.catch((e) => e);
		expect(error).toBeInstanceOf(ForgeError);
		expect(error.status).toBe(401);
		expect(error.message).toBe(mine[mine.length - 1].body.error_description);
		expect(needsApiKey(error)).toBe(true);
	});
});
