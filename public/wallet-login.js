// Client-side wallet authentication.
// Used by /login page. Supports two paths:
//   1. Privy — email/social/wallet login with auto-created embedded wallets
//   2. Raw MetaMask/SIWE — via ConnectWalletController (unified state machine)
//
// Loaded as a module from login.html — imports from CDN so it works outside Vite.

import { BrowserProvider } from 'https://esm.sh/ethers@6.16.0';
import { createConnectWalletButton } from '/wallet/connect-button.js';

const params = new URLSearchParams(location.search);
const next = params.get('next') || '/dashboard/';

// Privy app id comes from /api/config (backed by PRIVY_APP_ID env var).
let PRIVY_APP_ID = document.querySelector('meta[name="privy-app-id"]')?.content || '';
const configReady = fetch('/api/config', { credentials: 'omit' })
	.then((r) => (r.ok ? r.json() : null))
	.then((cfg) => { if (cfg?.privyAppId) PRIVY_APP_ID = cfg.privyAppId; })
	.catch(() => {});

// ── UI helpers ──────────────────────────────────────────────────────────────

function ui() {
	const privyBtn = document.getElementById('privy');
	const errEl = document.getElementById('err');
	return {
		privyBtn,
		errEl,
		setErr: (m) => { if (errEl) { errEl.textContent = m; errEl.style.display = 'block'; } },
		clearErr: () => { if (errEl) errEl.style.display = 'none'; },
	};
}

// ── Privy login (primary path — unchanged from original) ──────────────────

async function signInWithPrivy() {
	const { privyBtn, setErr, clearErr } = ui();
	await configReady;
	if (!PRIVY_APP_ID) { setErr('Privy not configured.'); return; }

	clearErr();
	if (privyBtn) { privyBtn.disabled = true; privyBtn.textContent = 'Loading Privy…'; }

	try {
		const mod = await import('https://esm.sh/@privy-io/js-sdk-core@latest');
		const PrivyClient = mod.PrivyClient || mod.default;
		const privy = new PrivyClient({ appId: PRIVY_APP_ID });

		if (privyBtn) privyBtn.textContent = 'Opening login…';
		await privy.login({ loginMethods: ['wallet', 'email', 'google'] });

		if (privyBtn) privyBtn.textContent = 'Connecting wallet…';
		const eip1193 = await privy.getEthereumProvider();
		if (!eip1193) throw new Error('No wallet provider returned by Privy.');

		const provider = new BrowserProvider(eip1193);
		await completePrivySignIn(provider, privyBtn);
	} catch (e) {
		const msg = e?.message || String(e);
		setErr(msg === 'user rejected action' || msg.includes('cancelled') ? 'Login cancelled.' : msg);
		if (privyBtn) { privyBtn.disabled = false; privyBtn.textContent = 'Sign in with Privy'; }
	}
}

// Privy-specific SIWE completion (kept separate from the controller flow).
async function completePrivySignIn(provider, btn) {
	const signer = await provider.getSigner();
	const address = await signer.getAddress();
	const network = await provider.getNetwork();
	const chainId = Number(network.chainId);

	if (btn) btn.textContent = 'Requesting nonce…';
	const nonceRes = await fetch('/api/auth/siwe/nonce', { credentials: 'include' });
	if (!nonceRes.ok) throw new Error('Failed to get nonce');
	const { nonce, csrf } = await nonceRes.json();

	const domain = location.host;
	const uri = location.origin;
	const issuedAt = new Date().toISOString();
	const expirationTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

	const message = [
		`${domain} wants you to sign in with your Ethereum account:`,
		address,
		'',
		'Sign in to 3D Agent. This does not cost anything and proves wallet ownership.',
		'',
		`URI: ${uri}`,
		'Version: 1',
		`Chain ID: ${chainId}`,
		`Nonce: ${nonce}`,
		`Issued At: ${issuedAt}`,
		`Expiration Time: ${expirationTime}`,
	].join('\n');

	if (btn) btn.textContent = 'Check your wallet…';
	const signature = await signer.signMessage(message);

	if (btn) btn.textContent = 'Verifying…';
	const verifyRes = await fetch('/api/auth/siwe/verify', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
		body: JSON.stringify({ message, signature }),
	});
	const data = await verifyRes.json();
	if (!verifyRes.ok) throw new Error(data.error_description || 'Verification failed');

	try {
		localStorage.setItem('3dagent:auth-hint', JSON.stringify({ authed: true, ts: Date.now() }));
	} catch { /* ignore */ }
	location.href = next;
}

// ── Raw MetaMask / SIWE — unified controller ───────────────────────────────

const walletMount = document.getElementById('wallet-mount');
if (walletMount) {
	const { setErr, clearErr } = ui();
	const ctrl = createConnectWalletButton(walletMount, {
		verifyUrl: '/api/auth/siwe/verify',
		onSuccess: () => {
			try {
				localStorage.setItem('3dagent:auth-hint', JSON.stringify({ authed: true, ts: Date.now() }));
			} catch { /* ignore */ }
			location.href = next;
		},
	});

	ctrl.addEventListener('change', (e) => {
		const { status, error } = e.detail;
		if (status === 'error') {
			const msg = error?.message || 'Sign in failed.';
			setErr(msg === 'user rejected action' ? 'Signature cancelled.' : msg);
		} else {
			clearErr();
		}
	});
}

// ── Privy button ────────────────────────────────────────────────────────────

const privyBtn = document.getElementById('privy');
if (privyBtn) privyBtn.addEventListener('click', signInWithPrivy);
