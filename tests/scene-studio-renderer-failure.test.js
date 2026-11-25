// @vitest-environment jsdom
//
// When no 3D renderer can start (WebGL blocked or unsupported), Scene Studio
// showed a blank viewport: the WebGL constructor's throw rejected createRenderer
// unhandled and nothing on the page explained it. The renderer sidebar now
// records the failure on the editor and announces it, and the empty-state card
// turns into an actionable notice. The failure can be recorded before the card
// mounts, so both orders are covered.

import { describe, it, expect, beforeEach } from 'vitest';
import { mountEmptyState } from '../src/scene-studio/empty-state.js';

function fakeSignal() {
	const fns = [];
	return { add: (fn) => fns.push(fn), dispatch: (...a) => fns.forEach((fn) => fn(...a)) };
}

function fakeEditor(children = []) {
	return {
		rendererError: null,
		scene: { children },
		signals: { sceneGraphChanged: fakeSignal(), editorCleared: fakeSignal() },
	};
}

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('scene studio renderer failure notice', () => {
	it('shows the notice when the failure was recorded before the card mounted', () => {
		const editor = fakeEditor();
		editor.rendererError = 'Error creating WebGL context.';
		const el = mountEmptyState(editor, document.body);
		expect(el.hidden).toBe(false);
		expect(el.textContent).toContain('could not start 3D rendering');
		expect(el.querySelector('[data-se="reload"]')).not.toBeNull();
	});

	it('shows the notice when the failure is announced after mount, even over a restored scene', () => {
		const editor = fakeEditor([{}]);
		const el = mountEmptyState(editor, document.body);
		expect(el.hidden).toBe(true);
		window.dispatchEvent(new CustomEvent('tws-scene-renderer-failed', { detail: { message: 'x' } }));
		expect(el.hidden).toBe(false);
		editor.signals.sceneGraphChanged.dispatch();
		expect(el.hidden).toBe(false);
		expect(el.textContent).toContain('hardware acceleration');
	});

	it('keeps the first-run card when the renderer started', () => {
		const editor = fakeEditor();
		const el = mountEmptyState(editor, document.body);
		expect(el.hidden).toBe(false);
		expect(el.textContent).toContain('Start with a model');
	});
});
