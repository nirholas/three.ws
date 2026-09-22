// The preview-id rule for anything that moves money or takes an irreversible
// action from the console.
//
// 1. A preview is created here, in the main process, from a live server-side
//    simulation or dry run. The exact request that would execute it is stored
//    next to it under a random `previewId`.
// 2. The renderer only ever holds the id. Approving sends the id and nothing
//    else, so a compromised or buggy renderer cannot change the recipient or
//    the amount between preview and execution.
// 3. An id is single use and expires (PREVIEW_TTL_MS). An expired preview has
//    to be re-run, which re-reads the balance and the price.
// 4. Before a financial preview executes, `confirm` (a native OS dialog built
//    from the stored summary, not from anything the renderer sent) asks the
//    person one last time.
//
// The renderer's generic data channel refuses the executing endpoints outright
// (isGuardedPath below), so this module is the only way to reach them.

import { randomBytes, randomUUID } from 'node:crypto';

export const PREVIEW_TTL_MS = 120_000;

const GUARDED = [
	/^\/api\/agents\/[^/]+\/(solana|wallet)\/(withdraw|trade|send)(\/|$|\?)/,
	/^\/api\/agents\/[^/]+\/trade(\/|$|\?)/,
	/^\/api\/agents\/[^/]+\/intents\/run(\/|$|\?)/,
	/^\/api\/agents\/(agent-trade|solana-trade)(\/|$|\?)/,
	/^\/api\/agent\/send-sol(\/|$|\?)/,
];

// True for a path the renderer may not call directly with a mutating method.
export function isGuardedPath(path, method = 'GET') {
	const m = String(method).toUpperCase();
	if (m === 'GET' || m === 'HEAD') return false;
	const p = String(path);
	if (GUARDED.some((re) => re.test(p))) return true;
	// Autopilot: reading and dismissing are free; executing is a preview action.
	return /^\/api\/autopilot\/proposals(\?|$)/.test(p);
}

const newId = () => `pv_${randomBytes(12).toString('base64url')}`;

function pickSignature(result) {
	const r = result?.data || result || {};
	return r.signature || r.receipt?.signature || r.action?.signature || null;
}

function explorerFor(result, signature, network) {
	const r = result?.data || result || {};
	if (r.explorer) return r.explorer;
	if (r.receipt?.explorer) return r.receipt.explorer;
	if (!signature) return null;
	return `https://solscan.io/tx/${signature}${network === 'devnet' ? '?cluster=devnet' : ''}`;
}

export function createPreviewRegistry({ request, confirm, now = Date.now, ttlMs = PREVIEW_TTL_MS, idFactory = newId }) {
	const previews = new Map();

	function sweep() {
		const t = now();
		for (const [id, p] of previews) if (p.expiresAt <= t) previews.delete(id);
	}

	function publicView(p) {
		return { previewId: p.id, kind: p.kind, agentId: p.agentId, financial: p.financial, expiresAt: p.expiresAt, summary: p.summary };
	}

	async function previewWithdraw({ agentId, destination, amount, network = 'mainnet' }) {
		const dest = String(destination || '').trim();
		const amt = String(amount ?? '').trim();
		if (!dest) throw new Error('Enter the address to send to.');
		if (amt !== 'max' && !(Number(amt) > 0)) throw new Error('Enter an amount greater than zero, or send the maximum.');
		const net = network === 'devnet' ? 'devnet' : 'mainnet';
		const base = { destination: dest, amount: amt === 'max' ? 'max' : Number(amt), asset: 'SOL', network: net };
		const path = `/api/agents/${encodeURIComponent(agentId)}/solana/withdraw`;
		const sim = await request(path, { method: 'POST', body: { ...base, simulate: true } });
		const d = sim?.data || {};
		return {
			financial: true,
			summary: {
				action: 'Send SOL from the agent wallet',
				recipient: d.destination || dest,
				amount: d.amount != null ? String(d.amount) : String(base.amount),
				token: 'SOL',
				chain: net === 'devnet' ? 'Solana devnet' : 'Solana mainnet',
				usd: d.usd ?? null,
				note: d.note || null,
				simulationError: d.err ? JSON.stringify(d.err) : null,
				computeUnits: d.units_consumed ?? null,
				network: net,
			},
			execute: { path, body: { ...base, idempotency_key: randomUUID() } },
		};
	}

	async function previewProposal({ agentId, proposalId }) {
		// The dry run answers with checks only; the recipient and amount the
		// confirmation must show come from the proposal row itself.
		const list = await request(`/api/autopilot/proposals?agentId=${encodeURIComponent(agentId)}&status=pending`);
		const proposal = (list?.proposals || []).find((row) => row.id === proposalId);
		if (!proposal) throw new Error('That proposal is no longer pending.');
		const res = await request('/api/autopilot/proposals', { method: 'POST', body: { agentId, action: 'dryrun', proposalId } });
		const p = { kind: proposal.kind, ...(res?.preview || {}) };
		const financial = p.kind === 'wallet_transfer';
		const params = proposal?.params || {};
		return {
			financial,
			summary: {
				action: p.willDo || 'Run this proposal',
				kind: p.kind || null,
				checks: Array.isArray(p.checks) ? p.checks.map((c) => ({ label: String(c.label), ok: Boolean(c.ok), detail: c.detail ? String(c.detail) : '' })) : [],
				blocked: Boolean(p.blocked),
				...(financial ? {
					recipient: params.recipient || null,
					amount: params.amount_sol != null ? String(params.amount_sol) : null,
					token: 'SOL',
					chain: 'Solana mainnet',
					network: 'mainnet',
				} : {}),
			},
			execute: { path: '/api/autopilot/proposals', body: { agentId, action: 'execute', proposalId, confirm: true } },
		};
	}

	async function create(kind, input = {}) {
		sweep();
		if (!input.agentId) throw new Error('Pick an agent first.');
		let built;
		if (kind === 'withdraw') built = await previewWithdraw(input);
		else if (kind === 'proposal') built = await previewProposal(input);
		else throw new Error(`Unknown preview kind: ${kind}`);
		const p = { id: idFactory(), kind, agentId: input.agentId, createdAt: now(), expiresAt: now() + ttlMs, ...built };
		previews.set(p.id, p);
		return publicView(p);
	}

	async function approve(previewId) {
		sweep();
		const p = previews.get(previewId);
		if (!p) {
			const err = new Error('This preview expired or was already used. Preview it again to see the current numbers.');
			err.code = 'preview_expired';
			throw err;
		}
		// Single use from this point on, whatever happens next.
		previews.delete(previewId);
		if (p.summary.blocked) {
			const err = new Error('The dry run found a check that fails, so nothing was sent. Fix it and preview again.');
			err.code = 'preview_blocked';
			throw err;
		}
		if (p.financial) {
			const ok = await confirm(p.summary);
			if (!ok) return { status: 'cancelled', previewId };
		}
		const result = await request(p.execute.path, { method: 'POST', body: p.execute.body });
		const signature = pickSignature(result);
		return {
			status: 'executed',
			previewId,
			signature,
			explorer: explorerFor(result, signature, p.summary.network),
			result: result?.data || result,
		};
	}

	function cancel(previewId) {
		return { status: 'cancelled', previewId, existed: previews.delete(previewId) };
	}

	function get(previewId) {
		sweep();
		const p = previews.get(previewId);
		return p ? publicView(p) : null;
	}

	return { create, approve, cancel, get, size: () => (sweep(), previews.size) };
}
