// GET /api/skills/:id/card
//
// The skill's agent card (A2A AgentCard shape). It lists every rail the author
// has enabled with the endpoint and headers to use, and nothing for a rail that
// is switched off, so a card is always safe to act on. Price and the
// author/platform split come from the same quote the invoke router charges.

import { sql } from '../../_lib/db.js';
import { env } from '../../_lib/env.js';
import { cors, error, json, method, respondError, wrap } from '../../_lib/http.js';
import { isUuid } from '../../_lib/validate.js';
import {
	RECEIPT_FORMAT,
	enabledRails,
	invokeUrl,
	quoteSkill,
	railEndpoints,
	splitSummary,
} from '../../_lib/skill-rails.js';

export function buildSkillCard(skill, origin = env.APP_ORIGIN) {
	const priced = Number(skill.price_per_call_usd) > 0;
	const quote = priced ? quoteSkill(skill) : null;
	return {
		name: skill.name,
		description: skill.description || '',
		url: invokeUrl(skill, origin),
		version: '1',
		provider: { organization: 'three.ws', url: origin },
		capabilities: { streaming: false, pushNotifications: false, extensions: [] },
		defaultInputModes: ['application/json'],
		defaultOutputModes: ['application/json'],
		skills: [
			{
				id: skill.slug,
				name: skill.name,
				description: skill.description || '',
				tags: [skill.category || 'general'],
			},
		],
		'x-three-ws': {
			skill_id: skill.id,
			slug: skill.slug,
			priced,
			price: quote ? splitSummary(quote.split) : null,
			networks: quote ? quote.networks : [],
			receipt_format: RECEIPT_FORMAT,
			enabled_rails: priced ? enabledRails(skill) : [],
			rails: priced ? railEndpoints(skill, origin) : {},
		},
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const id = String(Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id ?? '').trim();
	if (!id) return error(res, 404, 'not_found', 'skill not found');

	let skill;
	try {
		const byId = isUuid(id);
		[skill] = await sql`
			SELECT ms.id, ms.slug, ms.name, ms.description, ms.category, ms.rails,
			       ms.price_per_call_usd,
			       evm.address AS author_payto_base,
			       sol.address AS author_payto_solana
			  FROM marketplace_skills ms
			  LEFT JOIN user_wallets evm
			         ON evm.user_id = ms.author_id AND evm.chain_type = 'evm' AND evm.is_primary = true
			  LEFT JOIN user_wallets sol
			         ON sol.user_id = ms.author_id AND sol.chain_type = 'solana' AND sol.is_primary = true
			 WHERE ${byId ? sql`ms.id = ${id}` : sql`ms.slug = ${id}`} AND ms.is_public = true
			 LIMIT 1
		`;
	} catch (err) {
		return respondError(res, 502, 'skill_lookup_failed', err);
	}
	if (!skill) return error(res, 404, 'not_found', 'skill not found');

	return json(res, 200, buildSkillCard(skill), { 'cache-control': 'public, max-age=60' });
});
