// @vitest-environment jsdom
// <agent-3d> on a site other than three.ws. Every API call must go to the
// three.ws origin the element's script was loaded from (or an explicit
// `api-base`), never to the host page's origin, and chat mode must give the
// visitor somewhere to type.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SCRIPT_ORIGIN = 'https://three.ws';

// The element derives its API origin from import.meta.url. Under vitest that is
// a file:// URL, so stand in for "this script was served by three.ws".
vi.mock('../../src/shared/embed-api-origin.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, apiOriginFromScriptURL: () => SCRIPT_ORIGIN };
});

vi.mock('../../src/viewer.js', () => ({
	Viewer: class {
		constructor(stage) {
			this.stage = stage;
			this.scene = { background: null };
			this.renderer = { setClearAlpha() {} };
		}
		async load() {}
		dispose() {}
	},
}));
vi.mock('../../src/runtime/index.js', () => ({
	Runtime: class extends EventTarget {
		destroy() {}
	},
	skillAccessFromAgentDetail: () => null,
}));
vi.mock('../../src/runtime/scene.js', () => ({ SceneController: class {} }));
vi.mock('../../src/skills/index.js', () => ({
	SkillRegistry: class {
		async install() {
			return { name: 'x', uri: 'x' };
		}
		all() {
			return [];
		}
	},
}));
vi.mock('../../src/memory/index.js', () => ({
	Memory: {
		async load() {
			return { recall() {
				return [];
			} };
		},
	},
}));
vi.mock('../../src/manifest.js', () => ({
	loadManifest: vi.fn(),
	fetchRelative: vi.fn(async () => ''),
}));
vi.mock('../../src/ipfs.js', () => ({ resolveURI: (u) => u, uriCandidates: (u) => [u] }));
vi.mock('../../src/agent-resolver.js', () => ({
	resolveAgentById: vi.fn(async (id) => ({
		spec: 'agent-manifest/0.1',
		name: 'AxisXV',
		id: { agentId: id },
		body: { uri: 'https://cdn.example/axis.glb' },
		brain: {},
		voice: {},
		skills: [],
		_baseURI: '',
	})),
	resolveByAvatarId: vi.fn(async () => ({
		spec: 'agent-manifest/0.1',
		name: 'Body',
		body: { uri: 'https://cdn.example/body.glb' },
		brain: { provider: 'none' },
		voice: {},
		skills: [],
		_baseURI: '',
	})),
	AgentResolveError: class extends Error {},
}));
vi.mock('../../src/erc8004/resolver.js', () => ({
	parseAgentRef: () => null,
	resolveOnchainAgent: vi.fn(),
	toManifest: vi.fn(),
}));
vi.mock('../../src/pump/trade-reactions.js', () => ({ attachTradeReactions: () => () => {} }));
vi.mock('../../src/embed-action-bridge.js', () => ({
	EmbedActionBridge: class {
		start() {}
		stop() {}
	},
}));
vi.mock('../../src/agent-protocol.js', () => ({
	protocol: { emit() {}, on() {} },
	ACTION_TYPES: {},
}));

globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));

const AGENT_ID = '27a0f649-3b59-4552-bb0b-faf616ac448b';
let resolver;

beforeEach(async () => {
	if (!customElements.get('agent-3d')) await import('../../src/element.js');
	resolver = await import('../../src/agent-resolver.js');
	resolver.resolveAgentById.mockClear();
	resolver.resolveByAvatarId.mockClear();
	document.body.innerHTML = '';
});

describe('<agent-3d> API origin on a third-party page', () => {
	it('resolves agent-id against the script origin, not the host page origin', async () => {
		expect(location.origin).not.toBe(SCRIPT_ORIGIN);
		const el = document.createElement('agent-3d');
		el.setAttribute('agent-id', AGENT_ID);
		const manifest = await el._resolveManifest();
		expect(manifest.name).toBe('AxisXV');
		expect(resolver.resolveAgentById).toHaveBeenCalledWith(AGENT_ID, { origin: SCRIPT_ORIGIN });
	});

	it('resolves avatar-id against the script origin too', async () => {
		const el = document.createElement('agent-3d');
		el.setAttribute('avatar-id', '22222222-2222-4222-8222-222222222222');
		await el._resolveManifest();
		expect(resolver.resolveByAvatarId.mock.calls[0][1].origin).toBe(SCRIPT_ORIGIN);
	});

	it('lets the api-base attribute point the element at another backend', async () => {
		const el = document.createElement('agent-3d');
		el.setAttribute('agent-id', AGENT_ID);
		el.setAttribute('api-base', 'https://agents.bookshop.example/');
		await el._resolveManifest();
		expect(resolver.resolveAgentById).toHaveBeenCalledWith(AGENT_ID, {
			origin: 'https://agents.bookshop.example',
		});
	});

	it('sends no cookies cross-origin and keeps owner-only memory modes local', () => {
		const el = document.createElement('agent-3d');
		expect(el._apiBase()).toBe(SCRIPT_ORIGIN);
		expect(el._apiCredentials()).toBe('omit');
		el.setAttribute('memory', 'remote');
		expect(el._memoryMode({})).toBe('local');
		el.setAttribute('memory', 'none');
		expect(el._memoryMode({})).toBe('none');
	});

	it('treats an api-base on the page origin as first-party (cookies, remote memory)', () => {
		const el = document.createElement('agent-3d');
		el.setAttribute('api-base', location.origin);
		expect(el._apiCredentials()).toBe('include');
		el.setAttribute('memory', 'remote');
		expect(el._memoryMode({})).toBe('remote');
	});
});

describe('<agent-3d> chat composer', () => {
	it('gives chat mode a text field and send button that talk to the agent', () => {
		const el = document.createElement('agent-3d');
		el.setAttribute('chat', '');
		el.setAttribute('body', 'https://cdn.example/body.glb');
		el._renderShell();
		const form = el.shadowRoot.querySelector('form.input-row');
		const input = form.querySelector('input');
		expect(input.getAttribute('aria-label')).toBe('Message to agent');
		expect(form.querySelector('button[type="submit"]').getAttribute('aria-label')).toBe('Send message');

		el.say = vi.fn();
		input.value = '  hello there  ';
		form.dispatchEvent(new Event('submit', { cancelable: true }));
		expect(el.say).toHaveBeenCalledWith('hello there');
		expect(input.value).toBe('');

		el.say.mockClear();
		form.dispatchEvent(new Event('submit', { cancelable: true }));
		expect(el.say).not.toHaveBeenCalled(); // an empty field sends nothing
	});

	it('shows the mic only where speech input can work', () => {
		const el = document.createElement('agent-3d');
		el.setAttribute('chat', '');
		el._renderShell();
		expect(el.shadowRoot.querySelector('button.mic')).toBeNull(); // jsdom has no SpeechRecognition

		const voiced = document.createElement('agent-3d');
		voiced.setAttribute('chat', '');
		voiced.setAttribute('voice-server', 'wss://voice.example');
		voiced._renderShell();
		expect(voiced.shadowRoot.querySelector('button.mic')).not.toBeNull();
	});

	it('builds no composer for a bare avatar', () => {
		const el = document.createElement('agent-3d');
		el.setAttribute('body', 'https://cdn.example/body.glb');
		el._renderShell();
		expect(el.shadowRoot.querySelector('.input-row')).toBeNull();
	});
});
