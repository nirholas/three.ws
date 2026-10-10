// Install the three.ws skill into Claude Code: ~/.claude/skills/three-ws/SKILL.md
// (or ./.claude/skills/ with --project). The content is the hosted entry-point
// skill at {origin}/skill.md, so it is exactly what the site documents.
// Idempotent: an identical file is left untouched, a changed one is replaced
// atomically.

import fs from 'node:fs';
import path from 'node:path';
import { request } from './http.js';
import { systemEnv } from './paths.js';

export function claudeSkillPath(env = systemEnv(), { project = false } = {}) {
	return path.join(project ? env.cwd : env.home, '.claude', 'skills', 'three-ws', 'SKILL.md');
}

/** Returns { file, changed, error }. Never throws. */
export async function installClaudeSkills({ origin, env = systemEnv(), project = false }) {
	const file = claudeSkillPath(env, { project });
	try {
		const res = await request(`${origin}/skill.md`, { headers: { accept: 'text/markdown, text/plain' } });
		if (!res.ok) return { file, changed: false, error: `${origin}/skill.md answered ${res.status}` };
		const body = await res.text();
		if (!/^---\r?\nname:\s*three-ws/m.test(body)) return { file, changed: false, error: `${origin}/skill.md is not a three.ws skill file` };
		let current = null;
		try { current = fs.readFileSync(file, 'utf8'); } catch { current = null; }
		if (current === body) return { file, changed: false, error: null };
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, body);
		fs.renameSync(tmp, file);
		return { file, changed: true, error: null };
	} catch (err) {
		return { file, changed: false, error: err.message };
	}
}
