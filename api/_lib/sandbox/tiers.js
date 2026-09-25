// Which tier a tool name belongs to when a sandboxed script asks for it.
//
// The bridge (api/_lib/sandbox/bridge.js) holds a script to the same tool
// policy as a model (docs/prompts/03, packages/mcp-policy): read and write
// tools the run may use are callable, and a financial tool is never callable
// from inside a script. A financial tool needs its preview shown to the user
// and the user's yes in the conversation, and a script has no conversation.
//
// The tier comes from, in order:
//   1. the server agent registry (api/_lib/agent-tools.js): read, always;
//   2. the policy table, across every server: the most restrictive tier any
//      server gives the name (a name that is financial anywhere is financial);
//   3. for a name nobody classified, its shape: names that execute, transfer,
//      send, buy, sell, launch, withdraw, sign or pay are treated as financial,
//      so an unclassified fund-moving tool fails closed instead of open.

import { POLICY } from '@three-ws/mcp-policy';
import { AGENT_TOOLS } from '../agent-tools.js';

const RANK = { read: 0, write: 1, financial: 2 };

const FINANCIAL_SHAPE = /(^|_)(execute|transfer|send|buy|sell|swap|launch|withdraw|sign|pay|mint|bridge|borrow|repay|supply|redeem|stake|unstake|close_position|open_position)(_|$)/;

let _table = null;

function policyIndex() {
	if (_table) return _table;
	const out = new Map();
	for (const rows of Object.values(POLICY)) {
		for (const [name, row] of Object.entries(rows)) {
			const tier = row?.tier || 'read';
			const prev = out.get(name);
			if (!prev || RANK[tier] > RANK[prev.tier]) {
				out.set(name, { tier, previewTool: row.previewTool || null, confirmFlag: row.confirmFlag || null });
			}
		}
	}
	_table = out;
	return out;
}

/**
 * The tier of a tool name, and for a financial tool the preview it requires.
 * @param {string} name
 * @returns {{ tier: 'read'|'write'|'financial', previewTool: string|null, source: 'registry'|'policy'|'shape'|'default' }}
 */
export function toolTier(name) {
	const n = String(name || '');
	if (Object.hasOwn(AGENT_TOOLS, n)) return { tier: 'read', previewTool: null, source: 'registry' };
	const row = policyIndex().get(n);
	if (row) return { tier: row.tier, previewTool: row.previewTool, source: 'policy' };
	if (FINANCIAL_SHAPE.test(n)) return { tier: 'financial', previewTool: null, source: 'shape' };
	return { tier: 'read', previewTool: null, source: 'default' };
}

/** Whether a script may never call this tool, whatever the run allows. */
export function isFinancialTool(name) {
	return toolTier(name).tier === 'financial';
}
