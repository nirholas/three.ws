// Parser for web+threews: links, the custom protocol the installed app registers
// through the manifest's protocol_handlers member. Windows (Teams, Outlook, Word,
// the Run box) and Chromium hand the link to /open?link=<link>, and this module
// decides where it lands. It is the only gate between an arbitrary string from
// another application and a navigation, so it whitelists routes and id shapes
// and always returns a same-origin path; anything else is an explained error.
//
//   web+threews://agent/<id>          -> /agents/<id>
//   web+threews://model/<uuid>        -> /m/<uuid>
//   web+threews://forge?prompt=<text> -> /forge?prompt=<text>

export const PROTOCOL_SCHEME = 'web+threews';
export const MAX_LINK_LENGTH = 2048;
// Matches the forge textarea's maxlength, so a link never carries more than the
// forge would accept.
export const MAX_PROMPT_LENGTH = 1000;

const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const RAW_UNSAFE = /[\u0000-\u001f\u007f\\]/;
// Prompts may span lines; every other control character is rejected.
// eslint-disable-next-line no-control-regex
const PROMPT_UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const MESSAGES = {
	empty: 'The link was empty. Open a web+threews: link from a message or document to land on an agent, a model or the forge.',
	too_long: `The link is longer than ${MAX_LINK_LENGTH} characters, so it was not opened.`,
	wrong_scheme: 'Only web+threews: links can be opened here. The link used a different scheme, so it was not followed.',
	bad_encoding: 'The link contains broken percent-encoding and could not be read. Copy the link again from its source.',
	bad_path: 'The link has unsafe or extra path segments. Supported links are web+threews://agent/<id>, web+threews://model/<id> and web+threews://forge?prompt=<text>.',
	unknown_route: 'This link points at something three.ws does not open. Supported links are web+threews://agent/<id>, web+threews://model/<id> and web+threews://forge?prompt=<text>.',
	bad_id: 'The id in this link is missing or malformed. Agent ids are letters, digits, hyphens and underscores; model ids are UUIDs.',
	bad_prompt: 'The forge prompt in this link contains control characters, so it was not used.',
	prompt_too_long: `The forge prompt in this link is longer than ${MAX_PROMPT_LENGTH} characters. Shorten it and share the link again.`,
};

function fail(error) {
	return { ok: false, error, message: MESSAGES[error] };
}

function decode(part) {
	try {
		return { value: decodeURIComponent(part) };
	} catch {
		return { error: 'bad_encoding' };
	}
}

function parseQuery(query) {
	const out = {};
	if (!query) return { params: out };
	for (const pair of query.split('&')) {
		if (!pair) continue;
		const eq = pair.indexOf('=');
		const key = decode((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, ' '));
		const val = decode((eq < 0 ? '' : pair.slice(eq + 1)).replace(/\+/g, ' '));
		if (key.error || val.error) return { error: 'bad_encoding' };
		if (!(key.value in out)) out[key.value] = val.value;
	}
	return { params: out };
}

function parseEntity(kind, segments) {
	if (segments.length < 2) return fail('bad_id');
	const decoded = decode(segments[1]);
	if (decoded.error) return fail(decoded.error);
	const id = decoded.value;
	const valid = kind === 'model' ? UUID.test(id) : AGENT_ID.test(id);
	if (!valid) return fail('bad_id');
	if (segments.length > 2) return fail('bad_path');
	const target = kind === 'model' ? `/m/${id}` : `/agents/${id}`;
	return { ok: true, kind, id, target };
}

function parseForge(segments, query) {
	if (segments.length > 1) return fail('bad_path');
	const { params, error } = parseQuery(query);
	if (error) return fail(error);
	const prompt = String(params.prompt ?? '').trim();
	if (PROMPT_UNSAFE.test(prompt)) return fail('bad_prompt');
	if (prompt.length > MAX_PROMPT_LENGTH) return fail('prompt_too_long');
	if (!prompt) return { ok: true, kind: 'forge', prompt: '', target: '/forge' };
	return { ok: true, kind: 'forge', prompt, target: `/forge?${new URLSearchParams({ prompt })}` };
}

/**
 * @param {unknown} input the link as received, plain or percent-encoded once
 * @returns {{ ok: true, kind: 'agent'|'model'|'forge', target: string, id?: string, prompt?: string }
 *         | { ok: false, error: string, message: string }}
 */
export function parseThreewsLink(input) {
	if (typeof input !== 'string' || !input.trim()) return fail('empty');
	let raw = input.trim();
	if (raw.length > MAX_LINK_LENGTH) return fail('too_long');

	// Chromium substitutes %s with the whole link percent-encoded. URLSearchParams
	// already undoes that, but a link pasted by hand may still carry the layer.
	if (/^web%2bthreews%3a/i.test(raw)) {
		const unwrapped = decode(raw);
		if (unwrapped.error) return fail(unwrapped.error);
		raw = unwrapped.value;
	}

	const m = raw.match(/^([a-z][a-z0-9+.-]*):([\s\S]*)$/i);
	if (!m || m[1].toLowerCase() !== PROTOCOL_SCHEME) return fail('wrong_scheme');
	let rest = m[2];
	if (RAW_UNSAFE.test(rest)) return fail('bad_path');

	rest = rest.replace(/^\/\//, '');
	const hash = rest.indexOf('#');
	if (hash >= 0) rest = rest.slice(0, hash);
	const q = rest.indexOf('?');
	const path = q >= 0 ? rest.slice(0, q) : rest;
	const query = q >= 0 ? rest.slice(q + 1) : '';

	const segments = path.split('/');
	if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
	const route = segments[0].toLowerCase();

	if (route === 'agent' || route === 'model') return parseEntity(route, segments);
	if (route === 'forge') return parseForge(segments, query);
	return fail('unknown_route');
}
