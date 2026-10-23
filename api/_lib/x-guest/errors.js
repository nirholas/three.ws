// Error classes for the keyless X guest reader. Adapted from XActions
// (Apache-2.0, see NOTICE). Only the types the guest reader raises are kept.

export class XGuestError extends Error {
	constructor(message, { status = null, endpoint = null, reason = 'error' } = {}) {
		super(message);
		this.name = new.target.name;
		this.status = status;
		this.endpoint = endpoint;
		this.reason = reason;
	}
}

export class NotFoundError extends XGuestError {
	constructor(message, opts = {}) {
		super(message, { ...opts, reason: opts.reason || 'not_found' });
	}
}

export class RateLimitError extends XGuestError {
	constructor(message, opts = {}) {
		super(message, { ...opts, reason: 'rate_limited' });
		this.resetAt = opts.resetAt ?? null;
	}
}
