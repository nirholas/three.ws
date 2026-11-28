// /slack: makes the Add to Slack button tell the truth (it asks the receiver
// whether OAuth is configured) and explains where an install attempt ended.
// The receiver redirects here with ?installed=1&team=&app= or ?install=<status>.

const STATUS_URL = '/api/gateway/slack?leg=status';
const INSTALL_URL = '/api/gateway/slack?leg=install';
const CONNECT_URL = '/settings/connections#tab-connections';
const SLACK_ID = /^[A-Z0-9]{2,32}$/;

const OUTCOMES = {
	cancelled: {
		tone: 'warn',
		title: 'Install cancelled',
		text: 'Nothing was added to your workspace. You can start again whenever you are ready.',
		retry: true,
	},
	expired: {
		tone: 'warn',
		title: 'That install link expired',
		text: 'An install has 15 minutes to finish, in the same browser that started it. Start again from this page.',
		retry: true,
	},
	failed: {
		tone: 'error',
		title: 'Slack did not finish the install',
		text: 'Slack returned an error while handing over access. Try again; if it keeps failing, contact support and mention the time you tried.',
		retry: true,
		support: true,
	},
	not_configured: {
		tone: 'error',
		title: 'Slack installs are paused',
		text: 'The Slack app is not accepting new workspaces right now. Telegram and Discord work today from Connections.',
		connect: 'Open Connections',
	},
};

function button(label, href, primary = false) {
	const a = document.createElement('a');
	a.className = primary ? 'sk-btn sk-btn--primary' : 'sk-btn';
	a.href = href;
	a.textContent = label;
	return a;
}

function showResult({ tone, title, text, actions }) {
	const box = document.getElementById('skResult');
	if (!box) return;
	box.dataset.tone = tone;
	document.getElementById('skResultTitle').textContent = title;
	document.getElementById('skResultText').textContent = text;
	document.getElementById('skResultActions').replaceChildren(...actions);
	box.hidden = false;
	box.focus({ preventScroll: true });
	box.scrollIntoView({ block: 'nearest' });
}

export function readOutcome(search) {
	const q = new URLSearchParams(search);
	if (q.get('installed') === '1') {
		const team = q.get('team');
		const app = q.get('app');
		return { kind: 'installed', team: SLACK_ID.test(team || '') ? team : null, app: SLACK_ID.test(app || '') ? app : null };
	}
	const status = q.get('install');
	if (status && Object.hasOwn(OUTCOMES, status)) return { kind: status };
	return null;
}

function renderOutcome(outcome) {
	if (outcome.kind === 'installed') {
		const actions = [button('Connect your three.ws account', CONNECT_URL, true)];
		if (outcome.team && outcome.app) {
			actions.push(button('Open in Slack', `https://slack.com/app_redirect?app=${outcome.app}&team=${outcome.team}`));
		}
		showResult({
			tone: 'ok',
			title: 'three.ws is in your workspace',
			text: 'Last step: pair it with your account. Send the three.ws app any direct message in Slack and it replies with a pairing link, or generate a code in Connections and run /three link <code> in Slack.',
			actions,
		});
		return;
	}
	const o = OUTCOMES[outcome.kind];
	const actions = [];
	if (o.retry) actions.push(button('Try again', INSTALL_URL, true));
	if (o.connect) actions.push(button(o.connect, CONNECT_URL, true));
	if (o.support) actions.push(button('Contact support', '/support'));
	showResult({ tone: o.tone, title: o.title, text: o.text, actions });
}

function setInstallState(available) {
	const btn = document.getElementById('skInstall');
	const note = document.getElementById('skInstallNote');
	if (!btn) return;
	btn.dataset.state = available ? 'available' : 'unavailable';
	if (available) {
		btn.removeAttribute('aria-disabled');
		return;
	}
	btn.setAttribute('aria-disabled', 'true');
	btn.removeAttribute('href');
	btn.setAttribute('role', 'link');
	if (note) {
		note.replaceChildren(
			'Slack installs are paused right now. Your agents are reachable today on Telegram and Discord from ',
			Object.assign(document.createElement('a'), { href: CONNECT_URL, textContent: 'Connections' }),
			'.',
		);
	}
}

async function checkAvailability() {
	try {
		const r = await fetch(STATUS_URL, { headers: { accept: 'application/json' } });
		if (!r.ok) throw new Error(`status ${r.status}`);
		const body = await r.json();
		setInstallState(body.available === true);
	} catch {
		// The status check is advisory. If it cannot be reached, keep the real
		// install link: the receiver itself explains a paused install.
		const btn = document.getElementById('skInstall');
		if (btn) btn.dataset.state = 'available';
	}
}

function init() {
	const outcome = readOutcome(location.search);
	if (outcome) {
		renderOutcome(outcome);
		history.replaceState(null, '', location.pathname + location.hash);
	}
	checkAvailability();
}

if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
	else init();
}
