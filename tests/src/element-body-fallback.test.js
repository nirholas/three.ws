// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same stubbing strategy as element-boot-race.test.js, but `ipfs.js` is left
// unmocked here: the fallback compares the *resolved* candidate against
// DEFAULT_AVATAR_GLB, so the test needs uriCandidates()'s real behavior for a
// plain HTTPS URL (one entry, per tests/ipfs-uri-candidates.test.js).
const { state, DEFAULT_AVATAR_GLB, REAL_BODY_URL } = vi.hoisted(() => ({
	state: { failDefaultToo: false },
	DEFAULT_AVATAR_GLB: 'https://three.ws/avatars/default.glb',
	REAL_BODY_URL: 'https://three.ws/api/avatars/test-id/glb',
}));

vi.mock('../../src/viewer.js', () => ({
	Viewer: class {
		constructor(stage) {
			this.stage = stage;
			this.scene = { background: null };
			this.renderer = { setClearAlpha() {} };
		}
		async load(uri) {
			if (uri === DEFAULT_AVATAR_GLB) {
				if (state.failDefaultToo) throw new Error('default avatar also failed');
				return {};
			}
			throw new Error(`body load failed for ${uri}`);
		}
		invalidate() {}
		dispose() {}
	},
}));
vi.mock('../../src/runtime/index.js', () => ({
	Runtime: class extends EventTarget {
		constructor() { super(); }
		destroy() {}
	},
}));
vi.mock('../../src/runtime/scene.js', () => ({
	SceneController: class {
		playClipByName() {}
	},
}));
vi.mock('../../src/skills/index.js', () => ({
	SkillRegistry: class { async install() { return { name: 'x', uri: 'x' }; } all() { return []; } },
}));
vi.mock('../../src/memory/index.js', () => ({
	Memory: { async load() { return { recall() { return []; } }; } },
}));
vi.mock('../../src/manifest.js', () => ({
	loadManifest: vi.fn(async () => ({
		spec: 'agent-manifest/0.1',
		_baseURI: '',
		name: 'Test',
		body: { uri: '' },
		brain: { provider: 'none' },
		voice: {},
		skills: [],
	})),
	fetchRelative: vi.fn(async () => ''),
}));
vi.mock('../../src/agent-resolver.js', () => ({
	resolveAgentById: vi.fn(),
	resolveByAgentId: vi.fn(async () => null),
	AgentResolveError: class extends Error {},
}));
vi.mock('../../src/erc8004/resolver.js', () => ({
	parseAgentRef: () => null,
	resolveOnchainAgent: vi.fn(),
	toManifest: vi.fn(),
}));
vi.mock('../../src/pump/trade-reactions.js', () => ({
	attachTradeReactions: () => () => {},
}));
vi.mock('../../src/embed-action-bridge.js', () => ({ EmbedActionBridge: class { start() {} stop() {} } }));
vi.mock('../../src/agent-protocol.js', () => ({
	protocol: { emit() {}, on() {}, off() {} },
	ACTION_TYPES: {},
}));

globalThis.fetch = vi.fn(async () => ({
	ok: false,
	status: 404,
	json: async () => ({}),
}));

beforeEach(async () => {
	state.failDefaultToo = false;
	if (!customElements.get('agent-3d')) {
		await import('../../src/element.js');
	}
	document.body.innerHTML = '';
});

describe('<agent-3d> body-load fallback', () => {
	it('falls back to the default avatar and reaches ready when the real body fails', async () => {
		const el = document.createElement('agent-3d');
		el.setAttribute('body', REAL_BODY_URL);
		el.setAttribute('eager', '');

		const events = [];
		el.addEventListener('agent:ready', () => events.push('ready'));
		el.addEventListener('agent:error', () => events.push('error'));
		el.addEventListener('agent:body-fallback', (e) => events.push({ type: 'fallback', detail: e.detail }));

		document.body.appendChild(el);
		// Wait on the outcome, not a fixed sleep: on a loaded machine the boot
		// after the fallback can outlast any guess at a duration.
		await vi.waitFor(() => expect(events.some((e) => e === 'ready' || e === 'error')).toBe(true), { timeout: 10_000 });

		expect(events).toContainEqual({
			type: 'fallback',
			detail: { uri: REAL_BODY_URL, fallbackUri: DEFAULT_AVATAR_GLB },
		});
		expect(events).toContain('ready');
		expect(events).not.toContain('error');
		expect(el.shadowRoot.querySelector('.error')).toBeNull();
	});

	it('still shows the existing error path when the default avatar also fails to load', async () => {
		state.failDefaultToo = true;
		const el = document.createElement('agent-3d');
		el.setAttribute('body', REAL_BODY_URL);
		el.setAttribute('eager', '');
		el.setAttribute('chat', '');

		const events = [];
		el.addEventListener('agent:ready', () => events.push('ready'));
		el.addEventListener('agent:error', (e) => events.push({ type: 'error', detail: e.detail }));
		el.addEventListener('agent:body-fallback', () => events.push('fallback'));

		document.body.appendChild(el);
		await vi.waitFor(() => expect(events.some((e) => e === 'ready' || e?.type === 'error')).toBe(true), { timeout: 10_000 });

		expect(events).not.toContain('ready');
		expect(events).not.toContain('fallback');
		expect(events.some((e) => e && e.type === 'error' && e.detail?.phase === 'boot')).toBe(true);
		expect(el.shadowRoot.querySelector('.error')).toBeTruthy();
	});
});
