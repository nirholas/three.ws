#!/usr/bin/env node
// Live check of the xAI half without an xAI key. It runs the server's real
// chat turn (runTurn, the same request body, URL and headers) with no key, so
// xAI answers its documented 401, and asserts the page would show the mapped
// "xAI did not accept the API key" error. Nothing is billed: xAI refuses the
// request before it reaches a model.
//
//   npm run live:xai-401
//   npm run live:xai-401 -- --capture DIR    also write xAI's raw 401 to DIR

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runTurn } from '../lib/chat.mjs';
import { loadConfig } from '../lib/config.mjs';
import { toAppError } from '../lib/errors.mjs';
import { buildRequest } from '../lib/xai.mjs';

const args = process.argv.slice(2);
const captureIndex = args.indexOf('--capture');
const captureDir = captureIndex >= 0 ? resolve(args[captureIndex + 1] || 'captures') : null;

const config = loadConfig({ ...process.env, XAI_API_KEY: '', THREE_WS_API_KEY: 'unused-by-this-check' });

let raw = null;
async function recordingFetch(url, init) {
	const res = await fetch(url, init);
	raw = { url: String(url), status: res.status, body: await res.clone().text(), sentAuthorization: Boolean(init?.headers?.authorization) };
	return res;
}

const events = [];
let error = null;
try {
	await runTurn({
		config,
		input: { message: 'A small brass desk lamp with a round green glass shade', previousResponseId: null, stage: null },
		emit: (event, data) => events.push(event),
		fetchImpl: recordingFetch,
	});
} catch (err) {
	error = toAppError(err);
}

const body = buildRequest({ config, text: 'A small brass desk lamp with a round green glass shade' });
const result = {
	url: raw?.url,
	sentAuthorization: raw?.sentAuthorization,
	httpStatus: raw?.status,
	xaiBody: raw?.body,
	requestModel: body.model,
	requestTools: body.tools.map((t) => ({ type: t.type, server_url: t.server_url, allowed_tools: t.allowed_tools })),
	eventsBeforeError: events,
	mapped: error ? { code: error.code, title: error.title, message: error.message, fix: error.fix, link: error.link } : null,
};
console.log(JSON.stringify(result, null, 2));

if (captureDir && raw) {
	await mkdir(captureDir, { recursive: true });
	let parsed;
	try {
		parsed = JSON.parse(raw.body);
	} catch {
		parsed = { raw: raw.body };
	}
	const fixture = {
		_fixture: {
			source: 'captured',
			from: `POST ${raw.url} with no Authorization header (the server's request body from buildRequest)`,
			capturedAt: new Date().toISOString(),
			by: 'scripts/live-xai-401.mjs',
			httpStatus: raw.status,
			docs: 'https://docs.x.ai/developers/debugging',
		},
		response: parsed,
	};
	await writeFile(join(captureDir, 'xai-401-no-key.json'), `${JSON.stringify(fixture, null, '\t')}\n`);
}

const ok = raw?.status === 401 && !raw.sentAuthorization && error?.code === 'xai_unauthorized';
console.log(ok ? 'PASS: xAI answered 401 without a key and the page maps it to "xAI did not accept the API key".' : 'FAIL: see the result above.');
process.exit(ok ? 0 : 1);
