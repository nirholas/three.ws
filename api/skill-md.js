// GET /.well-known/skill.md: SKILL-MD 1.0 document (x402-skill-md format),
// every paid HTTP route on three.ws, its price, its parameters, and the
// Solana/Base rails it settles on. Built from the same OpenAPI catalog
// /openapi.json serves; see api/_lib/skill-md.js for the generator.
//
// Distinct from the static /skill.md (public/skill.md), the Agent Skills
// (agentskills.io) connector file that points a model at three.ws's MCP
// servers and SKILL.md bundles. Both are linked from each other.
import { env } from './_lib/env.js';
import { cors, method, text, wrap } from './_lib/http.js';
import { generateSkillMd } from './_lib/skill-md.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const body = generateSkillMd(env.APP_ORIGIN);
	return text(res, 200, body, {
		'content-type': 'text/markdown; charset=utf-8',
		'cache-control': 'public, max-age=300, s-maxage=300',
	});
});
