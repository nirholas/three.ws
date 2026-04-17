// Wallet-disconnect UX for pages where the user is already signed in.
// Listens for MetaMask accountsChanged events and shows a non-blocking toast
// prompting sign-out if the wallet that was used to SIWE-auth disconnects.
//
// Add to authenticated pages:
//   <script type="module" src="/session-client.js"></script>
//
// Does NOT auto-sign-out — SIWE proved ownership at sign-in; the user may
// intentionally disconnect for privacy. The choice is always theirs.

(function initSessionClient() {
	if (!window.ethereum) return;

	// Fetch the current session address once so we can detect relevant disconnects.
	let siweAddress = null;
	fetch('/api/auth/me', { credentials: 'include' })
		.then((r) => (r.ok ? r.json() : null))
		.then((data) => {
			// me.js returns { user: { wallet_address, ... } } — use that if present.
			siweAddress = data?.user?.wallet_address?.toLowerCase() || null;
		})
		.catch(() => {});

	let toastEl = null;

	function showDisconnectToast() {
		if (toastEl) return; // already showing

		toastEl = document.createElement('div');
		toastEl.setAttribute('role', 'status');
		toastEl.setAttribute('aria-live', 'polite');
		Object.assign(toastEl.style, {
			position: 'fixed',
			bottom: '20px',
			right: '20px',
			background: '#1c1c28',
			border: '1px solid #2a2a36',
			borderRadius: '10px',
			padding: '12px 16px',
			color: '#eee',
			fontSize: '14px',
			display: 'flex',
			alignItems: 'center',
			gap: '12px',
			zIndex: '9999',
			boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
			maxWidth: '340px',
		});

		const msg = document.createElement('span');
		msg.textContent = 'MetaMask disconnected — you\u2019re still signed in.';

		const signOutBtn = document.createElement('button');
		signOutBtn.textContent = 'Sign out';
		Object.assign(signOutBtn.style, {
			background: 'transparent',
			border: '1px solid #3a3a4a',
			borderRadius: '6px',
			color: '#9a8cff',
			cursor: 'pointer',
			padding: '4px 10px',
			fontSize: '13px',
			whiteSpace: 'nowrap',
		});
		signOutBtn.onclick = () => {
			fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
				location.href = '/login';
			});
		};

		const dismissBtn = document.createElement('button');
		dismissBtn.textContent = '×';
		dismissBtn.setAttribute('aria-label', 'Dismiss');
		Object.assign(dismissBtn.style, {
			background: 'transparent',
			border: 'none',
			color: '#666',
			cursor: 'pointer',
			fontSize: '18px',
			padding: '0 2px',
			lineHeight: '1',
		});
		dismissBtn.onclick = () => dismissToast();

		toastEl.appendChild(msg);
		toastEl.appendChild(signOutBtn);
		toastEl.appendChild(dismissBtn);
		document.body.appendChild(toastEl);
	}

	function dismissToast() {
		if (toastEl) {
			toastEl.remove();
			toastEl = null;
		}
	}

	function onAccountsChanged(accounts) {
		if (accounts.length === 0) {
			// Wallet fully disconnected — show toast only if this session used SIWE.
			// If siweAddress is null the user logged in via email; no toast needed.
			if (siweAddress) showDisconnectToast();
		} else {
			// Wallet reconnected or account switched — dismiss any toast.
			dismissToast();
			siweAddress = accounts[0].toLowerCase();
		}
	}

	window.ethereum.on('accountsChanged', onAccountsChanged);
	window.addEventListener('pagehide', () => {
		window.ethereum?.removeListener('accountsChanged', onAccountsChanged);
	});
})();
