// Shared request plumbing for the custody routes: answer a tagged 4xx error
// with its code and detail, and read a JSON body with the right status codes.

import { error, readJson } from '../http.js';

/**
 * Run `fn`; a thrown error carrying a 4xx status becomes `{ error, error_description, ...detail }`.
 * Anything else propagates to wrap(), which logs and redacts 5xx.
 */
export async function answerCustody(res, fn) {
	try {
		return await fn();
	} catch (err) {
		const status = Number(err?.status);
		if (status >= 400 && status < 500 && err.code) {
			return error(res, status, err.code, err.message, err.detail ? { detail: err.detail } : {});
		}
		if (status === 202 && err.code) {
			return error(res, 202, err.code, err.message, err.detail ? { detail: err.detail } : {});
		}
		if (status === 502 && err.code && err.expose) return error(res, 502, err.code, err.message);
		throw err;
	}
}

/** The JSON body, or a CustodyHttpError-shaped 400/415. */
export async function readCustodyBody(req) {
	try {
		const body = await readJson(req);
		return body && typeof body === 'object' ? body : {};
	} catch (e) {
		throw Object.assign(new Error(e?.message || 'invalid request body'), {
			status: e?.status === 415 ? 415 : 400, code: e?.status === 415 ? 'unsupported_media_type' : 'bad_request',
		});
	}
}
