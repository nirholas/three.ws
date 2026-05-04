// Client-side wallet authentication for both EVM (SIWE) and Solana (SIWS).
// Loaded as a module from login.html — imports from CDN so it works outside Vite.

import { createConnectWalletButton } from '/wallet/connect-button.js';
import { createSolanaWalletButton } from '/wallet/connect-button-solana.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.min.js';

const params = new URLSearchParams(location.search);
const next   = window.__loginNext || params.get('next') || sessionStorage.getItem('login_redirect') || '/create';
sessionStorage.removeItem('login_redirect');

function setErr(m) {
	const el = document.getElementById('err');
	if (el) { el.textContent = m; el.style.display = 'block'; }
}
function clearErr() {
	const el = document.getElementById('err');
	if (el) el.style.display = 'none';
}

function onSuccess(data) {
	try {
		localStorage.setItem('3dagent:auth-hint', JSON.stringify({
			authed: true,
			name: data?.user?.display_name || '',
			ts: Date.now(),
		}));
	} catch { /* ignore */ }
	location.href = next;
}

// ─── EVM wallet button ────────────────────────────────────────────────────────

const evmMount = document.getElementById('wallet-mount');
if (evmMount) {
	const evmCtrl = createConnectWalletButton(evmMount, {
		verifyUrl: '/api/auth/siwe/verify',
		onSuccess,
	});
	evmCtrl.addEventListener('change', (e) => {
		const { status, error } = e.detail;
		if (status === 'error') {
			const msg = error?.message || 'Sign in failed.';
			setErr(msg === 'user rejected action' ? 'Signature cancelled.' : msg);
		} else {
			clearErr();
		}
	});
}

// ─── Solana wallet button ─────────────────────────────────────────────────────

let solanaCtrl = null;

function mountSolanaButton(preferredWallet = null) {
	const mount = document.getElementById('solana-wallet-mount');
	if (!mount) return;
	if (solanaCtrl) solanaCtrl.disconnect();

	solanaCtrl = createSolanaWalletButton(mount, {
		preferredWallet,
		verifyUrl: '/api/auth/siws/verify',
		onSuccess,
	});
	solanaCtrl.addEventListener('change', (e) => {
		const { status, error } = e.detail;
		if (status === 'error') {
			setErr(error?.message || 'Sign in failed.');
		} else {
			clearErr();
		}
	});
}

mountSolanaButton();

// Wallet hint buttons (Phantom / Backpack / Solflare)
document.querySelectorAll('.wallet-hint-btn').forEach((btn) => {
	btn.addEventListener('click', () => {
		document.querySelectorAll('.wallet-hint-btn').forEach((b) => b.classList.remove('active'));
		btn.classList.add('active');
		mountSolanaButton(btn.dataset.wallet);
	});
});

// ─── Chain tab switcher ───────────────────────────────────────────────────────

document.querySelectorAll('.chain-tab').forEach((tab) => {
	tab.addEventListener('click', () => {
		const chain = tab.dataset.chain;
		document.querySelectorAll('.chain-tab').forEach((t) => t.classList.remove('active'));
		document.querySelectorAll('.chain-panel').forEach((p) => p.classList.remove('active'));
		tab.classList.add('active');
		document.getElementById(`${chain}-panel`)?.classList.add('active');
		clearErr();
	});
});

// ─── Demo User button ────────────────────────────────────────────────────────

const demoLoginBtn = document.getElementById('demo-login-btn');
if (demoLoginBtn) {
	demoLoginBtn.addEventListener('click', async () => {
		// IMPORTANT: This is the default, public, well-known private key from
		// the Hardhat development environment.
		// It is NOT a secret. It is used for demonstration purposes only.
		// DO NOT send any real assets to the corresponding address:
		// 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
		***REMOVED***
		const wallet = new ethers.Wallet(demoPrivateKey);
		const address = await wallet.getAddress();

		demoLoginBtn.disabled = true;
		demoLoginBtn.textContent = 'Signing in as Demo User...';
		clearErr();

		try {
			// 1. Get nonce from server
			const nonceRes = await fetch('/api/auth/siwe/nonce', { credentials: 'include' });
			if (!nonceRes.ok) throw new Error('Failed to fetch nonce.');
			const { nonce, csrf } = await nonceRes.json();

			// 2. Create SIWE message
			const message = [
				`${location.host} wants you to sign in with your Ethereum account:`,
				address,
				'',
				'Sign in to three.ws.',
				'',
				`URI: ${location.origin}`,
				'Version: 1',
				`Chain ID: 1`, // Mainnet
				`Nonce: ${nonce}`,
				`Issued At: ${new Date().toISOString()}`,
			].join('\n');

			// 3. Sign the message
			const signature = await wallet.signMessage(message);

			// 4. Verify the signature with the server
			const verifyRes = await fetch('/api/auth/siwe/verify', {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
				body: JSON.stringify({ message, signature }),
			});

			if (!verifyRes.ok) {
				const body = await verifyRes.json().catch(() => ({}));
				throw new Error(body.error_description || 'Demo login failed at verification.');
			}
			const data = await verifyRes.json();
			onSuccess(data);

		} catch (err) {
			setErr(err.message || 'An unknown error occurred during demo login.');
			demoLoginBtn.disabled = false;
			demoLoginBtn.textContent = 'Login as Demo User';
		}
	});
}
