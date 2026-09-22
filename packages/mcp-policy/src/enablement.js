// Which tools a session may see and call.
//
// Enablement is described by a SPEC: a comma- or space-separated list of
// tokens applied left to right on top of a base. The same grammar is read from
// the X-Three-Tools header, the `tools` query parameter, the THREE_WS_TOOLS env
// var of a stdio server, and the saved settings (which are converted to it), so
// one mental model covers every surface.
//
//   default      read + write tiers on, financial off (the implicit base)
//   all          every tier on
//   none         everything off
//   readonly     only the read tier on
//   write        turn the write tier on        -write      turn it off
//   financial    turn the financial tier on    -financial  turn it off
//   trading      turn the whole trading group on, every tier included
//   -chat        turn the whole chat group off
//   swap_execute turn one tool on              -forget     turn one tool off
//
// Precedence between tokens is tool over group over tier: `-trading,swap_quote`
// hides the trading group except swap_quote.
//
// A spec made only of plain tool names (no base, tier, group or `-`) is an exact
// allow list: only those tools exist for the session. That is what `three-ws
// tools` writes into X-Three-Tools for a direct HTTP entry, and it is the
// brief's "client's allowed-tools list". To ADD a tool to the defaults instead,
// lead with a base: `default,swap_execute`.

import { GROUP_IDS, TIERS, DEFAULT_TIERS } from './groups.js';

const GROUP_SET = new Set(GROUP_IDS);
const TIER_SET = new Set(TIERS);
const BASES = { default: DEFAULT_TIERS, all: TIERS, none: [], readonly: ['read'] };
const TOOL_NAME = /^[A-Za-z][\w.-]{0,79}$/;

/**
 * Parse a spec into ordered tokens. Unknown words that look like tool names are
 * kept as tool tokens; anything else is reported so a typo is visible.
 * @param {string|string[]|null|undefined} spec
 * @returns {{ tokens: {kind:'base'|'tier'|'group'|'tool', id:string, on:boolean}[], invalid: string[] }}
 */
export function parseSpec(spec) {
	const raw = Array.isArray(spec) ? spec.join(',') : String(spec ?? '');
	const tokens = [];
	const invalid = [];
	for (const word of raw.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean)) {
		const on = !word.startsWith('-');
		const id = word.replace(/^[+-]/, '');
		const lower = id.toLowerCase();
		if (on && Object.hasOwn(BASES, lower)) tokens.push({ kind: 'base', id: lower, on: true });
		else if (TIER_SET.has(lower)) tokens.push({ kind: 'tier', id: lower, on });
		else if (GROUP_SET.has(lower)) tokens.push({ kind: 'group', id: lower, on });
		else if (TOOL_NAME.test(id)) tokens.push({ kind: 'tool', id, on });
		else invalid.push(word);
	}
	return { tokens, invalid };
}

/**
 * Fold tokens into an enablement. `source` records where it came from so an
 * error can tell the user which setting to change.
 * @param {{kind:string,id:string,on:boolean}[]} tokens
 * @param {string} source
 */
export function enablementFromTokens(tokens, source) {
	const tiers = new Set(DEFAULT_TIERS);
	const groupsOn = new Set();
	const groupsOff = new Set();
	const toolsOn = new Set();
	const toolsOff = new Set();
	for (const t of tokens) {
		if (t.kind === 'base') {
			tiers.clear();
			for (const tier of BASES[t.id]) tiers.add(tier);
			groupsOn.clear();
			groupsOff.clear();
			toolsOn.clear();
			toolsOff.clear();
		} else if (t.kind === 'tier') {
			if (t.on) tiers.add(t.id);
			else tiers.delete(t.id);
		} else if (t.kind === 'group') {
			(t.on ? groupsOn : groupsOff).add(t.id);
			(t.on ? groupsOff : groupsOn).delete(t.id);
		} else {
			(t.on ? toolsOn : toolsOff).add(t.id);
			(t.on ? toolsOff : toolsOn).delete(t.id);
		}
	}
	return { source, allowList: null, tiers, groupsOn, groupsOff, toolsOn, toolsOff };
}

/** The platform default: read and write on, financial off. */
export function defaultEnablement() {
	return enablementFromTokens([], 'default');
}

/** A client-supplied exact allow list: only these tool names exist for the session. */
export function allowListEnablement(names, source = 'client') {
	const list = new Set(
		(Array.isArray(names) ? names : String(names ?? '').split(/[\s,]+/))
			.map((n) => String(n).trim())
			.filter(Boolean),
	);
	return { ...defaultEnablement(), source, allowList: list };
}

/**
 * Convert saved settings ({ groups: {id: bool}, tools: {name: bool} }) to
 * tokens. Unknown group ids are dropped rather than trusted.
 * @param {{groups?: Record<string, boolean>, tools?: Record<string, boolean>}|null|undefined} settings
 */
export function settingsToTokens(settings) {
	if (!settings || typeof settings !== 'object') return [];
	const tokens = [];
	for (const [id, on] of Object.entries(settings.groups || {})) {
		if (GROUP_SET.has(id) && typeof on === 'boolean') tokens.push({ kind: 'group', id, on });
	}
	for (const [id, on] of Object.entries(settings.tools || {})) {
		if (TOOL_NAME.test(id) && typeof on === 'boolean') tokens.push({ kind: 'tool', id, on });
	}
	return tokens;
}

/**
 * Resolve the enablement for one session. The first source present wins, in
 * this order: the client's own allowed-tools list, the spec the client sent
 * (header, then query), the per-key setting, the account setting, the default.
 * Per-key settings are layered over the account setting, so a key only needs
 * to record where it differs.
 *
 * @param {{
 *   allowedTools?: string|string[]|null,
 *   headerSpec?: string|null,
 *   querySpec?: string|null,
 *   keySettings?: object|null,
 *   accountSettings?: object|null,
 * }} input
 */
export function resolveEnablement({ allowedTools, headerSpec, querySpec, keySettings, accountSettings } = {}) {
	if (allowedTools != null && String(allowedTools).trim() !== '') return allowListEnablement(allowedTools);
	if (headerSpec != null && String(headerSpec).trim() !== '') return enablementFromSpec(headerSpec, 'header');
	if (querySpec != null && String(querySpec).trim() !== '') return enablementFromSpec(querySpec, 'query');
	const account = settingsToTokens(accountSettings);
	const key = settingsToTokens(keySettings);
	if (key.length) return enablementFromTokens([...account, ...key], 'key');
	if (account.length) return enablementFromTokens(account, 'account');
	return defaultEnablement();
}

/**
 * Enablement from one spec string, honoring the bare-name-list rule above.
 * @param {string} spec
 * @param {string} source
 */
export function enablementFromSpec(spec, source) {
	const { tokens } = parseSpec(spec);
	if (tokens.length && tokens.every((t) => t.kind === 'tool' && t.on)) {
		return allowListEnablement(tokens.map((t) => t.id), source);
	}
	return enablementFromTokens(tokens, source);
}

/**
 * Enablement from a `three-ws tools` selection as the CLI stores it in the
 * credential store: { tiers, allow, deny }.
 * @param {{tiers?: string[], allow?: string[], deny?: string[]}} sel
 * @param {string} source
 */
export function enablementFromSelection(sel, source = 'cli') {
	const tokens = [{ kind: 'base', id: 'none', on: true }];
	for (const tier of Array.isArray(sel?.tiers) ? sel.tiers : DEFAULT_TIERS) {
		if (TIER_SET.has(tier)) tokens.push({ kind: 'tier', id: tier, on: true });
	}
	for (const name of Array.isArray(sel?.allow) ? sel.allow : []) tokens.push({ kind: 'tool', id: String(name), on: true });
	for (const name of Array.isArray(sel?.deny) ? sel.deny : []) tokens.push({ kind: 'tool', id: String(name), on: false });
	return enablementFromTokens(tokens, source);
}

/**
 * Is this tool on for the session? A tool with no policy entry is treated as
 * financial with no group: hidden unless named explicitly, so a tool nobody
 * classified can never slip into a default session.
 * @param {string} name
 * @param {{group:string,tier:string}|null} entry
 * @param {ReturnType<typeof defaultEnablement>} en
 */
export function isToolEnabled(name, entry, en) {
	if (en.allowList) return en.allowList.has(name);
	if (en.toolsOff.has(name)) return false;
	if (en.toolsOn.has(name)) return true;
	if (!entry) return false;
	if (en.groupsOff.has(entry.group)) return false;
	if (en.groupsOn.has(entry.group)) return true;
	return en.tiers.has(entry.tier);
}

/** A compact, serializable description of an enablement (for logs and the settings API). */
export function describeEnablement(en) {
	return {
		source: en.source,
		allow_list: en.allowList ? [...en.allowList] : null,
		tiers: [...en.tiers],
		groups_on: [...en.groupsOn],
		groups_off: [...en.groupsOff],
		tools_on: [...en.toolsOn],
		tools_off: [...en.toolsOff],
	};
}
