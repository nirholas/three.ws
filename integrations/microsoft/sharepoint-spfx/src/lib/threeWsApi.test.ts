/**
 * Property pane data layer: input normalisation, record mapping, the
 * debounced search, and live calls against the real three.ws APIs the
 * pickers and web parts use.
 */
import {
	THREE_WS_ORIGIN,
	ThreeWsApiError,
	agentStatus,
	debouncedSearch,
	extractThreeWsId,
	getAgent,
	getModel,
	isThreeWsId,
	normalizeModelUrl,
	searchAgents,
	searchModels,
	toAgentSummary,
	toModelSummary,
} from './threeWsApi';
import { agentItem, resolveTypedAgent, resolveTypedModel } from './pickers';

const ID = '93b7f147-9c7e-4c3e-8547-cebfcb0f985a';
const LIVE_TIMEOUT = 30000;

describe('input normalisation', () => {
	it('recognises three.ws ids', () => {
		expect(isThreeWsId(ID)).toBe(true);
		expect(isThreeWsId(` ${ID.toUpperCase()} `)).toBe(true);
		expect(isThreeWsId('not-an-id')).toBe(false);
		expect(isThreeWsId('')).toBe(false);
	});

	it('only accepts https GLB and glTF URLs', () => {
		expect(normalizeModelUrl('https://cdn.example.org/a/robot.glb')).toBe('https://cdn.example.org/a/robot.glb');
		expect(normalizeModelUrl('https://cdn.example.org/scene.gltf?v=2')).toBe('https://cdn.example.org/scene.gltf?v=2');
		expect(normalizeModelUrl('http://cdn.example.org/robot.glb')).toBe('');
		expect(normalizeModelUrl('https://cdn.example.org/robot.js')).toBe('');
		expect(normalizeModelUrl('data:model/gltf-binary;base64,Z2xURg==#.glb')).toBe('');
		expect(normalizeModelUrl('robot.glb')).toBe('');
	});

	it('pulls ids out of three.ws links and refuses other hosts', () => {
		expect(extractThreeWsId(ID)).toBe(ID);
		expect(extractThreeWsId(`https://three.ws/agents/${ID}`)).toBe(ID);
		expect(extractThreeWsId(`https://three.ws/m/${ID.toUpperCase()}`)).toBe(ID);
		expect(extractThreeWsId(`https://evil.example/agents/${ID}`)).toBe('');
		expect(extractThreeWsId('https://three.ws/agents/')).toBe('');
	});

	it('turns pasted values into selectable picker rows', () => {
		expect(resolveTypedAgent(`https://three.ws/agents/${ID}`)?.value).toBe(ID);
		expect(resolveTypedAgent('hello')).toBeUndefined();
		expect(resolveTypedModel('https://cdn.example.org/robot.glb')?.value).toBe('https://cdn.example.org/robot.glb');
		expect(resolveTypedModel(`https://three.ws/m/${ID}`)?.value).toBe(ID);
		expect(resolveTypedModel('a chair')).toBeUndefined();
	});
});

describe('record mapping', () => {
	it('maps an agent row and resolves relative URLs against three.ws', () => {
		const agent = toAgentSummary({
			id: ID,
			name: '  Ada ',
			avatar_thumbnail: '/cdn/ada.png',
			avatar_model_url: '/cdn/ada.glb',
			home_url: `/agents/${ID}`,
			chat_count: 3,
			last_action_at: null,
		});
		expect(agent).toEqual({
			id: ID,
			name: 'Ada',
			description: '',
			thumbnailUrl: `${THREE_WS_ORIGIN}/cdn/ada.png`,
			modelUrl: `${THREE_WS_ORIGIN}/cdn/ada.glb`,
			pageUrl: `${THREE_WS_ORIGIN}/agents/${ID}`,
			chatCount: 3,
			lastActiveAt: '',
			hasBody: true,
		});
		expect(agentItem(agent!).subtitle).toBe('3 conversations');
	});

	it('drops rows without a valid id, and models without a GLB', () => {
		expect(toAgentSummary({ id: 'x', name: 'A' })).toBeUndefined();
		expect(toModelSummary({ id: ID, title: 'Chair' })).toBeUndefined();
	});

	it('labels image-to-3d creations by their caption', () => {
		const model = toModelSummary({ id: ID, prompt: 'image-to-3d', caption: 'a red armchair', web_glb_url: '/cdn/forge/x.glb' });
		expect(model?.title).toBe('a red armchair');
		expect(model?.description).toBe('');
		expect(model?.glbUrl).toBe(`${THREE_WS_ORIGIN}/cdn/forge/x.glb`);
	});

	it('describes agent status from activity, then conversations', () => {
		const now = Date.parse('2026-11-16T12:00:00Z');
		expect(agentStatus({ lastActiveAt: '2026-11-16T11:59:30Z', chatCount: 0 }, now)).toBe('Active now');
		expect(agentStatus({ lastActiveAt: '2026-11-16T11:30:00Z', chatCount: 0 }, now)).toBe('Active 30 min ago');
		expect(agentStatus({ lastActiveAt: '2026-11-16T07:00:00Z', chatCount: 0 }, now)).toBe('Active 5 h ago');
		expect(agentStatus({ lastActiveAt: '', chatCount: 1 }, now)).toBe('Ready to chat · 1 conversation');
		expect(agentStatus({ lastActiveAt: '', chatCount: 0 }, now)).toBe('Ready to chat');
	});
});

describe('debouncedSearch', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('runs only the last query typed and aborts the one in flight', async () => {
		const seen: string[] = [];
		const signals: AbortSignal[] = [];
		const results: string[] = [];
		const search = debouncedSearch<string>(
			(query, signal) => {
				seen.push(query);
				signals.push(signal);
				return new Promise((resolve) => setTimeout(() => resolve(query.toUpperCase()), 50));
			},
			({ value }) => results.push(value || ''),
			300,
		);
		search('r');
		search('ro');
		search('rob');
		jest.advanceTimersByTime(300);
		expect(seen).toEqual(['rob']);
		search('robot');
		expect(signals[0].aborted).toBe(true);
		jest.advanceTimersByTime(300);
		jest.advanceTimersByTime(50);
		await Promise.resolve();
		expect(seen).toEqual(['rob', 'robot']);
		expect(results).toEqual(['ROBOT']);
	});

	it('reports errors and stops after cancel', async () => {
		const out: Array<{ value?: number; error?: Error }> = [];
		const search = debouncedSearch<number>(() => Promise.reject(new Error('boom')), (r) => out.push(r), 100);
		search('a');
		jest.advanceTimersByTime(100);
		await Promise.resolve();
		await Promise.resolve();
		expect(out[0].error?.message).toBe('boom');
		search('b');
		search.cancel();
		jest.advanceTimersByTime(100);
		await Promise.resolve();
		expect(out).toHaveLength(1);
	});
});

describe('live three.ws APIs', () => {
	it(
		'lists public agents with bodies first, and resolves one by id',
		async () => {
			const agents = await searchAgents('', { limit: 20 });
			expect(agents.length).toBeGreaterThan(0);
			const firstBodyless = agents.findIndex((a) => !a.hasBody);
			if (firstBodyless >= 0) expect(agents.slice(firstBodyless).every((a) => !a.hasBody)).toBe(true);
			const agent = await getAgent(agents[0].id);
			expect(agent.id).toBe(agents[0].id);
			expect(agent.pageUrl.startsWith(`${THREE_WS_ORIGIN}/`)).toBe(true);
		},
		LIVE_TIMEOUT,
	);

	it(
		'searches Forge models and resolves one to a viewable GLB',
		async () => {
			const newest = await searchModels('', { limit: 6 });
			expect(newest.length).toBeGreaterThan(0);
			const found = await searchModels('robot', { limit: 6 });
			expect(found.length).toBeGreaterThan(0);
			const model = await getModel(found[0].id);
			expect(model.id).toBe(found[0].id);
			expect(normalizeModelUrl(model.glbUrl)).toBe(model.glbUrl);
		},
		LIVE_TIMEOUT,
	);

	it(
		'turns a missing agent into a readable 404',
		async () => {
			const missing = '00000000-0000-4000-8000-000000000000';
			await expect(getAgent(missing)).rejects.toMatchObject({ status: 404 });
			await expect(getAgent('nope')).rejects.toBeInstanceOf(ThreeWsApiError);
		},
		LIVE_TIMEOUT,
	);

	it(
		'turns an unreachable host into a network error the owner can act on',
		async () => {
			await expect(searchAgents('a', { origin: 'https://127.0.0.1:9' })).rejects.toMatchObject({ status: 0 });
		},
		LIVE_TIMEOUT,
	);
});
