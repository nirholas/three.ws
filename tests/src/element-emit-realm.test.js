// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// element.js pulls in a WebGL Viewer and the dat.GUI debug panel on boot,
// neither of which survives jsdom. Nothing here exercises rendering: the
// subject is _emit, which runs entirely in the DOM.
vi.mock('../../src/viewer.js', () => ({ Viewer: class {} }));
vi.mock('dat.gui', () => ({
	GUI: class {
		addFolder() { return this; }
		add() { return { onChange: () => this, name: () => this }; }
		addColor() { return { onChange: () => this, name: () => this }; }
		destroy() {}
	},
}));

import '../../src/element.js';

// Stands in for the CustomEvent an element is left holding once its realm has
// moved on: a constructor whose products the element's own dispatchEvent
// refuses as "not of type 'Event'". That is exactly what a host page hands the
// element after an SPA remount, and what a test runner hands it when it
// restores the platform globals it swapped out for a DOM.
class ForeignCustomEvent {
	constructor(type, init = {}) {
		this.type = type;
		this.detail = init.detail;
	}
}

const withForeignCustomEvent = (view, run) => {
	const original = view.CustomEvent;
	view.CustomEvent = ForeignCustomEvent;
	try {
		return run();
	} finally {
		view.CustomEvent = original;
	}
};

describe('<agent-3d> event dispatch across a lost realm', () => {
	it('delivers an event normally when the realm is intact', () => {
		const el = document.createElement('agent-3d');
		document.body.appendChild(el);

		const seen = [];
		el.addEventListener('agent:error', (e) => seen.push(e.detail));
		el._emit('agent:error', { phase: 'boot' }, { bubbles: true, composed: true });

		expect(seen).toEqual([{ phase: 'boot' }]);
	});

	it('drops the event instead of throwing when the realm no longer accepts it', () => {
		const el = document.createElement('agent-3d');
		document.body.appendChild(el);
		const view = el.ownerDocument.defaultView;

		const seen = [];
		el.addEventListener('agent:error', (e) => seen.push(e.detail));

		withForeignCustomEvent(view, () => {
			// The whole point: this is called from inside _boot's catch, so a throw
			// here turns a handled boot failure into an unhandled rejection that
			// fails the process rather than the element.
			expect(() =>
				el._emit('agent:error', { phase: 'boot' }, { bubbles: true, composed: true }),
			).not.toThrow();
		});

		// Nobody was reachable, so nothing was delivered. That is the correct
		// outcome, not a swallowed delivery.
		expect(seen).toEqual([]);
	});

	it('lets a boot failure settle after the realm is gone without an unhandled rejection', async () => {
		const el = document.createElement('agent-3d');
		document.body.appendChild(el);
		const view = el.ownerDocument.defaultView;

		// Let the connect-time boot settle first. The stubbed Viewer has no load(),
		// so it fails, runs the catch, and leaves the element bootable again --
		// _boot() early-returns while _booting is still true.
		const settle = async () => {
			for (let i = 0; i < 200 && el._booting; i += 1) {
				await new Promise((r) => setTimeout(r, 5));
			}
		};
		await settle();
		expect(el._booting).toBe(false);
		expect(el._mounted).toBeFalsy();

		const rejections = [];
		const onRejection = (err) => rejections.push(err);
		process.on('unhandledRejection', onRejection);

		try {
			const original = view.CustomEvent;
			view.CustomEvent = ForeignCustomEvent;
			try {
				// Fire-and-forget, exactly how every production caller invokes it.
				// Nothing is holding this promise, so a throw out of the catch block
				// has nowhere to go but the process.
				el._boot();
				await settle();
			} finally {
				view.CustomEvent = original;
			}
			// Give a rejection a turn to surface before we stop listening.
			await new Promise((r) => setTimeout(r, 10));
		} finally {
			process.off('unhandledRejection', onRejection);
		}

		expect(rejections).toEqual([]);
	});
});
