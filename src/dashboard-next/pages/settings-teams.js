// Settings panel: Microsoft Teams notifications.
//
//   GET    /api/notifications/teams         linked Teams accounts + per-event switches
//   POST   /api/notifications/teams         { action: 'link-code' } | { action: 'test' }
//   PUT    /api/notifications/teams         { events: { forgeJobCompleted: false } }
//   DELETE /api/notifications/teams         unlink
//
// Shown whether or not an account is linked: unlinked it explains how to link,
// linked it lists the events (each saves as it is toggled) and offers a real
// test notification. See api/notifications/teams.js.

import { esc, get, post, put, del, relTime } from '../api.js';
import { emptyStateHTML, errorStateHTML, attachRetry } from '../../shared/state-kit.js';
import { toast } from '../../shared/toast.js';

const ID = 'teams-notifications';

const ERROR_COPY = {
	consent_missing: 'Your Microsoft 365 admin has not approved notifications for three.ws yet.',
	token_failed: 'Your Microsoft 365 admin has not approved notifications for three.ws yet.',
	not_installed: 'The three.ws app is not installed for this Teams account. Add it in Teams, then send the bot a message.',
	unauthorized: 'Microsoft rejected the request. Try the test again in a minute.',
	not_configured: 'Teams notifications are not enabled on this server yet.',
	network: 'Microsoft Graph could not be reached. Try again in a moment.',
	rejected: 'Microsoft rejected the notification.',
};

function panelShell() {
	const panel = document.createElement('div');
	panel.className = 'dn-panel';
	panel.id = ID;
	panel.setAttribute('aria-label', 'Microsoft Teams notifications');
	panel.innerHTML = `
		<div style="margin-bottom:14px">
			<div class="dn-panel-title">Microsoft Teams</div>
			<div class="dn-panel-sub" style="margin:2px 0 0">Get finished 3D models and agent activity in your Teams activity feed, with a push on your phone.</div>
		</div>
		<div data-slot="body"></div>`;
	return panel;
}

export function renderTeamsNotifications(resp, onRetry) {
	const panel = panelShell();
	const body = panel.querySelector('[data-slot="body"]');
	if (!resp.ok) {
		body.innerHTML = errorStateHTML({ title: "Couldn't load Teams settings", body: 'We could not reach the notification service. Try again in a moment.' });
		attachRetry(body, onRetry);
		return panel;
	}
	paint(panel, body, resp.data, onRetry);
	return panel;
}

async function refresh(panel, body, onRetry) {
	try {
		paint(panel, body, await get('/api/notifications/teams'), onRetry);
	} catch {
		body.innerHTML = errorStateHTML({ title: "Couldn't reload Teams settings", body: 'Your change may not have saved. Try again.' });
		attachRetry(body, onRetry);
	}
}

function paint(panel, body, data, onRetry) {
	const linked = Array.isArray(data.linked) ? data.linked : [];
	if (!data.configured) {
		body.innerHTML = emptyStateHTML({ icon: '', compact: true, title: 'Not available yet', body: ERROR_COPY.not_configured });
		return;
	}
	if (!linked.length) {
		body.innerHTML = `${emptyStateHTML({
			icon: '',
			compact: true,
			title: 'No Teams account linked',
			body: 'Add the three.ws app in Teams, create a code here, then send the three.ws bot: link ABCD-EFGH. The code works once and expires in ten minutes.',
			actions: [{ id: 'link', label: 'Create a link code', primary: true }],
		})}
		<div data-slot="code" aria-live="polite" style="margin-top:12px"></div>`;
		body.querySelector('[data-sk-action="link"]')?.addEventListener('click', (e) => createCode(e.currentTarget, body));
		return;
	}
	body.innerHTML = `
		<div style="display:grid;gap:8px;margin-bottom:14px">
			${linked.map((l) => `
				<div style="font-size:13px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
					<span class="dn-tag success">Linked</span>
					<span style="color:var(--nxt-ink-dim)">${l.last_sent_at ? `Last sent ${esc(relTime(l.last_sent_at))}` : 'Nothing sent yet'}</span>
					${l.last_error_code ? `<span class="dn-tag warn">${esc(ERROR_COPY[l.last_error_code] || ERROR_COPY.rejected)}</span>${l.consent_url ? `<a href="${esc(l.consent_url)}" target="_blank" rel="noopener" style="color:var(--nxt-accent)">Send the admin consent link</a>` : ''}` : ''}
				</div>`).join('')}
		</div>
		<div role="group" aria-label="Teams notification events" style="display:grid;gap:2px">
			${data.events.map((ev) => `
				<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--nxt-stroke)">
					<span style="font-size:13px">${esc(ev.label)}</span>
					<button type="button" role="switch" class="set-switch" data-teams-event="${esc(ev.type)}" aria-checked="${ev.enabled ? 'true' : 'false'}" aria-label="${esc(ev.label)} in Teams"></button>
				</div>`).join('')}
		</div>
		<div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
			<button type="button" class="dn-btn" data-action="teams-unlink">Unlink Teams</button>
			<button type="button" class="dn-btn primary" data-action="teams-test">Send a test notification</button>
		</div>
		<div data-slot="result" role="status" style="margin-top:10px;font-size:13px"></div>`;

	body.querySelectorAll('[data-teams-event]').forEach((sw) => {
		sw.addEventListener('click', async () => {
			const on = sw.getAttribute('aria-checked') !== 'true';
			sw.setAttribute('aria-checked', String(on));
			sw.disabled = true;
			try {
				await put('/api/notifications/teams', { events: { [sw.dataset.teamsEvent]: on } });
			} catch (err) {
				sw.setAttribute('aria-checked', String(!on));
				toast(err?.message || 'Could not save that change');
			} finally {
				sw.disabled = false;
			}
		});
	});
	body.querySelector('[data-action="teams-unlink"]')?.addEventListener('click', async (e) => {
		e.currentTarget.disabled = true;
		try {
			await del('/api/notifications/teams');
			toast('Teams unlinked');
		} catch (err) {
			toast(err?.message || 'Could not unlink Teams');
		}
		refresh(panel, body, onRetry);
	});
	body.querySelector('[data-action="teams-test"]')?.addEventListener('click', (e) => sendTest(e.currentTarget, body, panel, onRetry));
}

async function createCode(btn, body) {
	const slot = body.querySelector('[data-slot="code"]');
	btn.disabled = true;
	try {
		const c = await post('/api/notifications/teams', { action: 'link-code' });
		slot.innerHTML = `<div class="dn-panel-sub" style="margin:0">In Teams, send the three.ws bot:</div>
			<div style="font:600 20px/1.6 var(--nxt-mono, ui-monospace, monospace);letter-spacing:.04em;user-select:all">link ${esc(c.display)}</div>
			<div class="dn-panel-sub" style="margin:0">Expires in ${Math.round(c.expires_in / 60)} minutes. Reload this page after the bot confirms.</div>`;
	} catch (err) {
		slot.innerHTML = `<div style="color:var(--nxt-danger, #ff6b6b);font-size:13px">${esc(err?.message || 'Could not create a code. Try again.')}</div>`;
	} finally {
		btn.disabled = false;
	}
}

async function sendTest(btn, body, panel, onRetry) {
	const slot = body.querySelector('[data-slot="result"]');
	btn.disabled = true;
	btn.textContent = 'Sending…';
	slot.textContent = '';
	try {
		await post('/api/notifications/teams', { action: 'test' });
		slot.textContent = 'Sent. Look for it in your Teams activity feed.';
	} catch (err) {
		const failed = err?.body?.results?.find((r) => !r.ok);
		const code = failed?.code || err?.code;
		slot.textContent = ERROR_COPY[code] || failed?.message || err?.message || 'The test notification failed.';
		if (failed?.consent_url) slot.insertAdjacentHTML('beforeend', ` <a href="${esc(failed.consent_url)}" target="_blank" rel="noopener" style="color:var(--nxt-accent)">Admin consent link</a>`);
	} finally {
		btn.disabled = false;
		btn.textContent = 'Send a test notification';
	}
}
