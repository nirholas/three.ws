// Wires up the footer newsletter form on any page that includes it.
// POSTs to /api/newsletter/subscribe and shows inline success/error.
(function () {
	const forms = document.querySelectorAll('[data-newsletter-form]');
	if (!forms.length) return;

	forms.forEach((form) => {
		const input = form.querySelector('input[name="email"]');
		const btn = form.querySelector('button[type="submit"]');
		const msg = form.parentElement?.querySelector('[data-newsletter-msg]');
		if (!input || !btn) return;

		function setMsg(text, cls) {
			if (!msg) return;
			msg.textContent = text;
			msg.classList.remove('is-error', 'is-success');
			if (cls) msg.classList.add(cls);
		}

		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			const email = input.value.trim();
			if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
				setMsg('Please enter a valid email.', 'is-error');
				return;
			}
			btn.disabled = true;
			setMsg('Subscribing…');
			try {
				const r = await fetch('/api/newsletter/subscribe', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email }),
				});
				if (!r.ok) {
					const data = await r.json().catch(() => ({}));
					throw new Error(data.error_description || 'Subscription failed');
				}
				input.value = '';
				setMsg('Thanks — you’re on the list.', 'is-success');
			} catch (err) {
				setMsg(err.message || 'Something went wrong.', 'is-error');
			} finally {
				btn.disabled = false;
			}
		});
	});
})();
