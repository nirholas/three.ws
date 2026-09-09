/*
 * Live proof for the /openai connector page.
 *
 * The page tells a reader that a free, keyless MCP server is up at
 * /api/mcp-studio and then lists the tools it exposes. Both are claims, so the
 * page checks them in the reader's own browser instead of asserting them: one
 * JSON-RPC tools/list call drives the status strip and reconciles the printed
 * tool table against what the server actually answers, and one initialize call
 * confirms the protocol version printed in the Connect table.
 *
 * Loaded by pages/openai/index.html. Every element it touches is optional, so
 * the script is inert on any page that does not ship the markup.
 */
(function () {
	'use strict';

	var ENDPOINT = '/api/mcp-studio';
	var TIMEOUT_MS = 9000;

	var strip = document.getElementById('mcp-status');
	var retry = document.getElementById('mcp-retry');
	var toolList = document.querySelector('.tools');
	if (!strip || !retry || !toolList) return;

	var textEl = strip.querySelector('.stext');
	var rows = Array.prototype.slice.call(toolList.querySelectorAll('.tool[data-tool]'));

	function setState(state, html) {
		strip.dataset.state = state;
		textEl.innerHTML = html;
		retry.hidden = state !== 'down';
	}

	function rpc(method, params) {
		var ctrl = new AbortController();
		var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
		var body = { jsonrpc: '2.0', id: Date.now(), method: method };
		if (params) body.params = params;
		return fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: ctrl.signal,
		}).then(function (res) {
			if (!res.ok) throw new Error('HTTP ' + res.status);
			return res.json();
		}).then(function (json) {
			if (json && json.error) throw new Error(json.error.message || 'JSON-RPC error');
			return json && json.result;
		}).finally(function () { clearTimeout(timer); });
	}

	function firstSentence(text) {
		var clean = String(text || '').replace(/\s+/g, ' ').trim();
		var stop = clean.indexOf('. ');
		if (stop > 20) clean = clean.slice(0, stop + 1);
		return clean.length > 180 ? clean.slice(0, 177).trimEnd() + '...' : clean;
	}

	function clearNote(row) {
		var note = row.querySelector('.tnote');
		if (note) note.remove();
	}

	/* The note is a sibling of .desc, never a child of it: runtime i18n swaps
	   .desc textContent wholesale and silently deletes anything nested inside. */
	function addNote(row, message) {
		clearNote(row);
		var note = document.createElement('span');
		note.className = 'tnote';
		note.textContent = message;
		row.appendChild(note);
	}

	function mark(row, state) {
		row.dataset.live = state;
		var glyph = row.querySelector('.tmark');
		if (glyph) glyph.textContent = state === 'yes' ? '✓' : '!';
	}

	function appendRow(tool) {
		var row = document.createElement('div');
		row.className = 'tool';
		row.dataset.tool = tool.name;
		var name = document.createElement('span');
		name.className = 'tname';
		var glyph = document.createElement('span');
		glyph.className = 'tmark';
		glyph.setAttribute('aria-hidden', 'true');
		var code = document.createElement('code');
		code.textContent = tool.name;
		name.appendChild(glyph);
		name.appendChild(code);
		var desc = document.createElement('span');
		desc.className = 'desc';
		desc.textContent = firstSentence(tool.description);
		row.appendChild(name);
		row.appendChild(desc);
		toolList.appendChild(row);
		mark(row, 'new');
		addNote(row, 'Added to the live server since this page was written.');
		return row;
	}

	function reconcile(tools) {
		var live = Object.create(null);
		tools.forEach(function (t) { if (t && t.name) live[t.name] = t; });
		var verified = 0;
		rows.forEach(function (row) {
			var name = row.dataset.tool;
			if (live[name]) {
				verified++;
				mark(row, 'yes');
				clearNote(row);
				delete live[name];
			} else {
				mark(row, 'no');
				addNote(row, 'Not listed by the live server right now.');
			}
		});
		Object.keys(live).forEach(function (name) {
			rows.push(appendRow(live[name]));
		});
		return verified;
	}

	function markProtocol(version) {
		var cell = document.getElementById('mcp-protocol-cell');
		if (!cell || !version) return;
		var printed = cell.querySelector('code');
		if (!printed) return;
		var existing = cell.querySelector('.tnote');
		if (existing) existing.remove();
		if (printed.textContent.trim() === String(version).trim()) return;
		var note = document.createElement('span');
		note.className = 'tnote';
		note.textContent = 'The live server reports ' + String(version) + '.';
		cell.appendChild(note);
	}

	function probe() {
		setState('checking', 'Checking the connector from this browser.');
		var started = performance.now();
		rpc('tools/list').then(function (result) {
			var tools = (result && result.tools) || [];
			var ms = Math.round(performance.now() - started);
			if (!tools.length) {
				setState('empty', 'The connector answered but listed no tools. The endpoint is reachable; try again shortly or run the command below to read the raw response.');
				rows.forEach(function (row) { mark(row, 'no'); addNote(row, 'Not listed by the live server right now.'); });
				retry.hidden = false;
				return;
			}
			var verified = reconcile(tools);
			setState('live', '<strong>Live.</strong> ' + tools.length + ' tools answered in ' + ms +
				' ms, no key and no account. ' + verified + ' of ' + rows.length + ' listed below verified against the running server.');
			rpc('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'three.ws-openai-page', version: '1.0.0' },
			}).then(function (init) {
				markProtocol(init && init.protocolVersion);
			}).catch(function () {
				/* The tools/list result already established that the server is up;
				   a failed version read never downgrades that verdict. */
			});
		}).catch(function (err) {
			var reason = err && err.name === 'AbortError'
				? 'it did not answer within ' + Math.round(TIMEOUT_MS / 1000) + ' seconds'
				: 'the request failed (' + ((err && err.message) || 'network error') + ')';
			setState('down', 'Could not reach the connector from this browser: ' + reason +
				'. A browser extension or network filter can block this call, so the server may still be up for ChatGPT. ' +
				'Run the command below to check it directly, then use the button to retry.');
			rows.forEach(function (row) {
				delete row.dataset.live;
				var glyph = row.querySelector('.tmark');
				if (glyph) glyph.textContent = '';
				clearNote(row);
			});
		});
	}

	retry.addEventListener('click', function () {
		retry.disabled = true;
		probe();
		setTimeout(function () { retry.disabled = false; }, 600);
	});

	probe();

	/* Copy buttons: the URL and the curl command are the two things a reader
	   actually takes away from this page. */
	document.querySelectorAll('.copy-btn[data-copy]').forEach(function (btn) {
		var label = btn.textContent;
		btn.addEventListener('click', function () {
			var source = document.getElementById(btn.dataset.copy);
			if (!source) return;
			var text = source.innerText.trim();
			var done = function (ok) {
				btn.dataset.result = ok ? 'ok' : 'fail';
				btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
				if (!ok) {
					var range = document.createRange();
					range.selectNodeContents(source);
					var sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);
				}
				setTimeout(function () {
					btn.textContent = label;
					delete btn.dataset.result;
				}, 2200);
			};
			if (!navigator.clipboard || !navigator.clipboard.writeText) { done(false); return; }
			navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
		});
	});
})();
