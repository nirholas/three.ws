// Pure state machine for the wallet connect flow (CDN-compatible, no imports).
// Kept in sync with src/wallet/state.js — no external dependencies.

export const STATES = Object.freeze({
	IDLE: 'idle',
	DETECTING: 'detecting',
	NO_PROVIDER: 'no_provider',
	REQUESTING_ACCOUNTS: 'requesting_accounts',
	CONNECTED: 'connected',
	WRONG_CHAIN: 'wrong_chain',
	SIGNING: 'signing',
	VERIFYING: 'verifying',
	SUCCESS: 'success',
	ERROR: 'error',
});

export function initialState() {
	return { status: STATES.IDLE, address: null, chainId: null, error: null };
}

export function reduce(state, action) {
	switch (action.type) {
		case 'CONNECT':
			if (state.status !== STATES.IDLE) return state;
			return { ...state, status: STATES.DETECTING, error: null };
		case 'NO_PROVIDER':
			return { ...state, status: STATES.NO_PROVIDER };
		case 'HAS_PROVIDER':
			return { ...state, status: STATES.REQUESTING_ACCOUNTS };
		case 'ACCOUNTS_RESOLVED':
			return {
				...state,
				status: STATES.CONNECTED,
				address: action.address,
				chainId: action.chainId,
			};
		case 'WRONG_CHAIN':
			return { ...state, status: STATES.WRONG_CHAIN };
		case 'CHAIN_OK':
			return { ...state, status: STATES.CONNECTED };
		case 'SIGN':
			if (state.status !== STATES.CONNECTED && state.status !== STATES.WRONG_CHAIN)
				return state;
			return { ...state, status: STATES.SIGNING };
		case 'SIGNATURE_OBTAINED':
			return { ...state, status: STATES.VERIFYING };
		case 'SUCCESS':
			return { ...state, status: STATES.SUCCESS };
		case 'ERROR':
			return { ...state, status: STATES.ERROR, error: action.error ?? null };
		case 'RESET':
			return initialState();
		case 'ACCOUNTS_CHANGED':
			if (!action.accounts || action.accounts.length === 0) return initialState();
			// During an active connect flow (DETECTING/REQUESTING_ACCOUNTS) the wallet
			// fires accountsChanged as a side-effect of eth_requestAccounts. Don't
			// transition to CONNECTED here — ACCOUNTS_RESOLVED (with confirmed chainId)
			// will handle it. Transitioning early causes a duplicate signAndVerify that
			// races and overwrites the CSRF cookie, making the first attempt 403.
			if (
				state.status === STATES.DETECTING ||
				state.status === STATES.REQUESTING_ACCOUNTS
			) {
				return { ...state, address: action.accounts[0] };
			}
			return {
				...state,
				address: action.accounts[0],
				chainId: state.chainId,
				status: STATES.CONNECTED,
			};
		case 'CHAIN_CHANGED':
			return { ...state, chainId: action.chainId };
		default:
			return state;
	}
}
