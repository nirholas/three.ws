// POST /api/v1/hood-portfolios/generate: a sentence in, a portfolio out.
//
// Runs the screen: the caller's prompt plus Robinhood Chain's holdable universe
// go to the platform's free-first LLM chain (api/_lib/llm.js), and what comes
// back is validated against that universe before anyone sees it. A token the
// model invented is dropped rather than repaired into something plausible;
// weights are renormalised to sum to exactly 10000 because that is arithmetic,
// not judgement.
//
// The response includes the full manifest document and its keccak256 hash. That
// hash is the exact value `PortfolioRegistry.publish` commits on-chain, so the
// document a user reads here is provably the document their portfolio is
// deployed against.
//
// Free and keyless, rate limited per IP, because a screen costs a real LLM call.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { generatePortfolio, ScreenError, selectableUniverse } from '../../_lib/hood-portfolios.js';
import { LlmUnavailableError } from '../../_lib/llm.js';

const MAX_PROMPT = 500;

export default defineEndpoint({
	name: 'v1.hood-portfolios.generate',
	method: 'POST',
	auth: 'optional',
	handler: async ({ res, body, ip, principal }) => {
		const key = principal?.userId || ip;
		const rl = await limits.apiV1FreeMin(`hood-portfolios:gen:${key}`, 10);
		if (!rl.success) {
			return rateLimited(res, rl, 'portfolio generation is capped at 10 per minute, because each one is a real model call');
		}

		const prompt = String(body?.prompt || '').trim();
		if (!prompt) {
			fail(400, 'missing_prompt', 'describe the portfolio you want, e.g. "AI infrastructure across stocks and crypto"');
		}
		if (prompt.length > MAX_PROMPT) {
			fail(400, 'prompt_too_long', `keep the prompt under ${MAX_PROMPT} characters`);
		}

		let universe;
		try {
			universe = await selectableUniverse();
		} catch (err) {
			fail(503, 'universe_unavailable', `could not read Robinhood Chain's token universe: ${err.message}`);
		}

		try {
			const result = await generatePortfolio({ prompt, universe, track: { name: 'v1.hood-portfolios.generate' } });
			res.setHeader('Cache-Control', 'no-store');
			return {
				prompt,
				...result,
				// Everything the client needs to deploy this without a second round trip.
				deployment: {
					chainId: 4663,
					constituents: result.screen.constituents.map((c) => c.address),
					weightsBps: result.screen.constituents.map((c) => c.weightBps),
					rebalanceIntervalDays: result.screen.rebalanceDays,
				},
			};
		} catch (err) {
			if (err instanceof ScreenError) {
				fail(422, 'screen_failed', err.message);
			}
			if (err instanceof LlmUnavailableError) {
				fail(503, 'screen_unavailable', 'every model provider in the chain is currently unavailable, try again shortly');
			}
			throw err;
		}
	},
});
