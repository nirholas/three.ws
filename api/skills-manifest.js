// GET /api/skills-manifest — machine-readable manifest of agent skills

import { readFileSync } from 'fs';
import { cors, json, method, wrap } from './_lib/http.js';
import { buildSkillManifest } from '../src/skill-manifest.js';
import { AgentSkills } from '../src/agent-skills.js';

const { version } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const _noop = () => {};
const _stub = { emit: _noop, on: _noop, off: _noop, add: _noop, query: () => [] };
const _skills = new AgentSkills(_stub, _stub);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	return json(
		res,
		200,
		buildSkillManifest({
			agentId: '3d-agent',
			version,
			skills: _skills.list(),
		}),
		{ 'cache-control': 'public, max-age=60' },
	);
});
