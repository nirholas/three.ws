// Automation mode: the stable exit-code table, the error type commands throw to
// pick a code, the classifier that maps an API failure to a code, and the one
// rule for "may this process prompt a human".
//
//   0  ok
//   1  other error
//   2  usage (bad flags, missing input, or a prompt that --non-interactive forbids)
//   3  auth (not signed in, expired or revoked credential, missing scope)
//   4  refused by a guard (spend policy, approval gate, scan verdict, firewall)
//   5  payment required (HTTP 402 the command did not settle)
//   6  network (unreachable host, timeout, rate limit, server fault)
//
// `three-ws pay` predates this table and keeps its own documented 10 to 14
// codes; they are returned untouched because scripts already branch on them.

import { ApiError } from './http.js';

export const EXIT_CODES = Object.freeze({
	OK: 0,
	ERROR: 1,
	USAGE: 2,
	AUTH: 3,
	GUARD: 4,
	PAYMENT: 5,
	NETWORK: 6,
});

export class CliError extends Error {
	/**
	 * @param {number} exit one of EXIT_CODES
	 * @param {string} code short snake_case reason for --json
	 * @param {string} message what happened and how to fix it
	 * @param {object} [detail]
	 */
	constructor(exit, code, message, detail = undefined) {
		super(message);
		this.name = 'CliError';
		this.exit = exit;
		this.code = code;
		this.detail = detail;
	}
}

const GUARD_CODE = /guard|policy|firewall|blocked|refused|limit|approval|not_allowed|spend/i;

/** The exit code an error maps to. An error that already carries an integer `exit` keeps it. */
export function exitCodeFor(err) {
	if (Number.isInteger(err?.exit)) return err.exit;
	if (err instanceof ApiError) {
		const { status, code } = err;
		if (code === 'login_required' || status === 401) return EXIT_CODES.AUTH;
		if (status === 0) return EXIT_CODES.NETWORK;
		if (status === 402) return EXIT_CODES.PAYMENT;
		if (status === 403 || status === 422) return GUARD_CODE.test(String(code || '')) ? EXIT_CODES.GUARD : status === 403 ? EXIT_CODES.AUTH : EXIT_CODES.ERROR;
		if (status === 429 || status >= 500) return EXIT_CODES.NETWORK;
		if (code === 'validation_error' || status === 400) return EXIT_CODES.USAGE;
		return EXIT_CODES.ERROR;
	}
	return EXIT_CODES.ERROR;
}

/** True when nothing may prompt: --non-interactive or THREE_WS_NON_INTERACTIVE=1. */
export function isNonInteractive(flags = {}, env = { vars: {} }) {
	return Boolean(flags['non-interactive']) || env.vars?.THREE_WS_NON_INTERACTIVE === '1';
}

/** Throw the usage error for a required input that was not supplied. */
export function requireInput(value, what, hint) {
	if (value === undefined || value === null || value === '') {
		throw new CliError(EXIT_CODES.USAGE, 'missing_input', `${what} is required${hint ? `: ${hint}` : ''}.`);
	}
	return value;
}
