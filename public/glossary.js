// three.ws glossary — inline jargon tooltips + full glossary modal.
// Self-mounting: nav.js injects this on every page. On hover or keyboard-focus
// of any [data-term] element (or auto-wrapped jargon), a one-line plain-English
// popover appears. A "Glossary" nav link opens the full modal.
//
// CSS lives in public/style.css (.tws-tt, #tws-tt-pop, .tws-glos-*).
// The full modal reuses B06's .tws-modal-* CSS classes from public/style.css.
//
// Opt out per page with <html data-glossary="off">.

(function () {
	'use strict';

	if (window.__twsGlossary) return;
	if (typeof document === 'undefined') return;
	if (document.documentElement.getAttribute('data-glossary') === 'off') return;

	// ── Glossary data ──────────────────────────────────────────────────────────
	// Keys are canonical lowercase terms matching C02's data-term= values.
	var TERMS = {
		'usdc':          'A US-dollar-pegged payment token (1 USDC = $1) used for micropayments and earnings on three.ws.',
		'sol':           'The Solana network fee token, needed to submit transactions on the Solana blockchain.',
		'solana':        'A fast, low-cost blockchain network three.ws uses to record agents on-chain.',
		'evm':           'The shared engine behind Ethereum, Base, Polygon, and compatible chains.',
		'wallet':        'A digital account that holds your coins and signs transactions — no bank required.',
		'x402':          'A payment protocol where one API request triggers one automatic micro-payment in USDC.',
		'pay-per-call':  'Pay a small amount each time you use an API endpoint — no subscription needed.',
		'on-chain':      "Recorded permanently on a public blockchain, where anyone can verify it.",
		'mint':          'To create a new token on a blockchain — the moment it officially comes into existence.',
		'bonding curve': "A pricing rule where a token's price rises automatically as more people buy.",
		'pump.fun':      'A platform for launching community tokens on Solana with a built-in bonding-curve market.',
		'gas':           'A small fee paid to the blockchain network to process your transaction.',
		'mainnet':       'The live, real-money blockchain (as opposed to testnet, which uses fake coins).',
		'testnet':       'A practice blockchain with fake coins — for testing before going live on mainnet.',
		'base':          'A fast, low-cost blockchain built on Ethereum, used for USDC payments on three.ws.',
		'nft':           'A unique digital item recorded on a blockchain to prove ownership.',
		'ipfs':          'A decentralized file system that stores files by content hash, not a central server.',
		'mcp':           'Model Context Protocol — an open standard that lets AI assistants plug into tools and data.',
		'a2a':           'Agent-to-Agent — a protocol that lets one AI agent discover and call another automatically.',
		'erc-8004':      'An open standard for giving an AI agent a verifiable on-chain identity and reputation.',
		'agent reputation': 'An agent’s on-chain track record — scores and vouches anyone can read before deciding to trust it.',
		'identity registry': 'The ERC-8004 contract that records each agent as an on-chain identity others can look up.',
		'reputation registry': 'The ERC-8004 contract that stores permanent reviews and scores for an agent.',
		'validation registry': 'The ERC-8004 contract where an independent checker attests on-chain that an agent’s work passed.',
		'attestation':   'A signed, verifiable claim recorded on-chain — proof that something was checked and found true.',
		'vouch':         'To back an agent with your own reputation — an on-chain review that says “I trust this one.”',
		'stake':         'Money locked behind a vouch to make it costly to fake — refundable, but it gives the review weight.',
		'sybil attack':  'When one bad actor spins up many fake identities to game a system — costly identity deters it.',
		'metaplex core': 'The Solana standard three.ws uses to record your agent on-chain as a low-cost digital asset.',
		'agenc':         'A Solana protocol where AI agents post and claim paid tasks, earning on-chain reputation for completed work.',
		'trust grade':   'A simple A–D rating three.ws computes from an agent’s on-chain reputation, weighted toward the most trustworthy reviews.',
		'memo attestation': 'A small signed note written on Solana (via the Memo program) that records a vouch, review, or validation for an agent.',
		'graduation':    "When a token's bonding curve fills up and it moves to a full open market — it 'graduates' from the launchpad.",
		'skills':        'Tool packs that give an agent new abilities — like plug-in powers it can use to act, fetch, or pay.',
		'brain':         'The AI model that powers an agent’s thinking and replies (for example Claude or GPT).',
		'rig':           'The hidden skeleton added to a 3D avatar so it can move, pose, lip-sync, and animate.',
	};

	// Display labels (title-case) for the full glossary modal and popover header.
	var LABELS = {
		'usdc':          'USDC',
		'sol':           'SOL',
		'solana':        'Solana',
		'evm':           'EVM',
		'wallet':        'Wallet',
		'x402':          'x402',
		'pay-per-call':  'Pay-per-call',
		'on-chain':      'On-chain',
		'mint':          'Mint',
		'bonding curve': 'Bonding curve',
		'pump.fun':      'Pump.fun',
		'gas':           'Gas',
		'mainnet':       'Mainnet',
		'testnet':       'Testnet',
		'base':          'Base',
		'nft':           'NFT',
		'ipfs':          'IPFS',
		'mcp':           'MCP',
		'a2a':           'A2A',
		'erc-8004':      'ERC-8004',
		'agent reputation': 'Agent reputation',
		'identity registry': 'Identity Registry',
		'reputation registry': 'Reputation Registry',
		'validation registry': 'Validation Registry',
		'attestation':   'Attestation',
		'vouch':         'Vouch',
		'stake':         'Stake',
		'sybil attack':  'Sybil attack',
		'metaplex core': 'Metaplex Core',
		'agenc':         'AgenC',
		'trust grade':   'Trust grade',
		'memo attestation': 'Memo attestation',
		'graduation':    'Graduation',
		'skills':        'Skills',
		'brain':         'Brain',
		'rig':           'Rig',
	};

	// Canonical anchor slug for a term — shared by the popover "deeper link" and
	// the /glossary page's per-term ids so /glossary#<slug> always resolves.
	function slug(key) {
		return String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	}

	// ── HTML escaping ──────────────────────────────────────────────────────────
	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	// ── Tooltip popover (shared singleton) ────────────────────────────────────
	var _popEl = null;
	var _popTimer = null;
	var _curTrigger = null;      // element the popover currently describes
	var _popPid = 'tws-tt-pop'; // stable ID for aria-describedby

	function getPop() {
		if (_popEl) return _popEl;
		_popEl = document.createElement('div');
		_popEl.id = _popPid;
		_popEl.setAttribute('role', 'tooltip');
		// Hover bridge: keep the popover open while the pointer is inside it so a
		// user can travel from the term into the "Full glossary" link without it
		// closing mid-move. Leaving the popover hides it like leaving the term.
		_popEl.addEventListener('mouseenter', function () { clearTimeout(_popTimer); });
		_popEl.addEventListener('mouseleave', function () { hidePop(_curTrigger); });
		document.body.appendChild(_popEl);
		return _popEl;
	}

	function showPop(triggerEl, key) {
		var def = TERMS[key];
		var label = LABELS[key] || key;
		// Glossary terms get a "deeper link" to the full /glossary entry; generic
		// tips (attachTip) intentionally don't, so this lives only on this path.
		var more = '<a class="tws-tt-more" href="/glossary#' + slug(key) + '">Full glossary &rarr;</a>';
		showPopContent(triggerEl, '<strong>' + esc(label) + '</strong><span class="tws-tt-def">' + esc(def) + '</span>' + more);
	}

	// Render arbitrary (caller-escaped) content in the shared popover singleton.
	// Lets sibling layers (e.g. feature-discovery) reuse this one tooltip
	// primitive for non-glossary hints instead of spawning a second popover.
	function showPopContent(triggerEl, html) {
		clearTimeout(_popTimer);
		var pop = getPop();
		_curTrigger = triggerEl;
		pop.innerHTML = html;
		triggerEl.setAttribute('aria-describedby', _popPid);

		// Measure + position (fixed, viewport-aware)
		pop.style.visibility = 'hidden';
		pop.classList.remove('is-on');
		var rect = triggerEl.getBoundingClientRect();
		var vw = window.innerWidth;
		var vh = window.innerHeight;
		var gap = 8;

		// Place below trigger first (to measure height)
		pop.style.top = (rect.bottom + gap) + 'px';
		pop.style.left = rect.left + 'px';
		pop.style.visibility = '';

		var pw = pop.offsetWidth;
		var ph = pop.offsetHeight;

		// Flip up if clips bottom
		var top = rect.bottom + gap;
		if (top + ph > vh - gap) top = rect.top - ph - gap;
		// Clamp horizontally
		var left = rect.left;
		if (left + pw > vw - gap) left = vw - pw - gap;
		if (left < gap) left = gap;

		pop.style.top = top + 'px';
		pop.style.left = left + 'px';
		pop.classList.add('is-on');
	}

	function hidePop(triggerEl) {
		clearTimeout(_popTimer);
		_popTimer = setTimeout(function () {
			if (_popEl) _popEl.classList.remove('is-on');
			if (triggerEl) triggerEl.removeAttribute('aria-describedby');
		}, 80);
	}

	// ── Attach tooltip behaviors to an element ─────────────────────────────────
	function attach(el) {
		var key = (el.getAttribute('data-term') || '').toLowerCase();
		if (!key || !TERMS[key]) return;
		if (el._twsTTDone) return;
		el._twsTTDone = true;

		el.classList.add('tws-tt');
		// Make focusable unless already interactive
		var tag = el.tagName;
		if (tag !== 'A' && tag !== 'BUTTON' && !el.hasAttribute('tabindex')) {
			el.setAttribute('tabindex', '0');
		}

		el.addEventListener('mouseenter', function () { showPop(el, key); });
		el.addEventListener('mouseleave', function () { hidePop(el); });
		el.addEventListener('focus',      function () { showPop(el, key); });
		el.addEventListener('blur',       function () { hidePop(el); });
		el.addEventListener('keydown',    function (e) {
			if (e.key === 'Escape') {
				hidePop(el);
				if (_popEl) _popEl.classList.remove('is-on');
			} else if (e.key === 'Enter' && tag !== 'A' && tag !== 'BUTTON') {
				// Keyboard equivalent of the popover's "Full glossary" link: real
				// anchors/buttons keep their own activation behavior.
				window.location.href = '/glossary#' + slug(key);
			}
		});
	}

	// ── Generic contextual tooltip (reused by feature-discovery) ───────────────
	// Wires hover/focus tip behavior to any element with plain-language text,
	// reusing the same singleton popover, positioning and CSS as glossary terms.
	// `opts.label` adds a bold heading. `opts.plain` skips the inline-jargon
	// decoration (dotted underline + "?"), for icon/button controls where that
	// styling would be wrong. text is escaped here, so callers pass plain strings.
	function attachTip(el, text, opts) {
		if (!el || el._twsTipDone) return;
		el._twsTipDone = true;
		opts = opts || {};
		var html = (opts.label ? '<strong>' + esc(opts.label) + '</strong>' : '') + esc(text);

		if (!opts.plain) el.classList.add('tws-tt');
		// The trigger must be focusable so the tip is keyboard-reachable. Leave
		// natively-focusable controls alone; promote anything else.
		var nativelyFocusable = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
		if (!nativelyFocusable && !el.hasAttribute('tabindex')) {
			el.setAttribute('tabindex', '0');
		}
		el.addEventListener('mouseenter', function () { showPopContent(el, html); });
		el.addEventListener('mouseleave', function () { hidePop(el); });
		el.addEventListener('focus',      function () { showPopContent(el, html); });
		el.addEventListener('blur',       function () { hidePop(el); });
		el.addEventListener('keydown',    function (e) {
			if (e.key === 'Escape') {
				// Closing the tip shouldn't also dismiss an enclosing card/dialog.
				e.stopPropagation();
				hidePop(el);
				if (_popEl) _popEl.classList.remove('is-on');
			}
		});
	}

	// ── Full glossary modal (B06 .tws-modal-* CSS from public/style.css) ───────
	var _dlg = null;
	var _dlgTrigger = null;
	var _scrollBefore = '';

	function openModal(triggerEl) {
		_dlgTrigger = triggerEl instanceof Element ? triggerEl : document.activeElement;
		if (!_dlg) _buildModal();
		_scrollBefore = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		_dlg.showModal();
		_dlg.querySelector('.tws-modal-close').focus();
	}

	function closeModal() {
		if (!_dlg || !_dlg.open) return;
		var d = _dlg;
		var t = _dlgTrigger;
		var sc = _scrollBefore;
		_dlgTrigger = null;
		var reducedMotion = window.matchMedia &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		var delay = reducedMotion ? 0 : 210;
		if (!reducedMotion) d.classList.add('tws-modal--closing');
		setTimeout(function () {
			d.close();
			d.classList.remove('tws-modal--closing');
			document.body.style.overflow = sc;
			if (t && t.focus) t.focus();
		}, delay);
	}

	function _buildModal() {
		var dlg = document.createElement('dialog');
		dlg.className = 'tws-modal';
		dlg.setAttribute('aria-modal', 'true');
		dlg.setAttribute('aria-labelledby', 'tws-glos-title');
		dlg.setAttribute('aria-describedby', 'tws-glos-body');

		// Sort alphabetically by display label
		var keys = Object.keys(TERMS).sort(function (a, b) {
			return (LABELS[a] || a).localeCompare(LABELS[b] || b);
		});

		var listHTML = '<ul class="tws-glos-list" role="list">';
		for (var i = 0; i < keys.length; i++) {
			var k = keys[i];
			listHTML += '<li class="tws-glos-item">' +
				'<div class="tws-glos-term">' + esc(LABELS[k] || k) + '</div>' +
				'<div class="tws-glos-def">' + esc(TERMS[k]) + '</div>' +
				'</li>';
		}
		listHTML += '</ul>';

		dlg.innerHTML =
			'<div class="tws-modal-inner">' +
				'<div class="tws-modal-header">' +
					'<h2 class="tws-modal-title" id="tws-glos-title">Glossary</h2>' +
					'<button class="tws-modal-close" aria-label="Close dialog" type="button">&#x2715;</button>' +
				'</div>' +
				'<div class="tws-modal-body" id="tws-glos-body">' + listHTML + '</div>' +
			'</div>';

		document.body.appendChild(dlg);
		_dlg = dlg;

		// ESC → native 'cancel' event
		dlg.addEventListener('cancel', function (e) {
			e.preventDefault();
			closeModal();
		});

		// Backdrop click (click lands on <dialog> outside inner card)
		dlg.addEventListener('click', function (e) {
			var r = dlg.getBoundingClientRect();
			if (
				e.clientX < r.left || e.clientX > r.right ||
				e.clientY < r.top  || e.clientY > r.bottom
			) closeModal();
		});

		dlg.querySelector('.tws-modal-close').addEventListener('click', closeModal);
	}

	// ── Text-node auto-scanner ─────────────────────────────────────────────────
	// Walks content areas, finds first occurrence of each glossary term, and
	// wraps it in a <span class="tws-tt" data-term="…" tabindex="0"> so the
	// tooltip attaches. Skips interactive/code elements, existing wrappers, and
	// [data-term] anchors already handled by C02.

	var SKIP_TAGS = { INPUT:1, TEXTAREA:1, SELECT:1, CODE:1, PRE:1, A:1, BUTTON:1, SCRIPT:1, STYLE:1 };
	var _wrapped = Object.create(null); // track first-occurrence per term key
	var _termRe = null;

	function buildRe() {
		if (_termRe) return _termRe;
		// Longest keys first so multi-word terms match before their sub-words
		var keys = Object.keys(TERMS).sort(function (a, b) { return b.length - a.length; });
		var pats = keys.map(function (k) {
			return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		});
		// Word-boundary anchors work for both single-word and multi-word phrases
		_termRe = new RegExp('(?:^|\\b)(' + pats.join('|') + ')(?:\\b|$)', 'gi');
		return _termRe;
	}

	function scanTextNode(node) {
		var par = node.parentNode;
		if (!par) return;
		if (SKIP_TAGS[par.tagName]) return;
		// Skip if inside any skip context or already inside a tooltip.
		// aria-hidden / hidden / inert subtrees are skipped for two reasons, and
		// the accessibility one is the serious half: a wrapper carries
		// tabindex="0", so wrapping a term inside an aria-hidden subtree hands a
		// keyboard user a tab stop on content a screen reader announces as
		// nothing (axe: aria-hidden-focus, serious). It also wastes the
		// first-occurrence slot for that term on decorative text, so the real
		// occurrence further down the page silently never gets its tooltip.
		if (par.closest) {
			if (par.closest('code,pre,a,button,input,textarea,select,.tws-tt,[data-term]')) return;
			if (par.closest('[aria-hidden="true"],[hidden],[inert]')) return;
		}

		var text = node.textContent;
		var re = buildRe();
		re.lastIndex = 0;
		var match = re.exec(text);
		if (!match) return;

		var matched = match[1];
		if (!matched) return;
		var key = matched.toLowerCase();
		if (!TERMS[key]) return;
		if (_wrapped[key]) return; // already wrapped elsewhere on page
		_wrapped[key] = true;

		var before = text.slice(0, match.index);
		var after = text.slice(match.index + matched.length);
		var frag = document.createDocumentFragment();
		if (before) frag.appendChild(document.createTextNode(before));
		var span = document.createElement('span');
		span.className = 'tws-tt';
		span.setAttribute('data-term', key);
		span.setAttribute('tabindex', '0');
		span.textContent = matched;
		frag.appendChild(span);
		if (after) frag.appendChild(document.createTextNode(after));

		par.replaceChild(frag, node);
		attach(span);
	}

	function scanEl(el) {
		if (!el) return;
		if (SKIP_TAGS[el.tagName]) return;
		// Snapshot children before mutation
		var children = Array.prototype.slice.call(el.childNodes);
		for (var i = 0; i < children.length; i++) {
			var n = children[i];
			if (n.nodeType === 3) {
				scanTextNode(n);
			} else if (n.nodeType === 1) {
				if (!SKIP_TAGS[n.tagName] &&
					!n.hasAttribute('data-term') &&
					!n.classList.contains('tws-tt')) {
					scanEl(n);
				}
			}
		}
	}

	// ── Delegated glossary-open handler ────────────────────────────────────────
	// Handles [data-glossary-open] clicks even on late-injected nav elements.
	function initGlossaryOpener() {
		document.addEventListener('click', function (e) {
			// e.target may be a non-Element (text node, document); closest() lives
			// on Elements only, so resolve the nearest Element before calling it.
			var t = e.target;
			var el = t && t.nodeType === 1 ? t : (t && t.parentElement) || null;
			var btn = el && el.closest('[data-glossary-open]');
			if (btn) {
				e.preventDefault();
				openModal(btn);
			}
		});
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' || e.key === ' ') {
				var btn = document.activeElement &&
					document.activeElement.closest('[data-glossary-open]');
				if (btn) {
					e.preventDefault();
					openModal(btn);
				}
			}
		});
	}

	// ── Init ───────────────────────────────────────────────────────────────────
	function init() {
		// Wire [data-term] anchors already in DOM (placed by C02)
		var termEls = document.querySelectorAll('[data-term]');
		for (var i = 0; i < termEls.length; i++) attach(termEls[i]);

		// Auto-wrap first occurrence of each term in main content areas
		var areas = document.querySelectorAll([
			'main', 'article', '.page-body', '.content', '.hero-copy',
			'.features-grid', '.markdown-body', '.docs-body', '.section-body',
			'.hero', '.hero-text', '.page-section',
		].join(','));
		var roots = areas.length ? Array.prototype.slice.call(areas) : [document.body];
		for (var j = 0; j < roots.length; j++) scanEl(roots[j]);

		// Delegated opener (works for nav items injected after init)
		initGlossaryOpener();
	}

	// ── Public API ─────────────────────────────────────────────────────────────
	window.twsGlossary = {
		open:     openModal,
		close:    closeModal,
		terms:    TERMS,
		labels:   LABELS,
		slug:     slug,
		attachTip: attachTip,
	};
	window.__twsGlossary = true;

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
