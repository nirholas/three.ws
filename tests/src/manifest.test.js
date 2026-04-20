import { describe, it, expect } from 'vitest';
import { normalize } from '../../src/manifest.js';

describe('normalize — full agent-manifest', () => {
	it('preserves manifest fields and stamps _baseURI', () => {
		const input = {
			spec: 'agent-manifest/0.1',
			name: 'Nich',
			description: 'a friend',
			body: { uri: 'avatar.glb', format: 'gltf-binary' },
			brain: { provider: 'anthropic' },
		};
		const m = normalize(input, { baseURI: 'https://example.com/agents/nich/' });
		expect(m.spec).toBe('agent-manifest/0.1');
		expect(m.name).toBe('Nich');
		expect(m._baseURI).toBe('https://example.com/agents/nich/');
		expect(m.body.uri).toBe('avatar.glb');
		expect(m.brain.provider).toBe('anthropic');
	});

	it('fills body.uri from top-level image when body.uri is missing', () => {
		const input = {
			spec: 'agent-manifest/0.1',
			name: 'Nich',
			image: 'thumbnail.glb',
		};
		const m = normalize(input, { baseURI: '' });
		expect(m.body.uri).toBe('thumbnail.glb');
	});

	it('does not overwrite existing body.uri with image', () => {
		const input = {
			spec: 'agent-manifest/0.1',
			image: 'thumb.glb',
			body: { uri: 'avatar.glb' },
		};
		const m = normalize(input, { baseURI: '' });
		expect(m.body.uri).toBe('avatar.glb');
	});

	it('defaults baseURI to empty string when not provided', () => {
		const input = { spec: 'agent-manifest/0.1', name: 'x' };
		const m = normalize(input);
		expect(m._baseURI).toBe('');
	});

	it('accepts spec prefix agent-manifest/ with any version suffix', () => {
		const input = { spec: 'agent-manifest/0.99', name: 'future' };
		const m = normalize(input, { baseURI: 'x' });
		expect(m.name).toBe('future');
	});
});

describe('normalize — ERC-8004 registration', () => {
	it('adapts eip-8004 registration JSON to manifest shape', () => {
		const input = {
			type: ['AgentRegistration', 'eip-8004'],
			name: 'OnChainBot',
			description: 'registered agent',
			image: 'https://example.com/thumb.png',
			registrations: [{ agentId: '42' }],
			services: [
				{
					name: 'avatar',
					type: 'service/avatar/3d+gltf',
					endpoint: 'https://cdn.example/bot.glb',
				},
			],
		};
		const m = normalize(input, { baseURI: 'https://example.com/' });
		expect(m.spec).toBe('agent-manifest/0.1');
		expect(m._source).toBe('erc8004-registration');
		expect(m.id.agentId).toBe('42');
		expect(m.name).toBe('OnChainBot');
		expect(m.body.uri).toBe('https://cdn.example/bot.glb');
		expect(m.body.format).toBe('gltf-binary');
		expect(m.brain.provider).toBe('none');
		expect(m.memory.mode).toBe('local');
		expect(m.tools).toContain('wave');
	});

	it('falls back to image when no avatar service declared', () => {
		const input = {
			type: ['eip-8004'],
			name: 'NoAvatar',
			image: 'https://example.com/fallback.glb',
			registrations: [{ agentId: '1' }],
			services: [],
		};
		const m = normalize(input, { baseURI: '' });
		expect(m.body.uri).toBe('https://example.com/fallback.glb');
	});

	it('coerces agentId to string', () => {
		const input = {
			type: ['eip-8004'],
			registrations: [{ agentId: 123 }],
			image: 'x',
		};
		const m = normalize(input, { baseURI: '' });
		expect(typeof m.id.agentId).toBe('string');
		expect(m.id.agentId).toBe('123');
	});

	it('handles missing registrations array', () => {
		const input = { type: ['eip-8004'], image: 'x' };
		const m = normalize(input, { baseURI: '' });
		expect(m.id.agentId).toBeUndefined();
	});

	it('preserves services array', () => {
		const svcs = [
			{ name: 'avatar', endpoint: 'https://a.glb' },
			{ name: 'chat', endpoint: 'https://chat' },
		];
		const input = {
			type: ['eip-8004'],
			registrations: [{ agentId: '1' }],
			image: 'x',
			services: svcs,
		};
		const m = normalize(input, { baseURI: '' });
		expect(m.services).toEqual(svcs);
	});

	it('defaults services to empty array when not provided', () => {
		const input = { type: ['eip-8004'], registrations: [{ agentId: '1' }], image: 'x' };
		const m = normalize(input, { baseURI: '' });
		expect(m.services).toEqual([]);
	});

	it('defaults services to empty array when not an array', () => {
		const input = {
			type: ['eip-8004'],
			registrations: [{ agentId: '1' }],
			image: 'x',
			services: 'not-an-array',
		};
		const m = normalize(input, { baseURI: '' });
		expect(m.services).toEqual([]);
	});

	it('coerces x402Support to boolean', () => {
		const trueCase = normalize(
			{
				type: ['eip-8004'],
				registrations: [{ agentId: '1' }],
				image: 'x',
				x402Support: { version: 1 },
			},
			{ baseURI: '' },
		);
		expect(trueCase.x402Support).toBe(true);

		const falseCase = normalize(
			{ type: ['eip-8004'], registrations: [{ agentId: '1' }], image: 'x' },
			{ baseURI: '' },
		);
		expect(falseCase.x402Support).toBe(false);
	});

	it('preserves embedPolicy when provided', () => {
		const policy = { allowedOrigins: ['*'] };
		const m = normalize(
			{
				type: ['eip-8004'],
				registrations: [{ agentId: '1' }],
				image: 'x',
				embedPolicy: policy,
			},
			{ baseURI: '' },
		);
		expect(m.embedPolicy).toEqual(policy);
	});

	it('defaults embedPolicy to null', () => {
		const m = normalize(
			{ type: ['eip-8004'], registrations: [{ agentId: '1' }], image: 'x' },
			{ baseURI: '' },
		);
		expect(m.embedPolicy).toBeNull();
	});

	it('resolves ipfs:// URI in body.uri', () => {
		const input = {
			type: ['eip-8004'],
			registrations: [{ agentId: '1' }],
			image: 'ipfs://bafkrei123',
		};
		const m = normalize(input, { baseURI: '' });
		expect(m.body.uri).toMatch(/^https:\/\//);
		expect(m.body.uri).toContain('bafkrei123');
	});
});

describe('normalize — fallback / unknown input', () => {
	it('produces a best-effort manifest from minimal input', () => {
		const m = normalize({ name: 'Mystery' }, { baseURI: '' });
		expect(m.spec).toBe('agent-manifest/0.1');
		expect(m.name).toBe('Mystery');
		expect(m.body.format).toBe('gltf-binary');
		expect(m.brain).toEqual({ provider: 'none' });
		expect(m.memory).toEqual({ mode: 'local' });
		expect(m.version).toBe('0.1.0');
	});

	it('uses body.uri, image, or model as fallback hierarchy', () => {
		expect(normalize({ body: { uri: 'a.glb' } }).body.uri).toBe('a.glb');
		expect(normalize({ image: 'b.glb' }).body.uri).toBe('b.glb');
		expect(normalize({ model: 'c.glb' }).body.uri).toBe('c.glb');
	});

	it('supplies defaults for missing optional fields', () => {
		const m = normalize({}, { baseURI: '' });
		expect(m.name).toBe('Unnamed agent');
		expect(m.description).toBe('');
		expect(m.body.uri).toBe('');
		expect(Array.isArray(m.skills)).toBe(true);
		expect(m.tools).toContain('play_clip');
	});

	it('preserves user-provided brain config', () => {
		const m = normalize(
			{ brain: { provider: 'anthropic', model: 'claude-x' } },
			{ baseURI: '' },
		);
		expect(m.brain.provider).toBe('anthropic');
		expect(m.brain.model).toBe('claude-x');
	});
});
