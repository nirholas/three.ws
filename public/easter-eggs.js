/* three.ws easter eggs. Injected into every page by the build (vite.config.js,
 * "mobile-ergonomics" plugin), self-contained, no dependencies.
 *
 *   1. Konami code (up up down down left right left right B A)  -> cube rain
 *   2. Type "three" anywhere (not in a field)                    -> a burst of 3s
 *   3. Click the top-left logo 7 times quickly                   -> the logo does a flip
 *   4. Type "gm" or "wagmi" anywhere                             -> a toast
 *   5. Open the console                                          -> a hint about the above
 *
 * Rules: never fires while typing in a field, respects prefers-reduced-motion,
 * stays out of iframes, adds no layout, and is pure delight (nothing is granted).
 * Discoveries are counted in localStorage (twx_eggs) for the toast copy only.
 */
(function () {
	if (window.__threeEggs) return;
	window.__threeEggs = true;
	try { if (window.self !== window.top) return; } catch (_) { return; }

	var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
	var KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
	var WORDS = { three: burst3, gm: function () { toast('gm. the agents are up too.'); }, wagmi: function () { toast('wagmi. all of us, with bodies.'); } };
	var LOGO = 'a[href="/"] img,a[href="/"] svg,.brand-mark,.wordmark-logo,.header-logo,[data-brand-mark],.nav-logo,.nav-brand';

	function found(id) {
		var all = [];
		try { all = JSON.parse(localStorage.getItem('twx_eggs') || '[]'); } catch (_) {}
		if (all.indexOf(id) < 0) {
			all.push(id);
			try { localStorage.setItem('twx_eggs', JSON.stringify(all)); } catch (_) {}
		}
		return all.length;
	}

	function css() {
		if (document.getElementById('twx-egg-css')) return;
		var s = document.createElement('style');
		s.id = 'twx-egg-css';
		s.textContent =
			'.twx-egg-toast{position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%) translateY(12px);' +
			'z-index:2147483000;max-width:min(90vw,420px);padding:10px 16px;border-radius:999px;font:600 13px/1.3 system-ui,sans-serif;' +
			'color:#fff;background:rgba(12,12,14,.92);border:1px solid rgba(255,255,255,.25);opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;text-align:center}' +
			'.twx-egg-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}' +
			'.twx-egg-bit{position:fixed;top:-40px;z-index:2147482999;pointer-events:none;will-change:transform}' +
			'@keyframes twx-egg-fall{to{transform:translate3d(var(--dx),110vh,0) rotate(var(--rot))}}' +
			'@keyframes twx-egg-flip{50%{transform:rotateY(180deg) scale(1.3)}to{transform:rotateY(360deg)}}' +
			'.twx-egg-flip{animation:twx-egg-flip .9s ease-in-out;transform-style:preserve-3d}';
		document.head.appendChild(s);
	}

	function toast(text) {
		css();
		var t = document.createElement('div');
		t.className = 'twx-egg-toast';
		t.setAttribute('role', 'status');
		t.textContent = text;
		document.body.appendChild(t);
		requestAnimationFrame(function () { t.classList.add('on'); });
		setTimeout(function () { t.classList.remove('on'); setTimeout(function () { t.remove(); }, 300); }, 3200);
	}

	function rain(make, count, ms) {
		if (reduce) return;
		css();
		for (var i = 0; i < count; i++) {
			var b = make();
			b.className = 'twx-egg-bit';
			b.style.left = Math.random() * 100 + 'vw';
			b.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
			b.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
			var d = ms * (0.6 + Math.random() * 0.6);
			b.style.animation = 'twx-egg-fall ' + d + 'ms cubic-bezier(.3,.1,.6,1) ' + Math.random() * 400 + 'ms forwards';
			document.body.appendChild(b);
			setTimeout(b.remove.bind(b), d + 900);
		}
	}

	function cubes() {
		rain(function () {
			var c = document.createElement('div');
			var size = 10 + Math.random() * 16;
			c.style.cssText = 'width:' + size + 'px;height:' + size + 'px;border-radius:3px;background:hsl(' + Math.floor(Math.random() * 360) + ' 85% 60%);box-shadow:inset -3px -3px 0 rgba(0,0,0,.25)';
			return c;
		}, 60, 2600);
		toast(found('konami') >= 4 ? 'You found every egg. Legend.' : 'Konami. +30 lives. (There are more eggs.)');
	}

	function burst3() {
		rain(function () {
			var c = document.createElement('div');
			c.textContent = '3';
			c.style.cssText = 'font:800 ' + (16 + Math.random() * 26) + 'px system-ui,sans-serif;color:hsl(' + Math.floor(Math.random() * 360) + ' 85% 65%)';
			return c;
		}, 40, 2200);
		toast('three. as in three.ws, and three dimensions.');
		found('three');
	}

	function typing(e) {
		var t = e.target;
		return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
	}

	var kIdx = 0, buf = '';
	document.addEventListener('keydown', function (e) {
		if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
		var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
		kIdx = k === KONAMI[kIdx] ? kIdx + 1 : (k === KONAMI[0] ? 1 : 0);
		if (kIdx === KONAMI.length) { kIdx = 0; cubes(); }
		if (e.key.length !== 1) return;
		buf = (buf + k).slice(-8);
		for (var w in WORDS) {
			if (buf.slice(-w.length) === w) { buf = ''; if (w !== 'three') found(w); WORDS[w](); break; }
		}
	});

	var clicks = 0, clickTimer = 0;
	document.addEventListener('click', function (e) {
		var logo = e.target.closest && e.target.closest(LOGO);
		if (!logo) return;
		clicks++;
		clearTimeout(clickTimer);
		clickTimer = setTimeout(function () { clicks = 0; }, 1500);
		if (clicks < 7) return;
		clicks = 0;
		e.preventDefault();
		found('logo');
		if (!reduce) {
			css();
			logo.classList.add('twx-egg-flip');
			setTimeout(function () { logo.classList.remove('twx-egg-flip'); }, 1000);
		}
		toast('Seven clicks. The logo has a third dimension after all.');
	}, true);

	try {
		console.log('%cthree.ws', 'font:800 22px system-ui;color:#ff7a1a', '\nPoking around? There are eggs hidden on every page. Try the Konami code, type "three", or click the logo seven times.');
	} catch (_) {}
})();
