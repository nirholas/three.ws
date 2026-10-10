// Electron glue for the local agent runtime: where the headless runtime in
// src/runtime meets the tray, native notifications, native confirmation
// dialogs and the companion mascot. Nothing here signs or moves funds. It
// shows the owner the exact action, and passes their answer, with the hash
// they were shown, back to the runtime, which re-checks it.

import { dialog, Notification } from 'electron';
import { join } from 'node:path';
import { createLocalRuntime } from '../runtime/index.js';
import { payloadHash } from '../runtime/hash.js';

const STATE_LABEL = { idle: 'Idle', working: 'Working', waiting_approval: 'Waiting for approval', paused: 'Paused', error: 'Error', killed: 'Killed' };

export function createLocalRuntimeService({ app, safeStorage, session, getConsole, onChange, onFace }) {
	const dir = join(app.getPath('userData'), 'runtime');
	const shown = new Set();

	const instance = createLocalRuntime({
		dir,
		safeStorage,
		apiBase: session.apiBase(),
		token: () => session.accessToken(),
		onEvent: (evt) => {
			if (evt.type === 'status') onFace(evt.face);
			if (evt.type === 'approval' && evt.notify) announce(evt.approval);
			const win = getConsole();
			if (win && !win.isDestroyed()) win.webContents.send('runtime:event', { type: evt.type, approval: evt.approval || null, receipt: evt.receipt || null, agent: evt.agent || null });
			onChange();
		},
	});
	const { runtime, log } = instance;

	/** The owner's last gate. Built from the stored approval, never from renderer input. */
	async function confirm(approval) {
		if (payloadHash(approval.payload) !== approval.hash) {
			return { error: 'The stored action does not match its hash. Nothing was run.' };
		}
		const parent = getConsole();
		const { response } = await dialog.showMessageBox(parent && !parent.isDestroyed() ? parent : undefined, {
			type: 'warning',
			buttons: ['Deny', 'Cancel', 'Approve'],
			defaultId: 1,
			cancelId: 1,
			noLink: true,
			title: 'Approval request',
			message: `${approval.payload.side === 'sell' ? 'Sell' : 'Buy'} ${approval.table.find((r) => r.key === 'amount')?.value}?`,
			detail: `${approval.text}\n\nApproval hash: ${approval.hash}\n\nApproving signs this exact action with the key on this machine. It cannot be undone.`,
		});
		return { decision: response === 2 ? 'approve' : response === 0 ? 'deny' : null };
	}

	async function decideThroughDialog(approvalId) {
		const approval = runtime.listApprovals().find((a) => a.id === approvalId);
		if (!approval || approval.status !== 'pending') return { status: approval?.status || 'not_found' };
		const answer = await confirm(approval);
		if (answer.error) throw Object.assign(new Error(answer.error), { code: 'payload_changed' });
		if (!answer.decision) return { status: 'pending' };
		return runtime.decide(approvalId, { decision: answer.decision, hash: approval.hash, via: 'desktop' });
	}

	function announce(approval) {
		if (shown.has(approval.id) || !Notification.isSupported()) return;
		shown.add(approval.id);
		const toast = new Notification({
			title: 'Approval needed',
			body: `${approval.text}\nHash ${approval.hash.slice(0, 12)}`,
			actions: [{ type: 'button', text: 'Review' }],
			silent: false,
		});
		const review = () => decideThroughDialog(approval.id).catch((err) => log.warn('approval_dialog_failed', { err }));
		toast.on('click', review);
		toast.on('action', review);
		toast.show();
	}

	/** Tray rows: one submenu per agent with status, pause or resume, kill, and its pending approvals. */
	function trayItems() {
		const agents = runtime.listAgents();
		if (!agents.length) return [{ label: 'Local agents: none yet', enabled: false }];
		return [
			{ label: 'Local agents', enabled: false },
			...agents.map((a) => ({
				label: `${a.name} · ${STATE_LABEL[a.status]}${a.pending_approvals ? ` (${a.pending_approvals})` : ''}`,
				submenu: [
					{ label: `${a.mode === 'paper' ? 'Paper' : 'Live'} on ${a.network}`, enabled: false },
					...(a.detail ? [{ label: a.detail.slice(0, 80), enabled: false }] : []),
					{ type: 'separator' },
					...runtime.listApprovals({ agentId: a.id, status: 'pending' }).map((ap) => ({
						label: `Review approval ${ap.text.split('\n')[1] || ''}`.trim(),
						click: () => void decideThroughDialog(ap.id).catch((err) => log.warn('approval_dialog_failed', { err })),
					})),
					a.status === 'paused'
						? { label: 'Resume', click: () => runtime.resume(a.id) }
						: { label: 'Pause', enabled: !['killed'].includes(a.status), click: () => runtime.pause(a.id) },
					{ label: 'Kill', enabled: a.status !== 'killed', click: () => void confirmKill(a) },
				],
			})),
		];
	}

	async function confirmKill(agent) {
		const parent = getConsole();
		const { response } = await dialog.showMessageBox(parent && !parent.isDestroyed() ? parent : undefined, {
			type: 'warning', buttons: ['Cancel', 'Kill agent'], defaultId: 0, cancelId: 0, noLink: true,
			message: `Kill ${agent.name}?`,
			detail: 'It stops for good: pending approvals are denied and its orders and automations are removed. Receipts and open positions stay on record.',
		});
		if (response === 1) runtime.kill(agent.id);
	}

	return { runtime, keystore: instance.keystore, log, trayItems, decideThroughDialog, keysEncrypted: instance.keysEncrypted, dir };
}
