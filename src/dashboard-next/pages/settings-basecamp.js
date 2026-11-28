// Settings panel: Basecamp chatbot (make 3D models from a Campfire or Ping).
//
//   GET    /api/basecamp/chatbots              { chatbots }
//   POST   /api/basecamp/chatbots  { label }   { chatbot, command_url }  shown once
//   DELETE /api/basecamp/chatbots?id=<uuid>    revoke
//
// A command URL is what a Basecamp admin pastes into "Configure chatbots".
// Basecamp signs nothing, so the URL is the credential: only its hash is
// stored and the full URL is shown once, right after creation. The handler is
// api/basecamp/command.js; the public setup guide is /integrations/basecamp.

import { esc, get, post, del, relTime } from '../api.js';
import { emptyStateHTML, errorStateHTML, attachRetry } from '../../shared/state-kit.js';
import { toast } from '../../shared/toast.js';

const ID = 'basecamp-chatbot';
const GUIDE = '/integrations/basecamp';
const MAX_ACTIVE = 10;

function injectStyles() {
	if (document.getElementById('set-bc-css')) return;
	const s = document.createElement('style');
	s.id = 'set-bc-css';
	s.textContent = `
		.bc-code{flex:1 1 260px;min-width:0;padding:9px 12px;border-radius:8px;border:1px solid var(--nxt-stroke-strong);
			background:rgba(255,255,255,.03);font:12.5px/1.5 var(--nxt-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
			color:var(--nxt-ink);overflow-x:auto;white-space:nowrap;user-select:all}
		.bc-copy{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap}
		.bc-form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:4px 0 16px}
		.bc-field{display:grid;gap:4px;flex:1 1 220px;min-width:0}
		.bc-field span{font-size:12px;color:var(--nxt-ink-fade)}
		.bc-input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--nxt-stroke-strong);
			background:rgba(255,255,255,.04);color:var(--nxt-ink);font:inherit;font-size:13px;
			transition:border-color .16s ease,box-shadow .16s ease}
		.bc-input:hover{border-color:var(--nxt-accent)}
		.bc-input:focus-visible{outline:none;border-color:var(--nxt-accent);box-shadow:0 0 0 3px var(--nxt-accent-soft)}
		.bc-new{margin:0 0 16px;padding:14px;border-radius:10px;border:1px solid var(--nxt-accent);background:var(--nxt-accent-soft)}
		.bc-new-title{font-size:13.5px;font-weight:600;margin-bottom:4px}
		.bc-new ol{margin:10px 0 0;padding-left:20px;font-size:13px;line-height:1.6;color:var(--nxt-ink-dim)}
		.bc-new code,.bc-row code{font-family:var(--nxt-mono, ui-monospace, monospace);font-size:12px;color:var(--nxt-ink)}
		.bc-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--nxt-stroke)}
		.bc-row:last-child{border-bottom:0}
		.bc-row.revoked{opacity:.6}
		.bc-row-meta{flex:1 1 220px;min-width:0}
		.bc-row-name{font-size:13.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.bc-row-facts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px;font-size:12px;color:var(--nxt-ink-fade)}
		.bc-link{color:var(--nxt-accent);text-decoration:underline;text-underline-offset:2px;border-radius:4px}
		.bc-link:hover{text-decoration-thickness:2px}
		.bc-link:focus-visible{outline:none;box-shadow:0 0 0 3px var(--nxt-accent-soft)}
		#${ID} .dn-btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--nxt-accent-soft)}
		#${ID} .dn-btn[disabled]{opacity:.55;cursor:progress}
	`;
	document.head.appendChild(s);
}

function shell() {
	injectStyles();
	const panel = document.createElement('div');
	panel.className = 'dn-panel';
	panel.id = ID;
	panel.setAttribute('aria-label', 'Basecamp chatbot');
	panel.innerHTML = `
		<div style="margin-bottom:14px">
			<div class="dn-panel-title">Basecamp chatbot</div>
			<div class="dn-panel-sub" style="margin:2px 0 0">Type <code>!threews</code> and a description in a Basecamp Campfire or Ping and get a textured 3D model back in the room, with a 3D viewer, AR and a GLB download. Models are made free on this account and saved to it, unlisted. <a class="bc-link" href="${GUIDE}">Setup guide</a></div>
		</div>
		<div data-slot="body"></div>`;
	return panel;
}

export function renderBasecampChatbots(resp, onRetry) {
	const panel = shell();
	const body = panel.querySelector('[data-slot="body"]');
	if (!resp.ok) {
		body.innerHTML = errorStateHTML({ title: "Couldn't load Basecamp chatbots", body: 'The chatbot service did not answer. Check your connection and try again.' });
		attachRetry(body, onRetry);
		return panel;
	}
	paint(body, resp.data, null, onRetry);
	return panel;
}

async function refresh(body, created, onRetry) {
	try {
		paint(body, await get('/api/basecamp/chatbots'), created, onRetry);
	} catch {
		body.innerHTML = errorStateHTML({ title: "Couldn't reload Basecamp chatbots", body: 'Your change was sent, but the list could not be refreshed. Try again.' });
		attachRetry(body, onRetry);
	}
}

async function copy(text, what) {
	try {
		await navigator.clipboard.writeText(text);
		toast(`${what} copied`, { variant: 'success' });
	} catch {
		toast(`Select the ${what.toLowerCase()} and copy it with Ctrl+C`, { variant: 'error' });
	}
}

function row(c) {
	const revoked = Boolean(c.revoked_at);
	const used = c.command_count
		? `${c.command_count} ${c.command_count === 1 ? 'command' : 'commands'}, last ${esc(relTime(c.last_command_at))}`
		: 'Not used yet';
	return `
		<div class="bc-row${revoked ? ' revoked' : ''}">
			<div class="bc-row-meta">
				<div class="bc-row-name">${esc(c.label)}</div>
				<div class="bc-row-facts">
					<span class="dn-tag">${revoked ? 'Revoked' : 'Active'}</span>
					<code>…${esc(c.token_hint)}</code>
					<span>Created ${esc(relTime(c.created_at))}</span>
					<span>${used}</span>
					${c.last_basecamp_account ? `<span>Basecamp account ${esc(c.last_basecamp_account)}</span>` : ''}
				</div>
			</div>
			${revoked ? '' : `<button type="button" class="dn-btn danger" data-revoke="${esc(c.id)}" aria-label="Revoke command URL ${esc(c.label)}">Revoke</button>`}
		</div>`;
}

function createdBlock(created) {
	return `
		<div class="bc-new" role="status">
			<div class="bc-new-title">Copy your command URL now</div>
			<div class="dn-panel-sub" style="margin:0 0 10px">This is the only time it is shown. Anyone who has it can make 3D models on this account, so paste it only into Basecamp.</div>
			<div class="bc-copy">
				<div class="bc-code" aria-label="New command URL">${esc(created.command_url)}</div>
				<button type="button" class="dn-btn primary" data-action="copy-url">Copy URL</button>
			</div>
			<ol>
				<li>In Basecamp, open the project's Campfire (an admin has to do this).</li>
				<li>Open the <strong>•••</strong> menu at the top and choose <strong>Configure chatbots</strong>, then <strong>Add a new chatbot</strong>.</li>
				<li>Name it <code>threews</code>, paste the URL into <strong>Command URL</strong>, and save.</li>
				<li>Type <code>!threews a low-poly lighthouse</code> in the Campfire. The model arrives in about a minute.</li>
			</ol>
		</div>`;
}

function paint(body, data, created, onRetry) {
	const chatbots = Array.isArray(data?.chatbots) ? data.chatbots : [];
	const active = chatbots.filter((c) => !c.revoked_at).length;
	const atLimit = active >= MAX_ACTIVE;

	body.innerHTML = `
		${created ? createdBlock(created) : ''}
		<form class="bc-form" data-slot="form" novalidate>
			<label class="bc-field">
				<span>Name (which Basecamp account or project it is for)</span>
				<input class="bc-input" name="label" maxlength="60" placeholder="Design team Basecamp" autocomplete="off" ${atLimit ? 'disabled' : ''}>
			</label>
			<button type="submit" class="dn-btn primary" ${atLimit ? 'disabled' : ''}>Create command URL</button>
		</form>
		<div data-slot="form-err" role="alert" style="color:var(--nxt-danger, #ff6b6b);font-size:13px;margin:-8px 0 12px"></div>
		${atLimit ? `<div class="dn-panel-sub" style="margin:-4px 0 12px">You have ${active} active command URLs, the maximum. Revoke one to create another.</div>` : ''}
		<div data-slot="list">
			${chatbots.length ? chatbots.map(row).join('') : emptyStateHTML({
				icon: '',
				compact: true,
				title: 'No Basecamp chatbots yet',
				body: 'Create a command URL above, then a Basecamp admin adds it as a chatbot named threews in a Campfire. One URL works across every project in that Basecamp account.',
			})}
		</div>`;

	body.querySelector('[data-action="copy-url"]')?.addEventListener('click', () => copy(created.command_url, 'Command URL'));

	const form = body.querySelector('[data-slot="form"]');
	const formErr = body.querySelector('[data-slot="form-err"]');
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		formErr.textContent = '';
		const btn = form.querySelector('button[type="submit"]');
		btn.disabled = true;
		btn.textContent = 'Creating…';
		try {
			const res = await post('/api/basecamp/chatbots', { label: form.elements.label.value.trim() || undefined });
			await refresh(body, res, onRetry);
		} catch (err) {
			formErr.textContent = err?.message || 'The command URL could not be created. Try again.';
			btn.disabled = false;
			btn.textContent = 'Create command URL';
		}
	});

	body.querySelectorAll('[data-revoke]').forEach((btn) => {
		btn.addEventListener('click', async () => {
			if (btn.dataset.confirm !== 'yes') {
				btn.dataset.confirm = 'yes';
				btn.textContent = 'Revoke: the chatbot stops working';
				return;
			}
			btn.disabled = true;
			try {
				const res = await del(`/api/basecamp/chatbots?id=${encodeURIComponent(btn.dataset.revoke)}`);
				toast('Command URL revoked', { variant: 'success' });
				paint(body, res, null, onRetry);
			} catch (err) {
				toast(err?.message || 'Could not revoke the command URL. Try again.', { variant: 'error' });
				btn.disabled = false;
			}
		});
	});
}
