// Pure logic for the menu bar panel: where the popover goes, what the avatar
// should be doing, and what the menu bar shows. No Electron, no DOM, so the
// main process, the renderer and the tests all import the same functions.

export const PANEL_WIDTH = 372;
export const PANEL_HEIGHT = 560;
const EDGE_GAP = 8;

/**
 * Where to put the popover. `anchor` is the tray icon's rectangle (or a 1px
 * rectangle at the cursor where the OS reports no tray bounds, as Linux does).
 * The panel is centered on the anchor, clamped inside the work area, and sits
 * below the anchor when the anchor is in the top half of the display (a menu
 * bar) and above it otherwise (a taskbar).
 */
export function placePanel(anchor, size, workArea) {
	const w = Math.min(size.width, workArea.width - EDGE_GAP * 2);
	const h = Math.min(size.height, workArea.height - EDGE_GAP * 2);
	const centerX = anchor.x + anchor.width / 2;
	const minX = workArea.x + EDGE_GAP;
	const maxX = workArea.x + workArea.width - w - EDGE_GAP;
	const x = Math.round(Math.min(Math.max(centerX - w / 2, minX), Math.max(minX, maxX)));
	const anchorMid = anchor.y + anchor.height / 2;
	const topHalf = anchorMid < workArea.y + workArea.height / 2;
	const rawY = topHalf ? anchor.y + anchor.height + EDGE_GAP : anchor.y - h - EDGE_GAP;
	const minY = workArea.y + EDGE_GAP;
	const maxY = workArea.y + workArea.height - h - EDGE_GAP;
	const y = Math.round(Math.min(Math.max(rawY, minY), Math.max(minY, maxY)));
	return { x, y, width: w, height: h };
}

/** An anchor rectangle: the tray icon's bounds when the OS gives them, else the cursor. */
export function anchorFor(trayBounds, cursor) {
	if (trayBounds && trayBounds.width > 0 && trayBounds.height > 0) return trayBounds;
	return { x: cursor.x, y: cursor.y, width: 1, height: 1 };
}

/**
 * Clicking the tray icon while the panel is open first blurs it (which hides
 * it) and then delivers the click. Without this the panel would flicker shut
 * and straight back open instead of staying closed.
 */
export function shouldOpenOnClick(lastBlurHideAt, now, windowMs = 250) {
	return !(lastBlurHideAt && now - lastBlurHideAt < windowMs);
}

const FACE = {
	none: { key: 'none', label: 'No local agents yet', gesture: 'idle', tone: 'muted' },
	idle: { key: 'idle', label: 'Idle, watching', gesture: 'idle', tone: 'ok' },
	working: { key: 'working', label: 'Working', gesture: 'walk', tone: 'ok' },
	waiting_approval: { key: 'waiting_approval', label: 'Needs your approval', gesture: 'wave', tone: 'warn' },
	error: { key: 'error', label: 'Needs attention', gesture: 'idle', tone: 'bad' },
	paused: { key: 'paused', label: 'Paused', gesture: 'idle', tone: 'muted' },
	killed: { key: 'killed', label: 'Stopped', gesture: 'idle', tone: 'muted' },
};

/** What the avatar does and says for the local runtime's most urgent state. */
export function faceView(face) {
	return FACE[face?.state] || FACE.none;
}

/** Text shown next to the icon in the macOS menu bar. Approvals outrank unread. */
export function trayTitle({ pendingApprovals = 0, unread = 0 } = {}) {
	if (pendingApprovals > 0) return `${pendingApprovals} to approve`;
	if (unread > 0) return String(unread > 99 ? '99+' : unread);
	return '';
}

/** One tooltip line for the tray icon. */
export function trayTooltip({ signedIn, name, pendingApprovals = 0, unread = 0 }) {
	const who = signedIn ? name || 'Signed in' : 'Not signed in';
	const bits = [];
	if (pendingApprovals) bits.push(`${pendingApprovals} awaiting approval`);
	if (unread) bits.push(`${unread} unread`);
	return `three.ws Desktop: ${who}${bits.length ? `, ${bits.join(', ')}` : ''}`;
}

/** SOL for a balance row: more digits for small balances, none of the noise for large ones. */
export function formatSol(sol) {
	if (sol == null || !Number.isFinite(Number(sol))) return null;
	const n = Number(sol);
	if (n === 0) return '0';
	if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
	if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
	return n.toLocaleString('en-US', { maximumSignificantDigits: 3 });
}

export function shortAddress(address) {
	const a = String(address || '');
	return a.length > 12 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a;
}

/** "just now", "42s ago", "5m ago" for the sync footer. */
export function ago(ms, now = Date.now()) {
	if (!ms) return null;
	const s = Math.max(0, Math.round((now - ms) / 1000));
	if (s < 5) return 'just now';
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	return `${Math.round(m / 60)}h ago`;
}

/** Cloud agent lifecycle to a label and whether the power button reads as on. */
export function agentPower(agent) {
	if (!agent) return { on: false, known: false, label: 'No agent' };
	if (agent.status === 'running') return { on: true, known: true, label: 'Running' };
	if (agent.status === 'stopped') return { on: false, known: true, label: 'Stopped' };
	if (agent.status === 'draft') return { on: false, known: false, label: 'Draft' };
	return { on: Boolean(agent.isPublished), known: false, label: agent.isPublished ? 'Live' : 'Unpublished' };
}

/**
 * The local runtime in one tile: how many agents, how many are running, and
 * whether the tile's button should pause everything or resume it.
 */
export function localSummary(agents = []) {
	const alive = agents.filter((a) => a.status !== 'killed');
	const paused = alive.filter((a) => a.status === 'paused');
	return {
		total: alive.length,
		paused: paused.length,
		allPaused: alive.length > 0 && paused.length === alive.length,
		action: alive.length > 0 && paused.length === alive.length ? 'resume' : 'pause',
	};
}
