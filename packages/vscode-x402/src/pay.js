// Pay-per-call flow. Pre-checks the 402 to show the exact USD amount and token,
// asks for confirmation (honouring the spend cap), then performs the real paid
// request on the correct rail and surfaces the settlement receipt:
//   • EVM accept    → @three-ws/x402-fetch (USDC EIP-3009 on Base + other chains)
//   • Solana accept → @x402/svm exact scheme (USDC or $THREE on Solana)

import * as vscode from 'vscode';
import { withX402, privateKeyToWallet } from '../../x402-fetch/src/index.js';
import { amountToUsd } from '../../x402-fetch/src/parse-challenge.js';
import { getKey, setKey, getSolanaKey, setSolanaKey } from './wallet.js';
import { inspectEndpoint, railOf } from './inspect.js';
import { buildSolanaPayingFetch, solanaAddressFromSecret, tokenLabel, isThreeAccept, isUsdcAccept } from './solana.js';

function config() {
	const c = vscode.workspace.getConfiguration('threewsX402');
	return {
		maxPaymentUsd: c.get('maxPaymentUsd', 0.1),
		confirmEachPayment: c.get('confirmEachPayment', true),
		network: c.get('network', ''), // '' = auto
		preferToken: c.get('preferToken', 'auto'),
	};
}

function decodeReceipt(res) {
	const raw = res.headers.get('x-payment-response') || res.headers.get('payment-response');
	if (!raw) return null;
	try {
		return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

function networkLabel(accept, rail) {
	if (rail === 'solana') return 'Solana';
	if (accept?.network === 'eip155:8453') return 'Base';
	return accept?.network || 'EVM';
}

/**
 * @param {{ url:string, method?:string, body?:string, serviceName?:string }} req
 * @returns {Promise<{ ok:boolean, status:number, amountUsd:number|null, address:string, token:string, network:string, receipt:any, bodyText:string }|null>}
 */
export async function payAndCall(context, req) {
	const cfg = config();

	let evmKey = await getKey(context);
	let solKey = await getSolanaKey(context);
	if (!evmKey && !solKey) {
		const choice = await vscode.window.showWarningMessage(
			'No wallet key set. Set one to pay for x402 endpoints.',
			'Set Solana key',
			'Set EVM key',
			'Cancel',
		);
		if (choice === 'Set Solana key') {
			await setSolanaKey(context);
			solKey = await getSolanaKey(context);
		} else if (choice === 'Set EVM key') {
			await setKey(context);
			evmKey = await getKey(context);
		} else return null;
		if (!evmKey && !solKey) return null;
	}

	const method = (req.method || 'GET').toUpperCase();
	const init = { method, headers: { accept: 'application/json' } };
	if (req.body != null && method !== 'GET' && method !== 'HEAD') {
		init.headers['content-type'] = 'application/json';
		init.body = req.body;
	}

	// Pre-check the challenge, restricted to the rails we actually hold a key for.
	const probe = await inspectEndpoint(req.url, {
		method,
		preferNetwork: cfg.network || undefined,
		preferToken: cfg.preferToken,
		wallets: { evm: !!evmKey, solana: !!solKey },
	});

	if (probe.status !== 402) {
		// Free or non-paid endpoint — just run it, no signing.
		const res = await fetch(req.url, init);
		return finalize(res, { amountUsd: 0, tokenAmount: 0, paymentLabel: 'free', address: '', token: '', network: '' });
	}

	if (!probe.chosen) {
		// Payable in principle by a rail whose key we don't have? Offer to set it.
		const inPrinciple = await inspectEndpoint(req.url, {
			method,
			preferNetwork: cfg.network || undefined,
			preferToken: cfg.preferToken,
			wallets: { evm: true, solana: true },
		});
		if (inPrinciple.chosen) {
			const needRail = railOf(inPrinciple.chosen);
			const label = needRail === 'solana' ? 'Solana' : 'EVM';
			const set = await vscode.window.showWarningMessage(
				`This endpoint is payable on ${needRail === 'solana' ? 'Solana' : 'an EVM network'}, but no ${label} wallet key is set.`,
				`Set ${label} key`,
				'Cancel',
			);
			if (set === `Set ${label} key`) {
				const added = needRail === 'solana' ? await setSolanaKey(context) : await setKey(context);
				if (added) return payAndCall(context, req); // retry now that a key exists
			}
			return null;
		}
		throw new Error(
			'This endpoint requires payment but offers no requirement this extension can satisfy (needs USDC EIP-3009 on an EVM network, or the exact scheme in USDC/$THREE on Solana).',
		);
	}

	const chosen = probe.chosen;
	const rail = probe.rail;
	const token = tokenLabel(chosen);
	const tokenAmount = amountToUsd(chosen);
	const amountUsd = isUsdcAccept(chosen) ? tokenAmount : null;
	const paymentLabel = amountUsd != null ? `$${amountUsd.toFixed(6)} ${token}` : `${tokenAmount.toFixed(6)} ${token}`;
	const netLabel = networkLabel(chosen, rail);

	// Derive the paying address for the confirmation prompt.
	let address = '';
	if (rail === 'evm') {
		address = privateKeyToWallet(evmKey).address;
	} else if (rail === 'solana') {
		try {
			address = await solanaAddressFromSecret(solKey);
		} catch {
			/* shown without address if derivation fails */
		}
	}

	if (amountUsd != null && amountUsd > cfg.maxPaymentUsd) {
		const raise = await vscode.window.showWarningMessage(
			`This call costs ${paymentLabel} on ${netLabel}, above your cap of $${cfg.maxPaymentUsd.toFixed(4)}.`,
			'Raise cap & pay',
			'Cancel',
		);
		if (raise !== 'Raise cap & pay') return null;
	} else if (cfg.confirmEachPayment || amountUsd == null) {
		const from = address ? ` from ${short(address)}` : '';
		const go = await vscode.window.showInformationMessage(
			`Pay ${paymentLabel} on ${netLabel}${from} to call ${req.serviceName || req.url}?`,
			{ modal: true },
			'Pay & call',
		);
		if (go !== 'Pay & call') return null;
	}

	let paidFetch;
	if (rail === 'solana') {
		// Pin the paid token to the one we quoted so the receipt matches the prompt.
		const payToken =
			cfg.preferToken !== 'auto' ? cfg.preferToken : isThreeAccept(chosen) ? 'three' : isUsdcAccept(chosen) ? 'usdc' : 'auto';
		const built = await buildSolanaPayingFetch(solKey, { preferToken: payToken });
		paidFetch = built.payingFetch;
		address = built.address;
	} else {
		paidFetch = withX402(evmKey, {
			maxPaymentUsd: Math.max(cfg.maxPaymentUsd, amountUsd ?? 0),
			network: chosen.network,
		});
	}

	const res = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Paying ${paymentLabel} on ${netLabel} & calling…` },
		() => paidFetch(req.url, init),
	);
	return finalize(res, { amountUsd, tokenAmount, paymentLabel, address, token, network: netLabel });
}

async function finalize(res, { amountUsd, tokenAmount, paymentLabel, address, token, network }) {
	const bodyText = await res.text();
	return {
		ok: res.ok,
		status: res.status,
		amountUsd,
		tokenAmount,
		paymentLabel,
		address,
		token,
		network,
		receipt: decodeReceipt(res),
		bodyText,
	};
}

function short(addr) {
	return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}
