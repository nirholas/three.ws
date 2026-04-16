/*
 * Agent3D embed SDK — Bridge v1
 * -----------------------------
 *   <script src="https://3dagent.vercel.app/embed-sdk.js"></script>
 *   const bridge = Agent3D.connect(iframeEl, {
 *     agentId,
 *     onReady,    // ({ version, capabilities, name }) => void
 *     onAction,   // (action) => void   — every protocol action the iframe emits
 *     onResize,   // (height) => void   — auto-applied to iframe unless autoResize:false
 *     onError,    // (err)    => void   — handshake timeout, blocked embed, etc.
 *     helloTimeoutMs:  2000,
 *     autoResize:      true,
 *   });
 *   bridge.send({ type: 'speak', payload: { text: 'hello' } });
 *   bridge.ping().then(rttMs => …);
 *   bridge.destroy();
 *
 * Tiny on purpose. See public/agent/embed.html for the full bridge contract.
 */
(function (root) {
	'use strict';
	if (root.Agent3D && root.Agent3D.connect) return;

	function connect(iframeEl, opts) {
		if (!iframeEl || iframeEl.tagName !== 'IFRAME') throw new Error('Agent3D.connect: iframe element required');
		if (!opts || !opts.agentId) throw new Error('Agent3D.connect: opts.agentId required');

		var agentId        = String(opts.agentId);
		var helloTimeoutMs = opts.helloTimeoutMs == null ? 2000 : opts.helloTimeoutMs;
		var autoResize     = opts.autoResize !== false;
		var iframeOrigin   = opts.origin || originOf(iframeEl.src);
		var pings          = Object.create(null);
		var nextPingId     = 1;
		var ready          = false;
		var destroyed      = false;
		var readyResolve, readyReject;
		var readyPromise   = new Promise(function (resolve, reject) { readyResolve = resolve; readyReject = reject; });

		function post(msg) {
			if (destroyed || !iframeEl.contentWindow) return;
			iframeEl.contentWindow.postMessage(msg, iframeOrigin || '*');
		}

		function onMessage(ev) {
			if (destroyed) return;
			// Origin lock — when we know the iframe origin, ignore everything else.
			if (iframeOrigin && ev.origin !== iframeOrigin) return;
			var msg = ev.data;
			if (!msg || typeof msg !== 'object' || msg.agentId !== agentId) return;
			switch (msg.type) {
				case 'agent:ready':
					if (!ready) {
						ready = true;
						readyResolve({ version: msg.version, capabilities: msg.capabilities || [], name: msg.name });
						if (typeof opts.onReady === 'function') {
							try { opts.onReady({ version: msg.version, capabilities: msg.capabilities || [], name: msg.name }); }
							catch (e) { console.error('[Agent3D] onReady threw', e); }
						}
					}
					return;
				case 'agent:action':
					if (typeof opts.onAction === 'function') {
						try { opts.onAction(msg.action); } catch (e) { console.error('[Agent3D] onAction threw', e); }
					}
					return;
				case 'agent:resize':
					if (autoResize && typeof msg.height === 'number' && msg.height > 0) {
						iframeEl.style.height = msg.height + 'px';
					}
					if (typeof opts.onResize === 'function') {
						try { opts.onResize(msg.height); } catch (e) { console.error('[Agent3D] onResize threw', e); }
					}
					return;
				case 'agent:pong':
					var pending = pings[msg.id];
					if (pending) { delete pings[msg.id]; pending.resolve(Date.now() - pending.t); }
					return;
				case 'agent:blocked':
					emitError(new Error('Embed blocked by agent policy'));
					return;
			}
		}

		function emitError(err) {
			if (typeof opts.onError === 'function') {
				try { opts.onError(err); } catch (e) { console.error('[Agent3D] onError threw', e); }
			}
			if (!ready) readyReject(err);
		}

		function sendHello() { post({ type: 'agent:hello', agentId: agentId, host: location.origin }); }

		window.addEventListener('message', onMessage);

		// Send hello on every load — also on first attach if the iframe was
		// already loaded before connect() ran (common when the host hydrates
		// after the iframe).
		iframeEl.addEventListener('load', sendHello);
		if (iframeEl.contentDocument && iframeEl.contentDocument.readyState === 'complete') sendHello();
		// Belt-and-braces: hosts that miss the load event still get a hello.
		setTimeout(sendHello, 50);

		var helloTimer = helloTimeoutMs > 0 ? setTimeout(function () {
			if (!ready) emitError(new Error('agent:ready not received within ' + helloTimeoutMs + 'ms'));
		}, helloTimeoutMs) : null;

		readyPromise.finally(function () { if (helloTimer) clearTimeout(helloTimer); });

		return {
			ready: readyPromise,
			send: function (action) { post({ type: 'agent:action', agentId: agentId, action: action }); },
			ping: function (timeoutMs) {
				var id = String(nextPingId++);
				return new Promise(function (resolve, reject) {
					pings[id] = { t: Date.now(), resolve: resolve };
					post({ type: 'agent:ping', agentId: agentId, id: id });
					setTimeout(function () {
						if (pings[id]) { delete pings[id]; reject(new Error('ping timeout')); }
					}, timeoutMs || 2000);
				});
			},
			destroy: function () {
				destroyed = true;
				window.removeEventListener('message', onMessage);
				iframeEl.removeEventListener('load', sendHello);
				if (helloTimer) clearTimeout(helloTimer);
			},
		};
	}

	function originOf(url) {
		if (!url) return '';
		try { return new URL(url, location.href).origin; } catch (_) { return ''; }
	}

	root.Agent3D = { connect: connect, version: '1' };
})(typeof window !== 'undefined' ? window : globalThis);
