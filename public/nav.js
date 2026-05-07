document.addEventListener('DOMContentLoaded', () => {
	const navContainer = document.getElementById('nav-container');
	if (!navContainer) return;
	fetch('/nav.html')
		.then(response => response.text())
		.then(data => {
			navContainer.innerHTML = data;
			initDropdowns(navContainer);
		});
});

function initDropdowns(root) {
	const triggers = root.querySelectorAll('.home-nav .nav-trigger');
	if (!triggers.length) return;

	function closeAll(except) {
		triggers.forEach((t) => {
			if (t !== except) t.setAttribute('aria-expanded', 'false');
		});
	}

	triggers.forEach((trigger) => {
		trigger.addEventListener('click', (e) => {
			e.stopPropagation();
			const open = trigger.getAttribute('aria-expanded') === 'true';
			closeAll(open ? null : trigger);
			trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
			if (!open) {
				const first = trigger.nextElementSibling?.querySelector('a');
				first?.focus();
			}
		});

		const menu = trigger.nextElementSibling;
		if (!menu) return;
		menu.addEventListener('keydown', (e) => {
			const items = Array.from(menu.querySelectorAll('a'));
			const idx = items.indexOf(document.activeElement);
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				items[(idx + 1) % items.length]?.focus();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				items[(idx - 1 + items.length) % items.length]?.focus();
			} else if (e.key === 'Escape') {
				trigger.setAttribute('aria-expanded', 'false');
				trigger.focus();
			}
		});
	});

	document.addEventListener('click', (e) => {
		if (!e.target.closest('.home-nav')) closeAll(null);
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') closeAll(null);
	});

	// Auth-aware CTA
	try {
		const raw = localStorage.getItem('3dagent:auth-hint');
		if (raw) {
			const { authed, name } = JSON.parse(raw);
			if (authed) {
				const cta = root.querySelector('#home-nav-cta');
				if (cta) { cta.textContent = 'Dashboard'; cta.href = '/dashboard'; }
				const myAgentsLi = root.querySelector('#home-nav-my-agents-li');
				if (myAgentsLi) myAgentsLi.hidden = false;
				const userLi = root.querySelector('#home-nav-user-li');
				const userEl = root.querySelector('#home-nav-user');
				if (userEl && userLi && name) { userEl.textContent = name; userLi.hidden = false; }
			}
		}
	} catch (_) {}
}
