/**
 * loadAvatar — unit tests
 *
 * Uses the Node built-in test runner (node:test) with a lightweight DOM shim.
 * No real script is loaded — we assert on the elements created and the
 * `src` attribute of the injected script tag.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal DOM shim
// ---------------------------------------------------------------------------

class FakeNode {
	constructor(tag) {
		this.tagName = String(tag || '').toUpperCase();
		this.children = [];
		this.parent = null;
		this.attributes = {};
		this.dataset = {};
		this.style = {};
		this._listeners = {};
	}
	setAttribute(k, v) { this.attributes[k] = String(v); }
	getAttribute(k) { return this.attributes[k]; }
	appendChild(child) {
		child.parent = this;
		this.children.push(child);
		// Auto-fire load on injected scripts so loadAvatar's await resolves.
		if (child.tagName === 'SCRIPT') {
			queueMicrotask(() => child._fire('load'));
		}
		return child;
	}
	remove() {
		if (this.parent) {
			const idx = this.parent.children.indexOf(this);
			if (idx >= 0) this.parent.children.splice(idx, 1);
		}
	}
	addEventListener(type, fn) {
		(this._listeners[type] ||= []).push(fn);
	}
	_fire(type) {
		(this._listeners[type] || []).forEach((fn) => fn({ type }));
	}
	querySelector(_sel) { return null; }
}

class FakeElement extends FakeNode {}

function installDom() {
	const document = {
		head: new FakeNode('head'),
		body: new FakeNode('body'),
		createElement(tag) {
			if (tag === 'script') {
				const n = new FakeNode('script');
				Object.defineProperty(n, 'src', {
					get() { return this.attributes.src; },
					set(v) { this.attributes.src = String(v); },
				});
				return n;
			}
			return new FakeElement(tag);
		},
		querySelector(_sel) { return null; },
	};
	const customElements = {
		_defined: new Set(),
		get(name) { return this._defined.has(name) ? function () {} : undefined; },
		whenDefined(name) {
			if (this._defined.has(name)) return Promise.resolve();
			return new Promise((resolve) => {
				const i = setInterval(() => {
					if (this._defined.has(name)) { clearInterval(i); resolve(); }
				}, 5);
			});
		},
		_define(name) { this._defined.add(name); },
	};
	global.document = document;
	global.customElements = customElements;
	// Element ctor presence so instanceof checks pass for our fake nodes
	global.Element = FakeNode;
}

beforeEach(() => {
	installDom();
	// Reset the module's internal cache between tests by re-importing fresh.
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('loadAvatar injects the agent-3d script and mounts the element', async () => {
	const { loadAvatar } = await import(`../src/avatar.js?fresh=${Date.now()}`);

	// Resolve customElements.whenDefined as soon as the script's onload fires.
	const origAppend = global.document.head.appendChild.bind(global.document.head);
	global.document.head.appendChild = function (node) {
		origAppend(node);
		if (node.tagName === 'SCRIPT') global.customElements._define('agent-3d');
		return node;
	};

	const container = global.document.createElement('div');
	const handle = await loadAvatar({ agentId: 'agt_test_123', container });

	// One script was added to <head>, pointing at the default CDN.
	const scripts = global.document.head.children.filter((c) => c.tagName === 'SCRIPT');
	assert.equal(scripts.length, 1);
	assert.equal(scripts[0].attributes.src, 'https://three.ws/agent-3d/latest/agent-3d.js');
	assert.equal(scripts[0].attributes.crossorigin || scripts[0].crossOrigin, 'anonymous');

	// One agent-3d element was added to the container.
	assert.equal(container.children.length, 1);
	const el = container.children[0];
	assert.equal(el.tagName, 'AGENT-3D');
	assert.equal(el.getAttribute('agent-id'), 'agt_test_123');
	assert.equal(el.getAttribute('controls'), 'orbit');
	assert.equal(typeof handle.dispose, 'function');
	assert.equal(typeof handle.playAnimation, 'function');

	handle.dispose();
	assert.equal(container.children.length, 0);
});

test('loadAvatar honours custom cdnUrl, controls, width, height, and extra attrs', async () => {
	const { loadAvatar } = await import(`../src/avatar.js?fresh=${Date.now()}`);

	const origAppend = global.document.head.appendChild.bind(global.document.head);
	global.document.head.appendChild = function (node) {
		origAppend(node);
		if (node.tagName === 'SCRIPT') global.customElements._define('agent-3d');
		return node;
	};

	const container = global.document.createElement('div');
	await loadAvatar({
		agentId: 'agt_xyz',
		container,
		controls: 'none',
		cdnUrl: 'https://cdn.example.com/agent-3d.js',
		width: '480px',
		height: '320px',
		attrs: { 'data-theme': 'dark', 'bg': 'transparent' },
	});

	const script = global.document.head.children.find((c) => c.tagName === 'SCRIPT');
	assert.equal(script.attributes.src, 'https://cdn.example.com/agent-3d.js');

	const el = container.children[0];
	assert.equal(el.getAttribute('controls'), 'none');
	assert.equal(el.style.width, '480px');
	assert.equal(el.style.height, '320px');
	assert.equal(el.getAttribute('data-theme'), 'dark');
	assert.equal(el.getAttribute('bg'), 'transparent');
});

test('loadAvatar rejects missing agentId or container', async () => {
	const { loadAvatar } = await import(`../src/avatar.js?fresh=${Date.now()}`);
	await assert.rejects(() => loadAvatar({}), /agentId is required/);
	await assert.rejects(() => loadAvatar({ agentId: 'x' }), /container must be a DOM element/);
});
