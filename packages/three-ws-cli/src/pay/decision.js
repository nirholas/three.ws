// Picks which offer to pay, if any. Solana first: anything not on Solana is
// skipped outright. Among payable Solana offers the cheapest wins (x402 before
// MPP on a tie), and the first one that clears the permissions is chosen, so a
// server that also lists an over-limit option never blocks a cheaper allowed one.

import { EXIT, PayError, REASON } from './errors.js';
import { describeOffer, evaluateOffer, isSolanaNetwork, normalizeNetwork } from './permissions.js';

const byPreference = (a, b) => {
	if (a.amountAtomic !== b.amountAtomic) return a.amountAtomic < b.amountAtomic ? -1 : 1;
	return (a.protocol === 'x402' ? 0 : 1) - (b.protocol === 'x402' ? 0 : 1);
};

/**
 * @param {object} args
 * @param {object[]} args.offers from readChallenge
 * @param {object} args.perms validated permissions
 * @param {string} args.origin origin of the URL being fetched
 * @param {string} [args.maxFlag] --max decimal string
 * @param {string} [args.networkFlag] --network filter
 * @param {(offer: object) => bigint} args.spent atomic units already spent today for the offer's network and asset
 * @returns {{ offer: object, confirm: boolean, skipped: Array<{ offer: object, reason: string, message: string }> }}
 */
export function decide({ offers, perms, origin, maxFlag, networkFlag, spent }) {
	const skipped = [];
	const note = (offer, reason, message) => skipped.push({ offer: describeOffer(offer), reason, message });
	const wanted = networkFlag ? normalizeNetwork(networkFlag) : null;

	const candidates = [];
	for (const offer of offers) {
		if (!isSolanaNetwork(offer.network)) {
			note(offer, REASON.networkNotAllowed, `network ${offer.network} is not Solana`);
		} else if (wanted && offer.network !== wanted) {
			note(offer, REASON.networkNotAllowed, `network ${offer.network} does not match --network`);
		} else if (offer.unsupported) {
			note(offer, offer.expired ? REASON.expired : REASON.unsupportedIntent, offer.unsupported);
		} else {
			candidates.push(offer);
		}
	}
	if (candidates.length === 0) {
		throw new PayError(
			EXIT.NO_PAYABLE_OPTION,
			REASON.noPayableOption,
			offers.length === 0
				? 'The server answered 402 but offered no payment option this tool understands (x402 or MPP on Solana).'
				: 'None of the payment options can be settled here: ' + skipped.map((s) => s.message).join('; ') + '.',
			{ skipped },
		);
	}

	candidates.sort(byPreference);
	let firstDenial = null;
	for (const offer of candidates) {
		try {
			const { confirm } = evaluateOffer(perms, offer, { origin, maxFlag, spent: spent(offer) });
			return { offer, confirm, skipped };
		} catch (err) {
			if (!(err instanceof PayError)) throw err;
			firstDenial ??= err;
			note(offer, err.reason, err.message);
		}
	}
	firstDenial.detail = { ...firstDenial.detail, skipped };
	throw firstDenial;
}
