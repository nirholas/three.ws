// REST routes for staked Event Markets, mounted next to the free-to-play routes
// by api/_lib/event-markets/routes.js. The server builds UNSIGNED transactions
// and records confirmed ones; it never signs or holds a staker's funds.
//   GET  :slug/staking                 panel state (gate, pool, odds, your position)
//   POST :slug/staking/attest          age and region attestation
//   POST :slug/staking/stake           unsigned stake tx + preview
//   POST :slug/staking/payout          unsigned claim or refund tx
//   POST :slug/staking/record          verify + ledger a confirmed signature
// Guide: docs/event-markets-staking.md.

import { apiError } from '../../agents-v1/http.js';
import { getMarket } from '../index.js';
import { attest, prepareStake, preparePayout, stakingView } from './service.js';
import { StakeRefusal } from './limits.js';
import { recordSignature } from './record.js';

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

async function marketOr404(slug) {
	const market = await getMarket(slug);
	if (!market || market.status === 'draft') throw apiError(404, 'not_found', 'No market with that id.');
	return market;
}

const refuse = (err) => {
	if (err instanceof StakeRefusal) return apiError(err.code === 'not_offered' ? 404 : 403, err.code, err.message, err.detail);
	return err;
};

async function view({ req, params, query, principal }) {
	const market = await marketOr404(params.slug);
	try {
		return await stakingView(req, market.id, principal, query.wallet || null);
	} catch (err) {
		throw refuse(err);
	}
}

async function attestRoute({ req, body, principal }) {
	try {
		return { gate: await attest(req, principal, { confirmedAge: body.confirmed_age, confirmedRegion: body.confirmed_region }) };
	} catch (err) {
		throw refuse(err);
	}
}

async function stakeRoute({ req, params, body, principal }) {
	const market = await marketOr404(params.slug);
	try {
		return await prepareStake(req, market.id, principal, { wallet: body.wallet, outcomeId: body.outcome_id, amount: body.amount });
	} catch (err) {
		throw refuse(err);
	}
}

async function payoutRoute({ params, body }) {
	const market = await marketOr404(params.slug);
	if (body.kind !== 'claim' && body.kind !== 'refund') throw apiError(400, 'invalid_kind', 'kind must be claim or refund.');
	try {
		return await preparePayout(market.id, { wallet: body.wallet, kind: body.kind });
	} catch (err) {
		throw refuse(err);
	}
}

async function recordRoute({ body, principal }) {
	if (typeof body.signature !== 'string' || !SIG_RE.test(body.signature)) throw apiError(400, 'invalid_signature', 'signature must be a transaction signature.');
	const event = await recordSignature(body.signature, principal.userId);
	if (!event) throw apiError(422, 'not_a_stake_tx', 'That transaction is not a confirmed stake, claim or refund on a staked market.');
	return { recorded: event.inserted, kind: event.kind, amount: event.amount.toString() };
}

export function stakingRoutes(prefix = '/event-markets') {
	return [
		{ method: 'GET', path: `${prefix}/:slug/staking`, name: 'event_markets.staking', auth: 'optional', handler: view },
		{ method: 'POST', path: `${prefix}/:slug/staking/attest`, name: 'event_markets.staking_attest', auth: 'required', handler: attestRoute },
		{ method: 'POST', path: `${prefix}/:slug/staking/stake`, name: 'event_markets.staking_stake', auth: 'required', handler: stakeRoute },
		{ method: 'POST', path: `${prefix}/:slug/staking/payout`, name: 'event_markets.staking_payout', auth: 'required', handler: payoutRoute },
		{ method: 'POST', path: `${prefix}/:slug/staking/record`, name: 'event_markets.staking_record', auth: 'required', handler: recordRoute },
	];
}
