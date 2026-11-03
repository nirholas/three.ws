// @vitest-environment jsdom
// agent-screen.js feeds every stream frame and every backfilled log entry that
// carries a Team Task snapshot (frame.meta.collab) to a floating panel. Without
// that panel the very first collab frame threw a ReferenceError inside the
// stream callback and the team graph never rendered.
import { describe, it, expect, beforeEach } from 'vitest';
import { createTeamTaskPanel } from '../src/agent-screen-team.js';

const tree = (status = 'running') => ({
	kind: 'collab',
	taskId: 't1',
	goal: 'Research and summarise',
	status,
	maxUsd: 1,
	spentUsd: 0.1,
	nodes: [
		{ id: 'lead', kind: 'lead', title: 'Research and summarise', status: 'running' },
		{ id: 'n1', kind: 'hire', title: 'Fetch sources', status: 'queued', agentId: 'a-2', name: 'Scout' },
	],
	edges: [{ from: 'lead', to: 'n1' }],
});

describe('createTeamTaskPanel', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		document.head.innerHTML = '';
	});

	it('mounts nothing until a snapshot arrives', () => {
		createTeamTaskPanel();
		expect(document.querySelector('.asc-team-panel')).toBeNull();
	});

	it('opens a panel and paints the graph on the first snapshot, then updates in place', () => {
		const panel = createTeamTaskPanel();
		panel.ingest(tree());
		const el = document.querySelector('.asc-team-panel');
		expect(el).toBeTruthy();
		expect(el.hidden).toBe(false);
		expect(el.querySelectorAll('.cg-node').length).toBe(2);
		panel.ingest({ ...tree('done'), nodes: tree().nodes.map((n) => ({ ...n, status: 'done' })) });
		expect(document.querySelectorAll('.asc-team-panel').length).toBe(1);
		expect(el.querySelectorAll('.cg-node.is-done').length).toBe(2);
	});

	it('ignores snapshots that are not a collab tree', () => {
		const panel = createTeamTaskPanel();
		panel.ingest(null);
		panel.ingest({ kind: 'other', nodes: [] });
		expect(document.querySelector('.asc-team-panel')).toBeNull();
	});

	it('closes via the close button and reopens when a newer snapshot lands', () => {
		const panel = createTeamTaskPanel();
		panel.ingest(tree());
		const el = document.querySelector('.asc-team-panel');
		el.querySelector('.asc-team-close').click();
		expect(el.hidden).toBe(true);
		panel.ingest(tree());
		expect(el.hidden).toBe(false);
	});

	it('stays out of the way while the Team Task overlay is open', () => {
		document.body.innerHTML = '<div class="tt-overlay"></div>';
		const panel = createTeamTaskPanel();
		panel.ingest(tree());
		expect(document.querySelector('.asc-team-panel')).toBeNull();
	});
});
