// The /teams page (src/teams.js) wires many async click handlers that ask for
// confirmation first and then show a busy state on the clicked button. Once a
// handler awaits, the event has finished dispatching and `e.currentTarget` is
// null, so `busy(e.currentTarget, ...)` after `await confirmDialog(...)` threw
// "Cannot read properties of null (reading 'innerHTML')" and the action never
// ran (rotate/revoke SCIM token, unclaim tenant, archive team). This parses the
// module and fails on any event handler that reads `currentTarget` from its
// event parameter after its first `await`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const SOURCE = readFileSync(fileURLToPath(new URL('../src/teams.js', import.meta.url)), 'utf8');

function children(node) {
	const out = [];
	for (const key of Object.keys(node)) {
		if (key === 'type' || key === 'start' || key === 'end') continue;
		const v = node[key];
		if (Array.isArray(v)) for (const c of v) { if (c && typeof c.type === 'string') out.push(c); }
		else if (v && typeof v.type === 'string') out.push(v);
	}
	return out;
}

function walk(node, visit) {
	visit(node);
	for (const c of children(node)) walk(c, visit);
}

// Walk a handler body without descending into nested functions, which have
// their own timeline.
function walkOwnBody(node, visit) {
	visit(node);
	for (const c of children(node)) {
		if (/Function/.test(c.type)) continue;
		walkOwnBody(c, visit);
	}
}

export function staleCurrentTargetReads(source) {
	const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
	const problems = [];
	walk(ast, (node) => {
		if (node.type !== 'CallExpression') return;
		const callee = node.callee;
		if (callee.type !== 'MemberExpression' || callee.property.name !== 'addEventListener') return;
		const fn = node.arguments[1];
		if (!fn || !/Function/.test(fn.type) || !fn.async) return;
		const evt = fn.params[0];
		if (!evt || evt.type !== 'Identifier') return;
		let firstAwait = Infinity;
		walkOwnBody(fn.body, (n) => { if (n.type === 'AwaitExpression' && n.start < firstAwait) firstAwait = n.start; });
		walkOwnBody(fn.body, (n) => {
			if (n.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === evt.name
				&& n.property.name === 'currentTarget' && n.start > firstAwait) {
				problems.push(`line ${n.loc.start.line}`);
			}
		});
	});
	return problems;
}

describe('teams page async handlers', () => {
	it('flags a currentTarget read after an await (detector self-check)', () => {
		const bad = `btn.addEventListener('click', async (e) => { const ok = await ask(); busy(e.currentTarget); });`;
		const good = `btn.addEventListener('click', async (e) => { const b = e.currentTarget; await ask(); busy(b); });`;
		expect(staleCurrentTargetReads(bad)).toHaveLength(1);
		expect(staleCurrentTargetReads(good)).toHaveLength(0);
	});

	it('never reads event.currentTarget after awaiting in src/teams.js', () => {
		expect(staleCurrentTargetReads(SOURCE)).toEqual([]);
	});
});
