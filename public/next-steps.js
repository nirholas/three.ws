// "What next?" strip. Most tool pages end where the tool ends: you forged a
// model and the page has nothing to say about rigging, restyling, embedding or
// selling it. This renders a short, goal-ordered strip of the natural next
// steps just above the footer, so a visitor moves along the journey instead of
// going back to the menu.
//
// Loaded by /nav.js on every page; does nothing unless the current path has an
// entry in STEPS. Opt a page out with <html data-next-steps="off">. Every href
// here is checked against data/pages.json by tests/next-steps.test.js.
(function () {
	'use strict';
	if (window.__twsNextSteps) return;
	window.__twsNextSteps = true;

	var STEPS = {
		'/forge': {
			lead: 'Your model is ready. What next?',
			steps: [
				{ title: 'Rig it', desc: 'Add a skeleton so it can move', href: '/workbench' },
				{ title: 'Restyle it', desc: 'Re-skin it in a new art style', href: '/restyle' },
				{ title: 'Put it on your site', desc: 'One tag embeds it anywhere', href: '/widgets' },
				{ title: 'Give it a brain', desc: 'Turn it into a talking agent', href: '/create-agent' },
			],
		},
		'/image-to-3d': {
			lead: 'Turned a photo into a model. What next?',
			steps: [
				{ title: 'Rig it', desc: 'Add a skeleton so it can move', href: '/workbench' },
				{ title: 'Restyle it', desc: 'Re-skin it in a new art style', href: '/restyle' },
				{ title: 'Embed it', desc: 'Show it on any website', href: '/widgets' },
				{ title: 'Chain steps', desc: 'Automate it in a workflow', href: '/forge/workflows' },
			],
		},
		'/create': {
			lead: 'Pick a path, then keep going.',
			steps: [
				{ title: 'Animate it', desc: 'Browse 70+ animations', href: '/animations' },
				{ title: 'Build an agent', desc: 'Name, skills and personality', href: '/create-agent' },
				{ title: 'Embed it', desc: 'Ship it to your site', href: '/widgets' },
			],
		},
		'/create/prompt': {
			lead: 'Avatar made. What next?',
			steps: [
				{ title: 'Animate it', desc: 'Browse 70+ animations', href: '/animations' },
				{ title: 'Build an agent', desc: 'Give it a brain and a wallet', href: '/create-agent' },
				{ title: 'Dress it', desc: 'Try outfits in the wardrobe', href: '/wardrobe' },
				{ title: 'Embed it', desc: 'Ship it to your site', href: '/widgets' },
			],
		},
		'/create/selfie': {
			lead: 'Avatar made. What next?',
			steps: [
				{ title: 'Animate it', desc: 'Browse 70+ animations', href: '/animations' },
				{ title: 'Build an agent', desc: 'Give it a brain and a wallet', href: '/create-agent' },
				{ title: 'Dress it', desc: 'Try outfits in the wardrobe', href: '/wardrobe' },
				{ title: 'Embed it', desc: 'Ship it to your site', href: '/widgets' },
			],
		},
		'/create-agent': {
			lead: 'Agent built. Make it useful.',
			steps: [
				{ title: 'Add skills', desc: 'Browse community skills', href: '/skills/community' },
				{ title: 'Sell a skill', desc: 'Price it per call and earn', href: '/marketplace' },
				{ title: 'Embed it', desc: 'Put it on your website', href: '/widgets' },
				{ title: 'See your creations', desc: 'Everything you have made', href: '/mine' },
			],
		},
		'/animations': {
			lead: 'Found a move you like?',
			steps: [
				{ title: 'Choreograph', desc: 'Sequence moves into a routine', href: '/choreograph' },
				{ title: 'Capture your own', desc: 'Record motion with a camera', href: '/mocap-studio' },
				{ title: 'Make an avatar', desc: 'Get a rigged character first', href: '/create' },
				{ title: 'Embed it', desc: 'Animate on your own site', href: '/widgets' },
			],
		},
		'/widgets': {
			lead: 'Embedded. Now make it do more.',
			steps: [
				{ title: 'Give it a brain', desc: 'Turn the avatar into an agent', href: '/create-agent' },
				{ title: 'Avatar SDK', desc: 'Drive it from your page code', href: '/avatar-sdk' },
				{ title: 'Check your embed', desc: 'Diagnose a broken embed', href: '/embed-doctor' },
			],
		},
		'/marketplace': {
			lead: 'Want to be on the other side of the counter?',
			steps: [
				{ title: 'Build a skill', desc: 'Author one in four files', href: '/docs/skills' },
				{ title: 'Create an agent', desc: 'Your agent, your wallet', href: '/create-agent' },
				{ title: 'See pay-per-call', desc: 'How x402 payments work', href: '/docs/x402' },
			],
		},
		'/launch': {
			lead: 'After the launch.',
			steps: [
				{ title: 'Track launches', desc: 'Every launch from three.ws', href: '/launches' },
				{ title: 'Watch the trenches', desc: 'Live Solana market data', href: '/trenches' },
				{ title: 'The $THREE launchpad', desc: 'Where $THREE lives', href: '/three-launchpad' },
			],
		},
		'/restyle': {
			lead: 'Restyled. What next?',
			steps: [
				{ title: 'Rig it', desc: 'Add a skeleton so it can move', href: '/workbench' },
				{ title: 'Embed it', desc: 'Show it on any website', href: '/widgets' },
				{ title: 'Swap its motion', desc: 'Retarget animation onto it', href: '/motion-swap' },
			],
		},
		'/walk': {
			lead: 'Keep exploring.',
			steps: [
				{ title: 'Place it in AR', desc: 'Your avatar in your room', href: '/ar' },
				{ title: 'Climb the board', desc: 'Walk leaderboard', href: '/walk-leaderboard' },
				{ title: 'Make an avatar', desc: 'Walk as yourself', href: '/create' },
			],
		},
		'/markets': {
			lead: 'Go deeper.',
			steps: [
				{ title: 'Trenches Pulse', desc: 'Live launches and runners', href: '/trenches' },
				{ title: 'Smart money', desc: 'Scored wallets worth watching', href: '/smart-money' },
				{ title: 'Signals', desc: 'What agents are flagging', href: '/signals' },
			],
		},
	};

	var doc = document.documentElement;
	if (doc.getAttribute('data-next-steps') === 'off') return;

	var path = location.pathname.replace(/\/+$/, '') || '/';
	var entry = STEPS[path];
	if (!entry) return;

	var DISMISS_KEY = 'tws:next-dismissed';
	function dismissed() {
		try {
			return JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]').indexOf(path) !== -1;
		} catch (e) {
			return false;
		}
	}
	function remember() {
		try {
			var list = JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]');
			list.push(path);
			sessionStorage.setItem(DISMISS_KEY, JSON.stringify(list));
		} catch (e) {
			/* private mode: the strip simply returns on the next page view */
		}
	}
	if (dismissed()) return;

	function mount() {
		if (doc.classList.contains('tws-in-os') || document.getElementById('tws-next-steps')) return;

		var style = document.createElement('style');
		style.textContent =
			'#tws-next-steps{max-width:1080px;margin:40px auto 0;padding:0 16px;font-family:var(--font-body,Inter,system-ui,sans-serif);color:var(--nv-text,#e9e9f4)}' +
			'#tws-next-steps .tn-box{padding:18px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.04)}' +
			'html[data-theme=light] #tws-next-steps .tn-box{background:#fff;border-color:rgba(10,10,40,.14);color:#1d1d2b}' +
			'#tws-next-steps .tn-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}' +
			'#tws-next-steps .tn-lead{margin:0;font-size:15px;font-weight:600}' +
			'#tws-next-steps .tn-x{width:32px;height:32px;font-size:18px;line-height:1;color:inherit;opacity:.6;background:none;border:0;border-radius:8px;cursor:pointer}' +
			'#tws-next-steps .tn-x:hover{opacity:1;background:rgba(128,128,160,.18)}' +
			'#tws-next-steps .tn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}' +
			'#tws-next-steps .tn-card{display:block;padding:12px 14px;color:inherit;text-decoration:none;border:1px solid rgba(128,128,160,.28);border-radius:12px;transition:background .15s,border-color .15s,transform .1s}' +
			'#tws-next-steps .tn-card:hover{background:rgba(128,128,160,.14);border-color:rgba(142,162,255,.7)}' +
			'#tws-next-steps .tn-card:active{transform:scale(.98)}' +
			'#tws-next-steps .tn-card b{display:block;font-size:14px}' +
			'#tws-next-steps .tn-card span{display:block;margin-top:2px;font-size:12.5px;opacity:.7}' +
			'#tws-next-steps a:focus-visible,#tws-next-steps button:focus-visible{outline:2px solid #8ea2ff;outline-offset:2px}' +
			'#tws-next-steps .tn-all{display:inline-block;margin-top:12px;font-size:13px;color:inherit;opacity:.75}' +
			'@media (prefers-reduced-motion:reduce){#tws-next-steps .tn-card{transition:none}}';
		document.head.appendChild(style);

		var wrap = document.createElement('aside');
		wrap.id = 'tws-next-steps';
		wrap.setAttribute('aria-label', 'Suggested next steps');
		var box = document.createElement('div');
		box.className = 'tn-box';

		var head = document.createElement('div');
		head.className = 'tn-head';
		var lead = document.createElement('p');
		lead.className = 'tn-lead';
		lead.textContent = entry.lead;
		var close = document.createElement('button');
		close.type = 'button';
		close.className = 'tn-x';
		close.setAttribute('aria-label', 'Dismiss suggestions');
		close.textContent = '×';
		close.addEventListener('click', function () {
			remember();
			wrap.remove();
		});
		head.appendChild(lead);
		head.appendChild(close);

		var grid = document.createElement('div');
		grid.className = 'tn-grid';
		entry.steps.forEach(function (s) {
			var a = document.createElement('a');
			a.className = 'tn-card';
			a.href = s.href;
			var b = document.createElement('b');
			b.textContent = s.title;
			var d = document.createElement('span');
			d.textContent = s.desc;
			a.appendChild(b);
			a.appendChild(d);
			grid.appendChild(a);
		});

		var all = document.createElement('a');
		all.className = 'tn-all';
		all.href = '/everything';
		all.textContent = 'Browse everything by goal →';

		box.appendChild(head);
		box.appendChild(grid);
		box.appendChild(all);
		wrap.appendChild(box);

		var footer = document.getElementById('footer-container');
		if (footer && footer.parentNode) footer.parentNode.insertBefore(wrap, footer);
		else document.body.appendChild(wrap);
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
	else mount();

	if (typeof module !== 'undefined' && module.exports) module.exports = { STEPS: STEPS };
})();
