// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the heavy Viewer + runtime deps so element.js can be imported under
// jsdom without WebGL / three.js bootstrapping. We're only exercising the
// element's lifecycle plumbing here, not rendering.
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
		constructor() { super(); }
		destroy() {}
	},
}));
vi.mock('../../src/runtime/scene.js', () => ({ SceneController: class {} }));
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
vi.mock('../../src/ipfs.js', () => ({ resolveURI: (u) => u }));
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
	protocol: { emit() {}, on() {} },
	ACTION_TYPES: {},
}));

// Stub network so manifest resolution doesn't reach out.
globalThis.fetch = vi.fn(async () => ({
	ok: false,
	status: 404,
	json: async () => ({}),
}));

beforeEach(async () => {
	// Fresh module each time so the customElements.define guard re-evaluates
	// against a clean registry. jsdom's registry persists across the file, so
	// we only need a single import.
	if (!customElements.get('agent-3d')) {
		await import('../../src/element.js');
	}
	document.body.innerHTML = '';
});

describe('<agent-3d> boot race', () => {
	it('does not throw "Cannot set properties of undefined" when attributes are pre-set in HTML', async () => {
		// Spy console.error so we can detect the original race-condition crash.
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		// Parser-style insertion: attributes set before the element is connected
		// (and before connectedCallback runs). innerHTML mimics the production
		// snippet path that triggered the original bug.
		document.body.innerHTML =
			'<agent-3d agent-id="11111111-1111-1111-1111-111111111111" eager></agent-3d>';
		const el = document.body.firstElementChild;

		// Yield so any queued microtasks / async _boot work runs.
		await new Promise((r) => setTimeout(r, 0));

		const undefHiddenCalls = errSpy.mock.calls.filter((args) =>
			args.some(
				(a) =>
					a &&
					(typeof a === 'string' ? a : a.message || '').includes(
						"Cannot set properties of undefined (setting 'hidden')",
					),
			),
		);
		expect(undefHiddenCalls).toHaveLength(0);

		// Sanity: the shell rendered, so the loading element exists in shadow DOM.
		expect(el.shadowRoot.querySelector('.loading')).toBeTruthy();

		errSpy.mockRestore();
	});

	it('boots cleanly when agent-id is set programmatically before connection', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const el = document.createElement('agent-3d');
		// Set the source attribute before the element is in the DOM. This drives
		// attributeChangedCallback before connectedCallback.
		el.setAttribute('agent-id', '11111111-1111-1111-1111-111111111111');
		el.setAttribute('eager', '');
		document.body.appendChild(el);

		await new Promise((r) => setTimeout(r, 0));

		const undefHiddenCalls = errSpy.mock.calls.filter((args) =>
			args.some(
				(a) =>
					a &&
					(typeof a === 'string' ? a : a.message || '').includes(
						"Cannot set properties of undefined (setting 'hidden')",
					),
			),
		);
		expect(undefHiddenCalls).toHaveLength(0);
		expect(el.shadowRoot.querySelector('.loading')).toBeTruthy();

		errSpy.mockRestore();
	});
});
