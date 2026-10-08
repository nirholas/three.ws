// Which responses the gzip/brotli middleware may compress.
//
// `compression` buffers its output until the encoder has a block worth
// emitting, so a response written incrementally reaches a client that accepts
// an encoding only when the handler ends it. The library's default filter
// exempts text/event-stream, but every other live stream on this server wears
// an ordinary type: /api/tty writes ANSI frames as text/plain for 8 seconds,
// and the LLM and agent streams write NDJSON. Measured 2026-10-08 against
// production: `curl https://three.ws/tty` animated from 0.15 s, while the same
// request with `Accept-Encoding: br` (Node fetch, browsers' fetch, curl
// --compressed) got its first byte at 9.8 s, the whole animation delivered as
// one wall of text after it had finished.
//
// The handlers already say so: `x-accel-buffering: no` is the header each
// streaming route sets to tell proxies not to hold its body. Honoring the same
// signal here covers every current stream and the next one without a list of
// paths or content types to keep in sync.

import compression from 'compression';

/** @param {import('node:http').ServerResponse} res */
export function isUnbufferedStream(res) {
	return String(res.getHeader('x-accel-buffering') ?? '').trim().toLowerCase() === 'no';
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export function shouldCompress(req, res) {
	if (isUnbufferedStream(res)) return false;
	return compression.filter(req, res);
}
