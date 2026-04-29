import { wrap, error } from '../../_lib/http.js';
import {
	handleAttestations,
	handleAttestEvent,
	handleCard,
	handlePriceHistory,
	handleRegisterPrep,
	handleRegisterConfirm,
	handleReputation,
	handleReputationHistory,
} from './_handlers.js';

export {
	taskHash,
	buildPayload,
	verifyPumpkitSignature,
} from './_handlers.js';

const DISPATCH = {
	attestations:        handleAttestations,
	'attest-event':      handleAttestEvent,
	card:                handleCard,
	'price-history':     handlePriceHistory,
	'register-prep':     handleRegisterPrep,
	'register-confirm':  handleRegisterConfirm,
	reputation:          handleReputation,
	'reputation-history': handleReputationHistory,
};

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').searchParams.get('action');
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown action: ${action}`);
	return fn(req, res);
});
