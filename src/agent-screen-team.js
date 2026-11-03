// agent-screen-team.js: the floating Team Task panel on /agent-screen.
//
// A lead agent's screen stream carries the live collaboration graph in
// `frame.meta.collab` (see api/agent-collab.js). Runs started from the task-bar
// "Team" toggle render in the Team Task overlay (agent-team.js); this panel is
// the passive view for everything else: a run started from another tab or the
// API, and the resync after a reconnect replays the log. It lazily mounts on the
// first snapshot, repaints in place afterwards, and can be dismissed (the next
// snapshot reopens it).

import { createCollabGraph } from './shared/collab-graph.js';

const STYLE_ID = 'asc-team-style';

const CSS = `
.asc-team-panel{position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);z-index:60;
  width:min(560px,calc(100vw - 32px));max-height:min(60vh,520px);overflow:auto;box-sizing:border-box;
  padding:12px 14px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.12);
  background:rgba(12,13,18,.94);backdrop-filter:blur(10px);box-shadow:0 18px 60px rgba(0,0,0,.55);color:#e4e4e7}
.asc-team-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.asc-team-label{font:700 11px/1 var(--font-sans,system-ui,sans-serif);letter-spacing:.09em;text-transform:uppercase;color:#a1a1aa}
.asc-team-close{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#d4d4d8;
  width:28px;height:28px;border-radius:8px;font-size:14px;line-height:1;cursor:pointer;transition:background .15s,border-color .15s,transform .1s}
.asc-team-close:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.3)}
.asc-team-close:active{transform:scale(.94)}
.asc-team-close:focus-visible{outline:2px solid #6aa8ff;outline-offset:2px}
`;

function ensureStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.appendChild(style);
}

/**
 * @returns {{ ingest(tree: object): void }} `ingest` accepts a compact collab
 *   tree (`frame.meta.collab`) and paints it; anything else is ignored.
 */
export function createTeamTaskPanel() {
	let panel = null;
	let graph = null;

	function mount() {
		ensureStyle();
		panel = document.createElement('section');
		panel.className = 'asc-team-panel';
		panel.setAttribute('aria-label', 'Team Task');
		panel.innerHTML = `
<div class="asc-team-bar">
  <span class="asc-team-label">Team Task</span>
  <button type="button" class="asc-team-close" aria-label="Close Team Task panel">✕</button>
</div>
<div data-graph></div>`;
		panel.querySelector('.asc-team-close').addEventListener('click', () => {
			panel.hidden = true;
		});
		document.body.appendChild(panel);
		graph = createCollabGraph(panel.querySelector('[data-graph]'), { compact: true });
	}

	function ingest(tree) {
		if (!tree || tree.kind !== 'collab' || !Array.isArray(tree.nodes) || !tree.nodes.length) return;
		// The overlay owns the run the viewer just launched; don't stack a second
		// copy of the same graph behind it.
		if (document.querySelector('.tt-overlay')) return;
		if (!panel) mount();
		panel.hidden = false;
		graph.update(tree);
	}

	return { ingest };
}
