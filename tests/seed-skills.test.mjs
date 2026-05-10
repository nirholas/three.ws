import { test, vi, expect } from 'vitest';

// Mock db before any imports that pull it in transitively.
vi.mock('../api/_lib/db.js', () => ({
	sql: Object.assign(vi.fn(async () => []), {
		json: (v) => v,
		end: vi.fn(async () => {}),
	}),
}));

// Paths are relative to this file (tests/), so ../src/ → src/ at repo root.
const { AgentSkills } = await import('../src/agent-skills.js');

test('Seed skills to the database', async () => {
	const _noop = () => {};
	const _stub = { emit: _noop, on: _noop, off: _noop, add: _noop, query: () => [] };
	const skills = new AgentSkills(_stub, _stub).list();

	expect(skills.length).toBeGreaterThan(0);

	const seeded = [];
	for (const skill of skills) {
		const { name, description, inputSchema } = skill;
		if (!description) continue;

		const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
		let category = 'utility';
		const nameParts = name.split('-');
		if (nameParts.length > 1) category = nameParts[0];

		const entry = {
			name,
			slug,
			description,
			category,
			is_public: true,
			schema_json: inputSchema ? [{ function: { name, parameters: inputSchema } }] : null,
		};

		expect(typeof entry.name).toBe('string');
		expect(entry.slug).toMatch(/^[a-z0-9-]+$/);
		seeded.push(entry);
	}

	expect(seeded.length).toBeGreaterThan(0);
}, 60000);
