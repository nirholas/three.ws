// Client-side wallet authentication (SIWE / MetaMask).
// Loaded as a module from login.html — imports from CDN so it works outside Vite.

import { createConnectWalletButton } from '/wallet/connect-button.js';

const params = new URLSearchParams(location.search);
const next = params.get('next') || '/dashboard/';

function setErr(m) {
	const el = document.getElementById('err');
	if (el) { el.textContent = m; el.style.display = 'block'; }
}
function clearErr() {
	const el = document.getElementById('err');
	if (el) el.style.display = 'none';
}

const walletMount = document.getElementById('wallet-mount');
if (walletMount) {
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