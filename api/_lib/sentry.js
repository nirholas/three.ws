// Sentry error reporting for Vercel serverless functions.
// Required env: SENTRY_DSN
// Optional env: SENTRY_ENVIRONMENT (defaults to VERCEL_ENV), SENTRY_RELEASE (defaults to VERCEL_GIT_COMMIT_SHA)
//
// Usage: import { captureException } from './_lib/sentry.js'
// wrap() in http.js calls this automatically for 5xx errors.

import * as Sentry from '@sentry/node';

let _initialised = false;

function init() {
	if (_initialised || !process.env.SENTRY_DSN) return;
	Sentry.init({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || 'development',
		release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
		tracesSampleRate: 0.1,
		// Don't send PII by default
		sendDefaultPii: false,
	});
	_initialised = true;
}

export function captureException(err, context = {}) {
	if (!process.env.SENTRY_DSN) return;
	init();
	Sentry.withScope((scope) => {
		for (const [key, value] of Object.entries(context)) {
			scope.setExtra(key, value);
		}
		Sentry.captureException(err);
	});
}

export function captureMessage(message, level = 'info', context = {}) {
	if (!process.env.SENTRY_DSN) return;
	init();
	Sentry.withScope((scope) => {
		scope.setLevel(level);
		for (const [key, value] of Object.entries(context)) {
			scope.setExtra(key, value);
		}
		Sentry.captureMessage(message);
	});
}
