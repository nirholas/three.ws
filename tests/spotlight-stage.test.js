// @vitest-environment jsdom
//
// The /spotlight 3D stage (stageFor in src/spotlight-shared.js). The stage
// layers a still image under a transparent <agent-3d> canvas, so the still must
// leave exactly when the live avatar is ready. It used to wait for a canvas to
// appear, but the component draws inside its shadow root, which the host-level
// observer never saw: the bind-pose still stayed up for the life of the page and
// read as a second, T-posed avatar standing behind the animated one.
import { describe, it, expect } from 'vitest';
import { stageFor } from '../src/spotlight-shared.js';

function entryWith(agent = {}) {
	return {
		id: 'entry-1',
		title: 'An entry',
		agent: {
			id: 'agent-1',
			name: 'Glyph',
			thumbnail: 'https://cdn.example/avatar_og.png',
			glb_url: 'https://cdn.example/avatar.glb',
			...agent,
		},
	};
}

function mountEager(entry) {
	const stage = stageFor(entry, { eager: true });
	document.body.append(stage);
	return {
		stage,
		still: stage.querySelector('.sp-stage-still'),
		viewer: stage.querySelector('agent-3d'),
	};
}

function fire(node, type) {
	node.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
}

describe('stageFor still and viewer handoff', () => {
	it('keeps the still while the viewer has only drawn into its shadow root', () => {
		const { still, viewer } = mountEager(entryWith());
		viewer.attachShadow({ mode: 'open' }).append(document.createElement('canvas'));
		expect(still.classList.contains('is-hidden')).toBe(false);
		expect(viewer.classList.contains('is-ready')).toBe(false);
	});

	it('swaps the still for the viewer once the viewer reports agent:ready', () => {
		const { still, viewer } = mountEager(entryWith());
		fire(viewer, 'agent:ready');
		expect(viewer.classList.contains('is-ready')).toBe(true);
		expect(still.classList.contains('is-hidden')).toBe(true);
		expect(still.getAttribute('aria-hidden')).toBe('true');
		expect(viewer.isConnected).toBe(true);
	});

	it('drops the viewer and keeps the still when boot fails', () => {
		const { stage, still, viewer } = mountEager(entryWith());
		fire(viewer, 'agent:error');
		expect(stage.querySelector('agent-3d')).toBeNull();
		expect(still.classList.contains('is-hidden')).toBe(false);
	});

	it('keeps a ready viewer when a later error (a failed chat send) arrives', () => {
		const { stage, viewer } = mountEager(entryWith());
		fire(viewer, 'agent:ready');
		fire(viewer, 'agent:error');
		expect(stage.querySelector('agent-3d')).toBe(viewer);
	});

	it('mounts exactly one viewer and one still', () => {
		const { stage } = mountEager(entryWith());
		expect(stage.querySelectorAll('agent-3d')).toHaveLength(1);
		expect(stage.querySelectorAll('.sp-stage-still')).toHaveLength(1);
	});

	it('shows only the monogram when the agent has neither thumbnail nor model', () => {
		const { stage } = mountEager(entryWith({ thumbnail: null, glb_url: null }));
		expect(stage.querySelector('agent-3d')).toBeNull();
		expect(stage.querySelector('.sp-mono')).not.toBeNull();
	});
});
