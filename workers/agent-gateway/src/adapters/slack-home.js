// The Slack App Home tab: what someone sees when they open the three.ws app in
// Slack. It is published per person (views.publish) every time they open the
// Home tab, from the live pairing of their DM with the app, so it always says
// truthfully whether this Slack account is connected and to which agent.

import { COMMANDS } from '../../../../api/_lib/gateway/commands.js';
import { appOrigin } from '../../../../api/_lib/gateway/format.js';
import { getLiveLink } from '../../../../api/_lib/gateway/store.js';
import { resolveChatAgent } from '../../../../api/_lib/gateway/agents.js';

const mrkdwn = (text) => ({ type: 'mrkdwn', text });
const section = (text) => ({ type: 'section', text: mrkdwn(text) });
const urlButton = (actionId, label, url, style) => ({
	type: 'button', action_id: actionId, url, text: { type: 'plain_text', text: label }, ...(style ? { style } : {}),
});

/** Slack mrkdwn control characters; everything else renders as typed. */
function esc(text) {
	return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function commandLines() {
	return COMMANDS
		.filter((c) => c.name !== 'link')
		// Descriptions spell usage the Telegram way (/buy ...); in Slack it is /three buy ...
		.map((c) => `\`/three ${c.name}${c.arg ? ` <${c.arg}>` : ''}\`  ${esc(c.description.replace(/(^|\s)\/(\w+)/g, '$1/three $2'))}`)
		.join('\n');
}

/**
 * @param {{ paired:boolean, agentName?:string|null, origin?:string }} state
 * @returns {{ type:'home', blocks:object[] }}
 */
export function buildHomeView({ paired, agentName = null, origin = appOrigin() }) {
	const blocks = [
		{ type: 'header', text: { type: 'plain_text', text: 'three.ws agent' } },
		section('Talk to your three.ws AI agent without leaving Slack. Ask about balances and positions, review the trades your agent prepares and approve or cancel them with a button, and get account alerts here.'),
		{ type: 'divider' },
	];

	if (paired) {
		const who = agentName ? `*${esc(agentName)}*` : 'your agent';
		blocks.push(section(`*Connected.* Your messages to this app go to ${who} on your three.ws account.${agentName ? '' : ' Run `/three agents`, then `/three use <agent>` to pick which agent answers.'}`));
		blocks.push({
			type: 'actions',
			elements: [
				urlButton('home_connections', 'Manage connections', `${origin}/settings/connections`, 'primary'),
				urlButton('home_dashboard', 'Open three.ws', `${origin}/dashboard`),
			],
		});
	} else {
		blocks.push(section([
			'*Not connected yet.* Link this app to your three.ws account in either of two ways:',
			'1. Open the *Messages* tab and send me anything. I reply with a pairing code; confirm it on three.ws.',
			'2. Or generate a code on three.ws (Settings, Connections) and run `/three link <code>` here.',
			'',
			'No account yet? Creating one is free.',
		].join('\n')));
		blocks.push({
			type: 'actions',
			elements: [
				urlButton('home_connect', 'Connect on three.ws', `${origin}/settings/connections`, 'primary'),
				urlButton('home_how', 'How it works', `${origin}/slack`),
			],
		});
	}

	blocks.push(
		{ type: 'divider' },
		section(`*Commands*\nType these anywhere in Slack. Only you see the answer.\n${commandLines()}`),
		{ type: 'divider' },
		{
			type: 'context',
			elements: [mrkdwn(`Trades never run from text alone: each one arrives as a preview with Approve and Cancel buttons and expires after ten minutes. <${origin}/legal/privacy#slack|Privacy> · <${origin}/support|Support> · <${origin}/slack|About this app>`)],
		},
	);
	return { type: 'home', blocks };
}

/** The view for the person whose Home tab opened: paired or not, and to which agent. */
export async function homeViewFor(chatId) {
	const link = await getLiveLink('slack', chatId);
	if (!link) return buildHomeView({ paired: false });
	const agent = await resolveChatAgent(link).catch(() => null);
	return buildHomeView({ paired: true, agentName: agent?.name || null });
}
