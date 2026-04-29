import { describe, it, expect, vi } from 'vitest';
import { buildSkillManifest } from '../src/skill-manifest.js';

// Mock the pumpfun skill registrars so the test doesn't need Solana SDK deps
vi.mock('../src/agent-skills-pumpfun.js', () => ({ registerPumpFunSkills: () => {} }));
vi.mock('../src/agent-skills-pumpfun-watch.js', () => ({ registerPumpFunWatchSkills: () => {} }));
vi.mock('../src/agent-skills-pumpfun-autonomous.js', () => ({
	registerPumpFunAutonomousSkills: () => {},
}));
vi.mock('../src/agent-skills-pumpfun-compose.js', () => ({
	registerPumpFunComposeSkills: () => {},
}));
vi.mock('../src/agent-skills-pumpfun-hooks.js', () => ({ attachPumpFunMemoryHooks: () => {} }));

const { AgentSkills } = await import('../src/agent-skills.js');
const _stub = { emit: () => {}, on: () => {}, off: () => {}, add: () => 'id', query: () => [] };
const _skills = new AgentSkills(_stub, _stub);

const SAMPLE_SKILLS = [
	{
		name: 'test.full',
		description: 'A test skill with args',
		inputSchema: {
			type: 'object',
			required: ['mint'],
			properties: {
				mint: { type: 'string' },
				limit: { type: 'number' },
			},
		},
	},
	{
		name: 'test.nodesc',
		// intentionally no description
		inputSchema: { type: 'object', properties: {} },
	},
];

describe('buildSkillManifest', () => {
	it('returns the documented shape', () => {
		const manifest = buildSkillManifest({
			agentId: 'test-agent',
			version: '1.0.0',
			skills: SAMPLE_SKILLS,
		});

		expect(manifest).toMatchObject({
			agent: { id: 'test-agent', version: '1.0.0' },
			skills: expect.any(Array),
		});
	});

	it('omits skills without a description and emits a warning', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const manifest = buildSkillManifest({
			agentId: 'test-agent',
			version: '1.0.0',
			skills: SAMPLE_SKILLS,
		});

		const names = manifest.skills.map((s) => s.name);
		expect(names).toContain('test.full');
		expect(names).not.toContain('test.nodesc');
		expect(warnSpy).toHaveBeenCalledOnce();
		warnSpy.mockRestore();
	});

	it('marks required args without ? and optional args with ?', () => {
		const manifest = buildSkillManifest({
			agentId: 'test-agent',
			version: '1.0.0',
			skills: [SAMPLE_SKILLS[0]],
		});

		expect(manifest.skills[0].args).toEqual({
			mint: 'string',
			limit: 'number?',
		});
	});

	it('handles a skill with no inputSchema', () => {
		const manifest = buildSkillManifest({
			agentId: 'test-agent',
			version: '1.0.0',
			skills: [{ name: 'bare', description: 'no schema' }],
		});

		expect(manifest.skills[0].args).toEqual({});
	});

	it('every registered skill with a description appears in the manifest', () => {
		const manifest = buildSkillManifest({
			agentId: '3d-agent',
			version: '0.0.0',
			skills: _skills.list(),
		});

		const manifestNames = new Set(manifest.skills.map((s) => s.name));
		const expected = _skills.list().filter((s) => s.description);

		expect(expected.length).toBeGreaterThan(0);
		for (const skill of expected) {
			expect(manifestNames.has(skill.name)).toBe(true);
		}
	});
});
