// Every three.ws-authored skill must conform to the Agent Skills open standard, or
// the one-command installer (`npx skills add`) and other runtimes skip it or reject
// its frontmatter. The validator is also exercised on deliberately broken folders so
// a loosened rule cannot pass unnoticed.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateSkillDir, validateSkillsRoot } from '../scripts/validate-agent-skills.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function makeSkill(folder, frontmatter, body = '# Body\n') {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-spec-'));
	const dir = path.join(root, folder);
	fs.mkdirSync(dir);
	fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`);
	return { root, dir };
}

describe('Agent Skills spec conformance', () => {
	it('every three.ws-authored skill under .agents/skills conforms', () => {
		const results = validateSkillsRoot(path.join(ROOT, '.agents', 'skills')).filter((r) => !r.vendored);
		expect(results.length).toBeGreaterThan(0);
		expect(results.filter((r) => r.problems.length)).toEqual([]);
	});

	it('accepts a minimal valid skill', () => {
		const { dir } = makeSkill('good-skill', 'name: good-skill\ndescription: Does a thing. Use when asked.');
		expect(validateSkillDir(dir)).toEqual([]);
	});

	it('rejects a name that differs from the folder', () => {
		const { dir } = makeSkill('folder-name', 'name: other-name\ndescription: x');
		expect(validateSkillDir(dir).join()).toMatch(/does not match folder/);
	});

	it('rejects uppercase and consecutive hyphens in the name', () => {
		const a = makeSkill('Bad', 'name: Bad\ndescription: x');
		const b = makeSkill('a--b', 'name: a--b\ndescription: x');
		expect(validateSkillDir(a.dir).join()).toMatch(/lowercase/);
		expect(validateSkillDir(b.dir).join()).toMatch(/lowercase/);
	});

	it('rejects frontmatter that is not valid YAML (unquoted colon in a description)', () => {
		const { dir } = makeSkill('colon', 'name: colon\ndescription: Use when the user says: do it');
		expect(validateSkillDir(dir).join()).toMatch(/not valid YAML/);
	});

	it('rejects non-string metadata values and an over-long description', () => {
		const a = makeSkill('meta', 'name: meta\ndescription: x\nmetadata:\n  flag: true');
		const b = makeSkill('long', `name: long\ndescription: ${'x'.repeat(1025)}`);
		expect(validateSkillDir(a.dir).join()).toMatch(/metadata\.flag must be a string/);
		expect(validateSkillDir(b.dir).join()).toMatch(/max 1024/);
	});

	it('rejects unknown fields and a list-valued allowed-tools', () => {
		const { dir } = makeSkill('extra', 'name: extra\ndescription: x\ntitle: nope\nallowed-tools: ["Bash(ls)"]');
		const out = validateSkillDir(dir).join();
		expect(out).toMatch(/unknown frontmatter field "title"/);
		expect(out).toMatch(/allowed-tools must be/);
	});
});
