// The policy runtime every three.ws MCP server runs its tools through.
//
//   listTools   hides tools the session has not enabled and teaches the model
//               the rules on the financial ones (extra arguments, a description
//               suffix, and a `_meta` block naming group, tier, confirm flag and
//               preview tool).
//   beforeCall  refuses a disabled tool with instructions to enable it, and a
//               financial tool without its confirm flag or without a fresh
//               preview id bound to the same arguments.
//   afterCall   stamps a preview id onto a preview tool's result, and burns the
//               preview id once the financial call it authorized has succeeded.
//
// Refusals are MCP tool results with isError, not JSON-RPC errors, because a
// model reads a tool result and acts on it; most clients show a protocol error
// only to the person.

import { randomBytes } from 'node:crypto';

import { PREVIEW_TTL_MS } from './groups.js';
import { isToolEnabled } from './enablement.js';
import { POLICY } from './table.js';

export const SETTINGS_URL = 'https://three.ws/settings/mcp-tools';
export const CLI_COMMAND = 'npx three-ws tools';

// Preview arguments that must never be written to a preview store: signing
// keys and bearer material stay in the call that needed them.
const SECRET_ARG = /secret|password|private_?key|mnemonic|seed/i;

/**
 * Normalize one table entry. Table rows are terse; this is the shape every
 * consumer reads.
 * @param {string} name
 * @param {object} row
 */
export function normalizeEntry(name, row) {
	const entry = {
		name,
		group: row.group,
		tier: row.tier || 'read',
		confirmFlag: row.confirmFlag || null,
		previewTool: row.previewTool || null,
		previewArg: null,
		bind: [],
		ownsPreview: row.ownsPreview === true,
	};
	if (entry.previewTool) {
		entry.previewArg = /quote/.test(entry.previewTool) ? 'quote_id' : 'preview_id';
		entry.bind = (row.bind || []).map((b) => {
			const [from, to] = String(b).split('>');
			return [from, to || from];
		});
	}
	return entry;
}

/** A fresh, unguessable preview id. */
function newPreviewId(arg) {
	return `${arg === 'quote_id' ? 'q' : 'p'}_${randomBytes(18).toString('base64url')}`;
}

function textResult(text, structured) {
	return { content: [{ type: 'text', text }], structuredContent: structured, isError: true };
}

function sameValue(a, b) {
	if (a == null && b == null) return true;
	if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
	if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
	return String(a).trim() === String(b).trim();
}

/** An in-process preview store: the right store for a stdio server, which is one process. */
export function createMemoryPreviewStore() {
	const map = new Map();
	return {
		async put(id, record, ttlMs) {
			map.set(id, { record, expires: Date.now() + ttlMs });
		},
		async get(id) {
			const hit = map.get(id);
			if (!hit) return null;
			if (hit.expires < Date.now()) {
				map.delete(id);
				return null;
			}
			return hit.record;
		},
		async del(id) {
			map.delete(id);
		},
	};
}

/**
 * Build the policy runtime for one server.
 * @param {{
 *   serverId: string,
 *   table?: Record<string, Record<string, object>>,
 *   store?: ReturnType<typeof createMemoryPreviewStore>,
 *   settingsUrl?: string,
 *   now?: () => number,
 * }} opts
 */
export function createPolicy({ serverId, table = POLICY, store = createMemoryPreviewStore(), settingsUrl = SETTINGS_URL, now = Date.now }) {
	const rows = table[serverId];
	if (!rows) throw new Error(`mcp-policy: no policy table for server "${serverId}"`);
	const entries = new Map(Object.entries(rows).map(([name, row]) => [name, normalizeEntry(name, row)]));

	// Reverse index: which financial tools each preview tool authorizes.
	const authorizes = new Map();
	for (const e of entries.values()) {
		if (e.tier !== 'financial' || !e.previewTool || e.ownsPreview) continue;
		if (!authorizes.has(e.previewTool)) authorizes.set(e.previewTool, []);
		authorizes.get(e.previewTool).push(e);
	}

	const entry = (name) => entries.get(name) || null;

	/** A preview tool stays callable whenever a financial tool it unlocks is on. */
	function enabled(name, en) {
		if (isToolEnabled(name, entry(name), en)) return true;
		return (authorizes.get(name) || []).some((f) => isToolEnabled(f.name, f, en));
	}

	function enableHint(e) {
		const token = e ? e.group : null;
		return {
			cli: CLI_COMMAND,
			settings: settingsUrl,
			header: token ? `X-Three-Tools: ${token}` : null,
		};
	}

	function disabledResult(name, en) {
		const e = entry(name);
		const where = e
			? `It is in the "${e.group}" group (${e.tier} tier)${e.tier === 'financial' ? ', which is off by default because it moves funds or cannot be undone' : ''}.`
			: 'It has no policy classification, so it stays off until it is named explicitly.';
		const how = e
			? `Turn the group on with \`${CLI_COMMAND}\`, on ${settingsUrl}, or by sending the header X-Three-Tools: ${e.group}.`
			: `Name it in X-Three-Tools or on ${settingsUrl} to turn it on.`;
		return textResult(`${name} is turned off for this connection. ${where} ${how}`, {
			ok: false,
			reason: 'tool_disabled',
			tool: name,
			group: e?.group ?? null,
			tier: e?.tier ?? null,
			enabled_by: en.source,
			enable: enableHint(e),
		});
	}

	/** The financial-rule sentence appended to a financial tool's description. */
	function financialNote(e) {
		return (
			` FINANCIAL: moves funds or cannot be undone. Call ${e.previewTool} first, show the user its result, ` +
			`and call this tool only after the user clearly says yes, passing ${e.previewArg} from that result ` +
			`(valid ${PREVIEW_TTL_MS / 60000} minutes) and ${e.confirmFlag}: true. Report the transaction signature it returns.`
		);
	}

	function policyMeta(e) {
		return e
			? { group: e.group, tier: e.tier, confirmFlag: e.confirmFlag, previewTool: e.previewTool, previewArg: e.previewArg }
			: null;
	}

	/**
	 * Decorate a JSON-Schema tool list for tools/list: drop disabled tools, add
	 * the policy arguments and note to financial ones, and stamp `_meta`.
	 * @param {object[]} tools
	 * @param {object} en
	 */
	function listTools(tools, en) {
		const out = [];
		for (const tool of tools) {
			if (!enabled(tool.name, en)) continue;
			const e = entry(tool.name);
			const meta = { ...(tool._meta || {}), 'three.ws/policy': policyMeta(e) };
			if (e?.tier !== 'financial' || !e.confirmFlag) {
				out.push({ ...tool, _meta: meta });
				continue;
			}
			const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object' };
			const properties = { ...(schema.properties || {}) };
			properties[e.confirmFlag] ??= {
				type: 'boolean',
				description: `Must be true, and only after the user approved the ${e.previewTool} result.`,
			};
			if (e.previewArg) {
				properties[e.previewArg] ??= {
					type: 'string',
					description: `The ${e.previewArg} returned by ${e.previewTool} within the last ${PREVIEW_TTL_MS / 60000} minutes.`,
				};
			}
			out.push({
				...tool,
				description: `${tool.description || ''}${financialNote(e)}`,
				inputSchema: { ...schema, properties },
				_meta: meta,
			});
		}
		return out;
	}

	/**
	 * Gate one call. On success returns the arguments with the policy-only
	 * fields removed (unless the tool declares them itself), plus the preview
	 * record the call is spending, so afterCall can burn it.
	 *
	 * @param {{ name: string, args?: object, en: object, principal: string, ownArgs?: string[] }} call
	 *   ownArgs: argument names the tool's own schema declares.
	 * @returns {Promise<{ ok: true, args: object, entry: object|null, preview: object|null }
	 *                 | { ok: false, result: object }>}
	 */
	async function beforeCall({ name, args = {}, en, principal, ownArgs = [] }) {
		if (!enabled(name, en)) return { ok: false, result: disabledResult(name, en) };
		const e = entry(name);
		if (!e || e.tier !== 'financial' || !e.confirmFlag) return { ok: true, args, entry: e, preview: null };

		const own = new Set(ownArgs);
		const strip = (a) => {
			const copy = { ...a };
			if (!own.has(e.confirmFlag)) delete copy[e.confirmFlag];
			if (e.previewArg && !own.has(e.previewArg)) delete copy[e.previewArg];
			// A tool with its own legacy confirm gate is satisfied by the policy flag.
			if (own.has('confirm') && e.confirmFlag !== 'confirm') copy.confirm = true;
			return copy;
		};

		if (args[e.confirmFlag] !== true) {
			return {
				ok: false,
				result: textResult(
					`${name} moves funds or cannot be undone, so it needs ${e.confirmFlag}: true. ` +
						`First call ${e.previewTool}, show the user what it returns, and call ${name} with its ${e.previewArg} and ` +
						`${e.confirmFlag}: true only after the user clearly says yes.`,
					{ ok: false, reason: 'confirmation_required', tool: name, confirm_flag: e.confirmFlag, preview_tool: e.previewTool, preview_arg: e.previewArg },
				),
			};
		}
		// A tool that issues and checks its own preview ids gets the confirm flag
		// enforced here and its preview verified by its own handler.
		if (!e.previewTool || e.ownsPreview) return { ok: true, args: strip(args), entry: e, preview: null };

		const id = args[e.previewArg];
		const refuse = (reason, detail) =>
			({
				ok: false,
				result: textResult(`${detail} Call ${e.previewTool} again, show the user the fresh result, and retry ${name} with the new ${e.previewArg} after they approve.`, {
					ok: false,
					reason,
					tool: name,
					preview_tool: e.previewTool,
					preview_arg: e.previewArg,
				}),
			});
		if (typeof id !== 'string' || !id) return refuse('preview_required', `${name} needs the ${e.previewArg} returned by ${e.previewTool}.`);
		const record = await store.get(id);
		if (!record || record.server !== serverId) return refuse('preview_unknown', `${e.previewArg} ${id} is unknown or has expired.`);
		if (now() - record.createdAt > PREVIEW_TTL_MS) {
			await store.del(id);
			return refuse('preview_stale', `${e.previewArg} ${id} is older than ${PREVIEW_TTL_MS / 60000} minutes, so it no longer reflects live prices and balances.`);
		}
		if (record.tool !== e.previewTool) return refuse('preview_mismatch', `${e.previewArg} ${id} came from ${record.tool}, not ${e.previewTool}.`);
		if (record.principal !== principal) return refuse('preview_mismatch', `${e.previewArg} ${id} belongs to a different caller.`);
		const differs = e.bind.filter(([from, to]) => !sameValue(record.args?.[from], args[to])).map(([, to]) => to);
		if (differs.length) {
			return refuse('preview_mismatch', `The ${differs.join(', ')} you passed differ from what ${e.previewTool} previewed.`);
		}
		return { ok: true, args: strip(args), entry: e, preview: { id, ...record } };
	}

	/**
	 * Finish one call: issue a preview id for a successful preview tool, burn
	 * the preview a successful financial call consumed.
	 * @param {{ name: string, args?: object, principal: string, result: object, preview?: object|null }} done
	 */
	async function afterCall({ name, args = {}, principal, result, preview = null }) {
		if (!result || result.isError) return result;
		if (preview?.id) {
			await store.del(preview.id);
			return result;
		}
		const unlocks = authorizes.get(name);
		if (!unlocks?.length) return result;

		const arg = unlocks[0].previewArg;
		const id = newPreviewId(arg);
		const createdAt = now();
		const kept = Object.fromEntries(Object.entries(args).filter(([k]) => !SECRET_ARG.test(k)));
		await store.put(id, { server: serverId, tool: name, principal, args: kept, createdAt }, PREVIEW_TTL_MS);

		const expiresAt = new Date(createdAt + PREVIEW_TTL_MS).toISOString();
		const next = unlocks.map((f) => `${f.name} with ${f.previewArg}: "${id}" and ${f.confirmFlag}: true`).join(', or ');
		const note =
			`${arg}: ${id} (valid until ${expiresAt}). Show the user this result. Only after they clearly say yes, call ${next}. ` +
			'If they say no, or change anything, do not call it.';
		return {
			...result,
			content: [...(Array.isArray(result.content) ? result.content : []), { type: 'text', text: note }],
			_meta: {
				...(result._meta || {}),
				'three.ws/preview': { [arg]: id, expires_at: expiresAt, unlocks: unlocks.map((f) => f.name) },
			},
		};
	}

	return { serverId, entry, entries, enabled, listTools, beforeCall, afterCall, disabledResult, policyMeta, financialNote };
}
