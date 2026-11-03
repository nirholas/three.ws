// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.stubGlobal(
	'fetch',
	vi.fn(async () => ({ ok: true, json: async () => [] })),
);

const { mountManifestBuilder } = await import('../src/editor/manifest-builder.js');

describe('mountManifestBuilder', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		localStorage.clear();
	});

	it('mounts without an agentId and offers the save-first persona hint', () => {
		const root = document.createElement('div');
		document.body.appendChild(root);
		const { host } = mountManifestBuilder(root, {});
		expect(host.shadowRoot.innerHTML).toContain('Save the agent first');
	});

	it('mounts with an agentId and wires the persona interview', () => {
		const root = document.createElement('div');
		document.body.appendChild(root);
		const { host } = mountManifestBuilder(root, { agentId: 'agent-1' });
		expect(host.shadowRoot.querySelector('#btn-persona-start')).not.toBeNull();
	});

	it('renders the skill tag filter chips once the skills index loads', async () => {
		fetch.mockImplementationOnce(async () => ({
			ok: true,
			json: async () => [{ id: 's1', name: 'S1', tags: ['solana'] }],
		}));
		const root = document.createElement('div');
		document.body.appendChild(root);
		const { host } = mountManifestBuilder(root, {});
		await new Promise((r) => setTimeout(r, 20));
		expect(host.shadowRoot.querySelector('.skill-chip[data-tag="solana"]')).not.toBeNull();
	});
});
